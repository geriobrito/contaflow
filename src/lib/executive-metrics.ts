import type { BankTransaction, ChartAccount, JournalEntry } from '@/types/firestore';
import { buildDRE, type DateRange } from '@/lib/dre/build';
import { monthlyColumns, previousYearRange, variation } from '@/lib/dre/compare';

export interface ExecutiveMonthlyBreakdown {
  month: string; // YYYY-MM
  label: string; // ex.: "jan/25"
  grossRevenue: number;
  netRevenue: number;
  costs: number;
  operatingExpenses: number;
  financialExpenses: number;
  taxes: number;
  netResult: number;
  netMargin: number;
}

export interface CostComposition {
  costs: number;
  operatingExpenses: number;
  financialExpenses: number;
  taxes: number;
  total: number;
  costsPct: number;
  operatingExpensesPct: number;
  financialExpensesPct: number;
  taxesPct: number;
}

export interface ExecutiveSummary {
  range: DateRange;
  periodLabel: string;
  twelveMonthsGrossRevenue: number;
  twelveMonthsGrossRevenueVariation: number | null;
  twelveMonthsNetRevenue: number;
  twelveMonthsNetResult: number;
  twelveMonthsNetMargin: number;
  twelveMonthsEbitda: number;
  reconciledCount: number;
  awaitingApprovalCount: number;
  monthly: ExecutiveMonthlyBreakdown[];
  costComposition: CostComposition;
}

const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(last).padStart(2, '0')}`;
}

function shiftMonths(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatMonthShort(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MONTH_SHORT[Number(m) - 1]}/${y.slice(2)}`;
}

function isDepreciationOrAmortization(code: string, name: string): boolean {
  if (code === '3.2.1.04' || code === '3.3.2.15') return true;
  const lower = name.toLowerCase();
  return lower.includes('deprecia') || lower.includes('amortiza');
}

/**
 * Calcula a janela de 12 meses até a data de referência (ou o último lançamento disponível)
 * e consolida os indicadores executivos (Faturamento, Margem Líquida, EBITDA, Composição de Gastos).
 */
export function buildExecutiveSummary(params: {
  transactions: readonly BankTransaction[];
  accounts: readonly ChartAccount[];
  journalEntries?: readonly JournalEntry[] | null;
  referenceDate?: string;
}): ExecutiveSummary {
  const { transactions, accounts, journalEntries, referenceDate } = params;

  let refMonth = referenceDate ? referenceDate.slice(0, 7) : '';
  if (!refMonth) {
    let latest = '';
    for (const t of transactions) {
      if (t.date > latest) latest = t.date;
    }
    if (journalEntries) {
      for (const j of journalEntries) {
        if (j.date > latest) latest = j.date;
      }
    }
    refMonth = latest ? latest.slice(0, 7) : new Date().toISOString().slice(0, 7);
  }

  const startMonth = shiftMonths(refMonth, -11);
  const range: DateRange = {
    start: `${startMonth}-01`,
    end: lastDayOfMonth(refMonth),
  };

  const consolidated = buildDRE(transactions, accounts, range, journalEntries);
  const prevRange = previousYearRange(range);
  const previousConsolidated = buildDRE(transactions, accounts, prevRange, journalEntries);

  const cols = monthlyColumns(transactions, accounts, range, journalEntries);
  const monthly: ExecutiveMonthlyBreakdown[] = cols.map((col) => {
    const s = col.statement;
    const finExp = s.sections.FINANCIAL_EXPENSES.total;
    const taxes = s.deductions + s.incomeTaxes;
    return {
      month: col.key,
      label: col.label,
      grossRevenue: s.grossRevenue,
      netRevenue: s.netRevenue,
      costs: s.costs,
      operatingExpenses: s.operatingExpenses,
      financialExpenses: finExp,
      taxes,
      netResult: s.netResult,
      netMargin: s.netMargin ?? 0,
    };
  });

  // Depreciação e amortização somadas de volta para estimativa do EBITDA operacional
  let depreciationTotal = 0;
  for (const line of [...consolidated.sections.COSTS.lines, ...consolidated.sections.OPERATING_EXPENSES.lines]) {
    if (isDepreciationOrAmortization(line.code, line.name)) {
      depreciationTotal += line.value;
    }
  }

  const operatingResult = consolidated.grossProfit - consolidated.operatingExpenses + consolidated.otherResult;
  const ebitda = operatingResult + depreciationTotal;

  const costs = consolidated.costs;
  const operatingExpenses = consolidated.operatingExpenses;
  const financialExpenses = consolidated.sections.FINANCIAL_EXPENSES.total;
  const taxes = consolidated.deductions + consolidated.incomeTaxes;
  const totalOutflows = costs + operatingExpenses + financialExpenses + taxes;

  const pct = (v: number) => (totalOutflows > 0.005 ? (v / totalOutflows) * 100 : 0);

  return {
    range,
    periodLabel: `${formatMonthShort(startMonth)} a ${formatMonthShort(refMonth)}`,
    twelveMonthsGrossRevenue: consolidated.grossRevenue,
    twelveMonthsGrossRevenueVariation: variation(consolidated.grossRevenue, previousConsolidated.grossRevenue),
    twelveMonthsNetRevenue: consolidated.netRevenue,
    twelveMonthsNetResult: consolidated.netResult,
    twelveMonthsNetMargin: consolidated.netMargin ?? 0,
    twelveMonthsEbitda: ebitda,
    reconciledCount: consolidated.reconciledCount,
    awaitingApprovalCount: consolidated.awaitingApproval,
    monthly,
    costComposition: {
      costs,
      operatingExpenses,
      financialExpenses,
      taxes,
      total: totalOutflows,
      costsPct: pct(costs),
      operatingExpensesPct: pct(operatingExpenses),
      financialExpensesPct: pct(financialExpenses),
      taxesPct: pct(taxes),
    },
  };
}

