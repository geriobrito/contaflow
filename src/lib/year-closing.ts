import type { ChartAccount, JournalEntry, JournalEntryLine, PeriodLock } from '@/types/firestore';
import { accountKind, type Posting } from '@/lib/ledger';
import { MAX_JOURNAL_LINES } from '@/lib/journal';
import { missingTemplateAccounts } from '@/lib/chart/itg1000';
import { formatMonth, monthsBetween } from '@/lib/periods';
import { fromCents, toCents } from '@/lib/money';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

/**
 * Encerramento do exercício (ARE) e Demonstração de Lucros ou Prejuízos Acumulados (DLPA).
 *
 * Em 31/12 as contas de resultado são zeradas contra a ARE (Apuração do Resultado do
 * Exercício), e o saldo da ARE vai para Lucros Acumulados (lucro) ou Prejuízos Acumulados
 * (prejuízo). São lançamentos manuais comuns no Diário (`category: 'CLOSING'`), marcados com
 * `yearClosing`, divididos em partes de até MAX_JOURNAL_LINES partidas e gravados todos numa
 * única operação, com um só registro de auditoria (`closeYear` no repositório). O razão não precisa de
 * tratamento próprio: com as contas de resultado do ano zeradas, o resultado daquele ano deixa
 * de aparecer como "Resultados de exercícios anteriores" e passa a estar no PL de verdade. Sem
 * encerramento, o cálculo virtual de sempre continua valendo.
 */

export const ARE_CODE = '5.1.1.01';
export const RETAINED_EARNINGS_CODE = '2.3.3.01';
export const ACCUMULATED_LOSSES_CODE = '2.3.3.02';
export const DISTRIBUTED_PROFITS_CODE = '2.3.3.03';
/** Contas do modelo de que o encerramento precisa (com os grupos), criadas se faltarem no plano. */
export const CLOSING_ACCOUNT_CODES: readonly string[] = ['5', '5.1', '5.1.1', ARE_CODE, '2.3.3', RETAINED_EARNINGS_CODE, ACCUMULATED_LOSSES_CODE];

export const yearStartOf = (year: string) => `${year}-01-01`;
export const yearEndOf = (year: string) => `${year}-12-31`;

/** Lançamentos que encerram o exercício `year`. */
export const closingEntriesOf = (entries: readonly JournalEntry[], year: string): JournalEntry[] =>
  entries.filter((e) => e.yearClosing === year).sort((a, b) => a.entryNumber - b.entryNumber);

/** Lançamentos sem o encerramento de `year`: a base para apurar o resultado dele. */
export const withoutClosingOf = (entries: readonly JournalEntry[], year: string): JournalEntry[] =>
  entries.filter((e) => e.yearClosing !== year);

export function yearClosingLockedMessage(entry: Pick<JournalEntry, 'entryNumber' | 'yearClosing'>): string {
  return `O lançamento #${entry.entryNumber} é o encerramento do exercício de ${entry.yearClosing}. Para desfazê-lo, reabra o exercício em Balanço › DLPA.`;
}

/** Contas do encerramento que faltam no plano (ARE, Lucros e Prejuízos Acumulados e os grupos). */
export function missingClosingAccounts(clientId: string, accounts: readonly ChartAccount[]): ChartAccount[] {
  return missingTemplateAccounts(clientId, accounts).filter((a) => CLOSING_ACCOUNT_CODES.includes(a.code));
}

/* =========================================================================
   Apuração
   ========================================================================= */

export interface ResultBalance {
  accountId: string;
  /** Saldo no exercício em centavos (positivo = devedor: despesa; negativo = credor: receita). */
  cents: number;
}

/**
 * Saldo de cada conta de resultado no exercício. `postings` não deve conter o encerramento do
 * próprio exercício (ver `withoutClosingOf`).
 */
export function resultBalances(postings: readonly Posting[], accounts: readonly ChartAccount[], year: string): ResultBalance[] {
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const start = yearStartOf(year);
  const end = yearEndOf(year);
  const sums = new Map<string, number>();
  for (const p of postings) {
    if (p.date < start || p.date > end) continue;
    const acc = byId.get(p.accountId);
    if (!acc || accountKind(acc) !== 'RESULT') continue;
    sums.set(acc.id, (sums.get(acc.id) ?? 0) + toCents(p.value));
  }
  const code = (id: string) => byId.get(id)?.code ?? '';
  return [...sums]
    .filter(([, cents]) => cents !== 0)
    .map(([accountId, cents]) => ({ accountId, cents }))
    .sort((a, b) => code(a.accountId).localeCompare(code(b.accountId), undefined, { numeric: true }));
}

