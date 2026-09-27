import ExcelJS from 'exceljs';
import {
  buildDREExportRows,
  cnpjLabel,
  DRE_CURRENCY,
  DRE_STANDARD,
  DRE_TITLE,
  dreFileBaseName,
  formatIssueDate,
  periodLabel,
  type DREExportContext,
  type DREExportRow,
} from '@/lib/export/dre-rows';

const FONT_NAME = 'Aptos';
/** Formato contábil: positivos, negativos em vermelho com sinal, e zero. */
const CURRENCY_FORMAT = '"R$" #,##0.00;[Red]-"R$" #,##0.00;"R$" 0.00';
const PERCENT_FORMAT = '0.0%;[Red]-0.0%;0.0%';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
const SUBTOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
const RESULT_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE4E4E4' } };
const THIN: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const MEDIUM: Partial<ExcelJS.Border> = { style: 'medium', color: { argb: 'FF1C1917' } };

const font = (overrides: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({
  name: FONT_NAME,
  size: 10,
  color: { argb: 'FF1C1917' },
  ...overrides,
});

function descriptionOf(row: DREExportRow): string {
  return row.kind === 'account' ? `${row.code ?? ''}  ${row.label}` : row.label;
}

/**
 * Gera a DRE em .xlsx estilizado (layout ITG 1000/2022). Valores são gravados como
 * números (não texto), com formato contábil, para permitir fórmulas e conferência.
 */
export async function generateDREExcel(ctx: DREExportContext): Promise<{ blob: Blob; fileName: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ContaFlow';
  wb.created = ctx.issuedAt ?? new Date();

  const ws = wb.addWorksheet('DRE', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    properties: { defaultRowHeight: 18 },
  });

  const rows = buildDREExportRows(ctx.statement);

  /* ── Cabeçalho corporativo ─────────────────────────────────────────── */
  const headerLines: { text: string; bold?: boolean; size?: number; italic?: boolean }[] = [
    { text: ctx.client.name.toUpperCase(), bold: true, size: 12 },
    { text: cnpjLabel(ctx.client.cnpj) },
    { text: DRE_TITLE, bold: true, size: 12 },
    { text: DRE_STANDARD, italic: true },
    { text: `${periodLabel(ctx.range)}  •  ${DRE_CURRENCY}` },
  ];
  headerLines.forEach((line, i) => {
    const r = i + 1;
    ws.mergeCells(r, 1, r, 3);
    const cell = ws.getCell(r, 1);
    cell.value = line.text;
    cell.font = font({ bold: line.bold, italic: line.italic, size: line.size ?? 10, color: { argb: line.bold ? 'FF1C1917' : 'FF595959' } });
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = HEADER_FILL;
    ws.getRow(r).height = line.size ? 22 : 17;
  });
  // Moldura fina ao redor do bloco de cabeçalho.
  for (let r = 1; r <= headerLines.length; r++) {
    for (let c = 1; c <= 3; c++) {
      ws.getCell(r, c).border = {
        top: r === 1 ? THIN : undefined,
        bottom: r === headerLines.length ? THIN : undefined,
        left: c === 1 ? THIN : undefined,
        right: c === 3 ? THIN : undefined,
      };
    }
  }

  /* ── Cabeçalho da tabela ───────────────────────────────────────────── */
  const tableHeaderRow = headerLines.length + 2;
  const th = ws.getRow(tableHeaderRow);
  th.values = ['Descrição', '% s/ Receita Bruta', 'Valor (R$)'];
  th.height = 20;
  th.eachCell((cell, col) => {
    cell.font = font({ bold: true, size: 9, color: { argb: 'FF595959' } });
    cell.fill = HEADER_FILL;
    cell.border = { top: THIN, bottom: THIN, left: THIN, right: THIN };
    cell.alignment = { horizontal: col === 1 ? 'left' : 'right', vertical: 'middle' };
  });

  /* ── Linhas da DRE ─────────────────────────────────────────────────── */
  rows.forEach((row, i) => {
    const r = ws.getRow(tableHeaderRow + 1 + i);
    r.getCell(1).value = descriptionOf(row);
    r.getCell(2).value = row.percent === null ? null : row.percent / 100;
    r.getCell(3).value = Math.round(row.value * 100) / 100;

    r.getCell(2).numFmt = PERCENT_FORMAT;
    r.getCell(3).numFmt = CURRENCY_FORMAT;
    r.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: row.kind === 'account' ? 2 : 0 };
    r.getCell(2).alignment = { horizontal: 'right', vertical: 'middle' };
    r.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' };

    const isAccount = row.kind === 'account';
    const bold = !isAccount;
    const baseFont = font({
      bold,
      size: row.kind === 'result' ? 11 : isAccount ? 9 : 10,
      color: { argb: isAccount ? 'FF595959' : 'FF1C1917' },
    });

    for (let c = 1; c <= 3; c++) {
      const cell = r.getCell(c);
      cell.font = baseFont;
      cell.border = { left: c === 1 ? THIN : undefined, right: c === 3 ? THIN : undefined, bottom: isAccount ? undefined : THIN };
      if (row.kind === 'subtotal') cell.fill = SUBTOTAL_FILL;
      if (row.kind === 'result') {
        cell.fill = RESULT_FILL;
        cell.border = { top: MEDIUM, bottom: MEDIUM, left: c === 1 ? THIN : undefined, right: c === 3 ? THIN : undefined };
      }
    }
    r.height = row.kind === 'result' ? 24 : isAccount ? 16 : 19;
  });

  /* ── Encerramento e assinaturas ────────────────────────────────────── */
  const issuedAt = ctx.issuedAt ?? new Date();
  let r = tableHeaderRow + rows.length + 3;
  ws.getCell(r, 1).value = `Emitido em ${formatIssueDate(issuedAt)}.`;
  ws.getCell(r, 1).font = font({ size: 9 });

  r += 4;
  const legal = ctx.signatories?.legalRepresentative;
  const accountant = ctx.signatories?.accountant;
  const signature: [string, string][] = [
    [legal?.name || 'Nome:', accountant?.name || 'Nome:'],
    ['Representante Legal / Administrador', 'Profissional da Contabilidade'],
    [`CPF: ${legal?.cpf ?? ''}`, `CRC: ${accountant?.crc ?? ''}`],
  ];
  signature.forEach(([left, right], i) => {
    const leftCell = ws.getCell(r + i, 1);
    ws.mergeCells(r + i, 2, r + i, 3);
    const rightCell = ws.getCell(r + i, 2);
    leftCell.value = left;
    rightCell.value = right;
    for (const cell of [leftCell, rightCell]) {
      cell.alignment = { horizontal: 'center' };
      cell.font = font({ size: 9, bold: i === 0, color: { argb: i === 0 ? 'FF1C1917' : 'FF595959' } });
      if (i === 0) cell.border = { top: { style: 'thin', color: { argb: 'FF1C1917' } } };
    }
  });

  /* ── Larguras com auto-ajuste e respiro ────────────────────────────── */
  const longest = Math.max(...rows.map((row) => descriptionOf(row).length + (row.kind === 'account' ? 4 : 0)), 40);
  ws.getColumn(1).width = Math.min(Math.max(longest + 4, 48), 80);
  ws.getColumn(2).width = 20;
  const longestValue = Math.max(...rows.map((row) => Math.abs(row.value).toFixed(2).length));
  ws.getColumn(3).width = Math.max(longestValue + 10, 20);

  ws.pageSetup.printArea = `A1:C${r + 2}`;
  ws.headerFooter.oddFooter = `&L&8${ctx.client.name}&R&8Página &P de &N`;

  const buffer = await wb.xlsx.writeBuffer();
  return {
    blob: new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    fileName: `${dreFileBaseName(ctx.client.tradeName || ctx.client.name, ctx.range)}.xlsx`,
  };
}
