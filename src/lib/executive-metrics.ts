import type { BankTransaction, ChartAccount, JournalEntry, ResultSummary } from '@/types/firestore';
import { buildDRE, type DateRange } from '@/lib/dre/build';
import { monthlyColumns, previousYearRange, variation } from '@/lib/dre/compare';
import { todayISO } from '@/lib/business-days';
import { round2 } from '@/lib/money';

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
  /** Custos, despesas e tributos do mês (o que saiu contra a receita). */
  outflows: number;
  /** Resultado líquido acumulado desde o primeiro mês da janela. */
  cumulativeResult: number;
  /** Receita bruta do mesmo mês um ano antes (comparação), com o rótulo dele. */
  previousGrossRevenue: number;
  previousLabel: string;
}

/**
 * Degrau da ponte do resultado (cascata): `total` é uma barra que parte do zero (receita bruta,
 * resultado líquido); `delta` soma ou subtrai do acumulado anterior. `start` e `end` são as
 * extremidades da barra no eixo de valores.
 */
export interface BridgeStep {
  key: 'gross' | 'deductions' | 'costs' | 'opex' | 'other' | 'incomeTaxes' | 'net';
  label: string;
  kind: 'total' | 'delta';
  /** Valor do degrau: positivo soma, negativo subtrai. Nos totais, o próprio total. */
  value: number;
  start: number;
  end: number;
}

/** Conta de custo ou despesa entre as maiores do período. */
export interface TopExpense {
  code: string;
  name: string;
  value: number;
  /** Participação (%) no total de custos e despesas. */
  share: number;
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
  /** Os 12 meses anteriores, para comparar. */
  previous: { periodLabel: string; grossRevenue: number; netResult: number; netMargin: number };
  /** Variação do resultado líquido frente aos 12 meses anteriores (%), ou null sem base. */
  twelveMonthsNetResultVariation: number | null;
  /** Margem EBITDA sobre a receita líquida (%). */
  twelveMonthsEbitdaMargin: number;
  /** Da receita bruta ao resultado líquido, degrau a degrau. */
  bridge: BridgeStep[];
  /** Maiores contas de custo e despesa; o que sobra vem somado em "Demais contas". */
  topExpenses: TopExpense[];
  /** Meses da janela com receita ou gasto lançado. */
  monthsWithData: number;
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

/** Quantas contas aparecem pelo nome no ranking de gastos; as demais são somadas. */
const TOP_EXPENSES = 7;

/**
 * Ponte do resultado: receita bruta, o que sai em cada grupo e o resultado líquido. "Financeiro
 * e outros" é o que falta para fechar no resultado da DRE (resultado financeiro e outras receitas
 * e despesas), então os degraus sempre somam o resultado líquido.
 */
export function buildBridge(s: Pick<DREStatementLike, 'grossRevenue' | 'deductions' | 'costs' | 'operatingExpenses' | 'incomeTaxes' | 'netResult'>): BridgeStep[] {
  const other = round2(s.netResult - (s.grossRevenue - s.deductions - s.costs - s.operatingExpenses - s.incomeTaxes));
  const steps: BridgeStep[] = [];
  let running = 0;
  const total = (key: BridgeStep['key'], label: string, value: number) => {
    steps.push({ key, label, kind: 'total', value, start: 0, end: value });
    running = value;
  };
  const delta = (key: BridgeStep['key'], label: string, value: number) => {
    if (Math.abs(value) < 0.005) return;
    steps.push({ key, label, kind: 'delta', value, start: running, end: round2(running + value) });
    running = round2(running + value);
  };
  total('gross', 'Receita bruta', s.grossRevenue);
  delta('deductions', 'Tributos e deduções', -s.deductions);
  delta('costs', 'Custos', -s.costs);
  delta('opex', 'Despesas operacionais', -s.operatingExpenses);
  delta('other', 'Financeiro e outros', other);
  delta('incomeTaxes', 'IRPJ e CSLL', -s.incomeTaxes);
  total('net', 'Resultado líquido', s.netResult);
  return steps;
}

interface DREStatementLike {
  grossRevenue: number;
  deductions: number;
  costs: number;
  operatingExpenses: number;
  incomeTaxes: number;
  netResult: number;
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
/** Intervalo lido pela visão executiva: os 12 meses até a referência e os 12 anteriores (comparação). */
export function executiveLoadRange(referenceDate: string): DateRange {
  const refMonth = referenceDate.slice(0, 7);
  return { start: `${shiftMonths(refMonth, -23)}-01`, end: lastDayOfMonth(refMonth) };
}

export function buildExecutiveSummary(params: {
  transactions: readonly BankTransaction[];
  accounts: readonly ChartAccount[];
  journalEntries?: readonly JournalEntry[] | null;
  /** Resumos de competências fechadas no lugar dos lançamentos delas (src/lib/dre/summaries.ts). */
  summaries?: readonly ResultSummary[] | null;
  referenceDate?: string;
}): ExecutiveSummary {
  const { transactions, accounts, journalEntries, summaries, referenceDate } = params;

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
    refMonth = latest ? latest.slice(0, 7) : todayISO().slice(0, 7);
  }

