import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import type { ChartAccount, ClientCompany, FinancingContract, InvestmentAccount, PrepaidExpense, StockControl } from '@/types/firestore';
import { accountingStandard } from '@/lib/accounting-standard';
import { lastDayOf } from '@/lib/fixed-assets';
import { postedPrepaidCents, prepaidBalanceAt, prepaidEndDate } from '@/lib/prepaid-expenses';
import { contractPositionAt, FINANCING_KIND_LABEL } from '@/lib/financing';
import { isActiveIn, type YieldRow } from '@/lib/investments';
import { STOCK_FREQUENCY_LABEL, type StockFigures } from '@/lib/stock';
import { fromCents, toCents } from '@/lib/money';
import { GRAND_TOTAL_FILL, HEADER_FILL, INK, MARGIN_X, MUTED, RULE, addPageFooters, renderStatementHeader, sanitizeFileName } from '@/lib/export/ledger-pdf';
import { renderSheetHeader } from '@/lib/export/ledger-excel';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

/**
 * Papéis de trabalho em PDF e Excel das demais abas de Bens e Contratos:
 * 1. Seguros e despesas antecipadas
 * 2. Empréstimos, financiamentos e parcelamentos
 * 3. Aplicações financeiras
 * 4. Estoque e CMV
 */

export type ReportClient = Pick<ClientCompany, 'name' | 'cnpj' | 'tradeName' | 'porte' | 'activity'>;

const CURRENCY_FORMAT = '"R$" #,##0.00;[Red]-"R$" #,##0.00;"R$" 0.00';
const periodOf = (month: string) => `Posição em ${formatDateBR(lastDayOf(month))}`;
const clientSlug = (client: ReportClient) => sanitizeFileName(client.tradeName || client.name) || 'Cliente';

/* =========================================================================
   1. Seguros e despesas antecipadas
   ========================================================================= */

export const PREPAID_REPORT_TITLE = 'RELATÓRIO ANALÍTICO DE DESPESAS ANTECIPADAS';

export interface PrepaidReportRow {
  kind: 'item' | 'subtotal' | 'total';
  label: string;
  accountCode?: string;
  documentRef?: string;
  period?: string;
  months?: number;
  amount: number;
  quota: number;
  appropriated: number;
  balance: number;
}

export function prepaidReportRows(
  items: readonly PrepaidExpense[],
  month: string,
  implantationMonth: string | null,
  accounts: readonly ChartAccount[]
): PrepaidReportRow[] {
  const active = items
    .map((item) => {
      const totalCents = toCents(item.amount);
      const balanceCents = prepaidBalanceAt(item, month, implantationMonth);
      const quotaCents = postedPrepaidCents(item, month, implantationMonth);
      const appropriatedCents = Math.max(0, totalCents - balanceCents);
      return { item, totalCents, quotaCents, appropriatedCents, balanceCents };
    })
    .filter((x) => x.item.startDate.slice(0, 7) <= month && (x.balanceCents > 0 || x.quotaCents > 0))
    .sort((a, b) => a.item.assetAccountCode.localeCompare(b.item.assetAccountCode, undefined, { numeric: true }) || a.item.startDate.localeCompare(b.item.startDate));

  const out: PrepaidReportRow[] = [];
  const total = { amount: 0, quota: 0, app: 0, bal: 0 };

  for (let i = 0; i < active.length; ) {
    const code = active[i].item.assetAccountCode;
    const sub = { amount: 0, quota: 0, app: 0, bal: 0 };
    for (; i < active.length && active[i].item.assetAccountCode === code; i++) {
      const { item, totalCents, quotaCents, appropriatedCents, balanceCents } = active[i];
      out.push({
        kind: 'item',
        label: item.description,
        accountCode: code,
        ...(item.documentRef ? { documentRef: item.documentRef } : {}),
        period: `${formatDateBR(item.startDate)} a ${formatDateBR(prepaidEndDate(item))}`,
        months: item.months,
        amount: fromCents(totalCents),
        quota: fromCents(quotaCents),
        appropriated: fromCents(appropriatedCents),
        balance: fromCents(balanceCents),
      });
      sub.amount += totalCents;
      sub.quota += quotaCents;
      sub.app += appropriatedCents;
      sub.bal += balanceCents;
    }
    const name = accounts.find((a) => a.code === code)?.name ?? code;
    out.push({
      kind: 'subtotal',
      label: `${code} ${name}`,
      accountCode: code,
      amount: fromCents(sub.amount),
      quota: fromCents(sub.quota),
      appropriated: fromCents(sub.app),
      balance: fromCents(sub.bal),
    });
    total.amount += sub.amount;
    total.quota += sub.quota;
    total.app += sub.app;
    total.bal += sub.bal;
  }

  out.push({
    kind: 'total',
    label: 'Total',
    amount: fromCents(total.amount),
    quota: fromCents(total.quota),
    appropriated: fromCents(total.app),
    balance: fromCents(total.bal),
  });
  return out;
}

