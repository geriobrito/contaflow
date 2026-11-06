import type { ChartAccount, FinancingContract, FinancingKind, JournalEntry, JournalEntryLine } from '@/types/firestore';
import { fromCents, toCents } from '@/lib/money';
import { monthOf } from '@/lib/periods';
import { journalEntryProblem, journalTotals, MAX_JOURNAL_LINES } from '@/lib/journal';
import { lastDayOf, monthLabel, sameDepreciation } from '@/lib/fixed-assets';
import { formatCurrency } from '@/lib/utils/formatters';

/**
 * Empréstimos, financiamentos e parcelamentos (de impostos):
 * - lançamento inicial na data do contrato: D contrapartida (o fornecedor do bem, o imposto a
 *   recolher, ou a transitória que recebe o depósito do empréstimo), D despesa financeira com os
 *   encargos da contratação (IOF, cadastro, registro), D (−) encargos a transcorrer pelos juros
 *   prefixados, C obrigação — tudo separado em curto prazo (parcelas que vencem até 31/12 do ano
 *   seguinte) e longo prazo;
 * - todo mês, os juros prefixados da parcela que vence nele saem dos encargos a transcorrer para a
 *   despesa (tabela Price: juros = saldo × taxa);
 * - em 31/12, as parcelas que vencem no ano seguinte passam do longo para o curto prazo;
 * - juros pós-fixados (parcelamento pela Selic) não têm encargos a transcorrer: no pagamento, o que
 *   passar da parcela-base vai para juros.
 * Os pagamentos vêm pelo extrato, classificados na conta de curto prazo.
 */

export interface FinancingDefaults {
  counterpart: string;
  shortTerm: string;
  longTerm: string;
  chargesShort: string;
  chargesLong: string;
  upfront: string;
  interest: string;
}

export const FINANCING_DEFAULTS: Record<FinancingKind, FinancingDefaults> = {
  LOAN: { counterpart: '1.1.1.04', shortTerm: '2.1.4.01', longTerm: '2.2.1.01', chargesShort: '2.1.4.03', chargesLong: '2.2.1.02', upfront: '3.4.1.01.006', interest: '3.4.1.01.005' },
  FINANCING: { counterpart: '2.1.2.01', shortTerm: '2.1.4.02', longTerm: '2.2.1.01', chargesShort: '2.1.4.03', chargesLong: '2.2.1.02', upfront: '3.4.1.01.006', interest: '3.4.1.01.005' },
  INSTALLMENT_PLAN: { counterpart: '2.1.5.01', shortTerm: '2.1.5.05', longTerm: '2.2.2.01', chargesShort: '2.1.4.03', chargesLong: '2.2.1.02', upfront: '3.4.1.01.006', interest: '3.4.1.01.007' },
};

export const FINANCING_KIND_LABEL: Record<FinancingKind, string> = {
  LOAN: 'Empréstimo',
  FINANCING: 'Financiamento',
  INSTALLMENT_PLAN: 'Parcelamento de impostos',
};

const competence = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

/** Mesma data, `months` meses depois (dia que não existe no mês vira o último). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${String(tm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Valor financiado, em centavos: o crédito (ou o bem, ou o débito consolidado) mais os encargos financiados. */
export const financedCents = (c: Pick<FinancingContract, 'principal' | 'upfrontCharges'>): number => toCents(c.principal) + toCents(c.upfrontCharges ?? 0);

/** Taxa mensal (%) da tabela Price que leva o valor financiado às `n` parcelas de `payment` (busca binária). */
export function priceRate(financed: number, payment: number, n: number): number {
  if (n <= 0 || payment * n <= financed) return 0;
  const pv = (i: number) => (payment * (1 - Math.pow(1 + i, -n))) / i;
  let lo = 1e-9;
  let hi = 1;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > financed) lo = mid;
    else hi = mid;
  }
  return ((lo + hi) / 2) * 100;
}

