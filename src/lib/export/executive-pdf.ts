import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { ClientCompany } from '@/types/firestore';
import type { BridgeStep, ExecutiveMonthlyBreakdown, ExecutiveSummary } from '@/lib/executive-metrics';
import { GRAND_TOTAL_FILL, HEADER_FILL, INK, MARGIN_X, MUTED, RULE, addPageFooters, renderStatementHeader, sanitizeFileName } from '@/lib/export/ledger-pdf';
import { round2 } from '@/lib/money';
import { formatCurrency } from '@/lib/utils/formatters';

/**
 * Relatório Executivo em PDF (A4 retrato): os indicadores dos 12 meses, a leitura do período, os
 * dois gráficos principais desenhados no próprio PDF (vetoriais: saem iguais em qualquer máquina
 * e impressora) e as tabelas mês a mês, de maiores gastos e de composição. É o mesmo conteúdo da
 * Visão Executiva do Painel, sem depender do "Imprimir" do navegador.
 */

export const EXECUTIVE_TITLE = 'RELATÓRIO EXECUTIVO';

export interface ExecutivePdfContext {
  client: Pick<ClientCompany, 'name' | 'tradeName' | 'cnpj'>;
  summary: ExecutiveSummary;
  /** Frases da leitura do período (src/lib/executive-insights.ts). */
  insights: readonly string[];
}

type RGB = [number, number, number];
/** As cores das séries no tema claro (as mesmas da tela: `--viz-*` em globals.css). */
const COLOR = {
  revenue: [42, 120, 214] as RGB,
  outflows: [235, 104, 52] as RGB,
  result: [27, 175, 122] as RGB,
  negative: [208, 59, 59] as RGB,
  grid: [232, 229, 224] as RGB,
};

const pct = (value: number, digits = 1) => `${value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;

/** Valor curto para eixos e rótulos: "R$ 12,5 mil", "R$ 1,2 mi". */
export function compactMoney(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}R$ ${(abs / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${sign}R$ ${(abs / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `${sign}R$ ${abs.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
}

/**
 * Escala do eixo de valores: passo "redondo" (1, 2, 2,5 ou 5 × potência de 10) com cerca de
 * quatro divisões, do piso ao teto que contêm os dados. Sempre inclui o zero.
 */
export function niceScale(min: number, max: number): { bottom: number; top: number; step: number; ticks: number[] } {
  const low = Math.min(0, min);
  const high = Math.max(0, max);
  const span = high - low || 1;
  const rough = span / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  const bottom = Math.floor(low / step) * step;
  const top = Math.ceil(high / step) * step || step;
  const ticks: number[] = [];
  for (let v = bottom; v <= top + step / 1000; v += step) ticks.push(round2(v));
  return { bottom, top, step, ticks };
}

interface Plot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Eixo de valores e linhas de grade; devolve a função que leva um valor à coordenada Y. */
function drawValueAxis(doc: jsPDF, plot: Plot, scale: ReturnType<typeof niceScale>): (value: number) => number {
  const yOf = (value: number) => plot.y + plot.h - ((value - scale.bottom) / (scale.top - scale.bottom)) * plot.h;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  for (const tick of scale.ticks) {
    const y = yOf(tick);
    doc.setDrawColor(...(tick === 0 ? MUTED : COLOR.grid));
    doc.setLineWidth(tick === 0 ? 0.25 : 0.15);
    doc.line(plot.x, y, plot.x + plot.w, y);
    doc.text(compactMoney(tick), plot.x - 1.5, y + 0.9, { align: 'right' });
  }
  return yOf;
}

function legend(doc: jsPDF, x: number, y: number, items: readonly { label: string; color: RGB; line?: boolean }[]) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  let at = x;
  for (const item of items) {
    doc.setFillColor(...item.color);
    if (item.line) doc.rect(at, y - 1.1, 3.2, 0.5, 'F');
    else doc.roundedRect(at, y - 2, 2.2, 2.2, 0.4, 0.4, 'F');
    doc.setTextColor(...MUTED);
    doc.text(item.label, at + (item.line ? 4.2 : 3.2), y);
    at += doc.getTextWidth(item.label) + (item.line ? 9 : 8);
  }
}

