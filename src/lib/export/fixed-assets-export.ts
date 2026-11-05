import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import type { ChartAccount, ClientCompany, FixedAsset } from '@/types/firestore';
import { accountingStandard } from '@/lib/accounting-standard';
import { assetPositionAt, lastDayOf, postedQuotaCents } from '@/lib/fixed-assets';
import { fromCents } from '@/lib/money';
import { GRAND_TOTAL_FILL, HEADER_FILL, INK, MARGIN_X, MUTED, RULE, addPageFooters, renderStatementHeader, sanitizeFileName } from '@/lib/export/ledger-pdf';
import { renderSheetHeader } from '@/lib/export/ledger-excel';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

/**
 * Relatório analítico do imobilizado (papel de trabalho da conciliação com o balancete): os bens
 * no balanço no fim da competência, por conta, com custo, cota do mês, acumulada e valor líquido.
 */

export const FIXED_ASSETS_TITLE = 'RELATÓRIO ANALÍTICO DO IMOBILIZADO';

export interface FixedAssetReportRow {
  kind: 'asset' | 'subtotal' | 'total';
  label: string;
  accountCode?: string;
  documentRef?: string;
  inUseDate?: string;
  rate?: number;
  cost: number;
  quota: number;
  accumulated: number;
  net: number;
}

/** Linhas do relatório: bens por conta (com subtotal da conta) e o total. Bens baixados ou ainda não adquiridos ficam de fora. */
export function fixedAssetReportRows(
  assets: readonly FixedAsset[],
  month: string,
  implantationMonth: string | null,
  accounts: readonly ChartAccount[]
): FixedAssetReportRow[] {
  const items = assets
    .map((a) => ({ a, pos: assetPositionAt(a, month, implantationMonth), quota: postedQuotaCents(a, month, implantationMonth) }))
    .filter((x) => x.pos.costCents > 0)
    .sort((x, y) => x.a.accountCode.localeCompare(y.a.accountCode, undefined, { numeric: true }) || x.a.inUseDate.localeCompare(y.a.inUseDate));
  const out: FixedAssetReportRow[] = [];
  const total = { cost: 0, quota: 0, acc: 0 };
  for (let i = 0; i < items.length; ) {
    const code = items[i].a.accountCode;
    const sub = { cost: 0, quota: 0, acc: 0 };
    for (; i < items.length && items[i].a.accountCode === code; i++) {
      const { a, pos, quota } = items[i];
      out.push({
        kind: 'asset',
        label: a.description,
        accountCode: code,
        ...(a.documentRef ? { documentRef: a.documentRef } : {}),
        inUseDate: a.inUseDate,
        rate: a.annualRate,
        cost: fromCents(pos.costCents),
        quota: fromCents(quota),
        accumulated: fromCents(pos.accumulatedCents),
        net: fromCents(pos.netCents),
      });
      sub.cost += pos.costCents;
      sub.quota += quota;
      sub.acc += pos.accumulatedCents;
    }
    const name = accounts.find((acc) => acc.code === code)?.name ?? items[i - 1].a.accountName ?? code;
    out.push({ kind: 'subtotal', label: `${code} ${name}`, accountCode: code, cost: fromCents(sub.cost), quota: fromCents(sub.quota), accumulated: fromCents(sub.acc), net: fromCents(sub.cost - sub.acc) });
    total.cost += sub.cost;
    total.quota += sub.quota;
    total.acc += sub.acc;
  }
  out.push({ kind: 'total', label: 'Total', cost: fromCents(total.cost), quota: fromCents(total.quota), accumulated: fromCents(total.acc), net: fromCents(total.cost - total.acc) });
  return out;
}

export interface FixedAssetReportContext {
  client: Pick<ClientCompany, 'name' | 'cnpj' | 'tradeName' | 'porte' | 'activity'>;
  rows: readonly FixedAssetReportRow[];
  month: string;
  issuedAt?: Date;
}

const periodOf = (month: string) => `Posição em ${formatDateBR(lastDayOf(month))}`;
const fileBase = (ctx: FixedAssetReportContext) => `Imobilizado_${sanitizeFileName(ctx.client.tradeName || ctx.client.name) || 'Cliente'}_${lastDayOf(ctx.month)}`;
const pct = (n?: number) => (n === undefined ? '' : `${n.toLocaleString('pt-BR')}%`);
const HEAD = ['Bem', 'NF', 'Em uso desde', 'Taxa a.a.', 'Custo', 'Cota do mês', 'Acumulada', 'Valor líquido'];

