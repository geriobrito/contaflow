import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import type { ClientCompany, OpeningMode } from '@/types/firestore';
import type { OpeningSection, OpeningSheet } from '@/lib/opening-view';
import { accountingStandard } from '@/lib/accounting-standard';
import { round2 } from '@/lib/money';
import { GRAND_TOTAL_FILL, HEADER_FILL, INK, MARGIN_X, MUTED, RULE, addPageFooters, renderSignatures as renderPdfSignatures, renderStatementHeader, sanitizeFileName, type LedgerPdfExportContext } from '@/lib/export/ledger-pdf';
import { renderSheetHeader, renderSignatures as renderSheetSignatures } from '@/lib/export/ledger-excel';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

/**
 * Relatório do balanço de abertura: Ativo e Passivo + PL na hierarquia do plano (seção › grupo ›
 * conta), com os bancos no lugar da conta vinculada e a contrapartida automática na 2.3.3.04;
 * depois, a composição dos saldos informada conta a conta, e as assinaturas. É o documento que
 * acompanha a implantação (e o primeiro registro do Livro Diário).
 */

export type OpeningReportKind = 'section' | 'group' | 'account' | 'total';

export interface OpeningReportRow {
  kind: OpeningReportKind;
  code?: string;
  label: string;
  /** Contribuição à coluna (retificadora negativa). */
  value: number;
}

export interface OpeningCompositionItem {
  code: string;
  name: string;
  amount: number;
  detail: string;
}

export const OPENING_REPORT_TITLE: Record<OpeningMode, string> = {
  OPENING_BALANCE: 'BALANÇO DE ABERTURA',
  CONTINUITY: 'BALANÇO DE ABERTURA (SALDOS DE IMPLANTAÇÃO)',
};

/** Linhas de uma coluna: só o que tem saldo (seções, grupos e contas zerados ficam de fora). */
function columnRows(sections: readonly OpeningSection[], total: number, totalLabel: string): OpeningReportRow[] {
  const out: OpeningReportRow[] = [];
  for (const s of sections) {
    if (Math.abs(s.subtotal) < 0.005) continue;
    out.push({ kind: 'section', code: s.account?.code, label: s.title, value: s.subtotal });
    for (const g of s.groups) {
      if (g.title) {
        if (Math.abs(g.subtotal) < 0.005) continue;
        out.push({ kind: 'group', code: g.account?.code, label: g.title, value: g.subtotal });
      }
      for (const r of g.rows) {
        if (Math.abs(r.value) < 0.005) continue;
        if (r.type === 'bank') out.push({ kind: 'account', code: r.ledger?.code, label: r.bank.nickname, value: r.value });
        else if (r.type === 'plug') out.push({ kind: 'account', code: r.account?.code, label: r.account?.name ?? 'Balanço de Abertura', value: r.value });
        else out.push({ kind: 'account', code: r.account.code, label: r.account.name, value: r.value });
      }
    }
  }
  out.push({ kind: 'total', label: totalLabel, value: total });
  return out;
}

/** As duas colunas do relatório, a partir da planilha completa (`buildOpeningSheet` sem filtro). */
export function openingReportRows(sheet: OpeningSheet): { assets: OpeningReportRow[]; claims: OpeningReportRow[] } {
  return {
    assets: columnRows(sheet.assets, sheet.totals.assets, 'TOTAL DO ATIVO'),
    claims: columnRows(sheet.claims, round2(sheet.totals.liabilities + sheet.totals.equity), 'TOTAL DO PASSIVO E DO PATRIMÔNIO LÍQUIDO'),
  };
}

export interface OpeningReportContext {
  client: Pick<ClientCompany, 'name' | 'cnpj' | 'tradeName' | 'porte' | 'activity'>;
  date: string;
  mode: OpeningMode;
  rows: { assets: readonly OpeningReportRow[]; claims: readonly OpeningReportRow[] };
  composition: readonly OpeningCompositionItem[];
  issuedAt?: Date;
  signatories?: LedgerPdfExportContext['signatories'];
}

const periodOf = (ctx: OpeningReportContext) => `Posição no início do dia ${formatDateBR(ctx.date)}`;
const fileBase = (ctx: OpeningReportContext) => `Balanco_de_Abertura_${sanitizeFileName(ctx.client.tradeName || ctx.client.name) || 'Cliente'}_${ctx.date}`;
const money = (v: number) => (v < 0 ? `(${formatCurrency(-v)})` : formatCurrency(v));
const indent = (r: OpeningReportRow) => (r.kind === 'group' ? '   ' : r.kind === 'account' ? '      ' : '');

function pdfColumn(doc: jsPDF, title: string, rows: readonly OpeningReportRow[], startY: number): number {
  autoTable(doc, {
    startY,
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: 18 },
    theme: 'plain',
    head: [[title, 'Código', 'R$']],
    body: rows.map((r) => [`${indent(r)}${r.label}`, r.code ?? '', money(r.value)]),
    styles: { font: 'helvetica', fontSize: 8.5, textColor: INK, cellPadding: { top: 1.4, bottom: 1.4, left: 2, right: 2 }, lineColor: RULE },
    headStyles: { fontStyle: 'bold', fontSize: 8, textColor: INK, fillColor: HEADER_FILL, lineWidth: { bottom: 0.35 }, lineColor: INK },
    columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 26, textColor: MUTED }, 2: { cellWidth: 38, halign: 'right' } },
    didParseCell: (data) => {
      if (data.section === 'head') {
        if (data.column.index === 2) data.cell.styles.halign = 'right';
        return;
      }
      const row = rows[data.row.index];
      if (!row || row.kind === 'account') return;
      data.cell.styles.fontStyle = 'bold';
      if (row.kind === 'group') data.cell.styles.fontStyle = 'normal';
      if (row.kind === 'total') {
        data.cell.styles.fillColor = GRAND_TOTAL_FILL;
        data.cell.styles.lineWidth = { top: 0.3, bottom: 0.3 };
        data.cell.styles.lineColor = INK;
      }
    },
  });
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

