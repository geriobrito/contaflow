import type { BankAccount, BankTransaction, ChartAccount, PeriodLock, ResultSummary } from '@/types/firestore';
import { ledgerEntries, type Posting } from '@/lib/ledger';
import { monthsBetween } from '@/lib/periods';
import { toCents } from '@/lib/money';
import { hash, ledgerConfigKey, monthEnd } from '@/lib/snapshots';
import { resolveDREGroup, type DateRange } from './build';

/**
 * Resumos da DRE por competência fechada.
 *
 * A DRE, a comparação com o ano anterior e a visão executiva releem o exercício inteiro a
 * cada consulta. Numa competência fechada os lançamentos não mudam (as regras do Firestore
 * os congelam), então basta guardar, por mês, o que a DRE tira deles: a soma e a quantidade
 * de partidas por conta de resultado, as contagens por situação e as partidas do razão (para a
 * conferência DRE × balanço). Um resumo só vale enquanto:
 *   - a competência segue fechada no mesmo fechamento (`lockedAt`);
 *   - a quantidade de lançamentos do mês é a mesma (importar em mês fechado é permitido);
 *   - bancos e contas do plano são os mesmos (`configKey`).
 * Se algo muda, o mês volta a ser lido lançamento a lançamento e o resumo é refeito.
 */

/** Muda quando o conteúdo ou a forma de calcular o resumo muda: os antigos deixam de valer. */
const SUMMARY_VERSION = 1;

export const summaryId = (clientId: string, month: string): string => `${clientId}_${month}`;

/** Bancos e plano de que o resumo depende, mais quais contas transitam pela DRE (tipo e grupo). */
export function summaryConfigKey(banks: readonly BankAccount[], accounts: readonly ChartAccount[]): string {
  const result = accounts
    .filter((a) => resolveDREGroup(a) !== null)
    .map((a) => a.id)
    .sort();
  return `s${SUMMARY_VERSION}-${ledgerConfigKey(banks, accounts)}-${hash(result.join('|'))}`;
}

/** Resumo de uma competência a partir de todos os lançamentos bancários dela. */
export function buildResultSummary(args: {
  clientId: string;
  month: string;
  transactions: readonly BankTransaction[];
  banks: readonly BankAccount[];
  accounts: readonly ChartAccount[];
  lockedAt: string;
  createdAt: string;
}): ResultSummary {
  const { clientId, month, transactions, banks, accounts, lockedAt, createdAt } = args;
  if (transactions.some((t) => t.date.slice(0, 7) !== month)) throw new Error('Lançamentos fora da competência do resumo.');
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const lines = new Map<string, { cents: number; count: number }>();
  let reconciledCount = 0;
  let awaitingApproval = 0;
  let pendingCount = 0;

  // Mesmo critério de buildDRE: só os conciliados, cada partida na sua conta de resultado.
  for (const t of transactions) {
    if (t.status === 'AUTO_CLASSIFIED') awaitingApproval++;
    if (t.status === 'PENDING') pendingCount++;
    if (t.status !== 'RECONCILED') continue;
    const parts =
      t.isSplit && t.splits && t.splits.length > 0
        ? t.splits.map((sp) => ({ accountId: sp.accountId, amount: sp.amount }))
        : t.accountId
          ? [{ accountId: t.accountId, amount: t.amount }]
          : [];
    let counted = false;
    for (const p of parts) {
      const acc = byId.get(p.accountId);
      if (!acc || !resolveDREGroup(acc)) continue;
      counted = true;
      const line = lines.get(acc.id) ?? { cents: 0, count: 0 };
      line.cents += toCents(p.amount);
      line.count += 1;
      lines.set(acc.id, line);
    }
    if (counted) reconciledCount++;
  }

  // Partidas do razão do mês, sem os saldos iniciais dos bancos (lançados à parte, na hora).
  const postings = new Map<string, number>();
  const banksWithoutOpening = banks.map((b) => ({ ...b, openingBalance: undefined }));
  for (const e of ledgerEntries(transactions, banksWithoutOpening, accounts)) {
    if (e.source !== 'bank') continue;
    for (const l of e.lines) postings.set(l.accountId, (postings.get(l.accountId) ?? 0) + toCents(l.value));
  }

  return {
    id: summaryId(clientId, month),
    clientId,
    month,
    lockedAt,
    txCount: transactions.length,
    configKey: summaryConfigKey(banks, accounts),
    lines: [...lines]
      .map(([accountId, l]) => ({ accountId, amount: l.cents / 100, count: l.count }))
      .sort((a, b) => a.accountId.localeCompare(b.accountId)),
    reconciledCount,
    awaitingApproval,
    pendingCount,
    postings: [...postings]
      .filter(([, cents]) => cents !== 0)
      .map(([accountId, cents]) => ({ accountId, value: cents / 100 }))
      .sort((a, b) => a.accountId.localeCompare(b.accountId)),
    createdAt,
  };
}

/**
 * Por que o resumo não pode ser usado com os dados atuais, ou null se pode. A contagem de
 * lançamentos (`txCount`) é conferida no servidor por quem carrega.
 */
export function summaryProblem(summary: ResultSummary, current: { lock: PeriodLock | undefined; configKey: string }): string | null {
  if (!current.lock) return 'competência reaberta';
  if (current.lock.lockedAt !== summary.lockedAt) return 'competência reaberta e fechada de novo';
  if (summary.configKey !== current.configKey) return 'bancos ou plano de contas alterados';
  return null;
}

/** Competências inteiras dentro do intervalo (as das pontas, se cortadas, ficam de fora). */
export function wholeMonthsIn(range: DateRange): string[] {
  return monthsBetween(range.start, range.end).filter((m) => `${m}-01` >= range.start && monthEnd(m) <= range.end);
}

/** Resumos que valem para o intervalo: só os de competências inteiras dentro dele. */
export const summariesIn = (summaries: readonly ResultSummary[] | null | undefined, range: DateRange): ResultSummary[] =>
  (summaries ?? []).filter((s) => `${s.month}-01` >= range.start && monthEnd(s.month) <= range.end);

/** Partidas do razão dos resumos, no último dia de cada competência (para `buildPostings(..., carry)`). */
export const summaryPostings = (summaries: readonly ResultSummary[] | null | undefined): Posting[] =>
  (summaries ?? []).flatMap((s) => s.postings.map((p) => ({ accountId: p.accountId, date: monthEnd(s.month), value: p.value })));

/** Sequências de meses consecutivos (para contar lançamentos com duas consultas por sequência). */
export function consecutiveRuns(months: readonly string[]): string[][] {
  const sorted = [...months].sort();
  const runs: string[][] = [];
  const next = (m: string) => {
    const [y, mm] = m.split('-').map(Number);
    return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
  };
  for (const m of sorted) {
    const last = runs[runs.length - 1];
    if (last && next(last[last.length - 1]) === m) last.push(m);
    else runs.push([m]);
  }
  return runs;
}
