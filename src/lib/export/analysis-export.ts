import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import type { ClientCompany } from '@/types/firestore';
import { accountingStandard } from '@/lib/accounting-standard';
import { formatIndicator, INDICATOR_GROUP_LABEL, type FinancialAnalysis, type IndicatorGroup } from '@/lib/financial-indicators';
import { HEADER_FILL, INK, MARGIN_X, MUTED, RULE, addPageFooters, renderSignatures, renderStatementHeader, sanitizeFileName, type LedgerPdfExportContext } from '@/lib/export/ledger-pdf';
import { renderSheetHeader, renderSignatures as renderSheetSignatures } from '@/lib/export/ledger-excel';
import { formatDateBR } from '@/lib/utils/formatters';

/** Análise das demonstrações (índices) em PDF (A4 retrato) e Excel, para entregar ao cliente. */

export const ANALYSIS_TITLE = 'ANÁLISE DAS DEMONSTRAÇÕES CONTÁBEIS';

export interface AnalysisExportContext {
  client: Pick<ClientCompany, 'name' | 'cnpj' | 'tradeName' | 'porte' | 'activity'>;
  analysis: FinancialAnalysis;
  issuedAt?: Date;
  signatories?: LedgerPdfExportContext['signatories'];
}

const GROUPS: readonly IndicatorGroup[] = ['liquidity', 'debt', 'profitability'];
const periodOf = (a: FinancialAnalysis) =>
  a.previousDate ? `Posição em ${formatDateBR(a.date)}, comparada a ${formatDateBR(a.previousDate)}` : `Posição em ${formatDateBR(a.date)}`;
const fileBase = (ctx: AnalysisExportContext) => `Analise_${sanitizeFileName(ctx.client.tradeName || ctx.client.name) || 'Cliente'}_${ctx.analysis.date}`;
const NOTE =
  'Faixas de leitura são referências usuais de análise, não normas. A rentabilidade usa a DRE do exercício até a data (antes do encerramento) e o patrimônio do fim do período.';

export function generateAnalysisPdf(ctx: AnalysisExportContext): { blob: Blob; fileName: string } {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const { analysis } = ctx;
  const issuedAt = ctx.issuedAt ?? new Date();
  doc.setProperties({ title: `Análise - ${ctx.client.name}`, subject: periodOf(analysis), creator: 'ContaFlow' });
  let y = renderStatementHeader(doc, { client: ctx.client, title: ANALYSIS_TITLE, standard: accountingStandard(ctx.client), period: periodOf(analysis) });

  const head = analysis.previousDate ? ['Índice', formatDateBR(analysis.date), formatDateBR(analysis.previousDate)] : ['Índice', formatDateBR(analysis.date)];
  for (const group of GROUPS) {
    const rows = analysis.indicators.filter((i) => i.group === group);
    autoTable(doc, {
      startY: y + 3,
      margin: { left: MARGIN_X, right: MARGIN_X, bottom: 18 },
      theme: 'plain',
      head: [[INDICATOR_GROUP_LABEL[group].toUpperCase(), ...head.slice(1)]],
      body: rows.map((r) => [
        `${r.label}\n${r.formula}`,
        formatIndicator(r.value, r.format),
        ...(analysis.previousDate ? [formatIndicator(r.previous, r.format)] : []),
      ]),
      styles: { font: 'helvetica', fontSize: 9, textColor: INK, cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 }, lineColor: RULE },
      headStyles: { fontStyle: 'bold', fontSize: 8, textColor: MUTED, fillColor: HEADER_FILL, lineWidth: { bottom: 0.35 }, lineColor: INK },
      columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 32, halign: 'right' }, 2: { cellWidth: 32, halign: 'right' } },
      didParseCell: (data) => {
        if (data.section === 'head' && data.column.index > 0) data.cell.styles.halign = 'right';
        if (data.section === 'body') data.cell.styles.lineWidth = { bottom: 0.1 };
      },
    });
    y = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 30;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  const notes = [...analysis.warnings, NOTE];
  const width = doc.internal.pageSize.getWidth() - 2 * MARGIN_X;
  for (const text of notes) {
    const lines = doc.splitTextToSize(text, width) as string[];
    if (y + 4 + lines.length * 3.4 > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      y = 20;
    }
    doc.text(lines, MARGIN_X, y + 4);
    y += 2 + lines.length * 3.4;
  }
  renderSignatures(doc, y + 4, issuedAt, ctx.signatories);
  addPageFooters(doc, 'Análise das demonstrações', ctx.client.name);
  return { blob: doc.output('blob'), fileName: `${fileBase(ctx)}.pdf` };
}

export async function generateAnalysisExcel(ctx: AnalysisExportContext): Promise<{ blob: Blob; fileName: string }> {
  const { analysis } = ctx;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ContaFlow';
  wb.created = ctx.issuedAt ?? new Date();
  const ws = wb.addWorksheet('Análise', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const cols = analysis.previousDate ? 4 : 3;
  ws.columns = [{ width: 40 }, { width: 18 }, ...(analysis.previousDate ? [{ width: 18 }] : []), { width: 70 }];
  let r = renderSheetHeader(ws, ctx, ANALYSIS_TITLE, periodOf(analysis), cols);

  const font = (extra: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: 'Aptos', size: 10, color: { argb: 'FF1C1917' }, ...extra });
  for (const group of GROUPS) {
    const head = ws.getRow(r);
    head.values = [INDICATOR_GROUP_LABEL[group], formatDateBR(analysis.date), ...(analysis.previousDate ? [formatDateBR(analysis.previousDate)] : []), 'Fórmula'];
    head.font = font({ bold: true, color: { argb: 'FF555555' } });
    head.eachCell((c, i) => {
      c.border = { bottom: { style: 'thin', color: { argb: 'FF1C1917' } } };
      if (i > 1 && i < cols) c.alignment = { horizontal: 'right' };
    });
    r++;
    for (const ind of analysis.indicators.filter((i) => i.group === group)) {
      const row = ws.getRow(r++);
      // Números de verdade (não texto) para o cliente poder refazer contas na planilha.
      const cell = (v: number | null) => (v === null || !Number.isFinite(v) ? '—' : ind.format === 'percent' ? v / 100 : v);
      row.values = [ind.label, cell(ind.value), ...(analysis.previousDate ? [cell(ind.previous)] : []), ind.formula];
      row.font = font();
      const numFmt = ind.format === 'percent' ? '0.0%' : ind.format === 'currency' ? '"R$" #,##0.00;[Red]-"R$" #,##0.00' : '0.00';
      for (let c = 2; c < cols; c++) {
        row.getCell(c).numFmt = numFmt;
        row.getCell(c).alignment = { horizontal: 'right' };
      }
      row.getCell(cols).font = font({ size: 9, color: { argb: 'FF555555' } });
    }
    r++;
  }
  for (const text of [...analysis.warnings, NOTE]) {
    ws.mergeCells(r, 1, r, cols);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.alignment = { wrapText: true, vertical: 'top' };
    c.font = font({ size: 9, color: { argb: 'FF555555' } });
    ws.getRow(r).height = 28;
    r++;
  }
  renderSheetSignatures(ws, ctx, r + 2, 1, 1, cols - 1, cols);
  const buffer = await wb.xlsx.writeBuffer();
  return { blob: new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName: `${fileBase(ctx)}.xlsx` };
}
