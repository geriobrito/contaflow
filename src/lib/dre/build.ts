import type { AccountType, BankTransaction, ChartAccount, DREGroup } from '@/types/firestore';

/* =========================================================================
   Grupos canônicos (ITG 1000) e compatibilidade com dados legados
   ========================================================================= */

export type DRESectionKey =
  | 'GROSS_REVENUE'
  | 'DEDUCTIONS'
  | 'COSTS'
  | 'OPERATING_EXPENSES'
  | 'FINANCIAL_INCOME'
  | 'FINANCIAL_EXPENSES'
  | 'OTHER_INCOME'
  | 'OTHER_EXPENSES'
  | 'INCOME_TAXES';

/** Grupos de natureza credora (aumentam o resultado); os demais são devedores. */
const CREDIT_NATURE: ReadonlySet<DRESectionKey> = new Set(['GROSS_REVENUE', 'FINANCIAL_INCOME', 'OTHER_INCOME']);

const LEGACY: Partial<Record<DREGroup, DRESectionKey>> = {
  RECEITA_BRUTA: 'GROSS_REVENUE',
  DEDUCOES_RECEITA: 'DEDUCTIONS',
  CUSTOS: 'COSTS',
  DESPESAS_OPERACIONAIS: 'OPERATING_EXPENSES',
  DESPESAS_ADMINISTRATIVAS: 'OPERATING_EXPENSES',
  DESPESAS_COMERCIAIS: 'OPERATING_EXPENSES',
  DESPESAS_FINANCEIRAS: 'FINANCIAL_EXPENSES',
  RECEITAS_FINANCEIRAS: 'FINANCIAL_INCOME',
  IMPOSTOS_LUCRO: 'INCOME_TAXES',
};

const CANONICAL: ReadonlySet<string> = new Set<DRESectionKey>([
  'GROSS_REVENUE',
  'DEDUCTIONS',
  'COSTS',
  'OPERATING_EXPENSES',
  'FINANCIAL_INCOME',
  'FINANCIAL_EXPENSES',
  'OTHER_INCOME',
  'OTHER_EXPENSES',
  'INCOME_TAXES',
]);

const REVENUE_TYPES: ReadonlySet<AccountType> = new Set(['REVENUE', 'RECEITA']);
const COST_TYPES: ReadonlySet<AccountType> = new Set(['COST', 'CUSTO']);
const EXPENSE_TYPES: ReadonlySet<AccountType> = new Set(['EXPENSE', 'DESPESA']);

/**
 * Resolve o grupo da DRE de uma conta: `dreGroup` canônico → mapeamento legado →
 * natureza da conta. Contas patrimoniais (ativo, passivo, PL) retornam null.
 */
export function resolveDREGroup(account: ChartAccount): DRESectionKey | null {
  const isRevenue = REVENUE_TYPES.has(account.type);
  const isResult = isRevenue || COST_TYPES.has(account.type) || EXPENSE_TYPES.has(account.type);
  if (!isResult) return null;

  const group = account.dreGroup;
  if (group && CANONICAL.has(group)) return group as DRESectionKey;
  if (group && LEGACY[group]) return LEGACY[group] ?? null;
  if (group === 'OUTRAS_RECEITAS_DESPESAS') return isRevenue ? 'OTHER_INCOME' : 'OTHER_EXPENSES';

  if (isRevenue) return account.isContra ? 'DEDUCTIONS' : 'GROSS_REVENUE';
  if (COST_TYPES.has(account.type)) return 'COSTS';
  return 'OPERATING_EXPENSES';
}

/* =========================================================================
   Estrutura do demonstrativo
   ========================================================================= */

export interface DREAccountLine {
  accountId: string;
  code: string;
  name: string;
  /** Valor na natureza do grupo: receita positiva em grupos credores, despesa positiva em devedores. */
  value: number;
  count: number;
}

export interface DRESection {
  key: DRESectionKey;
  lines: DREAccountLine[];
  total: number;
}

export interface DREStatement {
  sections: Record<DRESectionKey, DRESection>;
  grossRevenue: number;
  deductions: number;
  netRevenue: number;
  costs: number;
  grossProfit: number;
  operatingExpenses: number;
  financialResult: number;
  otherResult: number;
  incomeTaxes: number;
  netResult: number;
  /** Margem líquida sobre a receita líquida (%), ou null sem receita. */
  netMargin: number | null;
  reconciledCount: number;
  /** Lançamentos auto-classificados no período, ainda fora da DRE até aprovação. */
  awaitingApproval: number;
}

