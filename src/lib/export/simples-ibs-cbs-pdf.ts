import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { ClientCompany } from '@/types/firestore';
import type { SimplesFigures, SimplesSimulation } from '@/lib/simples-ibs-cbs';
import { fromCents } from '@/lib/money';
import { GRAND_TOTAL_FILL, HEADER_FILL, INK, MARGIN_X, MUTED, RULE, addPageFooters, renderSignatures, renderStatementHeader, sanitizeFileName, type LedgerPdfExportContext } from '@/lib/export/ledger-pdf';
import { formatCurrency } from '@/lib/utils/formatters';

/** Relatório de assessoria: IBS/CBS dentro do DAS ou por fora, para a empresa do Simples. */

export const SIMPLES_IBS_CBS_TITLE = 'IBS E CBS NO SIMPLES NACIONAL: DENTRO DO DAS OU POR FORA';

export interface SimplesIbsCbsReportContext {
  client: Pick<ClientCompany, 'name' | 'cnpj' | 'tradeName'>;
  /** Ex.: "Período: 01/01/2027 a 31/12/2027". */
  periodLabel: string;
  figures: SimplesFigures;
  simulation: SimplesSimulation;
  simplesRate: number;
  fullRate: number;
  /** De onde veio cada alíquota (ex.: "observada em 12 nota(s) de venda", "informada pelo contador"). */
  simplesRateSource: string;
  fullRateSource: string;
  /** Conclusão em texto, a mesma da tela. */
  conclusion: string;
  notes: readonly string[];
  issuedAt?: Date;
  signatories?: LedgerPdfExportContext['signatories'];
}

const money = (cents: number) => formatCurrency(fromCents(cents));
const rate = (r: number) => `${r.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`;

export function simplesIbsCbsRows(ctx: SimplesIbsCbsReportContext): { label: string; inside: string; outside: string; bold?: boolean }[] {
  const { simulation: s } = ctx;
  return [
    { label: 'Alíquota de IBS + CBS', inside: rate(ctx.simplesRate), outside: rate(ctx.fullRate) },
    { label: 'Débito sobre as vendas', inside: money(s.inside.taxCents), outside: money(s.outside.debitCents) },
    { label: '(−) Crédito das compras', inside: '—', outside: money(s.outside.purchaseCreditCents) },
    { label: 'IBS + CBS pagos pela empresa', inside: money(s.inside.taxCents), outside: money(s.outside.taxCents), bold: true },
    { label: 'Crédito dos clientes empresa', inside: money(s.inside.buyersCreditCents), outside: money(s.outside.buyersCreditCents), bold: true },
  ];
}

export function generateSimplesIbsCbsPdf(ctx: SimplesIbsCbsReportContext): { blob: Blob; fileName: string } {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  doc.setProperties({ title: `IBS/CBS no Simples - ${ctx.client.name}`, subject: ctx.periodLabel, creator: 'ContaFlow' });
  let y = renderStatementHeader(doc, { client: ctx.client, title: SIMPLES_IBS_CBS_TITLE, standard: 'Simulação de assessoria (LC 214/2025; NT 2026.005)', period: ctx.periodLabel });
  const { sales, purchases } = ctx.figures;
  const plain = { font: 'helvetica' as const, fontSize: 8.5, textColor: INK, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 }, lineColor: RULE };
  const head = { fontStyle: 'bold' as const, fontSize: 8, textColor: INK, fillColor: HEADER_FILL, lineWidth: { bottom: 0.35 }, lineColor: INK };
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  autoTable(doc, {
    startY: y + 3,
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: 18 },
    theme: 'plain',
    head: [['NÚMEROS DO PERÍODO (NOTAS FISCAIS)', 'R$']],
    body: [
      [`Vendas (${sales.count} nota(s))`, money(sales.totalCents)],
      [`   a empresas, que aproveitam crédito (${sales.businessCount} nota(s))`, money(sales.businessCents)],
      ['   a pessoa física ou consumidor não identificado', money(sales.consumerCents)],
      [`IBS + CBS destacados nas compras (${purchases.count} nota(s))`, money(purchases.taxCents)],
      ['   sem direito a crédito pela classificação tributária', money(purchases.blockedCents)],
      ['   crédito aproveitável no regime regular', money(purchases.creditCents)],
    ],
    styles: plain,
    headStyles: head,
    columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 40, halign: 'right' } },
    didParseCell: (d) => {
      if (d.section === 'head' && d.column.index === 1) d.cell.styles.halign = 'right';
    },
  });
  y = lastY();

  const rows = simplesIbsCbsRows(ctx);
  autoTable(doc, {
    startY: y + 6,
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: 18 },
    theme: 'plain',
    head: [['COMPARAÇÃO', 'Dentro do DAS', 'Por fora (regime regular)']],
    body: rows.map((r) => [r.label, r.inside, r.outside]),
    styles: plain,
    headStyles: head,
    columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 40, halign: 'right' }, 2: { cellWidth: 46, halign: 'right' } },
    didParseCell: (d) => {
      if (d.section === 'head') {
        if (d.column.index > 0) d.cell.styles.halign = 'right';
        return;
      }
      if (rows[d.row.index]?.bold) {
        d.cell.styles.fontStyle = 'bold';
        d.cell.styles.fillColor = GRAND_TOTAL_FILL;
      }
    },
  });
  y = lastY();

  const width = doc.internal.pageSize.getWidth() - 2 * MARGIN_X;
  const paragraph = (text: string, size: number, color: [number, number, number], gap = 4) => {
    doc.setFont('helvetica', size > 8.5 ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, width) as string[];
    if (y + gap + lines.length * 4 > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      y = 20;
    }
    doc.text(lines, MARGIN_X, y + gap);
    y += gap + lines.length * (size * 0.42);
  };
  paragraph(`Alíquota do Simples: ${ctx.simplesRateSource}. Alíquota cheia: ${ctx.fullRateSource}.`, 8, MUTED, 6);
  paragraph(ctx.conclusion, 9.5, INK, 6);
  for (const note of ctx.notes) paragraph(`• ${note}`, 7.8, MUTED, 2.5);

  renderSignatures(doc, y + 2, ctx.issuedAt ?? new Date(), ctx.signatories);
  addPageFooters(doc, 'IBS/CBS no Simples', ctx.client.name);
  const base = sanitizeFileName(ctx.client.tradeName || ctx.client.name) || 'Cliente';
  return { blob: doc.output('blob'), fileName: `IBS_CBS_Simples_${base}.pdf` };
}