  const startMonth = shiftMonths(refMonth, -11);
  const range: DateRange = {
    start: `${startMonth}-01`,
    end: lastDayOfMonth(refMonth),
  };

  const consolidated = buildDRE(transactions, accounts, range, journalEntries, summaries);
  const prevRange = previousYearRange(range);
  const previousConsolidated = buildDRE(transactions, accounts, prevRange, journalEntries, summaries);

  const cols = monthlyColumns(transactions, accounts, range, journalEntries, summaries);
  const prevCols = monthlyColumns(transactions, accounts, prevRange, journalEntries, summaries);
  let cumulative = 0;
  const monthly: ExecutiveMonthlyBreakdown[] = cols.map((col, i) => {
    const s = col.statement;
    const finExp = s.sections.FINANCIAL_EXPENSES.total;
    const taxes = s.deductions + s.incomeTaxes;
    cumulative = round2(cumulative + s.netResult);
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
      outflows: round2(s.costs + s.operatingExpenses + finExp + taxes),
      cumulativeResult: cumulative,
      previousGrossRevenue: prevCols[i]?.statement.grossRevenue ?? 0,
      previousLabel: prevCols[i]?.label ?? '',
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

  // Maiores contas de custo e despesa (tributos sobre vendas ficam na composição, não aqui).
  const expenseLines = [...consolidated.sections.COSTS.lines, ...consolidated.sections.OPERATING_EXPENSES.lines, ...consolidated.sections.FINANCIAL_EXPENSES.lines]
    .filter((l) => l.value > 0.005)
    .sort((a, b) => b.value - a.value);
  const expenseTotal = expenseLines.reduce((sum, l) => sum + l.value, 0);
  const share = (v: number) => (expenseTotal > 0.005 ? (v / expenseTotal) * 100 : 0);
  const named = expenseLines.slice(0, TOP_EXPENSES);
  const rest = round2(expenseLines.slice(TOP_EXPENSES).reduce((sum, l) => sum + l.value, 0));
  const topExpenses: TopExpense[] = [
    ...named.map((l) => ({ code: l.code, name: l.name, value: l.value, share: share(l.value) })),
    ...(rest > 0.005 ? [{ code: '', name: `Demais contas (${expenseLines.length - TOP_EXPENSES})`, value: rest, share: share(rest) }] : []),
  ];
  const prevStartMonth = prevRange.start.slice(0, 7);
  const prevEndMonth = prevRange.end.slice(0, 7);

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
    previous: {
      periodLabel: `${formatMonthShort(prevStartMonth)} a ${formatMonthShort(prevEndMonth)}`,
      grossRevenue: previousConsolidated.grossRevenue,
      netResult: previousConsolidated.netResult,
      netMargin: previousConsolidated.netMargin ?? 0,
    },
    twelveMonthsNetResultVariation: variation(consolidated.netResult, previousConsolidated.netResult),
    twelveMonthsEbitdaMargin: Math.abs(consolidated.netRevenue) > 0.005 ? (ebitda / consolidated.netRevenue) * 100 : 0,
    bridge: buildBridge(consolidated),
    topExpenses,
    monthsWithData: monthly.filter((m) => Math.abs(m.grossRevenue) > 0.005 || Math.abs(m.outflows) > 0.005).length,
  };
}