export interface Installment {
  n: number;
  dueDate: string;
  /** Valor da parcela (prefixada) ou parcela-base (pós-fixada), em centavos. */
  payment: number;
  /** Juros prefixados da parcela (zero no pós-fixado), em centavos. */
  interest: number;
  amortization: number;
  /** Saldo devedor depois da parcela, em centavos. */
  balance: number;
}

/**
 * Tabela de parcelas. Prefixado: Price com a taxa do contrato (ou a calculada pela parcela); a
 * última parcela acerta os juros para o total ser exatamente parcelas − valor financiado.
 * Pós-fixado: parcelas-base iguais, a última com o que falta.
 */
export function installmentSchedule(c: FinancingContract): Installment[] {
  const financed = financedCents(c);
  const n = c.installments;
  const pmt = toCents(c.installmentAmount);
  if (financed <= 0 || n < 1 || pmt <= 0 || !c.firstDueDate) return [];
  const out: Installment[] = [];
  if (c.interestMode === 'FLOATING') {
    let balance = financed;
    for (let k = 1; k <= n; k++) {
      const payment = k === n ? balance : Math.min(pmt, balance);
      balance -= payment;
      out.push({ n: k, dueDate: addMonths(c.firstDueDate, k - 1), payment, interest: 0, amortization: payment, balance });
    }
    return out;
  }
  const totalInterest = Math.max(0, pmt * n - financed);
  const rate = (c.monthlyRate && c.monthlyRate > 0 ? c.monthlyRate : priceRate(financed / 100, pmt / 100, n)) / 100;
  let balance = financed;
  let interestSoFar = 0;
  for (let k = 1; k <= n; k++) {
    const interest = k === n ? totalInterest - interestSoFar : Math.min(Math.round(balance * rate), totalInterest - interestSoFar);
    interestSoFar += interest;
    const amortization = pmt - interest;
    balance = k === n ? 0 : balance - amortization;
    out.push({ n: k, dueDate: addMonths(c.firstDueDate, k - 1), payment: pmt, interest, amortization, balance });
  }
  return out;
}

/** Último dia que fica no curto prazo no lançamento inicial: 31/12 do ano seguinte ao do contrato. */
export const initialShortTermLimit = (c: Pick<FinancingContract, 'date'>): string => `${Number(c.date.slice(0, 4)) + 1}-12-31`;

/**
 * Limite do curto prazo no fim da competência `month`: 31/12 do ano seguinte ao do último
 * encerramento já reclassificado (dezembro), nunca antes do limite inicial do contrato.
 */
export function shortTermLimitAt(c: Pick<FinancingContract, 'date'>, month: string): string {
  const y = Number(month.slice(0, 4));
  const lastDecember = month.endsWith('-12') ? y : y - 1;
  return `${Math.max(Number(c.date.slice(0, 4)) + 1, lastDecember + 1)}-12-31`;
}

/* =========================================================================
   Validação e trava
   ========================================================================= */

export function financingProblem(c: FinancingContract, accounts: readonly ChartAccount[]): string | null {
  if (!c.description.trim()) return 'Informe a descrição do contrato.';
  if (!c.date) return 'Informe a data do contrato.';
  if (toCents(c.principal) <= 0) return 'Informe o valor do crédito (ou do bem, ou do débito consolidado).';
  if (toCents(c.upfrontCharges ?? 0) < 0) return 'Os encargos da contratação não podem ser negativos.';
  if (!Number.isInteger(c.installments) || c.installments < 1 || c.installments > 480) return 'O número de parcelas vai de 1 a 480.';
  if (toCents(c.installmentAmount) <= 0) return 'Informe o valor da parcela.';
  if (!c.firstDueDate || c.firstDueDate < c.date) return 'O primeiro vencimento não pode ser anterior ao contrato.';
  if (c.interestMode === 'PREFIXED' && toCents(c.installmentAmount) * c.installments < financedCents(c)) {
    return 'As parcelas somam menos que o valor financiado: confira o valor da parcela e os encargos.';
  }
  if (c.monthlyRate !== undefined && (c.monthlyRate < 0 || c.monthlyRate > 100)) return 'A taxa mensal vai de 0% a 100%.';
  const analytic = new Set(accounts.filter((a) => a.nature === 'ANALYTIC').map((a) => a.id));
  const needed: [string, string][] = [
    [c.counterpartAccountId, 'a contrapartida'],
    [c.shortTermAccountId, 'a conta de curto prazo'],
    [c.longTermAccountId, 'a conta de longo prazo'],
    [c.interestExpenseAccountId, 'a conta dos juros'],
  ];
  if (toCents(c.upfrontCharges ?? 0) > 0) needed.push([c.upfrontExpenseAccountId ?? '', 'a conta dos encargos da contratação']);
  if (c.interestMode === 'PREFIXED') needed.push([c.chargesShortAccountId ?? '', 'a conta dos encargos a transcorrer (curto prazo)'], [c.chargesLongAccountId ?? '', 'a dos encargos a transcorrer (longo prazo)']);
  for (const [id, what] of needed) if (!analytic.has(id)) return `Escolha ${what} (conta analítica do plano).`;
  return null;
}