export type ClosingDraft = Pick<JournalEntry, 'date' | 'memo' | 'category' | 'lines' | 'totalAmount' | 'yearClosing'>;

/**
 * Lançamentos de encerramento de `year`: partes que zeram as contas de resultado contra a ARE
 * (até MAX_JOURNAL_LINES − 1 contas cada, mais a partida da ARE) e, por fim, a transferência do
 * saldo da ARE para Lucros Acumulados ou Prejuízos Acumulados. Sem resultado, nada a lançar.
 */
export function buildClosingDrafts(year: string, balances: readonly ResultBalance[], accounts: readonly ChartAccount[]): ClosingDraft[] {
  const byCode = new Map(accounts.map((a) => [a.code, a] as const));
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const are = byCode.get(ARE_CODE);
  const retained = byCode.get(RETAINED_EARNINGS_CODE);
  const losses = byCode.get(ACCUMULATED_LOSSES_CODE);
  if (!are || !retained || !losses) throw new Error(`O plano precisa das contas ${ARE_CODE}, ${RETAINED_EARNINGS_CODE} e ${ACCUMULATED_LOSSES_CODE} para encerrar o exercício.`);

  const date = yearEndOf(year);
  const draft = (memo: string, lines: Omit<JournalEntryLine, 'id'>[]): ClosingDraft => ({
    date,
    memo,
    category: 'CLOSING',
    yearClosing: year,
    lines: lines.map((l, i) => ({ ...l, id: `are_${year}_${i + 1}` })),
    totalAmount: fromCents(lines.filter((l) => l.type === 'DEBIT').reduce((s, l) => s + toCents(l.amount), 0)),
  });
  const line = (acc: ChartAccount, cents: number, type: 'DEBIT' | 'CREDIT'): Omit<JournalEntryLine, 'id'> => ({
    accountId: acc.id,
    accountCode: acc.code,
    accountName: acc.name,
    type,
    amount: fromCents(Math.abs(cents)),
  });

  // A ARE pode já ter saldo (lançamento manual nela): entra na transferência, não é zerada à parte.
  const toZero = balances.filter((b) => b.accountId !== are.id && b.cents !== 0);
  const areOwn = balances.find((b) => b.accountId === are.id)?.cents ?? 0;
  const size = MAX_JOURNAL_LINES - 1;
  const parts = Math.ceil(toZero.length / size);
  const drafts: ClosingDraft[] = [];
  for (let k = 0; k < parts; k++) {
    const chunk = toZero.slice(k * size, (k + 1) * size);
    // Saldo devedor (despesa) sai a crédito; credor (receita), a débito. A ARE recebe a soma.
    const lines = chunk.map((b) => line(byId.get(b.accountId)!, b.cents, b.cents > 0 ? 'CREDIT' : 'DEBIT'));
    const sum = chunk.reduce((s, b) => s + b.cents, 0);
    if (sum !== 0) lines.push(line(are, sum, sum > 0 ? 'DEBIT' : 'CREDIT'));
    drafts.push(draft(`Encerramento do exercício de ${year}: contas de resultado para a ARE${parts > 1 ? ` (parte ${k + 1} de ${parts})` : ''}`, lines));
  }

  // Saldo da ARE depois das partes: credor = lucro; devedor = prejuízo.
  const total = toZero.reduce((s, b) => s + b.cents, 0) + areOwn;
  if (total < 0) {
    drafts.push(draft(`Encerramento do exercício de ${year}: lucro do exercício para Lucros Acumulados`, [line(are, total, 'DEBIT'), line(retained, total, 'CREDIT')]));
  } else if (total > 0) {
    drafts.push(draft(`Encerramento do exercício de ${year}: prejuízo do exercício para Prejuízos Acumulados`, [line(losses, total, 'DEBIT'), line(are, total, 'CREDIT')]));
  }
  return drafts;
}

/* =========================================================================
   Situação do exercício
   ========================================================================= */

