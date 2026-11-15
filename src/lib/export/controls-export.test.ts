import { describe, expect, it } from 'vitest';
import type { FinancingContract, InvestmentAccount, PrepaidExpense, StockControl } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import {
  financingReportRows,
  generateFinancingExcel,
  generateFinancingPdf,
  generateInvestmentsExcel,
  generateInvestmentsPdf,
  generatePrepaidExcel,
  generatePrepaidPdf,
  generateStockExcel,
  generateStockPdf,
  investmentReportRows,
  prepaidReportRows,
} from '@/lib/export/controls-export';

const chart = buildITG1000Chart('c');
const acc = (code: string) => chart.find((a) => a.code === code)!;
const client = { name: 'ALPHA LTDA', cnpj: '11222333000181' };

describe('papéis de trabalho de Bens e Contratos (PDF e Excel)', () => {
  it('despesas antecipadas: agrupa por conta e gera PDF e Excel', async () => {
    const items: PrepaidExpense[] = [
      {
        id: 'p1',
        kind: 'INSURANCE',
        description: 'Seguro Frota',
        documentRef: '991',
        use: 'EXPENSE',
        amount: 1200,
        startDate: '2026-01-01',
        months: 12,
        assetAccountId: acc('1.1.4.01').id,
        assetAccountCode: '1.1.4.01',
        payableAccountId: acc('2.1.3.05').id,
        payableAccountCode: '2.1.3.05',
        expenseAccountId: acc('3.3.2.18').id,
        expenseAccountCode: '3.3.2.18',
        createdAt: '',
        updatedAt: '',
      },
    ];
    const rows = prepaidReportRows(items, '2026-03', null, chart);
    expect(rows.map((r) => [r.kind, r.amount, r.quota, r.appropriated, r.balance])).toEqual([
      ['item', 1200, 100, 300, 900],
      ['subtotal', 1200, 100, 300, 900],
      ['total', 1200, 100, 300, 900],
    ]);
    expect(generatePrepaidPdf({ client, rows, month: '2026-03' }).fileName).toBe('Despesas_Antecipadas_ALPHA_LTDA_2026-03-31.pdf');
    const xlsx = await generatePrepaidExcel({ client, rows, month: '2026-03' });
    expect(xlsx.fileName).toBe('Despesas_Antecipadas_ALPHA_LTDA_2026-03-31.xlsx');
    expect(xlsx.blob.size).toBeGreaterThan(0);
  });

  it('financiamentos: calcula curto/longo prazo líquidos e gera PDF e Excel', async () => {
    const contract: FinancingContract = {
      id: 'f1',
      kind: 'LOAN',
      description: 'Capital de giro',
      lender: 'Banco X',
      date: '2026-03-01',
      principal: 10000,
      installments: 10,
      installmentAmount: 1100,
      firstDueDate: '2026-04-05',
      interestMode: 'PREFIXED',
      monthlyRate: 1.77,
      counterpartAccountId: acc('1.1.1.04').id,
      counterpartAccountCode: '1.1.1.04',
      shortTermAccountId: acc('2.1.4.01').id,
      shortTermAccountCode: '2.1.4.01',
      longTermAccountId: acc('2.2.1.01').id,
      longTermAccountCode: '2.2.1.01',
      chargesShortAccountId: acc('2.1.4.03').id,
      chargesShortAccountCode: '2.1.4.03',
      chargesLongAccountId: acc('2.2.1.02').id,
      chargesLongAccountCode: '2.2.1.02',
      upfrontExpenseAccountId: acc('3.4.1.01.006').id,
      upfrontExpenseAccountCode: '3.4.1.01.006',
      interestExpenseAccountId: acc('3.4.1.01.005').id,
      interestExpenseAccountCode: '3.4.1.01.005',
      createdAt: '',
      updatedAt: '',
    };
    const rows = financingReportRows([contract], '2026-04');
    expect(rows).toHaveLength(2);
    expect(rows[0].installmentsLabel).toBe('1/10');
    expect(generateFinancingPdf({ client, rows, month: '2026-04' }).fileName).toBe('Financiamentos_ALPHA_LTDA_2026-04-30.pdf');
    const xlsx = await generateFinancingExcel({ client, rows, month: '2026-04' });
    expect(xlsx.fileName).toBe('Financiamentos_ALPHA_LTDA_2026-04-30.xlsx');
    expect(xlsx.blob.size).toBeGreaterThan(0);
  });

  it('aplicações e estoque: gera PDF e Excel', async () => {
    const investments: InvestmentAccount[] = [
      {
        id: 'i1',
        description: 'CDB Banco Inter',
        ledgerAccountId: acc('1.1.1.03').id,
        ledgerAccountCode: '1.1.1.03',
        startMonth: '2026-01',
        balances: { '2026-03': 1050 },
        createdAt: '',
        updatedAt: '',
      },
    ];
    const invRows = investmentReportRows(investments, '2026-03', [
      { ledgerAccountId: acc('1.1.1.03').id, label: 'CDB Banco Inter', informedCents: 105000, ledgerCents: 100000, yieldCents: 5000 },
    ]);
    expect(invRows[1]).toEqual({ kind: 'total', label: 'Total', informed: 1050, ledgerBefore: 1000, yieldAmount: 50 });
    expect(generateInvestmentsPdf({ client, rows: invRows, month: '2026-03' }).fileName).toBe('Aplicacoes_ALPHA_LTDA_2026-03-31.pdf');
    expect((await generateInvestmentsExcel({ client, rows: invRows, month: '2026-03' })).blob.size).toBeGreaterThan(0);

    const control: StockControl = {
      id: 'c',
      clientId: 'c',
      stockAccountId: acc('1.1.3.01').id,
      stockAccountCode: '1.1.3.01',
      stockAccountName: 'Mercadorias para Revenda',
      costAccountId: acc('3.2.1.01').id,
      costAccountCode: '3.2.1.01',
      costAccountName: 'CMV',
      startMonth: '2026-01',
      frequency: 'MONTHLY',
      counts: { '2026-03': 800 },
      updatedAt: '',
    };
    const stockCtx = { client, control, month: '2026-03', figures: { ledgerCents: 200000, countCents: 80000, adjustmentCents: 120000 } };
    expect(generateStockPdf(stockCtx).fileName).toBe('Estoque_CMV_ALPHA_LTDA_2026-03-31.pdf');
    expect((await generateStockExcel(stockCtx)).blob.size).toBeGreaterThan(0);
  });
});
