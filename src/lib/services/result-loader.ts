import type { BankAccount, BankTransaction, ChartAccount, PeriodLock, ResultSummary } from '@/types/firestore';
import type { DataRepository, DateRange } from '@/lib/data/repository';
import { getRepository } from '@/lib/services/data-service';
import { buildResultSummary, consecutiveRuns, summaryConfigKey, summaryProblem, wholeMonthsIn } from '@/lib/dre/summaries';
import { monthsBetween } from '@/lib/periods';
import { addDays } from '@/lib/statement';
import { monthEnd } from '@/lib/snapshots';
import { reportError } from '@/lib/monitoring';

/** Lançamentos de um intervalo para a DRE: os meses fechados resumidos e o resto lançamento a lançamento. */
export interface ResultWindow {
  /** Lançamentos dos meses do intervalo que não vieram resumidos. */
  transactions: BankTransaction[];
  /** Resumos válidos (meses inteiros e fechados), no lugar dos lançamentos desses meses. */
  summaries: ResultSummary[];
  /** Meses cujo resumo foi refeito agora a partir dos lançamentos. */
  rebuilt: string[];
}

/**
 * Carrega o que a DRE precisa de `range` lendo o mínimo possível: competências inteiras e
 * fechadas vêm do resumo (um documento por mês, conferido antes de usar); as demais são lidas
 * lançamento a lançamento. Resumo ausente ou inválido de mês fechado é refeito e gravado para
 * a próxima consulta. Sem resumo utilizável, o resultado é o mesmo, só mais caro.
 */
export async function loadResultWindow(
  args: {
    clientId: string;
    range: DateRange;
    accounts: readonly ChartAccount[];
    banks: readonly BankAccount[];
    locks: readonly PeriodLock[];
  },
  repo: DataRepository = getRepository()
): Promise<ResultWindow> {
  const { clientId, range, accounts, banks, locks } = args;
  const lockOf = new Map(locks.map((l) => [l.month, l] as const));
  const lockedWhole = wholeMonthsIn(range).filter((m) => lockOf.has(m));
  const configKey = summaryConfigKey(banks, accounts);

  // 1. Resumos guardados e conferidos (fechamento, plano/bancos e quantidade de lançamentos).
  let valid: ResultSummary[] = [];
  if (lockedWhole.length > 0) {
    try {
      const stored = await repo.listResultSummaries(clientId, lockedWhole[0], lockedWhole[lockedWhole.length - 1]);
      const wanted = new Set(lockedWhole);
      const candidates = new Map(
        stored.filter((s) => wanted.has(s.month) && !summaryProblem(s, { lock: lockOf.get(s.month), configKey })).map((s) => [s.month, s] as const)
      );
      // Importar extrato em mês fechado é permitido: a contagem no servidor denuncia (duas consultas por sequência de meses).
      for (const run of consecutiveRuns([...candidates.keys()])) {
        const before = await repo.countTransactions(clientId, addDays(`${run[0]}-01`, -1));
        const until = await repo.countTransactions(clientId, monthEnd(run[run.length - 1]));
        const expected = run.reduce((sum, m) => sum + candidates.get(m)!.txCount, 0);
        if (until - before === expected) valid.push(...run.map((m) => candidates.get(m)!));
      }
    } catch (e) {
      reportError(e, { area: 'dre', op: 'ler resumos da DRE', level: 'warning' });
      valid = [];
    }
  }

  // 2. Os demais meses do intervalo, lançamento a lançamento (uma consulta por trecho contínuo).
  const covered = new Set(valid.map((s) => s.month));
  const segments = consecutiveRuns(monthsBetween(range.start, range.end).filter((m) => !covered.has(m)));
  const transactions: BankTransaction[] = [];
  for (const seg of segments) {
    const start = `${seg[0]}-01` < range.start ? range.start : `${seg[0]}-01`;
    const endOfLast = monthEnd(seg[seg.length - 1]);
    const end = endOfLast > range.end ? range.end : endOfLast;
    transactions.push(...(await repo.listTransactions(clientId, { start, end })));
  }
  transactions.sort((a, b) => b.date.localeCompare(a.date));

  // 3. Meses fechados lidos agora: grava o resumo para a próxima vez (atalho; a falha não bloqueia).
  const rebuilt = lockedWhole.filter((m) => !covered.has(m));
  if (rebuilt.length > 0) {
    const createdAt = new Date().toISOString();
    const byMonth = new Map<string, BankTransaction[]>();
    for (const t of transactions) {
      const m = t.date.slice(0, 7);
      if (rebuilt.includes(m)) byMonth.set(m, [...(byMonth.get(m) ?? []), t]);
    }
    const fresh = rebuilt.map((month) =>
      buildResultSummary({ clientId, month, transactions: byMonth.get(month) ?? [], banks, accounts, lockedAt: lockOf.get(month)!.lockedAt, createdAt })
    );
    try {
      await repo.saveResultSummaries(fresh);
    } catch (e) {
      reportError(e, { area: 'dre', op: 'gravar resumos da DRE', level: 'warning' });
    }
  }

  return { transactions, summaries: valid.sort((a, b) => a.month.localeCompare(b.month)), rebuilt };
}