export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

/**
 * Monta a DRE a partir dos lançamentos CONCILIADOS no período.
 *
 * Sinal: o extrato traz créditos positivos e débitos negativos. Em grupos credores
 * (receitas) o valor entra como está; em grupos devedores (deduções, custos, despesas)
 * entra invertido. Assim, um estorno lançado numa conta de despesa reduz a despesa.
 */
export function buildDRE(
  transactions: readonly BankTransaction[],
  accounts: readonly ChartAccount[],
  range: DateRange
): DREStatement {
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const buckets = new Map<DRESectionKey, Map<string, DREAccountLine>>();

  let reconciledCount = 0;
  let awaitingApproval = 0;

  for (const t of transactions) {
    if (t.date < range.start || t.date > range.end) continue;
    if (t.status === 'AUTO_CLASSIFIED') awaitingApproval++;
    if (t.status !== 'RECONCILED' || !t.accountId) continue;

    const acc = byId.get(t.accountId);
    const key = acc ? resolveDREGroup(acc) : null;
    if (!acc || !key) continue; // conta removida ou patrimonial: não transita pela DRE
    reconciledCount++;

    const bucket = buckets.get(key) ?? new Map<string, DREAccountLine>();
    const line = bucket.get(acc.id) ?? { accountId: acc.id, code: acc.code, name: acc.name, value: 0, count: 0 };
    line.value += CREDIT_NATURE.has(key) ? t.amount : -t.amount;
    line.count += 1;
    bucket.set(acc.id, line);
    buckets.set(key, bucket);
  }

  const section = (key: DRESectionKey): DRESection => {
    const lines = [...(buckets.get(key)?.values() ?? [])].sort((a, b) =>
      a.code.localeCompare(b.code, undefined, { numeric: true })
    );
    return { key, lines, total: lines.reduce((sum, l) => sum + l.value, 0) };
  };

  const sections = Object.fromEntries(
    [...CANONICAL].map((k) => [k, section(k as DRESectionKey)])
  ) as Record<DRESectionKey, DRESection>;

  const grossRevenue = sections.GROSS_REVENUE.total;
  const deductions = sections.DEDUCTIONS.total;
  const netRevenue = grossRevenue - deductions;
  const costs = sections.COSTS.total;
  const grossProfit = netRevenue - costs;
  const operatingExpenses = sections.OPERATING_EXPENSES.total;
  const financialResult = sections.FINANCIAL_INCOME.total - sections.FINANCIAL_EXPENSES.total;
  const otherResult = sections.OTHER_INCOME.total - sections.OTHER_EXPENSES.total;
  const incomeTaxes = sections.INCOME_TAXES.total;
  const netResult = grossProfit - operatingExpenses + financialResult + otherResult - incomeTaxes;

  return {
    sections,
    grossRevenue,
    deductions,
    netRevenue,
    costs,
    grossProfit,
    operatingExpenses,
    financialResult,
    otherResult,
    incomeTaxes,
    netResult,
    netMargin: netRevenue > 0 ? (netResult / netRevenue) * 100 : null,
    reconciledCount,
    awaitingApproval,
  };
}

/* =========================================================================
   Períodos
   ========================================================================= */

export type PeriodMode = 'month' | 'quarter' | 'year';

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (year: number, month1: number) => new Date(year, month1, 0).getDate();

/** `index`: mês 1–12 (month), trimestre 1–4 (quarter); ignorado para year. */
export function periodRange(mode: PeriodMode, year: number, index: number): DateRange {
  if (mode === 'year') return { start: `${year}-01-01`, end: `${year}-12-31` };
  if (mode === 'quarter') {
    const first = (index - 1) * 3 + 1;
    const last = first + 2;
    return { start: `${year}-${pad(first)}-01`, end: `${year}-${pad(last)}-${pad(lastDay(year, last))}` };
  }
  return { start: `${year}-${pad(index)}-01`, end: `${year}-${pad(index)}-${pad(lastDay(year, index))}` };
}
