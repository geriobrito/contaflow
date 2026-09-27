import type { AccountType, BankTransaction, ChartAccount, DREGroup } from '@/types/firestore';

/* =========================================================================
   Estrutura editorial da DRE
   ========================================================================= */

export interface DREAccountLine {
  accountId: string;
  code: string;
  name: string;
  /** Valor positivo = aumenta a linha do grupo (receita ou despesa, conforme o grupo). */
  value: number;
  count: number;
}

export interface DREExpenseGroup {
  id: string;
  title: string;
  /** Total do grupo como dedução do resultado (positivo reduz o lucro). */
  total: number;
  lines: DREAccountLine[];
}

export interface DREStatement {
  grossRevenue: number;
  revenueLines: DREAccountLine[];
  deductions: number;
  deductionLines: DREAccountLine[];
  netRevenue: number;
  expenseGroups: DREExpenseGroup[];
  totalExpenses: number;
  netResult: number;
  /** Margem líquida sobre a receita líquida (0–100), ou null sem receita. */
  netMargin: number | null;
  reconciledCount: number;
  /** Lançamentos auto-classificados no período ainda não aprovados (fora da DRE). */
  awaitingApproval: number;
}

export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

const REVENUE_TYPES: ReadonlySet<AccountType> = new Set(['REVENUE', 'RECEITA']);
const COST_TYPES: ReadonlySet<AccountType> = new Set(['COST', 'CUSTO']);
const EXPENSE_TYPES: ReadonlySet<AccountType> = new Set(['EXPENSE', 'DESPESA']);

/** Ordem e títulos dos grupos de custos e despesas operacionais. */
const EXPENSE_GROUPS: readonly { id: string; title: string; match: (a: ChartAccount) => boolean }[] = [
  { id: 'custos', title: 'Custos dos serviços e mercadorias', match: (a) => COST_TYPES.has(a.type) || a.dreGroup === 'CUSTOS' },
  { id: 'adm', title: 'Despesas administrativas', match: (a) => a.dreGroup === 'DESPESAS_ADMINISTRATIVAS' },
  { id: 'com', title: 'Despesas comerciais', match: (a) => a.dreGroup === 'DESPESAS_COMERCIAIS' },
  {
    id: 'fin',
    title: 'Resultado financeiro',
    match: (a) => a.dreGroup === 'DESPESAS_FINANCEIRAS' || a.dreGroup === 'RECEITAS_FINANCEIRAS',
  },
  { id: 'ir', title: 'IRPJ e CSLL', match: (a) => a.dreGroup === 'IMPOSTOS_LUCRO' },
  { id: 'outras', title: 'Outras despesas operacionais', match: (a) => EXPENSE_TYPES.has(a.type) },
];

const isDeduction = (a: ChartAccount): boolean => a.dreGroup === 'DEDUCOES_RECEITA';
const isGrossRevenue = (a: ChartAccount): boolean =>
  REVENUE_TYPES.has(a.type) && a.dreGroup !== 'RECEITAS_FINANCEIRAS' && !isDeduction(a);

const FINANCIAL_INCOME: DREGroup = 'RECEITAS_FINANCEIRAS';

function sortLines(lines: Map<string, DREAccountLine>): DREAccountLine[] {
  return [...lines.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

/**
 * Monta a DRE a partir dos lançamentos CONCILIADOS no período.
 * Auto-classificados não aprovados ficam fora e são apenas contabilizados em `awaitingApproval`.
 */
export function buildDRE(
  transactions: readonly BankTransaction[],
  accounts: readonly ChartAccount[],
  range: DateRange
): DREStatement {
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const inRange = (t: BankTransaction) => t.date >= range.start && t.date <= range.end;

  const revenue = new Map<string, DREAccountLine>();
  const deductions = new Map<string, DREAccountLine>();
  const groups = new Map<string, Map<string, DREAccountLine>>();

  let reconciledCount = 0;
  let awaitingApproval = 0;

  const add = (bucket: Map<string, DREAccountLine>, acc: ChartAccount, value: number) => {
    const line = bucket.get(acc.id) ?? { accountId: acc.id, code: acc.code, name: acc.name, value: 0, count: 0 };
    line.value += value;
    line.count += 1;
    bucket.set(acc.id, line);
  };

  for (const t of transactions) {
    if (!inRange(t)) continue;
    if (t.status === 'AUTO_CLASSIFIED') awaitingApproval++;
    if (t.status !== 'RECONCILED' || !t.accountId) continue;
    const acc = byId.get(t.accountId);
    if (!acc) continue;
    reconciledCount++;

    const magnitude = Math.abs(t.amount);

    if (isDeduction(acc)) {
      add(deductions, acc, magnitude);
    } else if (isGrossRevenue(acc)) {
      add(revenue, acc, magnitude);
    } else {
      const group = EXPENSE_GROUPS.find((g) => g.match(acc));
      if (!group) continue; // Ativo/Passivo não transitam pela DRE
      const bucket = groups.get(group.id) ?? new Map<string, DREAccountLine>();
      // Receitas financeiras reduzem o grupo "Resultado financeiro".
      add(bucket, acc, acc.dreGroup === FINANCIAL_INCOME ? -magnitude : magnitude);
      groups.set(group.id, bucket);
    }
  }

  const revenueLines = sortLines(revenue);
  const deductionLines = sortLines(deductions);
  const grossRevenue = revenueLines.reduce((s, l) => s + l.value, 0);
  const totalDeductions = deductionLines.reduce((s, l) => s + l.value, 0);
  const netRevenue = grossRevenue - totalDeductions;

  const expenseGroups: DREExpenseGroup[] = EXPENSE_GROUPS.filter((g) => groups.has(g.id)).map((g) => {
    const lines = sortLines(groups.get(g.id) ?? new Map());
    return { id: g.id, title: g.title, lines, total: lines.reduce((s, l) => s + l.value, 0) };
  });
  const totalExpenses = expenseGroups.reduce((s, g) => s + g.total, 0);
  const netResult = netRevenue - totalExpenses;

  return {
    grossRevenue,
    revenueLines,
    deductions: totalDeductions,
    deductionLines,
    netRevenue,
    expenseGroups,
    totalExpenses,
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
