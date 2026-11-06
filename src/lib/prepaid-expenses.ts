import type { ChartAccount, FixedAsset, FixedAssetUse, JournalEntry, JournalEntryLine, PrepaidExpense, PrepaidKind } from '@/types/firestore';
import { fromCents, toCents } from '@/lib/money';
import { formatDateBR } from '@/lib/utils/formatters';
import { monthOf } from '@/lib/periods';
import { journalEntryProblem, journalTotals, MAX_JOURNAL_LINES } from '@/lib/journal';
import { lastDayOf, monthLabel, nextMonth, sameDepreciation } from '@/lib/fixed-assets';

/**
 * Despesas antecipadas (seguros, assinaturas e outros gastos pagos antes de consumidos):
 * - na data da apólice, D despesa antecipada (ativo) / C obrigação (ex.: Seguros a Pagar), pelo
 *   valor total; os pagamentos vêm pelo extrato e baixam a obrigação;
 * - todo mês, no último dia, D despesa (ou custo) / C despesa antecipada, pela cota da vigência:
 *   valor ÷ meses, a partir do mês da apólice; a última cota é o que falta. A apropriação segue a
 *   vigência, nunca as parcelas pagas.
 */

export const PREPAID_DEFAULTS: Record<PrepaidKind, { asset: string; payable: string; expense: Record<FixedAssetUse, string | null> }> = {
  INSURANCE: { asset: '1.1.4.01', payable: '2.1.3.05', expense: { COST: '3.2.1.05', EXPENSE: '3.3.2.18' } },
  OTHER: { asset: '1.1.4.02', payable: '2.1.3.04', expense: { COST: null, EXPENSE: null } },
};

export const PREPAID_KIND_LABEL: Record<PrepaidKind, string> = {
  INSURANCE: 'Seguro',
  OTHER: 'Outra despesa antecipada',
};

export const prepaidEndDate = (item: Pick<PrepaidExpense, 'startDate' | 'months'>): string => {
  const [y, m, d] = item.startDate.split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1 + item.months, d));
  return end.toISOString().slice(0, 10);
};

/* =========================================================================
   Cotas
   ========================================================================= */

export interface PrepaidQuota {
  month: string;
  cents: number;
  /** Número da cota (1 a `months`). */
  index: number;
  /** Lançada por esta rotina (as anteriores à implantação e as já contabilizadas, não). */
  posted: boolean;
}

/** `total` em `n` cotas iguais, a última com o que falta (centavos). */
function split(total: number, n: number): number[] {
  if (n <= 0) return [];
  const q = Math.round(total / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? total - q * (n - 1) : q));
}

/**
 * Cotas da vigência, do mês da apólice em diante. Com apropriação já contabilizada até `through`,
 * o valor informado se divide pelos meses até ali (não lançados por esta rotina) e o que falta,
 * pelos meses seguintes: o total continua igual ao valor da despesa.
 */
export function prepaidSchedule(item: PrepaidExpense, implantationMonth: string | null): PrepaidQuota[] {
  const total = toCents(item.amount);
  if (total <= 0 || !item.months || item.months < 1 || !item.startDate) return [];
  const months: string[] = [];
  for (let i = 0, m = monthOf(item.startDate); i < item.months; i++, m = nextMonth(m)) months.push(m);
  const prior = item.priorAppropriation;
  const doneCount = prior ? months.filter((m) => m <= prior.through).length : 0;
  const informed = prior ? Math.min(total, Math.max(0, toCents(prior.amount))) : 0;
  const cents = doneCount ? [...split(informed, doneCount), ...split(total - informed, months.length - doneCount)] : split(total, months.length);
  return months.map((month, i) => ({
    month,
    cents: cents[i],
    index: i + 1,
    posted: i >= doneCount && (implantationMonth === null || month >= implantationMonth),
  }));
}

export const postedPrepaidCents = (item: PrepaidExpense, month: string, implantationMonth: string | null): number =>
  prepaidSchedule(item, implantationMonth).find((q) => q.month === month && q.posted)?.cents ?? 0;

/** Saldo a apropriar no fim da competência (no ativo), em centavos. */
export function prepaidBalanceAt(item: PrepaidExpense, month: string, implantationMonth: string | null): number {
  if (monthOf(item.startDate) > month) return 0;
  const used = prepaidSchedule(item, implantationMonth)
    .filter((q) => q.month <= month)
    .reduce((s, q) => s + q.cents, 0);
  return toCents(item.amount) - used;
}

/* =========================================================================
   Validação e trava
   ========================================================================= */