export interface YearClosingState {
  year: string;
  /** Lançamentos de encerramento já gravados. */
  entries: JournalEntry[];
  closed: boolean;
  decemberLocked: boolean;
  /** Resultado do exercício antes do encerramento (lucro positivo). */
  netResult: number;
  /** O que ainda sobra nas contas de resultado depois do encerramento (lançamentos posteriores a ele). */
  residual: number;
  /** Encerrado, mas as contas de resultado não estão zeradas: precisa reabrir e encerrar de novo. */
  stale: boolean;
  /** Motivos que impedem encerrar agora. */
  blockers: string[];
  /** Avisos que não impedem. */
  warnings: string[];
  canClose: boolean;
}

/**
 * Situação do encerramento de `year`. `postings` são as partidas do exercício sem o
 * encerramento dele (ver `withoutClosingOf`); `monthsWithData`, as competências do ano com
 * lançamentos, para avisar das que seguem abertas.
 */
export function yearClosingState(args: {
  year: string;
  postings: readonly Posting[];
  accounts: readonly ChartAccount[];
  journalEntries: readonly JournalEntry[];
  locks: readonly PeriodLock[];
  monthsWithData?: Iterable<string>;
  implantation?: string | null;
}): YearClosingState {
  const { year, postings, accounts, journalEntries, locks, implantation } = args;
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const entries = closingEntriesOf(journalEntries, year);
  const balances = resultBalances(postings, accounts, year);
  const netCents = balances.reduce((s, b) => s - b.cents, 0);

  // Efeito do encerramento gravado sobre as contas de resultado: o que sobra é o residual.
  const after = new Map(balances.map((b) => [b.accountId, b.cents] as const));
  for (const e of entries) {
    for (const l of e.lines) {
      const acc = byId.get(l.accountId);
      if (!acc || accountKind(acc) !== 'RESULT') continue;
      after.set(acc.id, (after.get(acc.id) ?? 0) + (l.type === 'DEBIT' ? 1 : -1) * toCents(l.amount));
    }
  }
  const leftover = [...after.values()].filter((c) => c !== 0);
  const residual = leftover.reduce((s, c) => s - c, 0);
  const closed = entries.length > 0;
  const stale = closed && leftover.length > 0;

  const lockedMonths = new Set(locks.map((l) => l.month));
  const decemberLocked = lockedMonths.has(`${year}-12`);
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (implantation && yearEndOf(year) <= implantation) {
    blockers.push(`O exercício de ${year} termina até a data de implantação (${formatDateBR(implantation)}): o resultado dele já está nos saldos de abertura.`);
  }
  if (!decemberLocked) blockers.push(`Feche a competência de ${formatMonth(`${year}-12`)} antes de encerrar o exercício.`);
  if (balances.length === 0) blockers.push(`Sem resultado a encerrar em ${year}: as contas de resultado não têm saldo.`);
  for (const code of [ARE_CODE, RETAINED_EARNINGS_CODE, ACCUMULATED_LOSSES_CODE]) {
    const acc = accounts.find((a) => a.code === code);
    if (acc && acc.nature !== 'ANALYTIC') blockers.push(`A conta ${code} (${acc.name}) precisa ser analítica para receber o encerramento.`);
  }
  const months = new Set(args.monthsWithData ?? []);
  const open = monthsBetween(yearStartOf(year), yearEndOf(year)).filter((m) => months.has(m) && !lockedMonths.has(m));
  if (open.length > 0) {
    warnings.push(
      `Competências ainda abertas em ${year}: ${open.map((m) => formatMonth(m)).join(', ')}. O que mudar nelas depois do encerramento o deixa desatualizado.`
    );
  }
  return {
    year,
    entries,
    closed,
    decemberLocked,
    netResult: fromCents(netCents),
    residual: fromCents(residual),
    stale,
    blockers,
    warnings,
    canClose: !closed && blockers.length === 0,
  };
}

/**
 * Quanto o encerramento de `year` (até `until`) levou ao patrimônio líquido, credor positivo:
 * o lucro transferido (negativo, se prejuízo). Some ao "Resultado do exercício" do balanço para
 * comparar com a DRE, que mostra o resultado antes do encerramento.
 */
