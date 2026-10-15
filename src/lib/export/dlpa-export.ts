import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import type { ClientCompany } from '@/types/firestore';
import type { DLPA } from '@/lib/year-closing';
import { accountingStandard } from '@/lib/accounting-standard';
import {
  GRAND_TOTAL_FILL,
  HEADER_FILL,
  INK,
  MARGIN_X,
  MUTED,
  RULE,
  addPageFooters,
  renderSignatures,
  renderStatementHeader,
  sanitizeFileName,
  type LedgerPdfExportContext,
} from '@/lib/export/ledger-pdf';
import { renderSheetHeader, renderSignatures as renderSheetSignatures } from '@/lib/export/ledger-excel';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

/** Demonstração de Lucros ou Prejuízos Acumulados em PDF (A4 retrato) e Excel. */

export const DLPA_TITLE = 'DEMONSTRAÇÃO DE LUCROS OU PREJUÍZOS ACUMULADOS';

export interface DLPAExportContext {
  client: Pick<ClientCompany, 'name' | 'cnpj' | 'tradeName' | 'porte'>;
  dlpa: DLPA;
  issuedAt?: Date;
  signatories?: LedgerPdfExportContext['signatories'];
}

const money = (v: number) => (v < 0 ? `(${formatCurrency(-v)})` : formatCurrency(v));
const periodOf = (d: DLPA) => `Exercício de ${d.year}: de ${formatDateBR(d.start)} a ${formatDateBR(d.end)}`;
const fileBase = (ctx: DLPAExportContext) => `DLPA_${sanitizeFileName(ctx.client.tradeName || ctx.client.name) || 'Cliente'}_${ctx.dlpa.start}_a_${ctx.dlpa.end}`;

export function generateDLPAPdf(ctx: DLPAExportContext): { blob: Blob; fileName: string } {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const standard = accountingStandard(ctx.client);
  const issuedAt = ctx.issuedAt ?? new Date();
  doc.setProperties({ title: `DLPA - ${ctx.client.name}`, subject: `${periodOf(ctx.dlpa)} - ${standard}`, creator: 'ContaFlow' });

  const y = renderStatementHeader(doc, { client: ctx.client, title: DLPA_TITLE, standard, period: periodOf(ctx.dlpa) });

  const rows = ctx.dlpa.rows;
  autoTable(doc, {
    startY: y + 2,
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: 18 },
    theme: 'plain',
    head: [['Descrição', 'Valor (R$)']],
    body: rows.map((r) => [r.label, money(r.value)]),
    styles: { font: 'helvetica', fontSize: 9, textColor: INK, cellPadding: { top: 2, bottom: 2, left: 2, right: 2 }, lineColor: RULE },
    headStyles: { fontStyle: 'bold', fontSize: 8, textColor: MUTED, fillColor: HEADER_FILL, lineWidth: { bottom: 0.35 }, lineColor: INK },
    columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 45, halign: 'right' } },
    didParseCell: (data) => {
      if (data.section === 'head') {
        if (data.column.index === 1) data.cell.styles.halign = 'right';
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
        data.cell.styles.cellPadding = { top: 2, bottom: 2, left: 7, right: 2 };
      }
    },
  });
  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 40;
  renderSignatures(doc, finalY, issuedAt, ctx.signatories);
  addPageFooters(doc, 'DLPA', ctx.client.name);
  return { blob: doc.output('blob'), fileName: `${fileBase(ctx)}.pdf` };
}

const CURRENCY_FORMAT = '"R$" #,##0.00;[Red]-"R$" #,##0.00;"R$" 0.00';

export async function generateDLPAExcel(ctx: DLPAExportContext): Promise<{ blob: Blob; fileName: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ContaFlow';
  wb.created = ctx.issuedAt ?? new Date();
  const ws = wb.addWorksheet('DLPA', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [{ width: 58 }, { width: 22 }];
  const first = renderSheetHeader(ws, ctx, DLPA_TITLE, periodOf(ctx.dlpa), 2);

  const head = ws.getRow(first);
  head.values = ['Descrição', 'Valor (R$)'];
  head.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FF555555' } };
  head.getCell(2).alignment = { horizontal: 'right' };
  head.eachCell((c) => (c.border = { bottom: { style: 'thin', color: { argb: 'FF1C1917' } } }));

  ctx.dlpa.rows.forEach((r, i) => {
    const row = ws.getRow(first + 1 + i);
    row.values = [r.kind === 'balance' ? r.label : `    ${r.label}`, r.value];
    row.font = { name: 'Aptos', size: 10, bold: r.kind === 'balance', color: { argb: 'FF1C1917' } };
    row.getCell(2).numFmt = CURRENCY_FORMAT;
    if (r.kind === 'balance') {
      row.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E2E2' } };
        c.border = { top: { style: 'thin', color: { argb: 'FF1C1917' } }, bottom: { style: 'thin', color: { argb: 'FF1C1917' } } };
      });
    }
  });

  renderSheetSignatures(ws, ctx, first + ctx.dlpa.rows.length + 4, 1, 1, 2, 2);
  const buffer = await wb.xlsx.writeBuffer();
  return {
    blob: new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    fileName: `${fileBase(ctx)}.xlsx`,
  };
}
