import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { ClientCompany } from '@/types/firestore';
import type { DateRange } from '@/lib/data/repository';
import type { BalanceSheet, BalanceSheetLine, TrialBalance } from '@/lib/ledger';
import { cnpjLabel, formatAccounting, formatIssueDate, periodLabel } from '@/lib/export/dre-rows';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

/* ── Paleta corporativa e sóbria (RGB) — legibilidade máxima em tela e impressão P&B ── */
const INK: [number, number, number] = [28, 25, 23];
const MUTED: [number, number, number] = [105, 100, 95];
const RULE: [number, number, number] = [210, 206, 200];
const HEADER_FILL: [number, number, number] = [246, 246, 244];
const SECTION_FILL: [number, number, number] = [238, 238, 236];
const SUBTOTAL_FILL: [number, number, number] = [242, 242, 240];
const GRAND_TOTAL_FILL: [number, number, number] = [228, 228, 226];

const MARGIN_X = 12; // mm (permite acomodar as 6 colunas do Balancete com folga perfeita em A4 Retrato)

export interface LedgerPdfExportContext {
  client: Pick<ClientCompany, 'name' | 'cnpj' | 'tradeName'>;
  range: DateRange;
  balanceSheet: BalanceSheet;
  trialBalance: TrialBalance;
  documentType: 'bs' | 'tb'; // 'bs' = Balanço patrimonial, 'tb' = Balancete de verificação
  showSynthetic?: boolean;
  issuedAt?: Date;
  signatories?: {
    legalRepresentative?: { name?: string; cpf?: string };
    accountant?: { name?: string; crc?: string };
  };
}

/** Formata saldo de balancete com indicador de natureza: D (devedor) ou C (credor). */
const formatDC = (v: number): string => {
  if (Math.abs(v) < 0.005) return '—';
  return `${formatCurrency(Math.abs(v))} ${v > 0 ? 'D' : 'C'}`;
};

/** Formata valor monetário do balanço: negativos entre parênteses. */
const formatBSMoney = (v: number): string => (v < 0 ? `(${formatCurrency(-v)})` : formatCurrency(v));

/** Nome de arquivo sanitizado sem acentos ou caracteres especiais. */
function sanitizeFileName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Adiciona o rodapé de paginação elegante em todas as páginas do documento.
 */
function addPageFooters(doc: jsPDF, title: string, clientName: string) {
  const totalPages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const footerY = pageHeight - 9;

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);

    // Linha fina de rodapé
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.2);
    doc.line(MARGIN_X, footerY - 3, pageWidth - MARGIN_X, footerY - 3);

    // Texto esquerda e direita
    doc.text(`${clientName.toUpperCase()}  •  ${title}`, MARGIN_X, footerY);
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - MARGIN_X, footerY, { align: 'right' });
  }
}

/**
 * Desenha o bloco formal de encerramento e assinaturas (Administrador e Contador com CRC).
 */
function renderSignatures(
  doc: jsPDF,
  startY: number,
  issuedAt: Date,
  signatories: LedgerPdfExportContext['signatories']
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageBottom = doc.internal.pageSize.getHeight() - 18;
  const BLOCK_HEIGHT = 46;

  let y = startY + 8;
  if (y + BLOCK_HEIGHT > pageBottom) {
    doc.addPage();
    y = 26;
  }

  // Data de emissão por extenso
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...INK);
  doc.text(`Emitido em ${formatIssueDate(issuedAt)}.`, MARGIN_X, y);

  y += 18;
  const availableWidth = pageWidth - MARGIN_X * 2;
  const colWidth = Math.min((availableWidth - 20) / 2, 85);
  const leftX = MARGIN_X + 4;
  const rightX = pageWidth - MARGIN_X - colWidth - 4;

  const legal = signatories?.legalRepresentative;
  const accountant = signatories?.accountant;
  const blank = '____________________________________';

  const drawSignatureBlock = (x: number, role: string, name?: string, docLabel?: string, docVal?: string) => {
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.35);
    doc.line(x, y, x + colWidth, y);

    const cx = x + colWidth / 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(name?.trim() || blank, cx, y + 4.5, { align: 'center', maxWidth: colWidth });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(role, cx, y + 9, { align: 'center' });

    if (docVal?.trim()) {
      doc.text(`${docLabel}: ${docVal.trim()}`, cx, y + 13, { align: 'center' });
    }
  };

  drawSignatureBlock(leftX, 'Representante Legal / Administrador', legal?.name, 'CPF', legal?.cpf);
  drawSignatureBlock(rightX, 'Profissional da Contabilidade', accountant?.name, 'CRC', accountant?.crc);
}