const PREPAID_HEAD = ['Descrição', 'Apólice / Doc.', 'Vigência', 'Meses', 'Valor total', 'Cota do mês', 'Apropriado', 'A apropriar'];

export function generatePrepaidPdf(ctx: { client: ReportClient; rows: readonly PrepaidReportRow[]; month: string; issuedAt?: Date }): { blob: Blob; fileName: string } {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  doc.setProperties({ title: `Despesas Antecipadas - ${ctx.client.name}`, subject: periodOf(ctx.month), creator: 'ContaFlow' });
  const y = renderStatementHeader(doc, { client: ctx.client, title: PREPAID_REPORT_TITLE, standard: accountingStandard(ctx.client), period: periodOf(ctx.month) });
  const rows = ctx.rows;
  autoTable(doc, {
    startY: y + 2,
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: 18 },
    theme: 'plain',
    head: [PREPAID_HEAD],
    body: rows.map((r) => [
      r.label,
      r.documentRef ?? '',
      r.period ?? '',
      r.months !== undefined ? String(r.months) : '',
      formatCurrency(r.amount),
      formatCurrency(r.quota),
      formatCurrency(r.appropriated),
      formatCurrency(r.balance),
    ]),
    styles: { font: 'helvetica', fontSize: 8.5, textColor: INK, cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 }, lineColor: RULE },
    headStyles: { fontStyle: 'bold', fontSize: 7.5, textColor: MUTED, fillColor: HEADER_FILL, lineWidth: { bottom: 0.35 }, lineColor: INK },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 24 },
      2: { cellWidth: 42 },
      3: { cellWidth: 16, halign: 'right' },
      4: { cellWidth: 28, halign: 'right' },
      5: { cellWidth: 26, halign: 'right' },
      6: { cellWidth: 28, halign: 'right' },
      7: { cellWidth: 28, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'head') {
        if (data.column.index >= 3) data.cell.styles.halign = 'right';
        return;
      }
      const row = rows[data.row.index];
      if (!row || row.kind === 'item') return;
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
  addPageFooters(doc, 'Despesas Antecipadas', ctx.client.name);
  return { blob: doc.output('blob'), fileName: `Despesas_Antecipadas_${clientSlug(ctx.client)}_${lastDayOf(ctx.month)}.pdf` };
}

