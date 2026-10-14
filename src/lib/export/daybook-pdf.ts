import { jsPDF } from 'jspdf';
import { autoTable, type RowInput } from 'jspdf-autotable';
import type { ClientCompany } from '@/types/firestore';
import { daybookTerms, type Daybook, type DaybookBookInfo } from '@/lib/daybook';
import { cnpjLabel, formatAccounting, periodLabel } from '@/lib/export/dre-rows';
import {
  GRAND_TOTAL_FILL,
  HEADER_FILL,
  INK,
  MARGIN_X,
  MUTED,
  RULE,
  addPageFooters,
  renderSignatures,
  sanitizeFileName,
  type LedgerPdfExportContext,
} from '@/lib/export/ledger-pdf';
import { formatDateBR } from '@/lib/utils/formatters';

export interface DaybookPdfContext {
  client: Pick<ClientCompany, 'name' | 'cnpj' | 'tradeName'>;
  daybook: Daybook;
  book: DaybookBookInfo;
  /** Por que o livro ainda é provisório (lançamentos a classificar, competência aberta), ou null. */
  provisional?: string | null;
  issuedAt?: Date;
  signatories?: LedgerPdfExportContext['signatories'];
}

type RowKind = 'entry' | 'line' | 'total' | 'empty';

/** Cabeçalho corrido das páginas de lançamentos. */
function runningHeader(doc: jsPDF, ctx: DaybookPdfContext) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text(ctx.client.name.toUpperCase(), MARGIN_X, 12, { maxWidth: pageWidth - MARGIN_X * 2 - 60 });
  doc.text(`LIVRO DIÁRIO Nº ${ctx.book.number.trim() || '1'}`, pageWidth - MARGIN_X, 12, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(cnpjLabel(ctx.client.cnpj), MARGIN_X, 16.5);
  doc.text(periodLabel(ctx.daybook.range), pageWidth - MARGIN_X, 16.5, { align: 'right' });
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.35);
  doc.line(MARGIN_X, 19, pageWidth - MARGIN_X, 19);
}

/** Termo de abertura ou de encerramento, numa página própria, com data e assinaturas. */
function renderTerm(doc: jsPDF, page: number, title: string, text: string, ctx: DaybookPdfContext, issuedAt: Date) {
  doc.setPage(page);
  const pageWidth = doc.internal.pageSize.getWidth();
  const center = pageWidth / 2;
  const width = pageWidth - MARGIN_X * 2 - 16;

  let y = 40;
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(ctx.client.name.toUpperCase(), center, y, { align: 'center', maxWidth: pageWidth - MARGIN_X * 2 });
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(cnpjLabel(ctx.client.cnpj), center, y, { align: 'center' });

  y += 22;
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(`LIVRO DIÁRIO Nº ${ctx.book.number.trim() || '1'}`, center, y, { align: 'center' });
  y += 9;
  doc.setFontSize(12);
  doc.text(title, center, y, { align: 'center' });

  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  const lines = doc.splitTextToSize(text, width) as string[];
  doc.text(lines, MARGIN_X + 8, y, { lineHeightFactor: 1.6 });
  y += lines.length * 10.5 * 0.3528 * 1.6;

  if (ctx.provisional) {
    y += 8;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    const note = doc.splitTextToSize(`Emissão provisória: ${ctx.provisional}.`, width) as string[];
    doc.text(note, MARGIN_X + 8, y);
    y += note.length * 4.5;
  }

  renderSignatures(doc, y + 14, issuedAt, ctx.signatories);
}

/**
 * Livro Diário em PDF (A4 retrato): termo de abertura, lançamentos do período em ordem
 * cronológica com as partidas a débito e a crédito, e termo de encerramento. Os termos
 * citam o total de páginas, por isso são escritos depois de os lançamentos estarem paginados.
 */
