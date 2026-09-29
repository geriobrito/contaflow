import ExcelJS from 'exceljs';
import type { ClientCompany } from '@/types/firestore';
import type { DateRange } from '@/lib/data/repository';
import type { BalanceSheet, BalanceSheetLine, TrialBalance } from '@/lib/ledger';
import { cnpjLabel, formatIssueDate, periodLabel } from '@/lib/export/dre-rows';
import { formatDateBR } from '@/lib/utils/formatters';

/**
 * Balanço patrimonial e balancete de verificação em .xlsx (uma aba cada), com valores
 * numéricos em formato contábil e bloco de assinaturas.
 */

const FONT = 'Aptos';
const MONEY = '#,##0.00;[Red]-#,##0.00;"-"';
const THIN: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };

export interface LedgerExportContext {
  client: Pick<ClientCompany, 'name' | 'cnpj'>;
  range: DateRange;
  balanceSheet: BalanceSheet;
  trialBalance: TrialBalance;
  issuedAt?: Date;
  signatories?: {
    legalRepresentative?: { name?: string; cpf?: string };
    accountant?: { name?: string; crc?: string };
  };
}

function header(ws: ExcelJS.Worksheet, ctx: LedgerExportContext, title: string, subtitle: string, width: number) {
  const lines = [
    { text: ctx.client.name.toUpperCase(), bold: true, size: 12 },
    { text: cnpjLabel(ctx.client.cnpj) },
    { text: title, bold: true, size: 12 },
    { text: `${subtitle}  •  Em Reais - R$` },
    { text: `Emitido em ${formatIssueDate(ctx.issuedAt ?? new Date())}`, size: 9 },
  ];
  lines.forEach((l, i) => {
    ws.mergeCells(i + 1, 1, i + 1, width);
    const cell = ws.getCell(i + 1, 1);
    cell.value = l.text;
    cell.font = { name: FONT, size: l.size ?? 10, bold: l.bold };
    cell.alignment = { horizontal: 'center' };
  });
  ws.addRow([]);
}

function signatures(ws: ExcelJS.Worksheet, ctx: LedgerExportContext, leftCol: number, rightCol: number) {
  const legal = ctx.signatories?.legalRepresentative;
  const accountant = ctx.signatories?.accountant;
  ws.addRow([]);
  ws.addRow([]);
  const rows: [string, string][] = [
    ['_______________________________', '_______________________________'],
    [legal?.name ?? '', accountant?.name ?? ''],
    ['Representante Legal / Administrador', 'Profissional da Contabilidade'],
    [`CPF: ${legal?.cpf ?? ''}`, `CRC: ${accountant?.crc ?? ''}`],
  ];
  for (const [l, r] of rows) {
    const row = ws.addRow([]);
    row.getCell(leftCol).value = l;
    row.getCell(rightCol).value = r;
    row.getCell(leftCol).font = { name: FONT, size: 9 };
    row.getCell(rightCol).font = { name: FONT, size: 9 };
  }
}

const indent = (l: BalanceSheetLine) => `${'   '.repeat(Math.max(0, l.level - 1))}${l.code ? `${l.code}  ` : ''}${l.name}`;

export async function generateLedgerExcel(ctx: LedgerExportContext): Promise<{ blob: Blob; fileName: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ContaFlow';
  wb.created = ctx.issuedAt ?? new Date();
  const bs = ctx.balanceSheet;

  /* ── Balanço patrimonial ─────────────────────────────────────────── */
  const b = wb.addWorksheet('Balanço patrimonial', { views: [{ showGridLines: false }], pageSetup: { paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  b.columns = [{ width: 60 }, { width: 18 }];
  header(b, ctx, 'BALANÇO PATRIMONIAL', `Em ${formatDateBR(bs.date)}`, 2);
  const side = (title: string, lines: BalanceSheetLine[], total: number) => {
    const t = b.addRow([title, total]);
    t.font = { name: FONT, bold: true, size: 10 };
    t.getCell(2).numFmt = MONEY;
    t.eachCell((c) => {
      c.fill = HEADER_FILL;
      c.border = { bottom: THIN };
    });
    for (const l of lines) {
      const r = b.addRow([indent(l), l.value]);
      r.font = { name: FONT, size: 10, bold: l.synthetic };
      r.getCell(2).numFmt = MONEY;
    }
    b.addRow([]);
  };
  side('ATIVO', bs.assets, bs.totalAssets);
  side('PASSIVO', bs.liabilities, bs.totalLiabilities);
  side('PATRIMÔNIO LÍQUIDO', bs.equity, bs.totalEquity);
  const tot = b.addRow(['TOTAL DO PASSIVO E DO PATRIMÔNIO LÍQUIDO', bs.totalLiabilities + bs.totalEquity]);
  tot.font = { name: FONT, bold: true, size: 10 };
  tot.getCell(2).numFmt = MONEY;
  signatures(b, ctx, 1, 2);

  /* ── Balancete ───────────────────────────────────────────────────── */
  const t = wb.addWorksheet('Balancete', { views: [{ showGridLines: false, state: 'frozen', ySplit: 7 }], pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  t.columns = [{ width: 16 }, { width: 48 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];
  header(t, ctx, 'BALANCETE DE VERIFICAÇÃO', periodLabel(ctx.range), 6);
  const head = t.addRow(['Código', 'Conta', 'Saldo anterior', 'Débitos', 'Créditos', 'Saldo atual']);
  head.font = { name: FONT, bold: true, size: 10 };
  head.eachCell((c) => {
    c.fill = HEADER_FILL;
    c.border = { bottom: THIN };
  });
  for (const r of ctx.trialBalance.rows) {
    const row = t.addRow([r.code, `${'   '.repeat(Math.max(0, r.level - 1))}${r.name}`, r.previous, r.debits, r.credits, r.final]);
    row.font = { name: FONT, size: 10, bold: r.synthetic };
    for (const c of [3, 4, 5, 6]) row.getCell(c).numFmt = MONEY;
  }
  const totals = ctx.trialBalance.totals;
  const tr = t.addRow(['', 'TOTAIS (contas analíticas)', totals.previous, totals.debits, totals.credits, totals.final]);
  tr.font = { name: FONT, bold: true, size: 10 };
  for (const c of [3, 4, 5, 6]) tr.getCell(c).numFmt = MONEY;
  tr.eachCell((c) => (c.border = { top: THIN }));
  t.addRow(['', 'Saldos: positivo = devedor (D); negativo = credor (C).']).font = { name: FONT, size: 9, italic: true };
  signatures(t, ctx, 2, 5);

  const buffer = await wb.xlsx.writeBuffer();
  const base = ctx.client.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return {
    blob: new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    fileName: `Balanco_Balancete_${base}_${bs.date}.xlsx`,
  };
}