export async function generatePrepaidExcel(ctx: { client: ReportClient; rows: readonly PrepaidReportRow[]; month: string; issuedAt?: Date }): Promise<{ blob: Blob; fileName: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ContaFlow';
  wb.created = ctx.issuedAt ?? new Date();
  const ws = wb.addWorksheet('Despesas Antecipadas', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [{ width: 42 }, { width: 16 }, { width: 24 }, { width: 10 }, { width: 18 }, { width: 16 }, { width: 18 }, { width: 18 }];
  const first = renderSheetHeader(ws, ctx, PREPAID_REPORT_TITLE, periodOf(ctx.month), PREPAID_HEAD.length);
  const head = ws.getRow(first);
  head.values = PREPAID_HEAD;
  head.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FF555555' } };
  head.eachCell((c, i) => {
    c.border = { bottom: { style: 'thin', color: { argb: 'FF1C1917' } } };
    if (i >= 4) c.alignment = { horizontal: 'right' };
  });
  ctx.rows.forEach((r, i) => {
    const row = ws.getRow(first + 1 + i);
    row.values = [
      r.kind === 'item' ? `    ${r.label}` : r.label,
      r.documentRef ?? '',
      r.period ?? '',
      r.months ?? '',
      r.amount,
      r.quota,
      r.appropriated,
      r.balance,
    ];
    row.font = { name: 'Aptos', size: 10, bold: r.kind !== 'item', color: { argb: 'FF1C1917' } };
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
    fileName: `Despesas_Antecipadas_${clientSlug(ctx.client)}_${lastDayOf(ctx.month)}.xlsx`,
  };
}

/* =========================================================================
   2. Empréstimos, financiamentos e parcelamentos
   ========================================================================= */

export const FINANCING_REPORT_TITLE = 'POSIÇÃO DE EMPRÉSTIMOS, FINANCIAMENTOS E PARCELAMENTOS';

export interface FinancingReportRow {
  kind: 'contract' | 'total';
  label: string;
  typeLabel?: string;
  installmentsLabel?: string;
  shortNet: number;
  longNet: number;
  unearnedInterest: number;
  balance: number;
}

export function financingReportRows(contracts: readonly FinancingContract[], month: string): FinancingReportRow[] {
  const sorted = [...contracts].sort((a, b) => a.date.localeCompare(b.date));
  const out: FinancingReportRow[] = [];
  const total = { shortNet: 0, longNet: 0, unearned: 0, balance: 0 };

  for (const c of sorted) {
    const pos = contractPositionAt(c, month);
    const shortNetCents = pos.shortPayments - pos.shortInterest;
    const longNetCents = pos.longPayments - pos.longInterest;
    const unearnedCents = pos.shortInterest + pos.longInterest;
    out.push({
      kind: 'contract',
      label: `${c.description}${c.lender ? ` · ${c.lender}` : ''}`,
      typeLabel: FINANCING_KIND_LABEL[c.kind],
      installmentsLabel: `${pos.paidCount}/${c.installments}`,
      shortNet: fromCents(shortNetCents),
      longNet: fromCents(longNetCents),
      unearnedInterest: fromCents(unearnedCents),
      balance: fromCents(pos.balance),
    });
    total.shortNet += shortNetCents;
    total.longNet += longNetCents;
    total.unearned += unearnedCents;
    total.balance += pos.balance;
  }

  out.push({
    kind: 'total',
    label: 'Total',
    shortNet: fromCents(total.shortNet),
    longNet: fromCents(total.longNet),
    unearnedInterest: fromCents(total.unearned),
    balance: fromCents(total.balance),
  });
  return out;
}

const FINANCING_HEAD = ['Contrato / Financiadora', 'Tipo', 'Parcelas', 'Curto prazo (líq.)', 'Longo prazo (líq.)', 'Encargos a transcorrer', 'Saldo devedor'];

export function generateFinancingPdf(ctx: { client: ReportClient; rows: readonly FinancingReportRow[]; month: string; issuedAt?: Date }): { blob: Blob; fileName: string } {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  doc.setProperties({ title: `Financiamentos - ${ctx.client.name}`, subject: periodOf(ctx.month), creator: 'ContaFlow' });
  const y = renderStatementHeader(doc, { client: ctx.client, title: FINANCING_REPORT_TITLE, standard: accountingStandard(ctx.client), period: periodOf(ctx.month) });
  const rows = ctx.rows;
  autoTable(doc, {
    startY: y + 2,
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: 18 },
    theme: 'plain',
    head: [FINANCING_HEAD],
    body: rows.map((r) => [
      r.label,
      r.typeLabel ?? '',
      r.installmentsLabel ?? '',
      formatCurrency(r.shortNet),
      formatCurrency(r.longNet),
      formatCurrency(r.unearnedInterest),
      formatCurrency(r.balance),
    ]),
    styles: { font: 'helvetica', fontSize: 8.5, textColor: INK, cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 }, lineColor: RULE },
    headStyles: { fontStyle: 'bold', fontSize: 7.5, textColor: MUTED, fillColor: HEADER_FILL, lineWidth: { bottom: 0.35 }, lineColor: INK },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 38 },
      2: { cellWidth: 20, halign: 'right' },
      3: { cellWidth: 32, halign: 'right' },
      4: { cellWidth: 32, halign: 'right' },
      5: { cellWidth: 34, halign: 'right' },
      6: { cellWidth: 32, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'head') {
        if (data.column.index >= 2) data.cell.styles.halign = 'right';
        return;
      }
      const row = rows[data.row.index];
      if (!row || row.kind !== 'total') return;
      data.cell.styles.fontStyle = 'bold';
      data.cell.styles.fillColor = GRAND_TOTAL_FILL;
      data.cell.styles.lineWidth = { top: 0.3, bottom: 0.3 };
      data.cell.styles.lineColor = INK;
    },
  });
  addPageFooters(doc, 'Financiamentos', ctx.client.name);
  return { blob: doc.output('blob'), fileName: `Financiamentos_${clientSlug(ctx.client)}_${lastDayOf(ctx.month)}.pdf` };
}