export function prepaidProblem(item: PrepaidExpense, accounts: readonly ChartAccount[]): string | null {
  if (!item.description.trim()) return 'Informe a descrição.';
  if (!item.startDate) return 'Informe a data da apólice ou do contrato.';
  if (!Number.isInteger(item.months) || item.months < 1 || item.months > 120) return 'A vigência vai de 1 a 120 meses.';
  if (toCents(item.amount) <= 0) return 'Informe o valor (prêmio líquido).';
  const analytic = new Set(accounts.filter((a) => a.nature === 'ANALYTIC').map((a) => a.id));
  if (!analytic.has(item.assetAccountId)) return 'Escolha a conta do ativo (despesa antecipada).';
  if (!analytic.has(item.payableAccountId)) return 'Escolha a conta da obrigação (a pagar).';
  if (!analytic.has(item.expenseAccountId)) return 'Escolha a conta de resultado da apropriação.';
  if (item.priorAppropriation && toCents(item.priorAppropriation.amount) > toCents(item.amount)) return 'A apropriação já lançada não pode passar do valor total.';
  return null;
}

const FINANCIAL_FIELDS = ['amount', 'startDate', 'months', 'assetAccountId', 'payableAccountId', 'expenseAccountId', 'use', 'priorAppropriation'] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const competence = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

/** Competências fechadas que já têm lançamento do item (o inicial ou cotas). */
export function lockedPrepaidMonths(item: PrepaidExpense, lockedMonths: ReadonlySet<string>, implantationMonth: string | null): string[] {
  const months = new Set<string>();
  if (item.recognitionEntryId && lockedMonths.has(monthOf(item.startDate))) months.add(monthOf(item.startDate));
  for (const q of prepaidSchedule(item, implantationMonth)) if (q.posted && lockedMonths.has(q.month)) months.add(q.month);
  return [...months].sort();
}

/**
 * Motivo de recusar a gravação por competência fechada, ou null: item com lançamento em mês fechado
 * não muda valores, datas nem contas; item novo cujo lançamento cairia em mês fechado pede a
 * reabertura (ou a apropriação já contabilizada até o último mês fechado).
 */
export function prepaidLockProblem(before: PrepaidExpense | null, after: PrepaidExpense, lockedMonths: ReadonlySet<string>, implantationMonth: string | null): string | null {
  if (before) {
    const months = lockedPrepaidMonths(before, lockedMonths, implantationMonth);
    if (months.length && FINANCIAL_FIELDS.some((f) => !same(before[f], after[f]))) {
      return `Esta despesa já tem lançamento em competência fechada (${months.map(competence).join(', ')}): valor, datas, vigência e contas não mudam mais. Reabra as competências para corrigir.`;
    }
    if (months.length) return null;
  }
  if (!after.recognitionEntryId && !before?.recognitionEntryId && after.startDate && lockedMonths.has(monthOf(after.startDate)) && !after.priorAppropriation) {
    return `A competência da apólice (${competence(monthOf(after.startDate))}) está fechada: reabra-a para o lançamento inicial ou marque que ele já está contabilizado.`;
  }
  const conflicts = prepaidSchedule(after, implantationMonth).filter((q) => q.posted && lockedMonths.has(q.month));
  if (conflicts.length) {
    return `As cotas de ${conflicts.map((q) => competence(q.month)).join(', ')} cairiam em competência fechada. Reabra essas competências ou informe a apropriação já lançada até ${competence(conflicts[conflicts.length - 1].month)}.`;
  }
  return null;
}

/**
 * Sugestão de apropriação já contabilizada para um item novo: as cotas que esta rotina não lançaria
 * (antes da implantação) ou que cairiam em meses fechados, somadas até o último deles. Null quando
 * todas as cotas podem ser lançadas.
 */
export function suggestPriorAppropriation(item: PrepaidExpense, lockedMonths: ReadonlySet<string>, implantationMonth: string | null): { through: string; amount: number } | null {
  const rows = prepaidSchedule({ ...item, priorAppropriation: undefined }, implantationMonth);
  const outside = rows.filter((q) => !q.posted || lockedMonths.has(q.month));
  if (!outside.length) return null;
  const through = outside[outside.length - 1].month;
  return { through, amount: fromCents(rows.filter((q) => q.month <= through).reduce((s, q) => s + q.cents, 0)) };
}

/* =========================================================================
   Lançamentos
   ========================================================================= */

export type PrepaidDraft = Pick<JournalEntry, 'date' | 'memo' | 'category' | 'lines' | 'totalAmount' | 'documentRef' | 'prepaidMonth' | 'prepaidId'>;

const accountLine = (acc: ChartAccount, type: 'DEBIT' | 'CREDIT', cents: number, memo: string, i: number): JournalEntryLine => ({
  id: `p${i}`,
  accountId: acc.id,
  accountCode: acc.code,
  accountName: acc.name,
  type,
  amount: fromCents(cents),
  memo,
});

