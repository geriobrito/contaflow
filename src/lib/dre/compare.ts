import type { BankTransaction, ChartAccount } from '@/types/firestore';
import { buildDRE, type DateRange, type DRESectionKey, type DREStatement } from '@/lib/dre/build';
import { monthsBetween } from '@/lib/periods';

/**
 * DRE comparativa: colunas mês a mês ou período atual contra o mesmo período do ano
 * anterior, com variação absoluta e percentual.
 */

export interface CompareColumn {
  key: string;
  label: string;
  range: DateRange;
  statement: DREStatement;
}

const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const lastDayOf = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** Uma coluna por mês do intervalo (recortada ao intervalo nas pontas). */
export function monthlyColumns(transactions: readonly BankTransaction[], accounts: readonly ChartAccount[], range: DateRange): CompareColumn[] {
  return monthsBetween(range.start, range.end).map((month) => {
    const start = `${month}-01` < range.start ? range.start : `${month}-01`;
    const endOfMonth = `${month}-${String(lastDayOf(month)).padStart(2, '0')}`;
    const end = endOfMonth > range.end ? range.end : endOfMonth;
    const [y, m] = month.split('-');
    return {
      key: month,
      label: `${MONTH_SHORT[Number(m) - 1]}/${y.slice(2)}`,
      range: { start, end },
      statement: buildDRE(transactions, accounts, { start, end }),
    };
  });
}

/** Mesmo intervalo, um ano antes (29/02 vira 28/02). */
export function previousYearRange(range: DateRange): DateRange {
  const shift = (d: string) => {
    const y = Number(d.slice(0, 4)) - 1;
    const md = d.slice(5);
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return `${y}-${md === '02-29' && !leap ? '02-28' : md}`;
  };
  return { start: shift(range.start), end: shift(range.end) };
}

/** Variação percentual sobre o valor anterior; null quando não há base. */
export function variation(current: number, previous: number): number | null {
  if (Math.abs(previous) < 0.005) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/* =========================================================================
   Linhas do comparativo
   ========================================================================= */

export type CompareRowKind = 'total' | 'section' | 'account';

export interface CompareRow {
  id: string;
  label: string;
  code?: string;
  kind: CompareRowKind;
  /** Aumento é bom (receitas, lucros) ou ruim (custos, despesas)? */
  favorable: 'up' | 'down';
  values: number[];
}

interface LineSpec {
  id: string;
  label: string;
  kind: 'total' | 'section';
  favorable: 'up' | 'down';
  value: (s: DREStatement) => number;
  section?: DRESectionKey;
}

/** Estrutura da DRE (ITG 1000) na ordem de apresentação. */
const SPEC: readonly LineSpec[] = [
  { id: 'gross', label: 'Receita bruta', kind: 'section', favorable: 'up', value: (s) => s.grossRevenue, section: 'GROSS_REVENUE' },
  { id: 'deductions', label: '(−) Deduções da receita', kind: 'section', favorable: 'down', value: (s) => s.deductions, section: 'DEDUCTIONS' },
  { id: 'net', label: 'Receita líquida', kind: 'total', favorable: 'up', value: (s) => s.netRevenue },
  { id: 'costs', label: '(−) Custos das vendas', kind: 'section', favorable: 'down', value: (s) => s.costs, section: 'COSTS' },
  { id: 'grossProfit', label: 'Lucro bruto', kind: 'total', favorable: 'up', value: (s) => s.grossProfit },
  { id: 'opex', label: '(−) Despesas operacionais', kind: 'section', favorable: 'down', value: (s) => s.operatingExpenses, section: 'OPERATING_EXPENSES' },
  { id: 'finIncome', label: 'Receitas financeiras', kind: 'section', favorable: 'up', value: (s) => s.sections.FINANCIAL_INCOME.total, section: 'FINANCIAL_INCOME' },
  { id: 'finExpenses', label: '(−) Despesas financeiras', kind: 'section', favorable: 'down', value: (s) => s.sections.FINANCIAL_EXPENSES.total, section: 'FINANCIAL_EXPENSES' },
  { id: 'otherIncome', label: 'Outras receitas', kind: 'section', favorable: 'up', value: (s) => s.sections.OTHER_INCOME.total, section: 'OTHER_INCOME' },
  { id: 'otherExpenses', label: '(−) Outras despesas', kind: 'section', favorable: 'down', value: (s) => s.sections.OTHER_EXPENSES.total, section: 'OTHER_EXPENSES' },
  { id: 'taxes', label: '(−) Tributos sobre o lucro', kind: 'section', favorable: 'down', value: (s) => s.incomeTaxes, section: 'INCOME_TAXES' },
  { id: 'result', label: 'Resultado líquido', kind: 'total', favorable: 'up', value: (s) => s.netResult },
];

/**
 * Linhas do comparativo para as colunas dadas. Com `withAccounts`, cada grupo traz as
 * contas que tiveram movimento em qualquer coluna. Grupos vazios em todas as colunas somem.
 */
export function compareRows(statements: readonly DREStatement[], withAccounts = true): CompareRow[] {
  const rows: CompareRow[] = [];
  for (const spec of SPEC) {
    const values = statements.map(spec.value);
    const empty = values.every((v) => Math.abs(v) < 0.005);
    if (spec.kind === 'section' && empty) continue;
    rows.push({ id: spec.id, label: spec.label, kind: spec.kind, favorable: spec.favorable, values });
    if (!withAccounts || !spec.section) continue;
    const section = spec.section;
    const accounts = new Map<string, { code: string; name: string }>();
    for (const s of statements) for (const l of s.sections[section].lines) accounts.set(l.accountId, { code: l.code, name: l.name });
    [...accounts]
      .sort(([, a], [, b]) => a.code.localeCompare(b.code, undefined, { numeric: true }))
      .forEach(([id, acc]) =>
        rows.push({
          id: `${spec.id}:${id}`,
          label: acc.name,
          code: acc.code,
          kind: 'account',
          favorable: spec.favorable,
          values: statements.map((s) => s.sections[section].lines.find((l) => l.accountId === id)?.value ?? 0),
        })
      );
  }
  return rows;
}
