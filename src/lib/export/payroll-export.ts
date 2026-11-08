import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import type { ClientCompany, JournalEntryLine, PayrollSummary } from '@/types/firestore';
import { accountingStandard } from '@/lib/accounting-standard';
import {
  calculateNetPayroll,
  type PayrollInput,
  type PayrollObligationMatch,
} from '@/lib/payroll';
import {
  GRAND_TOTAL_FILL,
  HEADER_FILL,
  INK,
  MARGIN_X,
  MUTED,
  RULE,
  addPageFooters,
  renderConformity,
  renderSignatures,
  renderStatementHeader,
  sanitizeFileName,
  type LedgerPdfExportContext,
} from '@/lib/export/ledger-pdf';
import { renderConformityRow, renderSheetHeader, renderSignatures as renderSheetSignatures } from '@/lib/export/ledger-excel';
import { formatMonth } from '@/lib/periods';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

export const PAYROLL_EXPORT_TITLE = 'ESPELHO CONTÁBIL DA FOLHA DE PAGAMENTO E CONCILIAÇÃO';

export interface PayrollExportContext {
  client: Pick<ClientCompany, 'name' | 'cnpj' | 'tradeName' | 'porte' | 'activity'>;
  summary: PayrollSummary | PayrollInput;
  journalLines: readonly JournalEntryLine[];
  obligations: readonly PayrollObligationMatch[];
  issuedAt?: Date;
  signatories?: LedgerPdfExportContext['signatories'];
}

const STATUS_LABEL: Record<PayrollObligationMatch['status'], string> = {
  SETTLED: 'Quitado no extrato',
  PARTIAL: 'Pago parcialmente',
  PENDING: 'Pendente de pagamento',
};

const periodOf = (month: string) => `Competência ${formatMonth(month)}`;
const fileBase = (ctx: PayrollExportContext) =>
  `Espelho_Folha_${sanitizeFileName(ctx.client.tradeName || ctx.client.name) || 'Cliente'}_${ctx.summary.month}`;