export function generateOpeningPdf(ctx: OpeningReportContext): { blob: Blob; fileName: string } {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const title = OPENING_REPORT_TITLE[ctx.mode];
  doc.setProperties({ title: `${title} - ${ctx.client.name}`, subject: periodOf(ctx), creator: 'ContaFlow' });
  let y = renderStatementHeader(doc, { client: ctx.client, title, standard: accountingStandard(ctx.client), period: periodOf(ctx) });
  y = pdfColumn(doc, 'ATIVO', ctx.rows.assets, y + 2);
  y = pdfColumn(doc, 'PASSIVO E PATRIMÔNIO LÍQUIDO', ctx.rows.claims, y + 6);

  if (ctx.composition.length) {
    autoTable(doc, {
      startY: y + 8,
      margin: { left: MARGIN_X, right: MARGIN_X, bottom: 18 },
      theme: 'plain',
      head: [['COMPOSIÇÃO DOS SALDOS', 'R$']],
      body: ctx.composition.map((c) => [`${c.code} ${c.name}\n${c.detail}`, formatCurrency(c.amount)]),
      styles: { font: 'helvetica', fontSize: 8.5, textColor: INK, cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 }, lineColor: RULE, lineWidth: { bottom: 0.15 } },
      headStyles: { fontStyle: 'bold', fontSize: 8, fillColor: HEADER_FILL, lineWidth: { bottom: 0.35 }, lineColor: INK },
      columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 38, halign: 'right', valign: 'top' } },
      didParseCell: (data) => {
        if (data.section === 'head' && data.column.index === 1) data.cell.styles.halign = 'right';
      },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  }

  renderPdfSignatures(doc, y + 4, ctx.issuedAt ?? new Date(), ctx.signatories);
  addPageFooters(doc, 'Balanço de abertura', ctx.client.name);
  return { blob: doc.output('blob'), fileName: `${fileBase(ctx)}.pdf` };
}

const CURRENCY_FORMAT = '"R$" #,##0.00;[Red]-"R$" #,##0.00;"R$" 0.00';

export async function generateOpeningExcel(ctx: OpeningReportContext): Promise<{ blob: Blob; fileName: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ContaFlow';
  wb.created = ctx.issuedAt ?? new Date();
  const ws = wb.addWorksheet('Balanço de abertura', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [{ width: 56 }, { width: 16 }, { width: 20 }];
  let r = renderSheetHeader(ws, ctx, OPENING_REPORT_TITLE[ctx.mode], periodOf(ctx), 3);
  const font = (extra: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: 'Aptos', size: 10, color: { argb: 'FF1C1917' }, ...extra });
  const line = { style: 'thin' as const, color: { argb: 'FF1C1917' } };

  const column = (title: string, rows: readonly OpeningReportRow[]) => {
    const head = ws.getRow(r++);
    head.values = [title, 'Código', 'R$'];
    head.font = font({ bold: true });
    head.eachCell((c, i) => {
      c.border = { bottom: line };
      if (i === 3) c.alignment = { horizontal: 'right' };
    });
    for (const row of rows) {
      const x = ws.getRow(r++);
      x.values = [`${indent(row)}${row.label}`, row.code ?? '', row.value];
      x.font = font({ bold: row.kind === 'section' || row.kind === 'total' });
      x.getCell(2).font = font({ color: { argb: 'FF555555' } });
      x.getCell(3).numFmt = CURRENCY_FORMAT;
      if (row.kind === 'total') {
        x.eachCell((c) => {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E2E2' } };
          c.border = { top: line, bottom: line };
        });
      }
    }
    r++;
  };
  column('ATIVO', ctx.rows.assets);
  column('PASSIVO E PATRIMÔNIO LÍQUIDO', ctx.rows.claims);

  if (ctx.composition.length) {
    const head = ws.getRow(r++);
    head.values = ['COMPOSIÇÃO DOS SALDOS', 'Código', 'R$'];
    head.font = font({ bold: true });
    head.eachCell((c) => (c.border = { bottom: line }));
    for (const c of ctx.composition) {
      const x = ws.getRow(r++);
      x.values = [`${c.name}\n${c.detail}`, c.code, c.amount];
      x.getCell(1).alignment = { wrapText: true, vertical: 'top' };
      x.getCell(2).alignment = { vertical: 'top' };
      x.getCell(3).alignment = { vertical: 'top' };
      x.getCell(3).numFmt = CURRENCY_FORMAT;
      x.font = font();
      x.height = Math.min(400, 15 * (1 + Math.ceil(c.detail.length / 70) + (c.detail.match(/\n/g)?.length ?? 0)));
    }
    r++;
  }

  renderSheetSignatures(ws, ctx, r + 2, 1, 1, 2, 3);
  const buffer = await wb.xlsx.writeBuffer();
  return {
    blob: new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    fileName: `${fileBase(ctx)}.xlsx`,
  };
}