/* =========================================================================
   1. BALANÇO PATRIMONIAL (A4 Retrato)
   ========================================================================= */

interface BSExportRow {
  kind: 'section' | 'item' | 'subtotal' | 'grand_total';
  code: string;
  name: string;
  level: number;
  synthetic: boolean;
  value: number;
}

function renderBalanceSheetPdf(doc: jsPDF, ctx: LedgerPdfExportContext) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const center = pageWidth / 2;
  const issuedAt = ctx.issuedAt ?? new Date();
  const bs = ctx.balanceSheet;

  doc.setProperties({
    title: `Balanço Patrimonial - ${ctx.client.name}`,
    subject: `Posição em ${formatDateBR(bs.date)} - NBC TG 1002 / ITG 1000`,
    creator: 'ContaFlow',
  });

  /* ── Cabeçalho do Balanço ── */
  let y = 18;
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text(ctx.client.name.toUpperCase(), center, y, { align: 'center', maxWidth: pageWidth - MARGIN_X * 2 });

  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(cnpjLabel(ctx.client.cnpj), center, y, { align: 'center' });

  y += 8;
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('BALANÇO PATRIMONIAL', center, y, { align: 'center' });

  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text('NBC TG 1002 / ITG 1000 - Microentidades', center, y, { align: 'center' });

  y += 7;
  doc.setFontSize(8.5);
  doc.setTextColor(...INK);
  doc.text(`Posição em ${formatDateBR(bs.date)}`, MARGIN_X, y);
  doc.text('Em Reais - R$', pageWidth - MARGIN_X, y, { align: 'right' });

  y += 2.5;
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, y, pageWidth - MARGIN_X, y);

  /* ── Montagem das linhas estruturadas ── */
  const rows: BSExportRow[] = [];

  const addLines = (lines: readonly BalanceSheetLine[]) => {
    for (const l of lines) {
      rows.push({
        kind: 'item',
        code: l.code,
        name: l.name,
        level: l.level,
        synthetic: l.synthetic,
        value: l.value,
      });
    }
  };

  // Seção 1: ATIVO
  rows.push({ kind: 'section', code: '1', name: 'ATIVO', level: 1, synthetic: true, value: bs.totalAssets });
  addLines(bs.assets);
  rows.push({ kind: 'subtotal', code: '', name: 'TOTAL DO ATIVO', level: 1, synthetic: true, value: bs.totalAssets });

  // Seção 2: PASSIVO
  rows.push({ kind: 'section', code: '2', name: 'PASSIVO', level: 1, synthetic: true, value: bs.totalLiabilities });
  addLines(bs.liabilities);
  rows.push({ kind: 'subtotal', code: '', name: 'TOTAL DO PASSIVO', level: 1, synthetic: true, value: bs.totalLiabilities });

  // Seção 3: PATRIMÔNIO LÍQUIDO
  rows.push({ kind: 'section', code: '2.3', name: 'PATRIMÔNIO LÍQUIDO', level: 1, synthetic: true, value: bs.totalEquity });
  addLines(bs.equity);
  rows.push({ kind: 'subtotal', code: '', name: 'TOTAL DO PATRIMÔNIO LÍQUIDO', level: 1, synthetic: true, value: bs.totalEquity });

  // TOTAL GERAL
  rows.push({
    kind: 'grand_total',
    code: '',
    name: 'TOTAL DO PASSIVO E DO PATRIMÔNIO LÍQUIDO',
    level: 1,
    synthetic: true,
    value: bs.totalLiabilities + bs.totalEquity,
  });

  const tableBody = rows.map((r) => [r.code, r.name, formatBSMoney(r.value)]);

  autoTable(doc, {
    startY: y + 2,
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: 18 },
    theme: 'plain',
    head: [['Código', 'Descrição da Conta', 'Saldo (R$)']],
    body: tableBody,
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      textColor: INK,
      cellPadding: { top: 1.4, bottom: 1.4, left: 2, right: 2 },
      lineColor: RULE,
      overflow: 'linebreak',
    },
    headStyles: {
      fontStyle: 'bold',
      fontSize: 8,
      textColor: MUTED,
      fillColor: HEADER_FILL,
      lineWidth: { bottom: 0.35 },
      lineColor: INK,
    },
    columnStyles: {
      0: { cellWidth: 26, halign: 'left', font: 'courier' },
      1: { cellWidth: 'auto', halign: 'left' },
      2: { cellWidth: 38, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'head') {
        if (data.column.index === 2) data.cell.styles.halign = 'right';
        return;
      }
      if (data.section !== 'body') return;

      const row = rows[data.row.index];
      if (!row) return;

      if (row.kind === 'section') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fontSize = 9;
        data.cell.styles.fillColor = SECTION_FILL;
        data.cell.styles.lineWidth = { top: 0.3, bottom: 0.2 };
        data.cell.styles.lineColor = INK;
        data.cell.styles.cellPadding = { top: 2.2, bottom: 2, left: 2, right: 2 };
        if (data.column.index === 1) data.cell.styles.textColor = INK;
      } else if (row.kind === 'subtotal') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fontSize = 8.8;
        data.cell.styles.fillColor = SUBTOTAL_FILL;
        data.cell.styles.lineWidth = { top: 0.25, bottom: 0.25 };
        data.cell.styles.lineColor = RULE;
        data.cell.styles.cellPadding = { top: 2, bottom: 2, left: 2, right: 2 };
      } else if (row.kind === 'grand_total') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fontSize = 9.5;
        data.cell.styles.fillColor = GRAND_TOTAL_FILL;
        data.cell.styles.lineWidth = { top: 0.4, bottom: 0.8 };
        data.cell.styles.lineColor = INK;
        data.cell.styles.cellPadding = { top: 2.8, bottom: 2.8, left: 2, right: 2 };
      } else {
        // item comum
        if (row.synthetic) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.textColor = INK;
        } else {
          data.cell.styles.fontStyle = 'normal';
          data.cell.styles.textColor = MUTED;
        }
        // Indentação proporcional ao nível na coluna de descrição
        if (data.column.index === 1) {
          const indent = Math.max(0, row.level - 1) * 3.5;
          data.cell.styles.cellPadding = { top: 1.3, bottom: 1.3, left: 2 + indent, right: 2 };
        }
      }
    },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 40;

  // Se houver diferença ou pendências, exibe nota de advertência profissional
  let nextY = finalY;
  if (bs.difference !== 0 || bs.suspense !== 0) {
    nextY += 4;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    const notes: string[] = [];
    if (bs.difference !== 0) {
      notes.push(`* Diferença entre Ativo e Passivo + PL: ${formatCurrency(Math.abs(bs.difference))}.`);
    }
    if (bs.suspense !== 0) {
      notes.push(`* Há ${formatCurrency(Math.abs(bs.suspense))} em lançamentos a classificar.`);
    }
    doc.text(notes.join('  '), MARGIN_X, nextY);
    nextY += 2;
  }

  renderSignatures(doc, nextY, issuedAt, ctx.signatories);
  addPageFooters(doc, 'BALANÇO PATRIMONIAL', ctx.client.name);
}

