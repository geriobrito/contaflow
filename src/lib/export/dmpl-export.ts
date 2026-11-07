import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import type { ClientCompany } from '@/types/firestore';
import type { DMPL } from '@/lib/dmpl';
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

/** Demonstração das Mutações do Patrimônio Líquido em PDF (A4 paisagem) e Excel. */

export const DMPL_TITLE = 'DEMONSTRAÇÃO DAS MUTAÇÕES DO PATRIMÔNIO LÍQUIDO';

export interface DMPLExportContext {
  client: Pick<ClientCompany, 'name' | 'cnpj' | 'tradeName' | 'porte' | 'activity'>;
  dmpl: DMPL;
  issuedAt?: Date;
  signatories?: LedgerPdfExportContext['signatories'];
}

const money = (v: number) => (v < 0 ? `(${formatCurrency(-v)})` : formatCurrency(v));
const periodOf = (d: DMPL) => `Exercício de ${d.year}: de ${formatDateBR(d.start)} a ${formatDateBR(d.end)}`;
const fileBase = (ctx: DMPLExportContext) =>
  `DMPL_${sanitizeFileName(ctx.client.tradeName || ctx.client.name) || 'Cliente'}_${ctx.dmpl.start}_a_${ctx.dmpl.end}`;

export function generateDMPLPdf(ctx: DMPLExportContext): { blob: Blob; fileName: string } {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const standard = accountingStandard(ctx.client);
  const issuedAt = ctx.issuedAt ?? new Date();
  doc.setProperties({ title: `DMPL - ${ctx.client.name}`, subject: `${periodOf(ctx.dmpl)} - ${standard}`, creator: 'ContaFlow' });

  const y = renderStatementHeader(doc, { client: ctx.client, title: DMPL_TITLE, standard, period: periodOf(ctx.dmpl) });

  const { columns, rows } = ctx.dmpl;
  const head = [['Descrição', ...columns.map((c) => `${c.label} (R$)`), 'Total do PL (R$)']];
  const body = rows.map((r) => [
    r.label,
    ...columns.map((c) => {
      const val = r.values[c.key] ?? 0;
      if (r.kind !== 'balance' && Math.abs(val) < 0.005) return '—';
      return money(val);
    }),
    money(r.total),
  ]);

  const columnStyles: Record<number, { cellWidth?: number | 'auto'; halign?: 'left' | 'right'; fontStyle?: 'bold' }> = {
    0: { cellWidth: 'auto', halign: 'left' },
  };
  for (let i = 1; i <= columns.length + 1; i++) {
    columnStyles[i] = { halign: 'right', ...(i === columns.length + 1 ? { fontStyle: 'bold' } : {}) };
  }

  autoTable(doc, {
    startY: y + 2,
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: 18 },
    theme: 'plain',
    head,
    body,
    styles: { font: 'helvetica', fontSize: 8.5, textColor: INK, cellPadding: { top: 2, bottom: 2, left: 2, right: 2 }, lineColor: RULE },
    headStyles: { fontStyle: 'bold', fontSize: 7.5, textColor: MUTED, fillColor: HEADER_FILL, lineWidth: { bottom: 0.35 }, lineColor: INK },
    columnStyles,
    didParseCell: (data) => {
      if (data.section === 'head') {
        if (data.column.index > 0) data.cell.styles.halign = 'right';
        return;
      }
      const row = rows[data.row.index];
      if (!row) return;
      if (row.kind === 'balance') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = GRAND_TOTAL_FILL;
        data.cell.styles.lineWidth = { top: 0.3, bottom: 0.3 };
        data.cell.styles.lineColor = INK;
      } else if (data.column.index === 0) {
        data.cell.styles.cellPadding = { top: 2, bottom: 2, left: 6, right: 2 };
      }
    },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 40;
  renderSignatures(doc, renderConformity(doc, finalY, ctx.client), issuedAt, ctx.signatories);
  addPageFooters(doc, 'DMPL', ctx.client.name);
  return { blob: doc.output('blob'), fileName: `${fileBase(ctx)}.pdf` };
}

const CURRENCY_FORMAT = '"R$" #,##0.00;[Red]-"R$" #,##0.00;"R$" 0.00';

export async function generateDMPLExcel(ctx: DMPLExportContext): Promise<{ blob: Blob; fileName: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ContaFlow';
  wb.created = ctx.issuedAt ?? new Date();
  const ws = wb.addWorksheet('DMPL', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const { columns, rows } = ctx.dmpl;
  const numCols = columns.length + 2;
  ws.columns = [{ width: 48 }, ...columns.map(() => ({ width: 22 })), { width: 24 }];
  const first = renderSheetHeader(ws, ctx, DMPL_TITLE, periodOf(ctx.dmpl), numCols);

  const head = ws.getRow(first);
  head.values = ['Descrição', ...columns.map((c) => `${c.label} (R$)`), 'Total do PL (R$)'];
  head.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FF555555' } };
  for (let c = 2; c <= numCols; c++) head.getCell(c).alignment = { horizontal: 'right' };
  head.eachCell((c) => (c.border = { bottom: { style: 'thin', color: { argb: 'FF1C1917' } } }));

  rows.forEach((r, i) => {
    const row = ws.getRow(first + 1 + i);
    const isBalance = r.kind === 'balance';
    row.values = [
      isBalance ? r.label : `    ${r.label}`,
      ...columns.map((c) => r.values[c.key] ?? 0),
      r.total,
    ];
    row.font = { name: 'Aptos', size: 10, bold: isBalance, color: { argb: 'FF1C1917' } };
    for (let c = 2; c <= numCols; c++) {
      const cell = row.getCell(c);
      cell.numFmt = CURRENCY_FORMAT;
      if (c === numCols) cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FF1C1917' } };
    }
    if (isBalance) {
      row.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E2E2' } };
        c.border = { top: { style: 'thin', color: { argb: 'FF1C1917' } }, bottom: { style: 'thin', color: { argb: 'FF1C1917' } } };
      });
    }
  });

  const mid = Math.max(1, Math.floor(numCols / 2));
  renderConformityRow(ws, first + rows.length + 2, ctx.client, 1, numCols);
  renderSheetSignatures(ws, ctx, first + rows.length + 5, 1, mid, mid + 1, numCols);
  const buffer = await wb.xlsx.writeBuffer();
  return {
    blob: new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    fileName: `${fileBase(ctx)}.xlsx`,
  };
}