export function closingTransfer(journalEntries: readonly JournalEntry[] | null | undefined, accounts: readonly ChartAccount[], year: string, until: string): number {
  if (!journalEntries) return 0;
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  let cents = 0;
  for (const e of journalEntries) {
    if (e.yearClosing !== year || e.date > until) continue;
    for (const l of e.lines) {
      const acc = byId.get(l.accountId);
      if (!acc || accountKind(acc) === 'RESULT') continue;
      cents += (l.type === 'CREDIT' ? 1 : -1) * toCents(l.amount);
    }
  }
  return fromCents(cents);
}

/* =========================================================================
   DLPA
   ========================================================================= */

export type DLPARowKind = 'balance' | 'movement';

export interface DLPARow {
  kind: DLPARowKind;
  label: string;
  /** Credor positivo: lucros aumentam, prejuízos e distribuições reduzem. */
  value: number;
}

export interface DLPA {
  year: string;
  start: string;
  end: string;
  opening: number;
  adjustments: number;
  netResult: number;
  distributions: number;
  closing: number;
  rows: DLPARow[];
}

const isRetained = (a: ChartAccount) => accountKind(a) === 'EQUITY' && (a.code === '2.3.3' || a.code.startsWith('2.3.3.'));
const isDistribution = (a: ChartAccount) => a.code === DISTRIBUTED_PROFITS_CODE || /distribu/i.test(a.name);

/**
 * DLPA do exercício de `end` (1º de janeiro até `end`), sobre as partidas completas (com o
 * encerramento, se houver). Lucros ou Prejuízos Acumulados são o grupo 2.3.3 mais o resultado
 * ainda não encerrado de exercícios anteriores. O saldo final é a soma das linhas.
 */
export function buildDLPA(postings: readonly Posting[], accounts: readonly ChartAccount[], journalEntries: readonly JournalEntry[] | null | undefined, end: string): DLPA {
  const year = end.slice(0, 4);
  const start = yearStartOf(year);
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  let groupBefore = 0;
  let resultBefore = 0;
  let resultInYear = 0;
  let distribution = 0;
  let otherRetained = 0;
  for (const p of postings) {
    if (p.date > end) continue;
    const acc = byId.get(p.accountId);
    if (!acc) continue;
    const credit = -toCents(p.value);
    const result = accountKind(acc) === 'RESULT';
    if (p.date < start) {
      if (result) resultBefore += credit;
      else if (isRetained(acc)) groupBefore += credit;
    } else if (result) resultInYear += credit;
    else if (isRetained(acc)) {
      if (isDistribution(acc)) distribution += credit;
      else otherRetained += credit;
    }
  }

  // Encerramento do próprio exercício: tira-se o efeito dele para mostrar o resultado e os ajustes.
  let closingOnResult = 0;
  let transferred = 0;
  for (const e of journalEntries ?? []) {
    if (e.yearClosing !== year || e.date > end) continue;
    for (const l of e.lines) {
      const acc = byId.get(l.accountId);
      if (!acc) continue;
      const credit = (l.type === 'CREDIT' ? 1 : -1) * toCents(l.amount);
      if (accountKind(acc) === 'RESULT') closingOnResult += credit;
      else if (isRetained(acc)) transferred += credit;
    }
  }

  const opening = groupBefore + resultBefore;
  const netResult = resultInYear - closingOnResult;
  const adjustments = otherRetained - transferred;
  const closing = opening + adjustments + netResult + distribution;
  const rows: DLPARow[] = [
    { kind: 'balance', label: `Saldo em ${formatDateBR(start)}`, value: fromCents(opening) },
    { kind: 'movement', label: '(+/-) Ajustes e outras movimentações', value: fromCents(adjustments) },
    { kind: 'movement', label: '(+/-) Lucro ou prejuízo líquido do exercício', value: fromCents(netResult) },
    { kind: 'movement', label: '(-) Lucros distribuídos', value: fromCents(distribution) },
    { kind: 'balance', label: `Saldo em ${formatDateBR(end)}`, value: fromCents(closing) },
  ];
  return {
    year,
    start,
    end,
    opening: fromCents(opening),
    adjustments: fromCents(adjustments),
    netResult: fromCents(netResult),
    distributions: fromCents(distribution),
    closing: fromCents(closing),
    rows,
  };
}

/** Resumo para auditoria: "lucro de R$ 1.234,56". */
export const describeResult = (value: number): string => `${value >= 0 ? 'lucro' : 'prejuízo'} de ${formatCurrency(Math.abs(value))}`;