export async function generateFinancingExcel(ctx: { client: ReportClient; rows: readonly FinancingReportRow[]; month: string; issuedAt?: Date }): Promise<{ blob: Blob; fileName: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ContaFlow';
  wb.created = ctx.issuedAt ?? new Date();
  const ws = wb.addWorksheet('Financiamentos', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [{ width: 44 }, { width: 24 }, { width: 14 }, { width: 18 }, { width: 18 }, { width: 20 }, { width: 18 }];
  const first = renderSheetHeader(ws, ctx, FINANCING_REPORT_TITLE, periodOf(ctx.month), FINANCING_HEAD.length);
  const head = ws.getRow(first);
  head.values = FINANCING_HEAD;
  head.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FF555555' } };
  head.eachCell((c, i) => {
    c.border = { bottom: { style: 'thin', color: { argb: 'FF1C1917' } } };
    if (i >= 3) c.alignment = { horizontal: 'right' };
  });
  ctx.rows.forEach((r, i) => {
    const row = ws.getRow(first + 1 + i);
    row.values = [r.label, r.typeLabel ?? '', r.installmentsLabel ?? '', r.shortNet, r.longNet, r.unearnedInterest, r.balance];
    row.font = { name: 'Aptos', size: 10, bold: r.kind === 'total', color: { argb: 'FF1C1917' } };
    row.getCell(3).alignment = { horizontal: 'right' };
    for (const c of [4, 5, 6, 7]) row.getCell(c).numFmt = CURRENCY_FORMAT;
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
    fileName: `Financiamentos_${clientSlug(ctx.client)}_${lastDayOf(ctx.month)}.xlsx`,
  };
}

/* =========================================================================
   3. Aplicações financeiras
   ========================================================================= */

export const INVESTMENTS_REPORT_TITLE = 'DEMONSTRATIVO DE APLICAÇÕES FINANCEIRAS E RENDIMENTOS';

export interface InvestmentReportRow {
  kind: 'account' | 'total';
  label: string;
  accountCode?: string;
  informed: number;
  ledgerBefore: number;
  yieldAmount: number;
}

export function investmentReportRows(
  investments: readonly InvestmentAccount[],
  month: string,
  yieldRows: readonly YieldRow[]
): InvestmentReportRow[] {
  const byAccountId = new Map(yieldRows.map((r) => [r.ledgerAccountId, r] as const));
  const active = investments.filter((inv) => isActiveIn(inv, month));
  const out: InvestmentReportRow[] = [];
  let totalInformed = 0;
  let totalLedger = 0;
  let totalYield = 0;

  if (yieldRows.length > 0) {
    for (const r of yieldRows) {
      const sample = active.find((a) => a.ledgerAccountId === r.ledgerAccountId);
      out.push({
        kind: 'account',
        label: r.label,
        accountCode: sample?.ledgerAccountCode ?? '',
        informed: fromCents(r.informedCents),
        ledgerBefore: fromCents(r.ledgerCents),
        yieldAmount: fromCents(r.yieldCents),
      });
      totalInformed += r.informedCents;
      totalLedger += r.ledgerCents;
      totalYield += r.yieldCents;
    }
  } else {
    for (const inv of active) {
      const yr = byAccountId.get(inv.ledgerAccountId);
      const infCents = toCents(inv.balances[month] ?? 0);
      const ledCents = yr?.ledgerCents ?? infCents;
      const yCents = infCents - ledCents;
      out.push({
        kind: 'account',
        label: inv.description,
        accountCode: inv.ledgerAccountCode,
        informed: fromCents(infCents),
        ledgerBefore: fromCents(ledCents),
        yieldAmount: fromCents(yCents),
      });
      totalInformed += infCents;
      totalLedger += ledCents;
      totalYield += yCents;
    }
  }

  out.push({
    kind: 'total',
    label: 'Total',
    informed: fromCents(totalInformed),
    ledgerBefore: fromCents(totalLedger),
    yieldAmount: fromCents(totalYield),
  });
  return out;
}

const INVESTMENTS_HEAD = ['Aplicação', 'Conta contábil', 'Saldo do extrato', 'Contábil antes do rendimento', 'Rendimento do mês'];

export function generateInvestmentsPdf(ctx: { client: ReportClient; rows: readonly InvestmentReportRow[]; month: string; issuedAt?: Date }): { blob: Blob; fileName: string } {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  doc.setProperties({ title: `Aplicações Financeiras - ${ctx.client.name}`, subject: periodOf(ctx.month), creator: 'ContaFlow' });
  const y = renderStatementHeader(doc, { client: ctx.client, title: INVESTMENTS_REPORT_TITLE, standard: accountingStandard(ctx.client), period: periodOf(ctx.month) });
  const rows = ctx.rows;
  autoTable(doc, {
    startY: y + 2,
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: 18 },
    theme: 'plain',
    head: [INVESTMENTS_HEAD],
    body: rows.map((r) => [
      r.label,
      r.accountCode ?? '',
      formatCurrency(r.informed),
      formatCurrency(r.ledgerBefore),
      formatCurrency(r.yieldAmount),
    ]),
    styles: { font: 'helvetica', fontSize: 8.5, textColor: INK, cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 }, lineColor: RULE },
    headStyles: { fontStyle: 'bold', fontSize: 7.5, textColor: MUTED, fillColor: HEADER_FILL, lineWidth: { bottom: 0.35 }, lineColor: INK },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 28 },
      2: { cellWidth: 34, halign: 'right' },
      3: { cellWidth: 38, halign: 'right' },
      4: { cellWidth: 32, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'head') {
        if (data.column.index >= 2) data.cell.styles.halign = 'right';
        return;
      }
      const row = rows[data.row.index];
      if (!row || row.kind !== 'total') return;
      data.cell.styles.fontStyle = 'bold';
      data.cell.styles.fillColor = GRAND_TOTAL_FILL;
      data.cell.styles.lineWidth = { top: 0.3, bottom: 0.3 };
      data.cell.styles.lineColor = INK;
    },
  });
  addPageFooters(doc, 'Aplicações Financeiras', ctx.client.name);
  return { blob: doc.output('blob'), fileName: `Aplicacoes_${clientSlug(ctx.client)}_${lastDayOf(ctx.month)}.pdf` };
}

