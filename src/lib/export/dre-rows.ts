import type { ClientCompany } from '@/types/firestore';
import type { DateRange, DREStatement } from '@/lib/dre/build';
import { formatCNPJ, formatDateBR } from '@/lib/utils/formatters';

/**
 * Linhas da DRE no layout da NBC TG 1002 (Anexo 9), compartilhadas
 * pelos exportadores de PDF e Excel para que os dois documentos sejam idênticos.
 */
export type DRERowKind = 'group' | 'account' | 'subtotal' | 'result';

export interface DREExportRow {
  kind: DRERowKind;
  label: string;
  /** Valor com sinal contábil: negativo reduz o resultado. */
  value: number;
  /** Percentual sobre a receita bruta (null quando não há receita). */
  percent: number | null;
  code?: string;
  /** Valor no mesmo período do exercício anterior (só com o comparativo). */
  previous?: number;
}

export interface DREExportContext {
  client: Pick<ClientCompany, 'name' | 'cnpj' | 'tradeName' | 'porte' | 'activity'>;
  range: DateRange;
  statement: DREStatement;
  /** Mesmo período do exercício anterior: sai em coluna própria (comparabilidade). */
  previous?: { range: DateRange; statement: DREStatement } | null;
  /** Data de emissão; padrão: agora. */
  issuedAt?: Date;
  signatories?: {
    legalRepresentative?: { name?: string; cpf?: string };
    accountant?: { name?: string; crc?: string };
  };
}

export const DRE_TITLE = 'DEMONSTRAÇÃO DO RESULTADO DO EXERCÍCIO';
export const DRE_CURRENCY = 'Em Reais - R$';

/**
 * Linhas da DRE; com `previous` (o mesmo período do exercício anterior), cada linha traz também
 * o valor dele em `previous`, e as contas que só tiveram movimento num dos dois aparecem com zero
 * no outro.
 */
export function buildDREExportRows(statement: DREStatement, previous?: DREStatement | null): DREExportRow[] {
  const base = statement.grossRevenue;
  const pct = (value: number): number | null => (base > 0 ? (value / base) * 100 : null);
  const rows: DREExportRow[] = [];
  const prev = previous ?? null;

  type Part = { key: keyof DREStatement['sections']; sign: 1 | -1 };
  const group = (label: string, value: (st: DREStatement) => number, parts: Part[]) => {
    rows.push({ kind: 'group', label, value: value(statement), percent: pct(value(statement)), ...(prev ? { previous: value(prev) } : {}) });
    for (const { key, sign } of parts) {
      const current = statement.sections[key].lines;
      const before = prev?.sections[key].lines ?? [];
      const codes = [...new Set([...current.map((l) => l.code), ...before.map((l) => l.code)])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      for (const code of codes) {
        const c = current.find((l) => l.code === code);
        const b = before.find((l) => l.code === code);
        const v = sign * (c?.value ?? 0);
        rows.push({
          kind: 'account',
          label: (c ?? b)!.name,
          code,
          value: v,
          percent: pct(v),
          ...(prev ? { previous: sign * (b?.value ?? 0) } : {}),
        });
      }
    }
  };
  const subtotal = (label: string, value: (st: DREStatement) => number, kind: 'subtotal' | 'result' = 'subtotal') =>
    rows.push({ kind, label, value: value(statement), percent: pct(value(statement)), ...(prev ? { previous: value(prev) } : {}) });
  const has = (key: keyof DREStatement['sections']) => statement.sections[key].lines.length > 0 || (prev?.sections[key].lines.length ?? 0) > 0;

  group('RECEITA BRUTA OPERACIONAL', (st) => st.grossRevenue, [{ key: 'GROSS_REVENUE', sign: 1 }]);
  group('(-) DEDUÇÕES DA RECEITA BRUTA', (st) => -st.deductions, [{ key: 'DEDUCTIONS', sign: -1 }]);
  subtotal('(=) RECEITA LÍQUIDA OPERACIONAL', (st) => st.netRevenue);
  group('(-) CUSTOS DAS VENDAS E SERVIÇOS', (st) => -st.costs, [{ key: 'COSTS', sign: -1 }]);
  subtotal('(=) RESULTADO BRUTO DO PERÍODO', (st) => st.grossProfit);
  group('(-) DESPESAS OPERACIONAIS', (st) => -st.operatingExpenses, [{ key: 'OPERATING_EXPENSES', sign: -1 }]);
  group('(+/-) RESULTADO FINANCEIRO LÍQUIDO', (st) => st.financialResult, [
    { key: 'FINANCIAL_INCOME', sign: 1 },
    { key: 'FINANCIAL_EXPENSES', sign: -1 },
  ]);
  if (has('OTHER_INCOME') || has('OTHER_EXPENSES')) {
    group('(+/-) OUTRAS RECEITAS E DESPESAS OPERACIONAIS', (st) => st.otherResult, [
      { key: 'OTHER_INCOME', sign: 1 },
      { key: 'OTHER_EXPENSES', sign: -1 },
    ]);
  }
  if (has('INCOME_TAXES')) {
    group('(-) IRPJ E CSLL', (st) => -st.incomeTaxes, [{ key: 'INCOME_TAXES', sign: -1 }]);
  }
  subtotal('(=) LUCRO (PREJUÍZO) LÍQUIDO DO EXERCÍCIO', (st) => st.netResult, 'result');
  return rows;
}

/* =========================================================================
   Formatação compartilhada
   ========================================================================= */

const BRL = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PCT = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** `1.234,56` e negativos entre parênteses: `(1.234,56)`. Quase zero (inclusive `-0`) sai `0,00`. */
export function formatAccounting(value: number): string {
  if (Math.abs(value) < 0.005) return BRL.format(0);
  const abs = BRL.format(Math.abs(value));
  return value < 0 ? `(${abs})` : abs;
}

/** `12,3%` colado ao símbolo; `-0` (linha redutora zerada) e arredondamentos para zero saem `0,0%`. */
export function formatPercent(value: number | null): string {
  if (value === null) return '-';
  const pct = Math.abs(value) < 0.05 ? 0 : value;
  return `${PCT.format(pct).replace(/\s+/g, '')}%`;
}

export const periodLabel = (range: DateRange): string =>
  `De ${formatDateBR(range.start)} a ${formatDateBR(range.end)}`;

export const cnpjLabel = (cnpj: string): string => `CNPJ: ${formatCNPJ(cnpj)}`;

/** `DRE_Alpha_Tech_2026-01-01_a_2026-12-31` — sem acentos nem caracteres inválidos em nomes de arquivo. */
export function dreFileBaseName(clientName: string, range: DateRange): string {
  const slug = clientName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return `DRE_${slug || 'Cliente'}_${range.start}_a_${range.end}`;
}

export function formatIssueDate(date: Date): string {
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** Dispara o download de um Blob no navegador. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