export function generatePayrollPdf(ctx: PayrollExportContext): { blob: Blob; fileName: string } {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const standard = accountingStandard(ctx.client);
  const issuedAt = ctx.issuedAt ?? new Date();
  const calc = calculateNetPayroll(ctx.summary);

  doc.setProperties({
    title: `Folha de Pagamento - ${ctx.client.name}`,
    subject: `${periodOf(ctx.summary.month)} - ${standard}`,
    creator: 'ContaFlow',
  });

  const y0 = renderStatementHeader(doc, {
    client: ctx.client,
    title: PAYROLL_EXPORT_TITLE,
    standard,
    period: periodOf(ctx.summary.month),
  });

  // 1. Quadro Resumo da Folha e Encargos
  const summaryRows: [string, string][] = [
    ['Salários e Ordenados Brutos (CLT)', formatCurrency(calc.grossSalaries)],
    ['Pró-Labore Bruto dos Sócios', formatCurrency(calc.grossProLabore)],
    ['(-) INSS Retido dos Empregados', formatCurrency(calc.inssEmployees)],
    ['(-) INSS Retido sobre Pró-Labore', formatCurrency(calc.inssProLabore)],
    ['(-) IRRF Retido (Salários + Pró-Labore)', formatCurrency(calc.totalIrrfPayable)],
    ...(calc.otherDeductions > 0 ? [['(-) Outros Descontos em Folha', formatCurrency(calc.otherDeductions)] as [string, string]] : []),
    ['(=) Líquido a Pagar (Salários + Pró-Labore)', formatCurrency(calc.totalNetPayable)],
    ['(+) FGTS da Competência', formatCurrency(calc.fgts)],
    ...(calc.inssEmployer > 0 ? [['(+) INSS Patronal (CPP / RAT / Terceiros)', formatCurrency(calc.inssEmployer)] as [string, string]] : []),
    ...(calc.vacationProvision > 0 ? [['(+) Provisão Mensal de Férias e Encargos', formatCurrency(calc.vacationProvision)] as [string, string]] : []),
    ...(calc.thirteenthProvision > 0 ? [['(+) Provisão Mensal de 13º Salário e Encargos', formatCurrency(calc.thirteenthProvision)] as [string, string]] : []),
    ['Total de Despesa com Pessoal e Encargos no Mês', formatCurrency(calc.totalExpense)],
  ];

  autoTable(doc, {
    startY: y0 + 2,
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: 18 },
    theme: 'plain',
    head: [['1. Resumo da Folha e Encargos', 'Valor (R$)']],
    body: summaryRows,
    styles: { font: 'helvetica', fontSize: 8.5, textColor: INK, cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 }, lineColor: RULE },
    headStyles: { fontStyle: 'bold', fontSize: 8, textColor: MUTED, fillColor: HEADER_FILL, lineWidth: { bottom: 0.35 }, lineColor: INK },
    columnStyles: {
      0: { cellWidth: 'auto', halign: 'left' },
      1: { cellWidth: 42, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'head' && data.column.index === 1) {
        data.cell.styles.halign = 'right';
        return;
      }
      if (data.section === 'body') {
        const label = String(summaryRows[data.row.index]?.[0] ?? '');
        if (label.startsWith('(=)') || label.startsWith('Total')) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = GRAND_TOTAL_FILL;
        }
      }
    },
  });

  const y1 = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y0 + 45) + 5;

  // 2. Partidas Dobradas do Lançamento de Provisão
  const journalBody = ctx.journalLines.map((l) => [
    `${l.accountCode} ${l.accountName}`,
    l.memo ?? '',
    l.type === 'DEBIT' ? formatCurrency(l.amount) : '—',
    l.type === 'CREDIT' ? formatCurrency(l.amount) : '—',
  ]);
  const totalDebit = ctx.journalLines.filter((l) => l.type === 'DEBIT').reduce((s, l) => s + l.amount, 0);
  const totalCredit = ctx.journalLines.filter((l) => l.type === 'CREDIT').reduce((s, l) => s + l.amount, 0);
  journalBody.push(['Total do Lançamento de Provisão', '', formatCurrency(totalDebit), formatCurrency(totalCredit)]);

  autoTable(doc, {
    startY: y1,
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: 18 },
    theme: 'plain',
    head: [['2. Contabilização (Partidas Dobradas)', 'Histórico', 'Débito (R$)', 'Crédito (R$)']],
    body: journalBody,
    styles: { font: 'helvetica', fontSize: 8, textColor: INK, cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 }, lineColor: RULE },
    headStyles: { fontStyle: 'bold', fontSize: 7.5, textColor: MUTED, fillColor: HEADER_FILL, lineWidth: { bottom: 0.35 }, lineColor: INK },
    columnStyles: {
      0: { cellWidth: 62, halign: 'left' },
      1: { cellWidth: 'auto', halign: 'left' },
      2: { cellWidth: 30, halign: 'right' },
      3: { cellWidth: 30, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'head' && data.column.index >= 2) {
        data.cell.styles.halign = 'right';
        return;
      }
      if (data.section === 'body' && data.row.index === journalBody.length - 1) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = GRAND_TOTAL_FILL;
        data.cell.styles.lineWidth = { top: 0.3, bottom: 0.3 };
        data.cell.styles.lineColor = INK;
      }
    },
  });

  const y2 = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y1 + 45) + 5;

  // 3. Conciliação Bancária das Obrigações
  const obBody = ctx.obligations.map((ob) => [
    `${ob.accountCode} · ${ob.label}`,
    formatCurrency(ob.provisioned),
    formatCurrency(ob.paid),
    formatCurrency(ob.remaining),
    STATUS_LABEL[ob.status],
  ]);

  autoTable(doc, {
    startY: y2,
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: 18 },
    theme: 'plain',
    head: [['3. Conciliação com Extrato Bancário', 'Provisionado', 'Pago no Banco', 'Em Aberto', 'Situação']],
    body: obBody,
    styles: { font: 'helvetica', fontSize: 8, textColor: INK, cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 }, lineColor: RULE },
    headStyles: { fontStyle: 'bold', fontSize: 7.5, textColor: MUTED, fillColor: HEADER_FILL, lineWidth: { bottom: 0.35 }, lineColor: INK },
    columnStyles: {
      0: { cellWidth: 'auto', halign: 'left' },
      1: { cellWidth: 28, halign: 'right' },
      2: { cellWidth: 28, halign: 'right' },
      3: { cellWidth: 28, halign: 'right' },
      4: { cellWidth: 36, halign: 'left' },
    },
    didParseCell: (data) => {
      if (data.section === 'head' && data.column.index >= 1 && data.column.index <= 3) {
        data.cell.styles.halign = 'right';
      }
    },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y2 + 30;
  renderSignatures(doc, renderConformity(doc, finalY, ctx.client), issuedAt, ctx.signatories);
  addPageFooters(doc, 'Folha de Pagamento', ctx.client.name);

  return { blob: doc.output('blob'), fileName: `${fileBase(ctx)}.pdf` };
}

const CURRENCY_FORMAT = '"R$" #,##0.00;[Red]-"R$" #,##0.00;"R$" 0.00';