export async function generateInvestmentsExcel(ctx: { client: ReportClient; rows: readonly InvestmentReportRow[]; month: string; issuedAt?: Date }): Promise<{ blob: Blob; fileName: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ContaFlow';
  wb.created = ctx.issuedAt ?? new Date();
  const ws = wb.addWorksheet('Aplicações', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [{ width: 40 }, { width: 18 }, { width: 20 }, { width: 24 }, { width: 20 }];
  const first = renderSheetHeader(ws, ctx, INVESTMENTS_REPORT_TITLE, periodOf(ctx.month), INVESTMENTS_HEAD.length);
  const head = ws.getRow(first);
  head.values = INVESTMENTS_HEAD;
  head.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FF555555' } };
  head.eachCell((c, i) => {
    c.border = { bottom: { style: 'thin', color: { argb: 'FF1C1917' } } };
    if (i >= 3) c.alignment = { horizontal: 'right' };
  });
  ctx.rows.forEach((r, i) => {
    const row = ws.getRow(first + 1 + i);
    row.values = [r.label, r.accountCode ?? '', r.informed, r.ledgerBefore, r.yieldAmount];
    row.font = { name: 'Aptos', size: 10, bold: r.kind === 'total', color: { argb: 'FF1C1917' } };
    for (const c of [3, 4, 5]) row.getCell(c).numFmt = CURRENCY_FORMAT;
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
    fileName: `Aplicacoes_${clientSlug(ctx.client)}_${lastDayOf(ctx.month)}.xlsx`,
  };
}

/* =========================================================================
   4. Estoque e CMV
   ========================================================================= */

export const STOCK_REPORT_TITLE = 'DEMONSTRATIVO DE ESTOQUE FINAL E APURAÇÃO DO CMV';

export interface StockReportContext {
  client: ReportClient;
  control: StockControl;
  month: string;
  figures: StockFigures | null;
  issuedAt?: Date;
}

function stockTableRows(ctx: StockReportContext): { label: string; value: number; strong?: boolean }[] {
  const { control, month, figures } = ctx;
  const count = control.counts[month];
  if (!figures) {
    return count !== undefined ? [{ label: 'Estoque final informado pelo cliente', value: count, strong: true }] : [];
  }
  const cmvLabel =
    figures.adjustmentCents >= 0
      ? `(=) CMV apurado (D ${control.costAccountCode} / C ${control.stockAccountCode})`
      : `(=) Volta ao estoque (D ${control.stockAccountCode} / C ${control.costAccountCode})`;
  return [
    { label: `(+) Estoque contábil antes do ajuste (${control.stockAccountCode} ${control.stockAccountName ?? ''})`, value: fromCents(figures.ledgerCents) },
    { label: `(−) Estoque final informado${control.notes?.[month] ? ` (${control.notes[month]})` : ''}`, value: fromCents(figures.countCents) },
    { label: cmvLabel, value: fromCents(Math.abs(figures.adjustmentCents)), strong: true },
  ];
}

export function generateStockPdf(ctx: StockReportContext): { blob: Blob; fileName: string } {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  doc.setProperties({ title: `Estoque e CMV - ${ctx.client.name}`, subject: periodOf(ctx.month), creator: 'ContaFlow' });
  const y = renderStatementHeader(doc, { client: ctx.client, title: STOCK_REPORT_TITLE, standard: accountingStandard(ctx.client), period: periodOf(ctx.month) });
  const rows = stockTableRows(ctx);
  const meta = `${ctx.control.stockAccountCode} ${ctx.control.stockAccountName ?? ''} → ${ctx.control.costAccountCode} ${ctx.control.costAccountName ?? ''} · ${STOCK_FREQUENCY_LABEL[ctx.control.frequency]}`;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(meta, MARGIN_X, y + 4);

  autoTable(doc, {
    startY: y + 7,
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: 18 },
    theme: 'plain',
    head: [['Descrição', 'Valor']],
    body: rows.map((r) => [r.label, formatCurrency(r.value)]),
    styles: { font: 'helvetica', fontSize: 9, textColor: INK, cellPadding: { top: 2, bottom: 2, left: 2, right: 2 }, lineColor: RULE },
    headStyles: { fontStyle: 'bold', fontSize: 7.5, textColor: MUTED, fillColor: HEADER_FILL, lineWidth: { bottom: 0.35 }, lineColor: INK },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 42, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'head') {
        if (data.column.index === 1) data.cell.styles.halign = 'right';
        return;
      }
      const row = rows[data.row.index];
      if (!row?.strong) return;
      data.cell.styles.fontStyle = 'bold';
      data.cell.styles.fillColor = GRAND_TOTAL_FILL;
      data.cell.styles.lineWidth = { top: 0.3, bottom: 0.3 };
      data.cell.styles.lineColor = INK;
    },
  });
  addPageFooters(doc, 'Estoque e CMV', ctx.client.name);
  return { blob: doc.output('blob'), fileName: `Estoque_CMV_${clientSlug(ctx.client)}_${lastDayOf(ctx.month)}.pdf` };
}