/** Competências com lançamento gerado do contrato (inicial, juros e reclassificação de dezembro). */
export function contractMonths(c: FinancingContract, implantationMonth: string | null): string[] {
  const months = new Set<string>();
  if (c.initialEntryId) months.add(monthOf(c.date));
  for (const r of routineRows(c, implantationMonth)) months.add(r.month);
  return [...months].sort();
}

const FINANCIAL_FIELDS = [
  'kind',
  'date',
  'principal',
  'upfrontCharges',
  'installments',
  'installmentAmount',
  'firstDueDate',
  'interestMode',
  'monthlyRate',
  'counterpartAccountId',
  'shortTermAccountId',
  'longTermAccountId',
  'chargesShortAccountId',
  'chargesLongAccountId',
  'upfrontExpenseAccountId',
  'interestExpenseAccountId',
  'priorThrough',
] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Motivo de recusar a gravação por competência fechada, ou null (mesma lógica do imobilizado). */
export function financingLockProblem(before: FinancingContract | null, after: FinancingContract, lockedMonths: ReadonlySet<string>, implantationMonth: string | null): string | null {
  if (before) {
    const locked = contractMonths(before, implantationMonth).filter((m) => lockedMonths.has(m));
    if (locked.length && FINANCIAL_FIELDS.some((f) => !same(before[f], after[f]))) {
      return `Este contrato já tem lançamento em competência fechada (${locked.map(competence).join(', ')}): valores, datas e contas não mudam mais. Reabra as competências para corrigir.`;
    }
    if (locked.length) return null;
  }
  if (!before?.initialEntryId && !after.initialEntryId && lockedMonths.has(monthOf(after.date)) && !after.priorThrough) {
    return `A competência do contrato (${competence(monthOf(after.date))}) está fechada: reabra-a para o lançamento inicial ou marque que ele já está contabilizado.`;
  }
  const conflicts = routineRows(after, implantationMonth).filter((r) => lockedMonths.has(r.month)).map((r) => r.month);
  if (conflicts.length) {
    return `Os juros ou a reclassificação de ${[...new Set(conflicts)].map(competence).join(', ')} cairiam em competência fechada. Reabra essas competências ou informe até quando os juros já foram lançados.`;
  }
  return null;
}

/* =========================================================================
   Lançamentos
   ========================================================================= */

export type FinancingDraft = Pick<JournalEntry, 'date' | 'memo' | 'category' | 'lines' | 'totalAmount' | 'documentRef' | 'financingMonth' | 'financingId'>;

const line = (acc: ChartAccount, type: 'DEBIT' | 'CREDIT', cents: number, memo: string, i: number): JournalEntryLine => ({
  id: `f${i}`,
  accountId: acc.id,
  accountCode: acc.code,
  accountName: acc.name,
  type,
  amount: fromCents(cents),
  memo,
});

