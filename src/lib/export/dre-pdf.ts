import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import {
  buildDREExportRows,
  cnpjLabel,
  DRE_CURRENCY,
  DRE_STANDARD,
  DRE_TITLE,
  dreFileBaseName,
  formatAccounting,
  formatIssueDate,
  formatPercent,
  periodLabel,
  type DREExportContext,
} from '@/lib/export/dre-rows';

/* Paleta sóbria em tons de cinza (RGB) — imprime bem em P&B. */
const INK: [number, number, number] = [28, 25, 23];
const MUTED: [number, number, number] = [110, 105, 100];
const RULE: [number, number, number] = [200, 196, 190];
const SUBTOTAL_FILL: [number, number, number] = [242, 242, 242];
const RESULT_FILL: [number, number, number] = [228, 228, 228];

const MARGIN_X = 18; // mm
const PAGE_BOTTOM = 280; // mm úteis em A4 retrato (297 - margem)

/**
 * Gera a DRE oficial em PDF vetorial (A4 retrato), no layout da ITG 1000/2022,
 * com bloco de encerramento e assinaturas. Retorna o Blob e o nome sugerido.
 */
export function generateDREPdf(ctx: DREExportContext): { blob: Blob; fileName: string } {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const center = pageWidth / 2;
  const issuedAt = ctx.issuedAt ?? new Date();

  doc.setProperties({
    title: `${DRE_TITLE} - ${ctx.client.name}`,
    subject: `${periodLabel(ctx.range)} - ${DRE_STANDARD}`,
    creator: 'ContaFlow',
  });

  /* ── Cabeçalho ─────────────────────────────────────────────────────── */
  let y = 20;
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(ctx.client.name.toUpperCase(), center, y, { align: 'center', maxWidth: pageWidth - MARGIN_X * 2 });
  y += 5.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text(cnpjLabel(ctx.client.cnpj), center, y, { align: 'center' });

  y += 10;
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(DRE_TITLE, center, y, { align: 'center' });
  y += 5.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(DRE_STANDARD, center, y, { align: 'center' });

  y += 8;
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text(periodLabel(ctx.range), MARGIN_X, y);
  doc.text(DRE_CURRENCY, pageWidth - MARGIN_X, y, { align: 'right' });
  y += 2.5;
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, y, pageWidth - MARGIN_X, y);

  /* ── Tabela ────────────────────────────────────────────────────────── */
  const rows = buildDREExportRows(ctx.statement);

  autoTable(doc, {
    startY: y + 2,
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: 20 },
    theme: 'plain',
    head: [['Descrição', '% s/ Receita Bruta', 'Valor (R$)']],
    body: rows.map((r) => [
      r.kind === 'account' ? `${r.code ?? ''}  ${r.label}` : r.label,
      formatPercent(r.percent),
      formatAccounting(r.value),
    ]),
    styles: {
      font: 'helvetica',
      fontSize: 9,
      textColor: INK,
      cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 },
      lineColor: RULE,
      overflow: 'linebreak',
    },
    headStyles: {
      fontStyle: 'bold',
      fontSize: 8,
      textColor: MUTED,
      lineWidth: { bottom: 0.3 },
      lineColor: RULE,
    },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 30, halign: 'right' },
      2: { cellWidth: 38, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'head') {
        if (data.column.index > 0) data.cell.styles.halign = 'right';
        return;
      }
      if (data.section !== 'body') return;
      const row = rows[data.row.index];
      if (!row) return;
      switch (row.kind) {
        case 'group':
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.cellPadding = { top: 2.6, bottom: 1.4, left: 2, right: 2 };
          break;
        case 'account':
          data.cell.styles.fontSize = 8.5;
          data.cell.styles.textColor = MUTED;
          if (data.column.index === 0) data.cell.styles.cellPadding = { top: 1.2, bottom: 1.2, left: 7, right: 2 };
          break;
        case 'subtotal':
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = SUBTOTAL_FILL;
          data.cell.styles.lineWidth = { top: 0.2, bottom: 0.2 };
          break;
        case 'result':
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fontSize = 10;
          data.cell.styles.fillColor = RESULT_FILL;
          data.cell.styles.lineColor = INK;
          data.cell.styles.lineWidth = { top: 0.4, bottom: 0.8 };
          data.cell.styles.cellPadding = { top: 3, bottom: 3, left: 2, right: 2 };
          break;
      }
    },
  });

  const finalY =
    (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 20;

  /* ── Encerramento e assinaturas (Anexo 9) ──────────────────────────── */
  const SIGNATURE_BLOCK = 52;
  let sy = finalY + 12;
  if (sy + SIGNATURE_BLOCK > PAGE_BOTTOM) {
    doc.addPage();
    sy = 30;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text(`Emitido em ${formatIssueDate(issuedAt)}.`, MARGIN_X, sy);

  const colWidth = (pageWidth - MARGIN_X * 2 - 16) / 2;
  const leftX = MARGIN_X;
  const rightX = MARGIN_X + colWidth + 16;
  const lineY = sy + 30;

  const legal = ctx.signatories?.legalRepresentative;
  const accountant = ctx.signatories?.accountant;
  const blank = '______________________';

  const signature = (x: number, role: string, name: string | undefined, idLabel: string, id: string | undefined) => {
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.3);
    doc.line(x, lineY, x + colWidth, lineY);
    const cx = x + colWidth / 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(name?.trim() || 'Nome:  ' + blank, cx, lineY + 5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(role, cx, lineY + 10, { align: 'center' });
    doc.text(`${idLabel}: ${id?.trim() || blank}`, cx, lineY + 15, { align: 'center' });
    doc.setTextColor(...INK);
  };

  signature(leftX, 'Representante Legal / Administrador', legal?.name, 'CPF', legal?.cpf);
  signature(rightX, 'Profissional da Contabilidade', accountant?.name, 'CRC', accountant?.crc);

  /* ── Rodapé com paginação ──────────────────────────────────────────── */
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(`${ctx.client.name} - ${DRE_TITLE}`, MARGIN_X, 290);
    doc.text(`Página ${i} de ${pages}`, pageWidth - MARGIN_X, 290, { align: 'right' });
  }

  return {
    blob: doc.output('blob'),
    fileName: `${dreFileBaseName(ctx.client.tradeName || ctx.client.name, ctx.range)}.pdf`,
  };
}
