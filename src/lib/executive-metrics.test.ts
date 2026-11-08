import { describe, expect, it } from 'vitest';
import type { BankTransaction, JournalEntry } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { buildExecutiveSummary } from '@/lib/executive-metrics';

const chart = buildITG1000Chart('c');
const idByCode = (code: string) => chart.find((a) => a.code === code)!.id;

let seq = 0;
function makeTx(date: string, amount: number, accountCode: string, status: BankTransaction['status'] = 'RECONCILED'): BankTransaction {
  return {
    id: `tx_${++seq}`,
    clientId: 'c',
    fitid: `f_${seq}`,
    date,
    amount,
    type: amount >= 0 ? 'CREDIT' : 'DEBIT',
    memo: 'Lançamento teste',
    accountId: idByCode(accountCode),
    status,
    createdAt: '',
  };
}

describe('buildExecutiveSummary', () => {
  it('consolida 12 meses móveis, calcula variação YoY, margem líquida, EBITDA e composição de gastos', () => {
    const transactions: BankTransaction[] = [
      // Período anterior (YoY): mar/2024
      makeTx('2024-03-15', 10000, '3.1.1.01'), // Receita de Vendas
      // Período de 12 meses (jul/2024 a jun/2025)
      makeTx('2025-01-10', 12000, '3.1.1.01'), // Receita Bruta
      makeTx('2025-01-15', -1000, '3.1.2.05'), // Simples Nacional (Dedução)
      makeTx('2025-01-20', -4000, '3.2.1.01'), // CMV (Custo)
      makeTx('2025-01-25', -2000, '3.3.2.01'), // Salários (Despesa operacional)
      makeTx('2025-01-28', -500, '3.4.1.01.002'), // Tarifas bancárias (Despesa financeira)
      makeTx('2025-06-10', 8000, '3.1.1.02'), // Receita de Serviços
    ];

    const journalEntries: JournalEntry[] = [
      {
        id: 'j1',
        clientId: 'c',
        entryNumber: 1,
        date: '2025-01-31',
        memo: 'Depreciação mensal',
        category: 'DEPRECIATION',
        totalAmount: 300,
        lines: [
          { id: 'l1', accountId: idByCode('3.3.2.15'), type: 'DEBIT', amount: 300 }, // Depreciação e Amortização
          { id: 'l2', accountId: idByCode('1.2.3.07'), type: 'CREDIT', amount: 300 },
        ],
        createdAt: '',
        updatedAt: '',
        createdByUid: 'u',
      },
    ];

    const summary = buildExecutiveSummary({
      transactions,
      accounts: chart,
      journalEntries,
      referenceDate: '2025-06-15',
    });

    expect(summary.range).toEqual({ start: '2024-07-01', end: '2025-06-30' });
    expect(summary.periodLabel).toBe('jul/24 a jun/25');
    expect(summary.monthly).toHaveLength(12);
    expect(summary.twelveMonthsGrossRevenue).toBe(20000);
    // YoY: 20.000 vs 10.000 = +100%
    expect(summary.twelveMonthsGrossRevenueVariation).toBeCloseTo(100, 2);
    expect(summary.twelveMonthsNetRevenue).toBe(19000);
    // Resultado líquido: 19.000 (rec. líq) - 4.000 (custo) - 2.300 (desp. op + deprec) - 500 (fin) = 12.200
    expect(summary.twelveMonthsNetResult).toBe(12200);
    // EBITDA: (19.000 - 4.000 - 2.300) + 300 (depreciação) = 13.000
    expect(summary.twelveMonthsEbitda).toBe(13000);

    // Composição de custos e despesas
    expect(summary.costComposition.costs).toBe(4000);
    expect(summary.costComposition.operatingExpenses).toBe(2300);
    expect(summary.costComposition.financialExpenses).toBe(500);
    expect(summary.costComposition.taxes).toBe(1000);
    expect(summary.costComposition.total).toBe(7800);
    expect(
      summary.costComposition.costsPct +
        summary.costComposition.operatingExpensesPct +
        summary.costComposition.financialExpensesPct +
        summary.costComposition.taxesPct
    ).toBeCloseTo(100, 4);
  });

  it('lida com lista vazia de lançamentos sem divisão por zero', () => {
    const summary = buildExecutiveSummary({
      transactions: [],
      accounts: chart,
      referenceDate: '2025-12-31',
    });

    expect(summary.monthly).toHaveLength(12);
    expect(summary.twelveMonthsGrossRevenue).toBe(0);
    expect(summary.twelveMonthsGrossRevenueVariation).toBeNull();
    expect(summary.twelveMonthsNetMargin).toBe(0);
    expect(summary.costComposition.total).toBe(0);
    expect(summary.costComposition.costsPct).toBe(0);
  });
});