function sectionTitle(doc: jsPDF, y: number, title: string, subtitle?: string): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text(title, MARGIN_X, y);
  if (!subtitle) return y + 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(subtitle, MARGIN_X, y + 3.6);
  return y + 7.5;
}

/** Barras de receita e de gastos de cada mês, com a linha do resultado líquido. */
function drawMonthlyChart(doc: jsPDF, top: number, height: number, monthly: readonly ExecutiveMonthlyBreakdown[]) {
  const pageWidth = doc.internal.pageSize.getWidth();
  legend(doc, MARGIN_X, top, [
    { label: 'Receita bruta', color: COLOR.revenue },
    { label: 'Custos, despesas e tributos', color: COLOR.outflows },
    { label: 'Resultado líquido', color: COLOR.result, line: true },
  ]);
  const plot: Plot = { x: MARGIN_X + 17, y: top + 4, w: pageWidth - MARGIN_X * 2 - 17, h: height - 12 };
  const values = monthly.flatMap((m) => [m.grossRevenue, m.outflows, m.netResult]);
  const yOf = drawValueAxis(doc, plot, niceScale(Math.min(...values, 0), Math.max(...values, 0)));
  const slot = plot.w / Math.max(1, monthly.length);
  const bar = Math.min(5, slot * 0.3);
  const zero = yOf(0);
  monthly.forEach((m, i) => {
    const cx = plot.x + slot * i + slot / 2;
    const draw = (value: number, x: number, color: RGB) => {
      if (Math.abs(value) < 0.005) return;
      const y = yOf(value);
      doc.setFillColor(...color);
      doc.rect(x, Math.min(y, zero), bar, Math.max(0.3, Math.abs(zero - y)), 'F');
    };
    draw(m.grossRevenue, cx - bar - 0.3, COLOR.revenue);
    draw(m.outflows, cx + 0.3, COLOR.outflows);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text(m.label, cx, plot.y + plot.h + 3.4, { align: 'center' });
  });
  doc.setDrawColor(...COLOR.result);
  doc.setLineWidth(0.5);
  monthly.forEach((m, i) => {
    if (i === 0) return;
    const prev = monthly[i - 1];
    doc.line(plot.x + slot * (i - 1) + slot / 2, yOf(prev.netResult), plot.x + slot * i + slot / 2, yOf(m.netResult));
  });
  monthly.forEach((m, i) => {
    doc.setFillColor(...(m.netResult >= 0 ? COLOR.result : COLOR.negative));
    doc.circle(plot.x + slot * i + slot / 2, yOf(m.netResult), 0.75, 'F');
  });
}

const bridgeColor = (s: BridgeStep): RGB => (s.key === 'gross' ? COLOR.revenue : s.key === 'net' ? (s.value >= 0 ? COLOR.result : COLOR.negative) : s.value >= 0 ? COLOR.result : COLOR.outflows);