export async function generatePayrollExcel(ctx: PayrollExportContext): Promise<{ blob: Blob; fileName: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ContaFlow';
  wb.created = ctx.issuedAt ?? new Date();
  const ws = wb.addWorksheet('Folha de Pagamento', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  ws.columns = [{ width: 38 }, { width: 34 }, { width: 18 }, { width: 18 }, { width: 22 }];
  let cursor = renderSheetHeader(ws, ctx, PAYROLL_EXPORT_TITLE, periodOf(ctx.summary.month), 5);

  const calc = calculateNetPayroll(ctx.summary);

  // Seção 1: Resumo
  const sHead = ws.getRow(cursor++);
  sHead.values = ['1. Resumo da Folha e Encargos', '', '', '', 'Valor (R$)'];
  sHead.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FF555555' } };
  sHead.getCell(5).alignment = { horizontal: 'right' };

  const summaryItems: [string, number, boolean?][] = [
    ['Salários e Ordenados Brutos (CLT)', calc.grossSalaries],
    ['Pró-Labore Bruto dos Sócios', calc.grossProLabore],
    ['(-) INSS Retido dos Empregados', calc.inssEmployees],
    ['(-) INSS Retido sobre Pró-Labore', calc.inssProLabore],
    ['(-) IRRF Retido (Salários + Pró-Labore)', calc.totalIrrfPayable],
    ...(calc.otherDeductions > 0 ? [['(-) Outros Descontos em Folha', calc.otherDeductions] as [string, number]] : []),
    ['(=) Líquido a Pagar (Salários + Pró-Labore)', calc.totalNetPayable, true],
    ['(+) FGTS da Competência', calc.fgts],
    ...(calc.inssEmployer > 0 ? [['(+) INSS Patronal', calc.inssEmployer] as [string, number]] : []),
    ...(calc.vacationProvision > 0 ? [['(+) Provisão Mensal de Férias e Encargos', calc.vacationProvision] as [string, number]] : []),
    ...(calc.thirteenthProvision > 0 ? [['(+) Provisão Mensal de 13º Salário e Encargos', calc.thirteenthProvision] as [string, number]] : []),
    ['Total de Despesa com Pessoal e Encargos no Mês', calc.totalExpense, true],
  ];

  for (const [label, val, bold] of summaryItems) {
    const row = ws.getRow(cursor++);
    row.getCell(1).value = label;
    row.getCell(5).value = val;
    row.getCell(5).numFmt = CURRENCY_FORMAT;
    row.getCell(5).alignment = { horizontal: 'right' };
    row.font = { name: 'Aptos', size: 10, bold: Boolean(bold) };
  }

  cursor++;

  // Seção 2: Lançamento Contábil
  const jHead = ws.getRow(cursor++);
  jHead.values = ['2. Conta Contábil', 'Histórico', 'Débito (R$)', 'Crédito (R$)', ''];
  jHead.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FF555555' } };
  jHead.getCell(3).alignment = { horizontal: 'right' };
  jHead.getCell(4).alignment = { horizontal: 'right' };

  for (const l of ctx.journalLines) {
    const row = ws.getRow(cursor++);
    row.getCell(1).value = `${l.accountCode} ${l.accountName}`;
    row.getCell(2).value = l.memo ?? '';
    if (l.type === 'DEBIT') {
      row.getCell(3).value = l.amount;
      row.getCell(3).numFmt = CURRENCY_FORMAT;
    } else {
      row.getCell(4).value = l.amount;
      row.getCell(4).numFmt = CURRENCY_FORMAT;
    }
    row.font = { name: 'Aptos', size: 9.5 };
  }

  cursor++;

  // Seção 3: Conciliação Bancária
  const oHead = ws.getRow(cursor++);
  oHead.values = ['3. Obrigação no Passivo', 'Provisionado (R$)', 'Pago no Banco (R$)', 'Em Aberto (R$)', 'Situação'];
  oHead.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FF555555' } };

  for (const ob of ctx.obligations) {
    const row = ws.getRow(cursor++);
    row.getCell(1).value = `${ob.accountCode} · ${ob.label}`;
    row.getCell(2).value = ob.provisioned;
    row.getCell(2).numFmt = CURRENCY_FORMAT;
    row.getCell(3).value = ob.paid;
    row.getCell(3).numFmt = CURRENCY_FORMAT;
    row.getCell(4).value = ob.remaining;
    row.getCell(4).numFmt = CURRENCY_FORMAT;
    row.getCell(5).value = STATUS_LABEL[ob.status];
    row.font = { name: 'Aptos', size: 9.5 };
    if (ob.reconciledTransactions.length > 0) {
      const txDetail = ob.reconciledTransactions
        .map((t) => `${formatDateBR(t.date)}: ${t.memo} (${formatCurrency(Math.abs(t.amount))})`)
        .join(' | ');
      const subRow = ws.getRow(cursor++);
      subRow.getCell(1).value = `   ↳ Baixas: ${txDetail}`;
      subRow.font = { name: 'Aptos', size: 8.5, italic: true, color: { argb: 'FF666666' } };
    }
  }

  renderConformityRow(ws, cursor + 1, ctx.client, 1, 5);
  renderSheetSignatures(ws, ctx, cursor + 4, 1, 2, 3, 5);

  const buffer = await wb.xlsx.writeBuffer();
  return {
    blob: new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    fileName: `${fileBase(ctx)}.xlsx`,
  };
}