export async function generateStockExcel(ctx: StockReportContext): Promise<{ blob: Blob; fileName: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ContaFlow';
  wb.created = ctx.issuedAt ?? new Date();
  const ws = wb.addWorksheet('Estoque e CMV', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [{ width: 64 }, { width: 22 }];
  const first = renderSheetHeader(ws, ctx, STOCK_REPORT_TITLE, periodOf(ctx.month), 2);
  const head = ws.getRow(first);
  head.values = ['Descrição', 'Valor'];
  head.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FF555555' } };
  head.eachCell((c, i) => {
    c.border = { bottom: { style: 'thin', color: { argb: 'FF1C1917' } } };
    if (i === 2) c.alignment = { horizontal: 'right' };
  });
  const rows = stockTableRows(ctx);
  rows.forEach((r, i) => {
    const row = ws.getRow(first + 1 + i);
    row.values = [r.label, r.value];
    row.font = { name: 'Aptos', size: 10, bold: Boolean(r.strong), color: { argb: 'FF1C1917' } };
    row.getCell(2).numFmt = CURRENCY_FORMAT;
    if (r.strong) {
      row.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E2E2' } };
        c.border = { top: { style: 'thin', color: { argb: 'FF1C1917' } }, bottom: { style: 'thin', color: { argb: 'FF1C1917' } } };
      });
    }
  });
  const buffer = await wb.xlsx.writeBuffer();
  return {
    blob: new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    fileName: `Estoque_CMV_${clientSlug(ctx.client)}_${lastDayOf(ctx.month)}.xlsx`,
  };
}
