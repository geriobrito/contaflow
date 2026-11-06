import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import {
  buildDREExportRows,
  DRE_TITLE,
  dreFileBaseName,
  formatAccounting,
  formatPercent,
  periodLabel,
  type DREExportContext,
} from '@/lib/export/dre-rows';
import { INK, MARGIN_X, MUTED, RULE, addPageFooters, renderConformity, renderSignatures, renderStatementHeader } from '@/lib/export/ledger-pdf';
import { accountingStandard } from '@/lib/accounting-standard';

/* Preenchimentos em tons de cinza (RGB) — imprime bem em P&B. */
const SUBTOTAL_FILL: [number, number, number] = [242, 242, 242];
const RESULT_FILL: [number, number, number] = [228, 228, 228];

/** Cabeçalho da coluna: o ano, para o exercício inteiro; o intervalo, nos demais períodos. */
function columnLabel(range: { start: string; end: string }): string {
  const y = range.start.slice(0, 4);
  if (range.start === `${y}-01-01` && range.end === `${y}-12-31`) return y;
  const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`;
  return `${br(range.start)} a ${br(range.end)}`;
}

/**
 * Gera a DRE oficial em PDF vetorial (A4 retrato), no layout da NBC TG 1002,
 * com bloco de encerramento e assinaturas. Retorna o Blob e o nome sugerido.
 */
export function generateDREPdf(ctx: DREExportContext): { blob: Blob; fileName: string } {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const issuedAt = ctx.issuedAt ?? new Date();
  const standard = accountingStandard(ctx.client);

  doc.setProperties({
    title: `${DRE_TITLE} - ${ctx.client.name}`,
    subject: `${periodLabel(ctx.range)} - ${standard}`,
    creator: 'ContaFlow',
  });

  /* ── Cabeçalho (o mesmo do Balanço, Balancete e DLPA) ──────────────── */
  const y = renderStatementHeader(doc, { client: ctx.client, title: DRE_TITLE, standard, period: periodLabel(ctx.range) });

  /* ── Tabela ────────────────────────────────────────────────────────── */
  const previous = ctx.previous ?? null;
  const rows = buildDREExportRows(ctx.statement, previous?.statement);

  autoTable(doc, {
    startY: y + 2,
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: 18 },
    theme: 'plain',
    head: [
      previous
        ? ['Descrição', '% s/ Receita Bruta', `${columnLabel(ctx.range)} (R$)`, `${columnLabel(previous.range)} (R$)`]
        : ['Descrição', '% s/ Receita Bruta', 'Valor (R$)'],
    ],
    body: rows.map((r) => [
      r.kind === 'account' ? `${r.code ?? ''}  ${r.label}` : r.label,
      formatPercent(r.percent),
      formatAccounting(r.value),
      ...(previous ? [formatAccounting(r.previous ?? 0)] : []),
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
      1: { cellWidth: previous ? 24 : 30, halign: 'right' },
      2: { cellWidth: previous ? 33 : 38, halign: 'right' },
      ...(previous ? { 3: { cellWidth: 33, halign: 'right' as const, textColor: MUTED } } : {}),
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

  /* ── Encerramento, assinaturas (Anexo 9) e paginação ───────────────── */
  renderSignatures(doc, renderConformity(doc, finalY, ctx.client), issuedAt, ctx.signatories);
  addPageFooters(doc, DRE_TITLE, ctx.client.name);

  return {
    blob: doc.output('blob'),
    fileName: `${dreFileBaseName(ctx.client.tradeName || ctx.client.name, ctx.range)}.pdf`,
  };
}