/** Lançamento inicial, na data da apólice: D despesa antecipada / C obrigação, pelo valor total. */
export function recognitionDraft(item: PrepaidExpense, accounts: readonly ChartAccount[]): { draft: PrepaidDraft | null; problem: string | null } {
  const asset = accounts.find((a) => a.id === item.assetAccountId);
  const payable = accounts.find((a) => a.id === item.payableAccountId);
  if (!asset || !payable) return { draft: null, problem: 'As contas da despesa antecipada não estão no plano.' };
  const cents = toCents(item.amount);
  const what = `${item.kind === 'INSURANCE' ? 'Apólice de seguro' : 'Contrato'}${item.documentRef ? ` nº ${item.documentRef}` : ''} - ${item.description}`;
  const vigencia = `vigência de ${formatDateBR(item.startDate)} a ${formatDateBR(prepaidEndDate(item))}`;
  const lines = [accountLine(asset, 'DEBIT', cents, what, 1), accountLine(payable, 'CREDIT', cents, what, 2)];
  const draft: PrepaidDraft = {
    date: item.startDate,
    memo: `${what} (${vigencia})`,
    category: 'PROVISION',
    lines,
    totalAmount: fromCents(cents),
    ...(item.documentRef ? { documentRef: item.documentRef } : {}),
    prepaidId: item.id,
  };
  const problem = journalEntryProblem(draft);
  return problem ? { draft: null, problem } : { draft, problem: null };
}

/** Contas do modelo que a apropriação do mês usa e faltam no plano. */
export function missingPrepaidCodes(items: readonly PrepaidExpense[], month: string, implantationMonth: string | null, accounts: readonly ChartAccount[]): string[] {
  const ids = new Set(accounts.filter((a) => a.nature === 'ANALYTIC').map((a) => a.id));
  const out = new Set<string>();
  for (const item of items) {
    if (!postedPrepaidCents(item, month, implantationMonth)) continue;
    if (!ids.has(item.expenseAccountId)) out.add(item.expenseAccountCode);
    if (!ids.has(item.assetAccountId)) out.add(item.assetAccountCode);
  }
  return [...out].sort();
}

/**
 * Apropriação da competência: um débito por conta de resultado e um crédito por conta do ativo,
 * no último dia do mês. Com muitos itens, as partidas somam por conta. Null sem cota no mês.
 */
export function appropriationDraft(
  items: readonly PrepaidExpense[],
  month: string,
  implantationMonth: string | null,
  accounts: readonly ChartAccount[]
): { draft: PrepaidDraft | null; problem: string | null } {
  const quotas = items.map((item) => ({ item, cents: postedPrepaidCents(item, month, implantationMonth) })).filter((q) => q.cents > 0);
  if (!quotas.length) return { draft: null, problem: null };
  const missing = missingPrepaidCodes(items, month, implantationMonth, accounts);
  if (missing.length) return { draft: null, problem: `Faltam no plano, como analíticas, as contas ${missing.join(', ')}.` };
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const label = monthLabel(month);

  const perItem = quotas.length * 2 <= MAX_JOURNAL_LINES;
  const lines: JournalEntryLine[] = [];
  if (perItem) {
    // Uma partida por item, com a cota no histórico ("cota 3 de 12").
    for (const { item, cents } of quotas) {
      const q = prepaidSchedule(item, implantationMonth).find((x) => x.month === month)!;
      const memo = `Apropriação ${q.index} de ${item.months} - ${item.description}${item.documentRef ? ` (nº ${item.documentRef})` : ''} - ${label}`;
      lines.push(accountLine(byId.get(item.expenseAccountId)!, 'DEBIT', cents, memo, lines.length + 1));
      lines.push(accountLine(byId.get(item.assetAccountId)!, 'CREDIT', cents, memo, lines.length + 1));
    }
  } else {
    const sum = (key: 'expenseAccountId' | 'assetAccountId') => {
      const m = new Map<string, number>();
      for (const { item, cents } of quotas) m.set(item[key], (m.get(item[key]) ?? 0) + cents);
      return m;
    };
    for (const [id, cents] of sum('expenseAccountId')) lines.push(accountLine(byId.get(id)!, 'DEBIT', cents, `Apropriação de despesas antecipadas - ${label}`, lines.length + 1));
    for (const [id, cents] of sum('assetAccountId')) lines.push(accountLine(byId.get(id)!, 'CREDIT', cents, `Apropriação de despesas antecipadas - ${label}`, lines.length + 1));
  }
  const draft: PrepaidDraft = {
    date: lastDayOf(month),
    memo: `Apropriação de seguros e despesas antecipadas - competência ${competence(month)}`,
    category: 'PROVISION',
    lines,
    totalAmount: journalTotals(lines).debit,
    documentRef: `APROP-${month}`,
    prepaidMonth: month,
  };
  const problem = journalEntryProblem(draft);
  return problem ? { draft: null, problem } : { draft, problem: null };
}