/* =========================================================================
   2. BALANCETE DE VERIFICAÇÃO (A4 Paisagem)
   ========================================================================= */

function renderTrialBalancePdf(doc: jsPDF, ctx: LedgerPdfExportContext) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const center = pageWidth / 2;
  const issuedAt = ctx.issuedAt ?? new Date();
  const tb = ctx.trialBalance;
  const rows = ctx.showSynthetic ? tb.rows : tb.rows.filter((r) => !r.synthetic);

  doc.setProperties({
    title: `Balancete de Verificação - ${ctx.client.name}`,
    subject: `${periodLabel(ctx.range)} - NBC TG 1002 / ITG 1000`,
    creator: 'ContaFlow',
  });

  /* ── Cabeçalho do Balancete ── */
  let y = 16;
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(ctx.client.name.toUpperCase(), center, y, { align: 'center', maxWidth: pageWidth - MARGIN_X * 2 });

  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(cnpjLabel(ctx.client.cnpj), center, y, { align: 'center' });

  y += 7.5;
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('BALANCETE DE VERIFICAÇÃO', center, y, { align: 'center' });

  y += 4.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text('NBC TG 1002 / ITG 1000 - Microentidades', center, y, { align: 'center' });

  y += 6.5;
  doc.setFontSize(8.5);
  doc.setTextColor(...INK);
  doc.text(periodLabel(ctx.range), MARGIN_X, y);
  doc.text('Em Reais - R$', pageWidth - MARGIN_X, y, { align: 'right' });

  y += 2.5;
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, y, pageWidth - MARGIN_X, y);

  /* ── Tabela de 6 colunas perfeitamente calibrada em A4 Retrato (186mm úteis) ── */
  const bodyRows = rows.map((r) => [
    r.code,
    r.name,
    formatDC(r.previous),
    r.debits ? formatAccounting(r.debits) : '—',
    r.credits ? formatAccounting(r.credits) : '—',
    formatDC(r.final),
  ]);

  // Linha de totais
  bodyRows.push([
    '',
    'TOTAIS (contas analíticas)',
    formatDC(tb.totals.previous),
    formatAccounting(tb.totals.debits),
    formatAccounting(tb.totals.credits),
    formatDC(tb.totals.final),
  ]);

  const totalRowIndex = bodyRows.length - 1;

  autoTable(doc, {
    startY: y + 2,
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: 18 },
    theme: 'plain',
    head: [['Código', 'Conta', 'Saldo Anterior', 'Débitos', 'Créditos', 'Saldo Atual']],
    body: bodyRows,
    styles: {
      font: 'helvetica',
      fontSize: 7.2,
      textColor: INK,
      cellPadding: { top: 1.2, bottom: 1.2, left: 1.5, right: 1.5 },
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
      0: { cellWidth: 23, halign: 'left', font: 'helvetica' },
      1: { cellWidth: 'auto', halign: 'left' },
      2: { cellWidth: 27, halign: 'right' },
      3: { cellWidth: 27, halign: 'right' },
      4: { cellWidth: 27, halign: 'right' },
      5: { cellWidth: 27, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'head') {
        if (data.column.index >= 2) data.cell.styles.halign = 'right';
        return;
      }
      if (data.section !== 'body') return;

      if (data.row.index === totalRowIndex) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fontSize = 8;
        data.cell.styles.fillColor = GRAND_TOTAL_FILL;
        data.cell.styles.lineWidth = { top: 0.35, bottom: 0.7 };
        data.cell.styles.lineColor = INK;
        data.cell.styles.cellPadding = { top: 1.8, bottom: 1.8, left: 1.5, right: 1.5 };
        return;
      }

      const row = rows[data.row.index];
      if (!row) return;

      if (row.synthetic) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.textColor = INK;
      } else {
        data.cell.styles.fontStyle = 'normal';
        data.cell.styles.textColor = MUTED;
      }

      if (data.column.index === 1) {
        const indent = Math.max(0, row.level - 1) * 2.2;
        data.cell.styles.cellPadding = { top: 1.2, bottom: 1.2, left: 1.5 + indent, right: 1.5 };
      }
    },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 40;

  // Legenda de rodapé explicativa
  const nextY = finalY + 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(
    'Nota: Saldos indicados com (D) Devedor e (C) Credor. Contas de resultado acumulam no exercício desde 1º de janeiro.',
    MARGIN_X,
    nextY
  );

  renderSignatures(doc, nextY + 2, issuedAt, ctx.signatories);
  addPageFooters(doc, 'BALANCETE DE VERIFICAÇÃO', ctx.client.name);
}

