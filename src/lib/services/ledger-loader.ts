import type { BankAccount, BankTransaction, ChartAccount, MonthCounts, PeriodLock, PeriodSnapshot } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import type { Posting } from '@/lib/ledger';
import { getRepository } from '@/lib/services/data-service';
import { monthOf } from '@/lib/periods';
import { addDays } from '@/lib/statement';
import { buildSnapshot, carryOf, monthEnd, snapshotProblem, snapshotTarget } from '@/lib/snapshots';

/** Lançamentos de um cliente a partir de um corte, mais o acumulado de tudo que veio antes. */
export interface LedgerWindow {
  /** Lançamentos posteriores a `asOf` (ou todos, quando não há consolidado utilizável). */
  transactions: BankTransaction[];
  /** Saldos dos lançamentos até `asOf`, como partidas: passe a `buildPostings(..., carry)`. */
  carry: Posting[];
  /** Contagens por competência e total dos lançamentos consolidados (ausentes de `transactions`). */
  carriedMonths: MonthCounts[];
  carriedCount: number;
  /** Último dia consolidado, ou null se o histórico inteiro foi lido. */
  asOf: string | null;
}

const FIRST_DAY = '0000-01-01';
const LAST_DAY = '9999-12-31';
/** Snapshots conferidos antes de desistir e ler o histórico inteiro. */
const MAX_CANDIDATES = 3;

/**
 * Carrega os lançamentos do cliente lendo o mínimo possível: parte do snapshot válido mais
 * recente (competências fechadas) e busca só o que veio depois. Sem snapshot utilizável, lê
 * tudo — o resultado é o mesmo, só mais caro — e deixa gravado o snapshot para a próxima vez.
 *
 * `from` é o primeiro dia de que a tela precisa dos lançamentos um a um: o consolidado
 * sempre termina antes dele. Para balanço e razão, é o início do exercício (1º de janeiro),
 * porque as contas de resultado zeram na virada do ano. Omitido, usa o corte mais recente.
 */
export async function loadLedgerWindow(
  args: {
    clientId: string;
    accounts: readonly ChartAccount[];
    banks: readonly BankAccount[];
    locks?: readonly PeriodLock[];
    from?: string;
    until?: string;
  },
  repo: DataRepository = getRepository()
): Promise<LedgerWindow> {
  const { clientId, accounts, banks, from, until } = args;
  const locks = args.locks ?? (await repo.listPeriodLocks(clientId));
  const beforeMonth = from ? monthOf(from) : undefined;
  const current = { banks, accounts, locks };

  // 1. Snapshot válido mais recente, anterior a `from`.
  let base: PeriodSnapshot | null = null;
  if (locks.some((l) => !beforeMonth || l.month < beforeMonth)) {
    try {
      const stored = (await repo.listPeriodSnapshots(clientId))
        .filter((s) => !beforeMonth || s.month < beforeMonth)
        .sort((a, b) => b.month.localeCompare(a.month));
      for (const candidate of stored.slice(0, MAX_CANDIDATES)) {
        if (snapshotProblem(candidate, current)) continue;
        // Importar extrato em competência fechada é permitido e muda os saldos: a contagem denuncia.
        if ((await repo.countTransactions(clientId, candidate.asOf)) !== candidate.txCount) continue;
        base = candidate;
        break;
      }
    } catch (e) {
      // O snapshot é só um atalho: sem ele, o histórico completo dá o mesmo resultado.
      console.warn('Saldos consolidados indisponíveis; lendo o histórico completo.', e);
      base = null;
    }
  }

  // 2. Só os lançamentos posteriores ao snapshot (ou todos).
  const loaded = await repo.listTransactions(
    clientId,
    base || until ? { start: base ? addDays(base.asOf, 1) : FIRST_DAY, end: until ?? LAST_DAY } : undefined
  );

  // 3. Se já dá para consolidar até uma competência fechada mais recente, grava para a próxima leitura.
  const dataMonths = new Set([...(base?.months ?? []).map((m) => m.month), ...loaded.map((t) => monthOf(t.date))]);
  const target = snapshotTarget(locks, dataMonths, beforeMonth);
  if (target && (!base || target > base.month) && (!until || monthEnd(target) <= until)) {
    const cut = monthEnd(target);
    const next = buildSnapshot({
      clientId,
      month: target,
      base,
      transactions: loaded.filter((t) => t.date <= cut),
      banks,
      accounts,
      locks,
      createdAt: new Date().toISOString(),
    });
    if (next) {
      try {
        await repo.savePeriodSnapshot(next);
      } catch (e) {
        console.warn('Não foi possível gravar os saldos consolidados; a próxima leitura refaz o cálculo.', e);
      }
      return windowOf(next, loaded.filter((t) => t.date > cut));
    }
  }
  return windowOf(base, loaded);
}

function windowOf(snapshot: PeriodSnapshot | null, transactions: BankTransaction[]): LedgerWindow {
  return {
    transactions,
    carry: carryOf(snapshot),
    carriedMonths: snapshot?.months ?? [],
    carriedCount: snapshot?.txCount ?? 0,
    asOf: snapshot?.asOf ?? null,
  };
}