const title = (c: FinancingContract) =>
  `${FINANCING_KIND_LABEL[c.kind]}${c.lender ? ` ${c.lender}` : ''}${c.documentRef ? ` nº ${c.documentRef}` : ''} - ${c.description}`;

/** Totais de curto e longo prazo no lançamento inicial, em centavos. */
export function initialSplit(c: FinancingContract): { shortPayments: number; longPayments: number; shortInterest: number; longInterest: number; shortCount: number; longCount: number } {
  const limit = initialShortTermLimit(c);
  const rows = installmentSchedule(c);
  const short = rows.filter((r) => r.dueDate <= limit);
  const long = rows.filter((r) => r.dueDate > limit);
  const sum = (list: Installment[], k: 'payment' | 'interest') => list.reduce((s, r) => s + r[k], 0);
  return {
    shortPayments: sum(short, 'payment'),
    longPayments: sum(long, 'payment'),
    shortInterest: sum(short, 'interest'),
    longInterest: sum(long, 'interest'),
    shortCount: short.length,
    longCount: long.length,
  };
}

/** Lançamento inicial, na data do contrato. */
export function initialEntryDraft(c: FinancingContract, accounts: readonly ChartAccount[]): { draft: FinancingDraft | null; problem: string | null } {
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const get = (id?: string) => (id ? byId.get(id) : undefined);
  const s = initialSplit(c);
  const memo = `${title(c)}: ${c.installments} parcela(s) de ${formatCurrency(c.installmentAmount)}`;
  const lines: JournalEntryLine[] = [];
  const push = (id: string | undefined, type: 'DEBIT' | 'CREDIT', cents: number, m: string) => {
    if (cents <= 0) return;
    const acc = get(id);
    if (!acc) throw new Error('missing');
    lines.push(line(acc, type, cents, m, lines.length + 1));
  };
  try {
    push(c.counterpartAccountId, 'DEBIT', toCents(c.principal), c.kind === 'INSTALLMENT_PLAN' ? 'Débito consolidado transferido para o parcelamento' : c.kind === 'FINANCING' ? 'Baixa do fornecedor pago pela financiadora' : 'Valor do empréstimo a receber no banco');
    push(c.upfrontExpenseAccountId, 'DEBIT', toCents(c.upfrontCharges ?? 0), 'Encargos da contratação (IOF, cadastro, registro)');
    if (c.interestMode === 'PREFIXED') {
      push(c.chargesShortAccountId, 'DEBIT', s.shortInterest, 'Juros a transcorrer - curto prazo');
      push(c.chargesLongAccountId, 'DEBIT', s.longInterest, 'Juros a transcorrer - longo prazo');
    }
    push(c.shortTermAccountId, 'CREDIT', s.shortPayments, `${s.shortCount} parcela(s) com vencimento até ${initialShortTermLimit(c).split('-').reverse().join('/')}`);
    push(c.longTermAccountId, 'CREDIT', s.longPayments, `${s.longCount} parcela(s) com vencimento depois`);
  } catch {
    return { draft: null, problem: 'As contas do contrato não estão no plano.' };
  }
  const draft: FinancingDraft = {
    date: c.date,
    memo,
    category: 'ADJUSTMENT',
    lines,
    totalAmount: journalTotals(lines).debit,
    ...(c.documentRef ? { documentRef: c.documentRef } : {}),
    financingId: c.id,
  };
  const problem = journalEntryProblem(draft);
  return problem ? { draft: null, problem } : { draft, problem: null };
}

/** O que a rotina mensal lança de um contrato: juros da parcela do mês e a reclassificação de dezembro. */
export interface RoutineRow {
  month: string;
  kind: 'interest' | 'reclass';
  installment?: Installment;
  /** Reclassificação: parcelas e juros que passam do longo para o curto prazo, em centavos. */
  payments?: number;
  interest: number;
  count?: number;
}

