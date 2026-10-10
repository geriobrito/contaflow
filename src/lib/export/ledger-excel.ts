import ExcelJS from 'exceljs';
import type { ClientCompany } from '@/types/firestore';
import type { DateRange } from '@/lib/data/repository';
import type { BalanceSheet, BalanceSheetLine, TrialBalance } from '@/lib/ledger';
import { cnpjLabel, formatIssueDate, periodLabel } from '@/lib/export/dre-rows';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

/**
 * Balanço patrimonial e balancete de verificação em .xlsx com acabamento executivo.
 * - Valores gravados estritamente como números (formato contábil brasileiro).
 * - Código e Conta separados em colunas individuais com recuo nativo de hierarquia.
 * - Indicação de natureza contábil (Devedor / Credor).
 * - Fechamento contábil com bordas duplas e verificação de equilíbrio patrimonial.
 * - Congelamento de cabeçalhos e configuração profissional de impressão A4.
 */

const FONT_NAME = 'Aptos';
const CURRENCY_FORMAT = '"R$" #,##0.00;[Red]-"R$" #,##0.00;"R$" 0.00';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
const SECTION_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAEAEA' } };
const SUBTOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
const GRAND_TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E2E2' } };

const THIN_BORDER: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const DOUBLE_BORDER: Partial<ExcelJS.Border> = { style: 'double', color: { argb: 'FF1C1917' } };

