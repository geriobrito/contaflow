import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import type { ClientCompany } from '@/types/firestore';
import { cashFlowRows, type CashFlowRow, type CashFlowStatement } from '@/lib/cash-flow';
import { accountingStandard } from '@/lib/accounting-standard';
import {
  GRAND_TOTAL_FILL,
  HEADER_FILL,
  INK,
  MARGIN_X,
  MUTED,
  RULE,
  addPageFooters,
  renderConformity,
  renderSignatures,
  renderStatementHeader,
  sanitizeFileName,
  type LedgerPdfExportContext,
} from '@/lib/export/ledger-pdf';
import { renderConformityRow, renderSheetHeader, renderSignatures as renderSheetSignatures } from '@/lib/export/ledger-excel';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

/** Demonstração dos Fluxos de Caixa (método direto) em PDF (A4 retrato) e Excel. */

export const DFC_TITLE = 'DEMONSTRAÇÃO DOS FLUXOS DE CAIXA';

export interface CashFlowExportContext {
  client: Pick<ClientCompany, 'name' | 'cnpj' | 'tradeName' | 'porte' | 'activity'>;
  statement: CashFlowStatement;
  /** Mostra as contas de cada linha. */
  detail?: boolean;
  issuedAt?: Date;
  signatories?: LedgerPdfExportContext['signatories'];
}

const money = (v: number) => (v < 0 ? `(${formatCurrency(-v)})` : formatCurrency(v));
const periodOf = (s: CashFlowStatement) => `Método direto: de ${formatDateBR(s.start)} a ${formatDateBR(s.end)}`;
const fileBase = (ctx: CashFlowExportContext) =>
  `DFC_${sanitizeFileName(ctx.client.tradeName || ctx.client.name) || 'Cliente'}_${ctx.statement.start}_a_${ctx.statement.end}`;

const labelOf = (r: CashFlowRow) => (r.kind === 'detail' && r.code ? `${r.code}  ${r.label}` : r.label);
const STRONG: ReadonlySet<CashFlowRow['kind']> = new Set(['section', 'subtotal', 'total', 'balance']);
const FILLED: ReadonlySet<CashFlowRow['kind']> = new Set(['total', 'balance']);
const INDENT: Partial<Record<CashFlowRow['kind'], number>> = { line: 7, detail: 12 };

export function generateCashFlowPdf(ctx: CashFlowExportContext): { blob: Blob; fileName: string } {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const standard = accountingStandard(ctx.client);
  const issuedAt = ctx.issuedAt ?? new Date();
  doc.setProperties({ title: `DFC - ${ctx.client.name}`, subject: `${periodOf(ctx.statement)} - ${standard}`, creator: 'ContaFlow' });

  const y = renderStatementHeader(doc, { client: ctx.client, title: DFC_TITLE, standard, period: periodOf(ctx.statement) });

  const rows = cashFlowRows(ctx.statement, { detail: ctx.detail });
  autoTable(doc, {
    startY: y + 2,
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: 18 },
    theme: 'plain',
    head: [['Descrição', 'Valor (R$)']],
    body: rows.map((r) => [labelOf(r), r.value === undefined ? '' : money(r.value)]),
    styles: { font: 'helvetica', fontSize: 9, textColor: INK, cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 }, lineColor: RULE },
    headStyles: { fontStyle: 'bold', fontSize: 8, textColor: MUTED, fillColor: HEADER_FILL, lineWidth: { bottom: 0.35 }, lineColor: INK },
    columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 45, halign: 'right' } },
    didParseCell: (data) => {
      if (data.section === 'head') {
        if (data.column.index === 1) data.cell.styles.halign = 'right';
        return;
      }
      const row = rows[data.row.index];
      if (!row) return;
      if (STRONG.has(row.kind)) data.cell.styles.fontStyle = 'bold';
      if (row.kind === 'section') data.cell.styles.cellPadding = { top: 4, bottom: 1.5, left: 2, right: 2 };
      if (row.kind === 'subtotal') {
        data.cell.styles.lineWidth = { top: 0.2 };
        data.cell.styles.lineColor = RULE;
      }
      if (FILLED.has(row.kind)) {
        data.cell.styles.fillColor = GRAND_TOTAL_FILL;
        data.cell.styles.lineWidth = { top: 0.3, bottom: 0.3 };
        data.cell.styles.lineColor = INK;
      }
      if (row.kind === 'detail') {
        data.cell.styles.fontSize = 8;
        data.cell.styles.textColor = MUTED;
      }
      const indent = INDENT[row.kind];
      if (indent && data.column.index === 0) data.cell.styles.cellPadding = { top: 1.8, bottom: 1.8, left: indent, right: 2 };
    },
  });
  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 40;
  renderSignatures(doc, renderConformity(doc, finalY, ctx.client), issuedAt, ctx.signatories);
  addPageFooters(doc, 'DFC', ctx.client.name);
  return { blob: doc.output('blob'), fileName: `${fileBase(ctx)}.pdf` };
}

const CURRENCY_FORMAT = '"R$" #,##0.00;[Red]-"R$" #,##0.00;"R$" 0.00';
const BORDER = { style: 'thin' as const, color: { argb: 'FF1C1917' } };

export async function generateCashFlowExcel(ctx: CashFlowExportContext): Promise<{ blob: Blob; fileName: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ContaFlow';
  wb.created = ctx.issuedAt ?? new Date();
  const ws = wb.addWorksheet('DFC', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [{ width: 64 }, { width: 22 }];
  const first = renderSheetHeader(ws, ctx, DFC_TITLE, periodOf(ctx.statement), 2);

  const head = ws.getRow(first);
  head.values = ['Descrição', 'Valor (R$)'];
  head.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FF555555' } };
  head.getCell(2).alignment = { horizontal: 'right' };
  head.eachCell((c) => (c.border = { bottom: BORDER }));

  const rows = cashFlowRows(ctx.statement, { detail: ctx.detail });
  rows.forEach((r, i) => {
    const row = ws.getRow(first + 1 + i);
    const pad = r.kind === 'line' ? '    ' : r.kind === 'detail' ? '        ' : '';
    row.values = r.value === undefined ? [labelOf(r)] : [`${pad}${labelOf(r)}`, r.value];
    row.font = {
      name: 'Aptos',
      size: r.kind === 'detail' ? 9 : 10,
      bold: STRONG.has(r.kind),
      color: { argb: r.kind === 'detail' ? 'FF69645F' : 'FF1C1917' },
    };
    if (r.value !== undefined) row.getCell(2).numFmt = CURRENCY_FORMAT;
    if (r.kind === 'subtotal') row.eachCell((c) => (c.border = { top: { style: 'thin', color: { argb: 'FFD2CEC8' } } }));
    if (FILLED.has(r.kind)) {
      row.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E2E2' } };
        c.border = { top: BORDER, bottom: BORDER };
      });
    }
  });

  renderConformityRow(ws, first + rows.length + 2, ctx.client, 1, 2);
  renderSheetSignatures(ws, ctx, first + rows.length + 5, 1, 1, 2, 2);
  const buffer = await wb.xlsx.writeBuffer();
  return {
    blob: new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    fileName: `${fileBase(ctx)}.xlsx`,
  };
}