export function generateDaybookPdf(ctx: DaybookPdfContext): { blob: Blob; fileName: string; pages: number } {
  const { daybook } = ctx;
  const issuedAt = ctx.issuedAt ?? new Date();
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  doc.setProperties({
    title: `Livro Diário - ${ctx.client.name}`,
    subject: periodLabel(daybook.range),
    creator: 'ContaFlow',
  });

  // Página 1 fica reservada ao termo de abertura; os lançamentos começam na 2.
  doc.addPage();

  const kinds: RowKind[] = [];
  const body: RowInput[] = [];
  for (const e of daybook.entries) {
    kinds.push('entry');
    body.push([String(e.number), formatDateBR(e.date), { content: e.document ? `${e.memo}  [${e.document}]` : e.memo, colSpan: 4 }]);
    for (const l of e.lines) {
      kinds.push('line');
      body.push(['', '', [l.code, l.name].filter(Boolean).join('  '), l.memo ?? '', l.debit ? formatAccounting(l.debit) : '', l.credit ? formatAccounting(l.credit) : '']);
    }
  }
  if (daybook.entries.length) {
    kinds.push('total');
    body.push([{ content: `TOTAIS DO PERÍODO (${daybook.entries.length} lançamentos)`, colSpan: 4 }, formatAccounting(daybook.totals.debits), formatAccounting(daybook.totals.credits)]);
  } else {
    kinds.push('empty');
    body.push([{ content: 'Sem lançamentos no período.', colSpan: 6 }]);
  }

  autoTable(doc, {
    startY: 22,
    margin: { left: MARGIN_X, right: MARGIN_X, top: 22, bottom: 18 },
    theme: 'plain',
    head: [['Nº', 'Data', 'Conta', 'Histórico', 'Débito', 'Crédito']],
    body,
    styles: {
      font: 'helvetica',
      fontSize: 7.2,
      textColor: INK,
      cellPadding: { top: 0.9, bottom: 0.9, left: 1.5, right: 1.5 },
      lineColor: RULE,
      overflow: 'linebreak',
    },
    headStyles: {
      fontStyle: 'bold',
      fontSize: 7.5,
      textColor: MUTED,
      fillColor: HEADER_FILL,
      lineWidth: { bottom: 0.35 },
      lineColor: INK,
    },
    columnStyles: {
      0: { cellWidth: 12, halign: 'right' },
      1: { cellWidth: 18 },
      2: { cellWidth: 58 },
      3: { cellWidth: 'auto' },
      4: { cellWidth: 25, halign: 'right' },
      5: { cellWidth: 25, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'head') {
        if (data.column.index >= 4 || data.column.index === 0) data.cell.styles.halign = 'right';
        return;
      }
      if (data.section !== 'body') return;
      const kind = kinds[data.row.index];
      if (kind === 'entry') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.lineWidth = { top: 0.2 };
        data.cell.styles.cellPadding = { top: 1.6, bottom: 0.6, left: 1.5, right: 1.5 };
      } else if (kind === 'line') {
        data.cell.styles.textColor = data.column.index >= 4 ? INK : MUTED;
      } else if (kind === 'total') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fontSize = 8;
        data.cell.styles.fillColor = GRAND_TOTAL_FILL;
        data.cell.styles.lineWidth = { top: 0.35, bottom: 0.7 };
        data.cell.styles.lineColor = INK;
        data.cell.styles.cellPadding = { top: 1.8, bottom: 1.8, left: 1.5, right: 1.5 };
        if (data.column.index >= 4) data.cell.styles.halign = 'right';
      } else {
        data.cell.styles.halign = 'center';
        data.cell.styles.textColor = MUTED;
        data.cell.styles.cellPadding = { top: 8, bottom: 8, left: 1.5, right: 1.5 };
      }
    },
    didDrawPage: () => runningHeader(doc, ctx),
  });

  // Última página: termo de encerramento.
  doc.addPage();
  const pages = doc.getNumberOfPages();
  const terms = daybookTerms({
    clientName: ctx.client.name.toUpperCase(),
    cnpj: ctx.client.cnpj,
    book: ctx.book,
    range: daybook.range,
    pages,
    entryCount: daybook.entries.length,
    total: daybook.totals.debits,
  });
  renderTerm(doc, 1, 'TERMO DE ABERTURA', terms.opening, ctx, issuedAt);
  renderTerm(doc, pages, 'TERMO DE ENCERRAMENTO', terms.closing, ctx, issuedAt);
  addPageFooters(doc, `LIVRO DIÁRIO Nº ${ctx.book.number.trim() || '1'}`, ctx.client.name);

  const slug = sanitizeFileName(ctx.client.tradeName || ctx.client.name);
  return {
    blob: doc.output('blob'),
    fileName: `Livro_Diario_${slug || 'Cliente'}_${daybook.range.start}_a_${daybook.range.end}.pdf`,
    pages: doc.getNumberOfPages(),
  };
}