const font = (overrides: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({
  name: FONT_NAME,
  size: 10,
  color: { argb: 'FF1C1917' },
  ...overrides,
});

export interface LedgerExportContext {
  client: Pick<ClientCompany, 'name' | 'cnpj' | 'tradeName'>;
  range: DateRange;
  balanceSheet: BalanceSheet;
  trialBalance: TrialBalance;
  issuedAt?: Date;
  signatories?: {
    legalRepresentative?: { name?: string; cpf?: string };
    accountant?: { name?: string; crc?: string };
  };
}

/** Cabeçalho corporativo integrado no topo da planilha */
function renderSheetHeader(
  ws: ExcelJS.Worksheet,
  ctx: LedgerExportContext,
  title: string,
  subtitle: string,
  numCols: number
): number {
  const lines = [
    { text: ctx.client.name.toUpperCase(), bold: true, size: 12 },
    { text: cnpjLabel(ctx.client.cnpj), size: 10 },
    { text: title, bold: true, size: 12 },
    { text: 'NBC TG 1002 / ITG 1000 - Microentidades', italic: true, size: 9 },
    { text: `${subtitle}  •  Em Reais - R$`, size: 10 },
    { text: `Emitido em ${formatIssueDate(ctx.issuedAt ?? new Date())}`, size: 9 },
  ];

  lines.forEach((l, i) => {
    const rowIdx = i + 1;
    ws.mergeCells(rowIdx, 1, rowIdx, numCols);
    const cell = ws.getCell(rowIdx, 1);
    cell.value = l.text;
    cell.font = font({
      bold: l.bold,
      italic: l.italic,
      size: l.size ?? 10,
      color: { argb: l.bold ? 'FF1C1917' : 'FF555555' },
    });
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = HEADER_FILL;
    ws.getRow(rowIdx).height = l.size && l.size > 10 ? 22 : 18;
  });

  // Borda fina externa no cabeçalho
  for (let r = 1; r <= lines.length; r++) {
    for (let c = 1; c <= numCols; c++) {
      ws.getCell(r, c).border = {
        top: r === 1 ? THIN_BORDER : undefined,
        bottom: r === lines.length ? THIN_BORDER : undefined,
        left: c === 1 ? THIN_BORDER : undefined,
        right: c === numCols ? THIN_BORDER : undefined,
      };
    }
  }

  // Linha em branco separadora
  ws.addRow([]);
  return lines.length + 2;
}

/** Renderiza bloco formal de assinaturas */
function renderSignatures(
  ws: ExcelJS.Worksheet,
  ctx: LedgerExportContext,
  startRow: number,
  leftColStart: number,
  leftColEnd: number,
  rightColStart: number,
  rightColEnd: number
) {
  const legal = ctx.signatories?.legalRepresentative;
  const accountant = ctx.signatories?.accountant;

  const rows: [string, string][] = [
    [legal?.name || 'Nome: _______________________________', accountant?.name || 'Nome: _______________________________'],
    ['Representante Legal / Administrador', 'Profissional da Contabilidade'],
    [`CPF: ${legal?.cpf ?? ''}`, `CRC: ${accountant?.crc ?? ''}`],
  ];

  rows.forEach(([left, right], i) => {
    const r = startRow + i;
    ws.mergeCells(r, leftColStart, r, leftColEnd);
    ws.mergeCells(r, rightColStart, r, rightColEnd);

    const cellL = ws.getCell(r, leftColStart);
    const cellR = ws.getCell(r, rightColStart);

    cellL.value = left;
    cellR.value = right;

    for (const c of [cellL, cellR]) {
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.font = font({ size: 9, bold: i === 0, color: { argb: i === 0 ? 'FF1C1917' : 'FF555555' } });
      if (i === 0) {
        c.border = { top: { style: 'thin', color: { argb: 'FF1C1917' } } };
      }
    }
    ws.getRow(r).height = 18;
  });
}

export async function generateLedgerExcel(ctx: LedgerExportContext): Promise<{ blob: Blob; fileName: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ContaFlow';
  wb.created = ctx.issuedAt ?? new Date();

  const bs = ctx.balanceSheet;
  const tb = ctx.trialBalance;

  /* =========================================================================
     Aba 1: Balanço Patrimonial
     ========================================================================= */
  const wsBs = wb.addWorksheet('Balanço patrimonial', {
    views: [{ showGridLines: true }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.7, bottom: 0.7, header: 0.3, footer: 0.3 },
    },
    properties: { defaultRowHeight: 19 },
  });

  const bsHeaderRow = renderSheetHeader(
    wsBs,
    ctx,
    'BALANÇO PATRIMONIAL',
    `Posição em ${formatDateBR(bs.date)}`,
    4
  );

  // Cabeçalho das colunas do Balanço
  const thBs = wsBs.getRow(bsHeaderRow);
  thBs.values = ['Código', 'Descrição da Conta', 'Tipo', 'Saldo (R$)'];
  thBs.height = 22;
  thBs.eachCell((cell, col) => {
    cell.font = font({ bold: true, size: 9.5, color: { argb: 'FF333333' } });
    cell.fill = HEADER_FILL;
    cell.border = { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER };
    cell.alignment = { horizontal: col === 4 ? 'right' : col === 3 ? 'center' : 'left', vertical: 'middle' };
  });

  let curBsRow = bsHeaderRow + 1;

  const renderBsSection = (
    sectionTitle: string,
    sectionCode: string,
    lines: readonly BalanceSheetLine[],
    subtotalTitle: string,
    subtotalValue: number
  ) => {
    // Linha de Seção Principal (ex: ATIVO)
    const secRow = wsBs.getRow(curBsRow++);
    secRow.values = [sectionCode, sectionTitle, 'Sintética', subtotalValue];
    secRow.height = 21;
    secRow.getCell(4).numFmt = CURRENCY_FORMAT;
    secRow.eachCell((cell, col) => {
      cell.font = font({ bold: true, size: 10 });
      cell.fill = SECTION_FILL;
      cell.border = { top: THIN_BORDER, bottom: THIN_BORDER };
      cell.alignment = { horizontal: col === 4 ? 'right' : col === 3 ? 'center' : 'left', vertical: 'middle' };
    });

    // Linhas de detalhe
    for (const l of lines) {
      const row = wsBs.getRow(curBsRow++);
      row.values = [l.code, l.name, l.synthetic ? 'Sintética' : 'Analítica', Math.round(l.value * 100) / 100];
      row.getCell(4).numFmt = CURRENCY_FORMAT;
      row.height = l.synthetic ? 19 : 17;

      const isSynth = l.synthetic;
      row.eachCell((cell, col) => {
        cell.font = font({
          bold: isSynth,
          size: isSynth ? 9.5 : 9,
          color: { argb: isSynth ? 'FF1C1917' : 'FF555555' },
        });
        cell.border = { bottom: THIN_BORDER };
        cell.alignment = {
          horizontal: col === 4 ? 'right' : col === 3 ? 'center' : 'left',
          vertical: 'middle',
          indent: col === 2 ? Math.max(0, l.level - 1) : 0,
        };
      });
    }

    // Linha de Subtotal
    const subRow = wsBs.getRow(curBsRow++);
    subRow.values = ['', subtotalTitle, 'Sintética', Math.round(subtotalValue * 100) / 100];
    subRow.height = 20;
    subRow.getCell(4).numFmt = CURRENCY_FORMAT;
    subRow.eachCell((cell, col) => {
      cell.font = font({ bold: true, size: 10 });
      cell.fill = SUBTOTAL_FILL;
      cell.border = { top: THIN_BORDER, bottom: THIN_BORDER };
      cell.alignment = { horizontal: col === 4 ? 'right' : col === 3 ? 'center' : 'left', vertical: 'middle' };
    });

    // Linha em branco
    curBsRow++;
  };

  renderBsSection('ATIVO', '1', bs.assets, 'TOTAL DO ATIVO', bs.totalAssets);
  renderBsSection('PASSIVO', '2', bs.liabilities, 'TOTAL DO PASSIVO', bs.totalLiabilities);
  renderBsSection('PATRIMÔNIO LÍQUIDO', '2.3', bs.equity, 'TOTAL DO PATRIMÔNIO LÍQUIDO', bs.totalEquity);

  // TOTAL DO PASSIVO E DO PATRIMÔNIO LÍQUIDO
  const totalPassivoPL = bs.totalLiabilities + bs.totalEquity;
  const totRow = wsBs.getRow(curBsRow++);
  totRow.values = ['', 'TOTAL DO PASSIVO E DO PATRIMÔNIO LÍQUIDO', 'Sintética', Math.round(totalPassivoPL * 100) / 100];
  totRow.height = 24;
  totRow.getCell(4).numFmt = CURRENCY_FORMAT;
  totRow.eachCell((cell, col) => {
    cell.font = font({ bold: true, size: 10.5 });
    cell.fill = GRAND_TOTAL_FILL;
    cell.border = { top: THIN_BORDER, bottom: DOUBLE_BORDER };
    cell.alignment = { horizontal: col === 4 ? 'right' : col === 3 ? 'center' : 'left', vertical: 'middle' };
  });

  // Linha de verificação de fechamento
  const checkRow = wsBs.getRow(curBsRow++);
  const balanced = Math.abs(bs.totalAssets - totalPassivoPL) < 0.01;
  checkRow.values = [
    '',
    balanced
      ? '✓ Balanço equilibrado: Ativo = Passivo + Patrimônio Líquido'
      : `⚠ Atenção: Diferença de ${formatCurrency(Math.abs(bs.difference))} entre Ativo e Passivo + PL`,
  ];
  checkRow.font = font({ italic: true, size: 9, color: { argb: balanced ? 'FF15803D' : 'FFB91C1C' } });

  // Bloco de assinaturas
  curBsRow += 2;
  renderSignatures(wsBs, ctx, curBsRow, 1, 2, 3, 4);

  // Larguras ajustadas
  wsBs.getColumn(1).width = 20; // Código
  wsBs.getColumn(2).width = 54; // Conta
  wsBs.getColumn(3).width = 15; // Tipo
  wsBs.getColumn(4).width = 24; // Saldo

  wsBs.pageSetup.printArea = `A1:D${curBsRow + 4}`;
  wsBs.headerFooter.oddFooter = `&L&8${ctx.client.name}&R&8Página &P de &N`;

  /* =========================================================================
     Aba 2: Balancete de Verificação
     ========================================================================= */
  const wsTb = wb.addWorksheet('Balancete', {
    views: [{ showGridLines: true, state: 'frozen', ySplit: 8 }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
    properties: { defaultRowHeight: 18 },
  });

  const tbHeaderRow = renderSheetHeader(
    wsTb,
    ctx,
    'BALANCETE DE VERIFICAÇÃO',
    periodLabel(ctx.range),
    8
  );

  // Cabeçalho das colunas do Balancete
  const thTb = wsTb.getRow(tbHeaderRow);
  thTb.values = [
    'Código',
    'Descrição da Conta',
    'Tipo',
    'Saldo Anterior',
    'Débitos',
    'Créditos',
    'Saldo Atual',
    'Nat.',
  ];
  thTb.height = 22;
  thTb.eachCell((cell, col) => {
    cell.font = font({ bold: true, size: 9.5, color: { argb: 'FF333333' } });
    cell.fill = HEADER_FILL;
    cell.border = { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER };
    cell.alignment = {
      horizontal: col === 1 ? 'left' : col === 2 ? 'left' : col === 3 || col === 8 ? 'center' : 'right',
      vertical: 'middle',
    };
  });

  let curTbRow = tbHeaderRow + 1;

  for (const r of tb.rows) {
    const row = wsTb.getRow(curTbRow++);
    const nat = Math.abs(r.final) < 0.005 ? '—' : r.final > 0 ? 'D' : 'C';

    row.values = [
      r.code,
      r.name,
      r.synthetic ? 'Sintética' : 'Analítica',
      Math.round(r.previous * 100) / 100,
      Math.round(r.debits * 100) / 100,
      Math.round(r.credits * 100) / 100,
      Math.round(r.final * 100) / 100,
      nat,
    ];

    for (const c of [4, 5, 6, 7]) {
      row.getCell(c).numFmt = CURRENCY_FORMAT;
    }

    const isSynth = r.synthetic;
    row.height = isSynth ? 19 : 17;

    row.eachCell((cell, col) => {
      cell.font = font({
        bold: isSynth,
        size: isSynth ? 9.5 : 9,
        color: { argb: isSynth ? 'FF1C1917' : 'FF555555' },
      });
      cell.border = { bottom: THIN_BORDER };
      cell.alignment = {
        horizontal: col === 1 ? 'left' : col === 2 ? 'left' : col === 3 || col === 8 ? 'center' : 'right',
        vertical: 'middle',
        indent: col === 2 ? Math.max(0, r.level - 1) : 0,
      };
    });
  }

  // Linha de Totais do Balancete (contas analíticas)
  const totTbRow = wsTb.getRow(curTbRow++);
  const totNat = Math.abs(tb.totals.final) < 0.005 ? '—' : tb.totals.final > 0 ? 'D' : 'C';

  totTbRow.values = [
    '',
    'TOTAIS (contas analíticas)',
    'Analítica',
    Math.round(tb.totals.previous * 100) / 100,
    Math.round(tb.totals.debits * 100) / 100,
    Math.round(tb.totals.credits * 100) / 100,
    Math.round(tb.totals.final * 100) / 100,
    totNat,
  ];

  totTbRow.height = 22;
  for (const c of [4, 5, 6, 7]) {
    totTbRow.getCell(c).numFmt = CURRENCY_FORMAT;
  }

  totTbRow.eachCell((cell, col) => {
    cell.font = font({ bold: true, size: 10 });
    cell.fill = GRAND_TOTAL_FILL;
    cell.border = { top: THIN_BORDER, bottom: DOUBLE_BORDER };
    cell.alignment = {
      horizontal: col === 1 ? 'left' : col === 2 ? 'left' : col === 3 || col === 8 ? 'center' : 'right',
      vertical: 'middle',
    };
  });

  // Linha informativa de rodapé
  const noteRow = wsTb.getRow(curTbRow++);
  noteRow.values = [
    '',
    'Saldos: valores positivos indicam saldo Devedor (D); negativos indicam saldo Credor (C). Contas de resultado acumulam no exercício a partir de 1º de janeiro.',
  ];
  noteRow.font = font({ italic: true, size: 8.5, color: { argb: 'FF666666' } });

  // Bloco de assinaturas
  curTbRow += 2;
  renderSignatures(wsTb, ctx, curTbRow, 2, 4, 5, 7);

  // Larguras ajustadas para Paisagem
  wsTb.getColumn(1).width = 18; // Código
  wsTb.getColumn(2).width = 46; // Conta
  wsTb.getColumn(3).width = 14; // Tipo
  wsTb.getColumn(4).width = 22; // Saldo Anterior
  wsTb.getColumn(5).width = 20; // Débitos
  wsTb.getColumn(6).width = 20; // Créditos
  wsTb.getColumn(7).width = 22; // Saldo Atual
  wsTb.getColumn(8).width = 10; // Nat.

  wsTb.pageSetup.printArea = `A1:H${curTbRow + 4}`;
  wsTb.headerFooter.oddFooter = `&L&8${ctx.client.name}&R&8Página &P de &N`;

  /* =========================================================================
     Exportação do arquivo binário
     ========================================================================= */
  const buffer = await wb.xlsx.writeBuffer();
  const base = (ctx.client.tradeName || ctx.client.name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

  return {
    blob: new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    fileName: `Balanco_Balancete_${base || 'Cliente'}_${bs.date}.xlsx`,
  };
}