/** Situação da apropriação do mês (mesmos estados da depreciação). */
export type AppropriationStatus =
  | { kind: 'NONE' }
  | { kind: 'POSTED'; entry: JournalEntry }
  | { kind: 'PENDING'; draft: PrepaidDraft; existing: JournalEntry | null }
  | { kind: 'REMOVE'; existing: JournalEntry }
  | { kind: 'BLOCKED'; problem: string; totalCents: number };

export function appropriationStatus(args: {
  items: readonly PrepaidExpense[];
  month: string;
  implantationMonth: string | null;
  accounts: readonly ChartAccount[];
  entries: readonly JournalEntry[];
}): AppropriationStatus {
  const { items, month, implantationMonth, accounts, entries } = args;
  const existing = entries.find((e) => e.prepaidMonth === month) ?? null;
  const { draft, problem } = appropriationDraft(items, month, implantationMonth, accounts);
  if (problem) {
    const totalCents = items.reduce((s, item) => s + postedPrepaidCents(item, month, implantationMonth), 0);
    return { kind: 'BLOCKED', problem, totalCents };
  }
  if (!draft) return existing ? { kind: 'REMOVE', existing } : { kind: 'NONE' };
  if (existing && sameDepreciation(existing, draft)) return { kind: 'POSTED', entry: existing };
  return { kind: 'PENDING', draft, existing };
}

const formatMoney = (cents: number) => fromCents(cents).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function appropriationCloseProblem(status: AppropriationStatus, month: string): string | null {
  switch (status.kind) {
    case 'PENDING':
      return status.existing
        ? `As despesas antecipadas mudaram depois da apropriação de ${competence(month)}: atualize o lançamento antes de fechar.`
        : `Lance a apropriação de seguros e despesas antecipadas de ${competence(month)} (${formatMoney(toCents(status.draft.totalAmount))}) antes de fechar a competência.`;
    case 'REMOVE':
      return `A apropriação de ${competence(month)} não tem mais cota nas despesas antecipadas: atualize o lançamento antes de fechar.`;
    case 'BLOCKED':
      return `Lance a apropriação de seguros e despesas antecipadas de ${competence(month)} (${formatMoney(status.totalCents)}) antes de fechar a competência.`;
    default:
      return null;
  }
}

/**
 * Competências abertas, da primeira cota até `untilMonth`, com apropriação a lançar ou atualizar
 * (a partir da implantação). Para recuperar meses que ficaram para trás.
 */
export function pendingAppropriationMonths(args: {
  items: readonly PrepaidExpense[];
  untilMonth: string;
  implantationMonth: string | null;
  lockedMonths: ReadonlySet<string>;
  accounts: readonly ChartAccount[];
  entries: readonly JournalEntry[];
}): string[] {
  const { items, untilMonth, implantationMonth, lockedMonths, accounts, entries } = args;
  const starts = items.map((i) => i.startDate && monthOf(i.startDate)).filter(Boolean) as string[];
  if (!starts.length) return [];
  let month = starts.sort()[0];
  if (implantationMonth && month < implantationMonth) month = implantationMonth;
  const out: string[] = [];
  for (let i = 0; i < 1300 && month <= untilMonth; i++, month = nextMonth(month)) {
    if (lockedMonths.has(month)) continue;
    const status = appropriationStatus({ items, month, implantationMonth, accounts, entries });
    if (status.kind === 'PENDING' || status.kind === 'REMOVE' || status.kind === 'BLOCKED') out.push(month);
  }
  return out;
}

/* =========================================================================
   Conferência e sugestões
   ========================================================================= */

/** Uso sugerido pelo bem segurado: o do bem no cadastro do imobilizado. */
export const useFromAsset = (asset: Pick<FixedAsset, 'use'> | undefined, fallback: FixedAssetUse): FixedAssetUse => asset?.use ?? fallback;

/** Saldo a apropriar por conta do ativo no fim da competência (para conferir com o balancete), em centavos. */
export function prepaidBalancesByAccount(items: readonly PrepaidExpense[], month: string, implantationMonth: string | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) out.set(item.assetAccountId, (out.get(item.assetAccountId) ?? 0) + prepaidBalanceAt(item, month, implantationMonth));
  return out;
}