/** Cascata da receita bruta ao resultado líquido, com a linha de ligação entre os degraus. */
function drawBridgeChart(doc: jsPDF, top: number, height: number, steps: readonly BridgeStep[]) {
  const pageWidth = doc.internal.pageSize.getWidth();
  legend(doc, MARGIN_X, top, [
    { label: 'Receita', color: COLOR.revenue },
    { label: 'O que sai', color: COLOR.outflows },
    { label: 'Resultado (ou o que entra)', color: COLOR.result },
  ]);
  const plot: Plot = { x: MARGIN_X + 17, y: top + 7, w: pageWidth - MARGIN_X * 2 - 17, h: height - 19 };
  const levels = steps.flatMap((s) => [s.start, s.end]);
  const yOf = drawValueAxis(doc, plot, niceScale(Math.min(...levels, 0), Math.max(...levels, 0)));
  const slot = plot.w / Math.max(1, steps.length);
  const bar = Math.min(16, slot * 0.5);
  steps.forEach((s, i) => {
    const cx = plot.x + slot * i + slot / 2;
    const yStart = yOf(s.start);
    const yEnd = yOf(s.end);
    const y = Math.min(yStart, yEnd);
    doc.setFillColor(...bridgeColor(s));
    doc.rect(cx - bar / 2, y, bar, Math.max(0.35, Math.abs(yStart - yEnd)), 'F');
    // Ligação: do fim deste degrau até o começo do próximo.
    if (i < steps.length - 1) {
      doc.setDrawColor(...MUTED);
      doc.setLineWidth(0.15);
      doc.line(cx + bar / 2, yEnd, cx + slot - bar / 2, yEnd);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(...INK);
    doc.text(`${s.kind === 'delta' && s.value > 0 ? '+' : ''}${compactMoney(s.value).replace('R$ ', '')}`, cx, y - 1.2, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(...MUTED);
    doc.text(doc.splitTextToSize(s.label, slot - 2) as string[], cx, plot.y + plot.h + 3.4, { align: 'center' });
  });
}

/** Os quatro indicadores em caixas, lado a lado. */
function drawKpis(doc: jsPDF, top: number, summary: ExecutiveSummary): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const gap = 3;
  const width = (pageWidth - MARGIN_X * 2 - gap * 3) / 4;
  const height = 19;
  const delta = (value: number | null) => (value === null ? '' : `${value >= 0 ? '+' : ''}${pct(value)} frente ao período anterior`);
  const items: { label: string; value: string; caption: string; color?: RGB }[] = [
    { label: 'Faturamento bruto (12M)', value: formatCurrency(summary.twelveMonthsGrossRevenue), caption: delta(summary.twelveMonthsGrossRevenueVariation) || `Média mensal: ${formatCurrency(summary.twelveMonthsGrossRevenue / 12)}` },
    { label: 'Receita líquida (12M)', value: formatCurrency(summary.twelveMonthsNetRevenue), caption: 'Após deduções e tributos s/ vendas' },
    {
      label: 'Resultado líquido (12M)',
      value: formatCurrency(summary.twelveMonthsNetResult),
      caption: delta(summary.twelveMonthsNetResultVariation) || (summary.twelveMonthsNetResult >= 0 ? 'Lucro líquido acumulado' : 'Prejuízo líquido no período'),
      color: summary.twelveMonthsNetResult >= 0 ? [15, 118, 82] : COLOR.negative,
    },
    { label: 'Margem líquida', value: pct(summary.twelveMonthsNetMargin), caption: `EBITDA est.: ${formatCurrency(summary.twelveMonthsEbitda)} (${pct(summary.twelveMonthsEbitdaMargin)})` },
  ];
  items.forEach((item, i) => {
    const x = MARGIN_X + i * (width + gap);
    doc.setDrawColor(...RULE);
    doc.setFillColor(...HEADER_FILL);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, top, width, height, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(item.label, x + 2.5, top + 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...(item.color ?? INK));
    doc.text(item.value, x + 2.5, top + 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.3);
    doc.setTextColor(...MUTED);
    doc.text(doc.splitTextToSize(item.caption, width - 5) as string[], x + 2.5, top + 15);
  });
  return top + height;
}

const TABLE_STYLES = { font: 'helvetica', fontSize: 8, textColor: INK, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 }, lineColor: RULE } as const;
const TABLE_HEAD = { fontStyle: 'bold', fontSize: 7.2, textColor: MUTED, fillColor: HEADER_FILL, lineWidth: { bottom: 0.35 }, lineColor: INK } as const;

/** Y logo abaixo da última tabela desenhada. */
const afterTable = (doc: jsPDF): number => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

