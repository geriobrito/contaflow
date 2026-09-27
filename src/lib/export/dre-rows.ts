import type { ClientCompany } from '@/types/firestore';
import type { DateRange, DREAccountLine, DREStatement } from '@/lib/dre/build';
import { formatCNPJ, formatDateBR } from '@/lib/utils/formatters';

/**
 * Linhas da DRE no layout da ITG 1000/2022 (NBC TG 1002 — Anexo 9), compartilhadas
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
}

export interface DREExportContext {
  client: Pick<ClientCompany, 'name' | 'cnpj' | 'tradeName'>;
  range: DateRange;
  statement: DREStatement;
  /** Data de emissão; padrão: agora. */
  issuedAt?: Date;
  signatories?: {
    legalRepresentative?: { name?: string; cpf?: string };
    accountant?: { name?: string; crc?: string };
  };
}

export const DRE_TITLE = 'DEMONSTRAÇÃO DO RESULTADO DO EXERCÍCIO';
export const DRE_STANDARD = 'NBC TG 1002 / ITG 1000 - Microentidades';
export const DRE_CURRENCY = 'Em Reais - R$';

export function buildDREExportRows(statement: DREStatement): DREExportRow[] {
  const base = statement.grossRevenue;
  const pct = (value: number): number | null => (base > 0 ? (value / base) * 100 : null);
  const rows: DREExportRow[] = [];

  const group = (label: string, value: number, parts: { lines: DREAccountLine[]; sign: 1 | -1 }[]) => {
    rows.push({ kind: 'group', label, value, percent: pct(value) });
    for (const { lines, sign } of parts) {
      for (const l of lines) {
        const v = sign * l.value;
        rows.push({ kind: 'account', label: l.name, code: l.code, value: v, percent: pct(v) });
      }
    }
  };
  const subtotal = (label: string, value: number, kind: 'subtotal' | 'result' = 'subtotal') =>
    rows.push({ kind, label, value, percent: pct(value) });

  const s = statement.sections;
  group('RECEITA BRUTA OPERACIONAL', statement.grossRevenue, [{ lines: s.GROSS_REVENUE.lines, sign: 1 }]);
  group('(-) DEDUÇÕES DA RECEITA BRUTA', -statement.deductions, [{ lines: s.DEDUCTIONS.lines, sign: -1 }]);
  subtotal('(=) RECEITA LÍQUIDA OPERACIONAL', statement.netRevenue);
  group('(-) CUSTOS DAS VENDAS E SERVIÇOS', -statement.costs, [{ lines: s.COSTS.lines, sign: -1 }]);
  subtotal('(=) RESULTADO BRUTO DO PERÍODO', statement.grossProfit);
  group('(-) DESPESAS OPERACIONAIS', -statement.operatingExpenses, [{ lines: s.OPERATING_EXPENSES.lines, sign: -1 }]);
  group('(+/-) RESULTADO FINANCEIRO LÍQUIDO', statement.financialResult, [
    { lines: s.FINANCIAL_INCOME.lines, sign: 1 },
    { lines: s.FINANCIAL_EXPENSES.lines, sign: -1 },
  ]);
  if (s.OTHER_INCOME.lines.length > 0 || s.OTHER_EXPENSES.lines.length > 0) {
    group('(+/-) OUTRAS RECEITAS E DESPESAS OPERACIONAIS', statement.otherResult, [
      { lines: s.OTHER_INCOME.lines, sign: 1 },
      { lines: s.OTHER_EXPENSES.lines, sign: -1 },
    ]);
  }
  if (s.INCOME_TAXES.lines.length > 0) {
    group('(-) IRPJ E CSLL', -statement.incomeTaxes, [{ lines: s.INCOME_TAXES.lines, sign: -1 }]);
  }
  subtotal('(=) LUCRO (PREJUÍZO) LÍQUIDO DO EXERCÍCIO', statement.netResult, 'result');
  return rows;
}

/* =========================================================================
   Formatação compartilhada
   ========================================================================= */

const BRL = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `1.234,56` e negativos entre parênteses: `(1.234,56)`. */
export function formatAccounting(value: number): string {
  const abs = BRL.format(Math.abs(value));
  return value < 0 ? `(${abs})` : abs;
}

export function formatPercent(value: number | null): string {
  if (value === null) return '-';
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
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