/* =========================================================================
   Função principal de geração
   ========================================================================= */

/**
 * Gera o relatório contábil em PDF vetorial A4 de alta qualidade.
 * - Balanço Patrimonial: A4 Retrato (layout oficial NBC TG 1002 / ITG 1000).
 * - Balancete de Verificação: A4 Retrato (padronizado no mesmo padrão do Balanço, sem cortes).
 */
export function generateLedgerPdf(ctx: LedgerPdfExportContext): { blob: Blob; fileName: string } {
  const isBalanceSheet = ctx.documentType === 'bs';

  const doc = new jsPDF({
    unit: 'mm',
    format: 'a4',
    orientation: 'portrait',
  });

  if (isBalanceSheet) {
    renderBalanceSheetPdf(doc, ctx);
  } else {
    renderTrialBalancePdf(doc, ctx);
  }

  const clientSlug = sanitizeFileName(ctx.client.tradeName || ctx.client.name);
  const dateSlug = isBalanceSheet ? ctx.balanceSheet.date : `${ctx.range.start}_a_${ctx.range.end}`;
  const prefix = isBalanceSheet ? 'Balanco_Patrimonial' : 'Balancete';
  const fileName = `${prefix}_${clientSlug || 'Cliente'}_${dateSlug}.pdf`;

  return {
    blob: doc.output('blob'),
    fileName,
  };
}