export function generateExecutivePdf(ctx: ExecutivePdfContext): { blob: Blob; fileName: string } {
  const { client, summary, insights } = ctx;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setProperties({ title: `Relatório Executivo - ${client.name}`, subject: summary.periodLabel, creator: 'ContaFlow' });

  let y = renderStatementHeader(doc, { client, title: EXECUTIVE_TITLE, standard: 'Indicadores gerenciais dos últimos 12 meses, comparados com os 12 anteriores', period: `Período: ${summary.periodLabel}` });
  y = drawKpis(doc, y + 5, summary) + 7;

  if (insights.length > 0) {
    y = sectionTitle(doc, y, 'Leitura do período');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    doc.setTextColor(...INK);
    for (const text of insights) {
      const lines = doc.splitTextToSize(text, pageWidth - MARGIN_X * 2 - 4) as string[];
      doc.setFillColor(...MUTED);
      doc.circle(MARGIN_X + 0.8, y - 0.9, 0.45, 'F');
      doc.text(lines, MARGIN_X + 3.5, y);
      y += lines.length * 3.7 + 0.8;
    }
    y += 4;
  }

  y = sectionTitle(doc, y, 'Faturamento, gastos e resultado mês a mês', 'O que entrou, o que saiu em custos, despesas e tributos, e o que sobrou em cada mês.');
  drawMonthlyChart(doc, y, 62, summary.monthly);
  y += 62 + 6;

  y = sectionTitle(doc, y, 'Da receita ao resultado (12 meses)', 'Quanto da receita bruta fica em cada grupo de gasto até chegar ao resultado líquido.');
  drawBridgeChart(doc, y, 66, summary.bridge);

  // Página 2: as tabelas.
  doc.addPage();
  y = sectionTitle(doc, 18, 'Demonstrativo gerencial mês a mês', summary.periodLabel);
  const months = summary.monthly;
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: 18 },
    theme: 'plain',
    head: [['Mês', 'Receita bruta', 'Tributos / ded.', 'Custos', 'Despesas', 'Resultado', 'Margem', 'Acumulado']],
    body: [
      ...months.map((m) => [m.label, formatCurrency(m.grossRevenue), formatCurrency(m.taxes), formatCurrency(m.costs), formatCurrency(m.operatingExpenses + m.financialExpenses), formatCurrency(m.netResult), pct(m.netMargin), formatCurrency(m.cumulativeResult)]),
      [
        '12 meses',
        formatCurrency(summary.twelveMonthsGrossRevenue),
        formatCurrency(summary.costComposition.taxes),
        formatCurrency(summary.costComposition.costs),
        formatCurrency(summary.costComposition.operatingExpenses + summary.costComposition.financialExpenses),
        formatCurrency(summary.twelveMonthsNetResult),
        pct(summary.twelveMonthsNetMargin),
        '',
      ],
    ],
    styles: TABLE_STYLES,
    headStyles: TABLE_HEAD,
    columnStyles: { 0: { cellWidth: 18 } },
    didParseCell: (data) => {
      if (data.column.index > 0) data.cell.styles.halign = 'right';
      if (data.section !== 'body') return;
      if (data.row.index === months.length) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = GRAND_TOTAL_FILL;
      } else if (data.column.index === 5 && months[data.row.index].netResult < 0) {
        data.cell.styles.textColor = COLOR.negative;
      }
    },
  });

  y = sectionTitle(doc, afterTable(doc) + 9, 'Maiores gastos do período', 'Contas de custo e despesa que mais pesaram, com a participação no total.');
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: 18 },
    theme: 'plain',
    head: [['Conta', 'Em 12 meses', 'Média por mês', '% dos gastos']],
    body: summary.topExpenses.length ? summary.topExpenses.map((e) => [e.code ? `${e.code} ${e.name}` : e.name, formatCurrency(e.value), formatCurrency(e.value / 12), pct(e.share)]) : [['Sem custos ou despesas no período', '', '', '']],
    styles: TABLE_STYLES,
    headStyles: TABLE_HEAD,
    didParseCell: (data) => {
      if (data.column.index > 0) data.cell.styles.halign = 'right';
    },
  });

  const c = summary.costComposition;
  y = sectionTitle(doc, afterTable(doc) + 9, 'Composição dos gastos', `Como os ${formatCurrency(c.total)} de custos, despesas e tributos se distribuem.`);
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: 18 },
    theme: 'plain',
    head: [['Grupo', 'Em 12 meses', '% do total']],
    body: [
      ['Custos (CMV/CSP)', formatCurrency(c.costs), pct(c.costsPct)],
      ['Despesas operacionais', formatCurrency(c.operatingExpenses), pct(c.operatingExpensesPct)],
      ['Despesas financeiras', formatCurrency(c.financialExpenses), pct(c.financialExpensesPct)],
      ['Tributos e deduções', formatCurrency(c.taxes), pct(c.taxesPct)],
    ],
    styles: TABLE_STYLES,
    headStyles: TABLE_HEAD,
    didParseCell: (data) => {
      if (data.column.index > 0) data.cell.styles.halign = 'right';
    },
  });

  addPageFooters(doc, 'Relatório Executivo', client.name);
  const period = summary.periodLabel.replace(/\//g, '-').replace(/\s+a\s+/, '_a_');
  return { blob: doc.output('blob'), fileName: `Relatorio_Executivo_${sanitizeFileName(client.tradeName || client.name)}_${period}.pdf` };
}