/** Linhas da rotina mensal do contrato, nas competências lançadas por ela (depois da implantação e de `priorThrough`). */
export function routineRows(c: FinancingContract, implantationMonth: string | null): RoutineRow[] {
  const rows = installmentSchedule(c);
  const posted = (month: string) => (implantationMonth === null || month >= implantationMonth) && (!c.priorThrough || month > c.priorThrough);
  const out: RoutineRow[] = [];
  if (c.interestMode === 'PREFIXED') {
    for (const r of rows) {
      const month = monthOf(r.dueDate);
      if (r.interest > 0 && posted(month)) out.push({ month, kind: 'interest', installment: r, interest: r.interest });
    }
  }
  // Reclassificação em 31/12 de cada ano a partir do seguinte ao do contrato.
  const firstYear = Number(c.date.slice(0, 4)) + 1;
  const lastDue = rows.length ? Number(rows[rows.length - 1].dueDate.slice(0, 4)) : 0;
  for (let y = firstYear; y + 1 <= lastDue; y++) {
    const month = `${y}-12`;
    if (!posted(month)) continue;
    const next = rows.filter((r) => r.dueDate.startsWith(`${y + 1}-`));
    if (!next.length) continue;
    out.push({ month, kind: 'reclass', payments: next.reduce((s, r) => s + r.payment, 0), interest: next.reduce((s, r) => s + r.interest, 0), count: next.length });
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

/** Contas do modelo que a rotina do mês usa e faltam no plano. */
export function missingFinancingCodes(contracts: readonly FinancingContract[], month: string, implantationMonth: string | null, accounts: readonly ChartAccount[]): string[] {
  const ids = new Set(accounts.filter((a) => a.nature === 'ANALYTIC').map((a) => a.id));
  const out = new Set<string>();
  for (const c of contracts) {
    for (const r of routineRows(c, implantationMonth).filter((x) => x.month === month)) {
      const need: [string | undefined, string | undefined][] =
        r.kind === 'interest'
          ? [[c.interestExpenseAccountId, c.interestExpenseAccountCode], [c.chargesShortAccountId, c.chargesShortAccountCode]]
          : [[c.longTermAccountId, c.longTermAccountCode], [c.shortTermAccountId, c.shortTermAccountCode], ...(r.interest ? ([[c.chargesShortAccountId, c.chargesShortAccountCode], [c.chargesLongAccountId, c.chargesLongAccountCode]] as [string | undefined, string | undefined][]) : [])];
      for (const [id, code] of need) if (!id || !ids.has(id)) out.add(code ?? '?');
    }
  }
  return [...out].sort();
}

/**
 * Lançamento da rotina do mês: juros das parcelas que vencem nele (D juros / C encargos a
 * transcorrer) e, em dezembro, a reclassificação do longo para o curto prazo. Null sem nada a lançar.
 */
export function financingRoutineDraft(
  contracts: readonly FinancingContract[],
  month: string,
  implantationMonth: string | null,
  accounts: readonly ChartAccount[]
): { draft: FinancingDraft | null; problem: string | null } {
  const items = contracts.flatMap((c) => routineRows(c, implantationMonth).filter((r) => r.month === month).map((r) => ({ c, r })));
  if (!items.length) return { draft: null, problem: null };
  const missing = missingFinancingCodes(contracts, month, implantationMonth, accounts);
  if (missing.length) return { draft: null, problem: `Faltam no plano, como analíticas, as contas ${missing.join(', ')}.` };
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const label = monthLabel(month);
  const raw: { accountId: string; type: 'DEBIT' | 'CREDIT'; cents: number; memo: string }[] = [];
  for (const { c, r } of items) {
    if (r.kind === 'interest') {
      const memo = `Juros da parcela ${r.installment!.n} de ${c.installments} - ${c.description} - ${label}`;
      raw.push({ accountId: c.interestExpenseAccountId, type: 'DEBIT', cents: r.interest, memo });
      raw.push({ accountId: c.chargesShortAccountId!, type: 'CREDIT', cents: r.interest, memo });
    } else {
      const memo = `Transferência para o curto prazo das ${r.count} parcela(s) de ${Number(month.slice(0, 4)) + 1} - ${c.description}`;
      raw.push({ accountId: c.longTermAccountId, type: 'DEBIT', cents: r.payments!, memo });
      raw.push({ accountId: c.shortTermAccountId, type: 'CREDIT', cents: r.payments!, memo });
      if (r.interest) {
        raw.push({ accountId: c.chargesShortAccountId!, type: 'DEBIT', cents: r.interest, memo: `${memo} (juros a transcorrer)` });
        raw.push({ accountId: c.chargesLongAccountId!, type: 'CREDIT', cents: r.interest, memo: `${memo} (juros a transcorrer)` });
      }
    }
  }
  let merged = raw;
  if (raw.length > MAX_JOURNAL_LINES) {
    const m = new Map<string, number>();
    for (const x of raw) m.set(`${x.accountId}|${x.type}`, (m.get(`${x.accountId}|${x.type}`) ?? 0) + x.cents);
    merged = [...m].map(([k, cents]) => {
      const [accountId, type] = k.split('|') as [string, 'DEBIT' | 'CREDIT'];
      return { accountId, type, cents, memo: `Juros e reclassificação de empréstimos e financiamentos - ${label}` };
    });
  }
  const lines = merged.map((x, i) => line(byId.get(x.accountId)!, x.type, x.cents, x.memo, i + 1));
  const draft: FinancingDraft = {
    date: lastDayOf(month),
    memo: `Juros de empréstimos e financiamentos${month.endsWith('-12') ? ' e reclassificação para o curto prazo' : ''} - competência ${competence(month)}`,
    category: 'ADJUSTMENT',
    lines,
    totalAmount: journalTotals(lines).debit,
    documentRef: `FINANC-${month}`,
    financingMonth: month,
  };
  const problem = journalEntryProblem(draft);
  return problem ? { draft: null, problem } : { draft, problem: null };
}

export type FinancingRoutineStatus =
  | { kind: 'NONE' }
  | { kind: 'POSTED'; entry: JournalEntry }
  | { kind: 'PENDING'; draft: FinancingDraft; existing: JournalEntry | null }
  | { kind: 'REMOVE'; existing: JournalEntry }
  | { kind: 'BLOCKED'; problem: string };

export function financingRoutineStatus(args: {
  contracts: readonly FinancingContract[];
  month: string;
  implantationMonth: string | null;
  accounts: readonly ChartAccount[];
  entries: readonly JournalEntry[];
}): FinancingRoutineStatus {
  const { contracts, month, implantationMonth, accounts, entries } = args;
  const existing = entries.find((e) => e.financingMonth === month) ?? null;
  const { draft, problem } = financingRoutineDraft(contracts, month, implantationMonth, accounts);
  if (problem) return { kind: 'BLOCKED', problem };
  if (!draft) return existing ? { kind: 'REMOVE', existing } : { kind: 'NONE' };
  if (existing && sameDepreciation(existing, draft)) return { kind: 'POSTED', entry: existing };
  return { kind: 'PENDING', draft, existing };
}

export function financingCloseProblem(status: FinancingRoutineStatus, month: string): string | null {
  switch (status.kind) {
    case 'PENDING':
      return status.existing
        ? `Os contratos de empréstimo e financiamento mudaram depois do lançamento de ${competence(month)}: atualize-o antes de fechar.`
        : `Lance os juros de empréstimos e financiamentos de ${competence(month)}${month.endsWith('-12') ? ' (e a reclassificação para o curto prazo)' : ''} antes de fechar a competência.`;
    case 'REMOVE':
      return `O lançamento de juros de ${competence(month)} não tem mais o que lançar: atualize-o antes de fechar.`;
    case 'BLOCKED':
      return `Lance os juros de empréstimos e financiamentos de ${competence(month)} antes de fechar a competência.`;
    default:
      return null;
  }
}

/** Competências abertas, até `untilMonth`, com a rotina a lançar ou atualizar. */
export function pendingFinancingMonths(args: {
  contracts: readonly FinancingContract[];
  untilMonth: string;
  implantationMonth: string | null;
  lockedMonths: ReadonlySet<string>;
  accounts: readonly ChartAccount[];
  entries: readonly JournalEntry[];
}): string[] {
  const { contracts, untilMonth, lockedMonths } = args;
  const months = new Set(contracts.flatMap((c) => routineRows(c, args.implantationMonth).map((r) => r.month)));
  for (const e of args.entries) if (e.financingMonth) months.add(e.financingMonth);
  return [...months]
    .filter((m) => m <= untilMonth && !lockedMonths.has(m))
    .sort()
    .filter((month) => {
      const s = financingRoutineStatus({ ...args, month });
      return s.kind === 'PENDING' || s.kind === 'REMOVE' || s.kind === 'BLOCKED';
    });
}

/* =========================================================================
   Posição e conferência
   ========================================================================= */

export interface ContractPosition {
  /** Saldo devedor (valor presente) no fim da competência, em centavos. */
  balance: number;
  shortPayments: number;
  longPayments: number;
  shortInterest: number;
  longInterest: number;
  /** Parcelas vencidas até o fim da competência (supostas pagas pelo extrato). */
  paidCount: number;
}

/** Posição do contrato no fim da competência, supondo as parcelas vencidas pagas. */
export function contractPositionAt(c: FinancingContract, month: string): ContractPosition {
  const end = lastDayOf(month);
  const rows = installmentSchedule(c);
  if (c.date > end) return { balance: 0, shortPayments: 0, longPayments: 0, shortInterest: 0, longInterest: 0, paidCount: 0 };
  const open = rows.filter((r) => r.dueDate > end);
  const limit = shortTermLimitAt(c, month);
  const sum = (list: Installment[], k: 'payment' | 'interest') => list.reduce((s, r) => s + r[k], 0);
  const short = open.filter((r) => r.dueDate <= limit);
  const long = open.filter((r) => r.dueDate > limit);
  return {
    balance: sum(open, 'payment') - sum(open, 'interest'),
    shortPayments: sum(short, 'payment'),
    longPayments: sum(long, 'payment'),
    shortInterest: c.interestMode === 'PREFIXED' ? sum(short, 'interest') : 0,
    longInterest: c.interestMode === 'PREFIXED' ? sum(long, 'interest') : 0,
    paidCount: rows.length - open.length,
  };
}

/** Saldo esperado por conta (lado natural: obrigações credoras positivas, encargos a transcorrer positivos), em centavos. */
export function expectedBalancesByAccount(contracts: readonly FinancingContract[], month: string): Map<string, number> {
  const out = new Map<string, number>();
  const add = (id: string | undefined, cents: number) => id && out.set(id, (out.get(id) ?? 0) + cents);
  for (const c of contracts) {
    const p = contractPositionAt(c, month);
    add(c.shortTermAccountId, p.shortPayments);
    add(c.longTermAccountId, p.longPayments);
    if (c.interestMode === 'PREFIXED') {
      add(c.chargesShortAccountId, p.shortInterest);
      add(c.chargesLongAccountId, p.longInterest);
    }
  }
  return out;
}

/**
 * Pagamento de parcela pós-fixada (parcelamento pela Selic) classificado na conta de curto prazo:
 * a parcela-base baixa a obrigação e o que passar dela vai para juros. Null quando a conta não é
 * de um contrato pós-fixado ou o valor não passa da parcela.
 */
export function floatingPaymentSplit(
  contracts: readonly FinancingContract[],
  accountId: string,
  amountCents: number
): { contract: FinancingContract; principalCents: number; interestCents: number } | null {
  const paid = Math.abs(amountCents);
  const contract = contracts.find((c) => c.interestMode === 'FLOATING' && c.shortTermAccountId === accountId);
  if (!contract) return null;
  const base = toCents(contract.installmentAmount);
  if (paid <= base) return null;
  return { contract, principalCents: base, interestCents: paid - base };
}