export function generateFixedAssetsPdf(ctx: FixedAssetReportContext): { blob: Blob; fileName: string } {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  doc.setProperties({ title: `Imobilizado - ${ctx.client.name}`, subject: periodOf(ctx.month), creator: 'ContaFlow' });
  const y = renderStatementHeader(doc, { client: ctx.client, title: FIXED_ASSETS_TITLE, standard: accountingStandard(ctx.client), period: periodOf(ctx.month) });
  const rows = ctx.rows;
  autoTable(doc, {
    startY: y + 2,
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: 18 },
    theme: 'plain',
    head: [HEAD],
    body: rows.map((r) => [
      r.label,
      r.documentRef ?? '',
      r.inUseDate ? formatDateBR(r.inUseDate) : '',
      pct(r.rate),
      formatCurrency(r.cost),
      formatCurrency(r.quota),
      formatCurrency(r.accumulated),
      formatCurrency(r.net),
    ]),
    styles: { font: 'helvetica', fontSize: 8.5, textColor: INK, cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 }, lineColor: RULE },
    headStyles: { fontStyle: 'bold', fontSize: 7.5, textColor: MUTED, fillColor: HEADER_FILL, lineWidth: { bottom: 0.35 }, lineColor: INK },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 22 },
      2: { cellWidth: 24 },
      3: { cellWidth: 18, halign: 'right' },
      4: { cellWidth: 30, halign: 'right' },
      5: { cellWidth: 26, halign: 'right' },
      6: { cellWidth: 30, halign: 'right' },
      7: { cellWidth: 30, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'head') {
        if (data.column.index >= 3) data.cell.styles.halign = 'right';
        return;
      }
      const row = rows[data.row.index];
      if (!row || row.kind === 'asset') return;
      data.cell.styles.fontStyle = 'bold';
      if (row.kind === 'total') {
        data.cell.styles.fillColor = GRAND_TOTAL_FILL;
        data.cell.styles.lineWidth = { top: 0.3, bottom: 0.3 };
        data.cell.styles.lineColor = INK;
      } else {
        data.cell.styles.lineWidth = { top: 0.2 };
      }
    },
  });
  addPageFooters(doc, 'Imobilizado', ctx.client.name);
  return { blob: doc.output('blob'), fileName: `${fileBase(ctx)}.pdf` };
}

const CURRENCY_FORMAT = '"R$" #,##0.00;[Red]-"R$" #,##0.00;"R$" 0.00';

export async function generateFixedAssetsExcel(ctx: FixedAssetReportContext): Promise<{ blob: Blob; fileName: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ContaFlow';
  wb.created = ctx.issuedAt ?? new Date();
  const ws = wb.addWorksheet('Imobilizado', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [{ width: 44 }, { width: 14 }, { width: 14 }, { width: 10 }, { width: 18 }, { width: 16 }, { width: 18 }, { width: 18 }];
  const first = renderSheetHeader(ws, ctx, FIXED_ASSETS_TITLE, periodOf(ctx.month), HEAD.length);
  const head = ws.getRow(first);
  head.values = HEAD;
  head.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FF555555' } };
  head.eachCell((c, i) => {
    c.border = { bottom: { style: 'thin', color: { argb: 'FF1C1917' } } };
    if (i >= 4) c.alignment = { horizontal: 'right' };
  });
  ctx.rows.forEach((r, i) => {
    const row = ws.getRow(first + 1 + i);
    row.values = [
      r.kind === 'asset' ? `    ${r.label}` : r.label,
      r.documentRef ?? '',
      r.inUseDate ? formatDateBR(r.inUseDate) : '',
      r.rate === undefined ? '' : r.rate / 100,
      r.cost,
      r.quota,
      r.accumulated,
      r.net,
    ];
    row.font = { name: 'Aptos', size: 10, bold: r.kind !== 'asset', color: { argb: 'FF1C1917' } };
    row.getCell(4).numFmt = '0.##%';
    for (const c of [5, 6, 7, 8]) row.getCell(c).numFmt = CURRENCY_FORMAT;
    if (r.kind === 'total') {
      row.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E2E2' } };
        c.border = { top: { style: 'thin', color: { argb: 'FF1C1917' } }, bottom: { style: 'thin', color: { argb: 'FF1C1917' } } };
      });
    }
  });
  const buffer = await wb.xlsx.writeBuffer();
  return {
    blob: new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    fileName: `${fileBase(ctx)}.xlsx`,
  };
}
