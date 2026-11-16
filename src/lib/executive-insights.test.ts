import { describe, expect, it } from 'vitest';
import type { BankTransaction } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { buildExecutiveSummary } from '@/lib/executive-metrics';
import { executiveInsights } from '@/lib/executive-insights';

const chart = buildITG1000Chart('c');
const idByCode = (code: string) => chart.find((a) => a.code === code)!.id;

let seq = 0;
const tx = (date: string, amount: number, code: string): BankTransaction => ({
  id: `tx_${++seq}`,
  clientId: 'c',
  fitid: `f_${seq}`,
  date,
  amount,
  type: amount >= 0 ? 'CREDIT' : 'DEBIT',
  memo: 'Lançamento teste',
  accountId: idByCode(code),
  status: 'RECONCILED',
  createdAt: '',
});

/** A moeda sai com espaço não separável (U+00A0) depois do "R$": as frases são comparadas com espaço comum. */
const plain = (texts: string[]) => texts.map((t) => t.replace(/ /g, ' '));

const summaryOf = (transactions: BankTransaction[]) => buildExecutiveSummary({ transactions, accounts: chart, referenceDate: '2025-06-15' });

describe('leitura do período na visão executiva', () => {
  it('sem movimento, não afirma nada', () => {
    expect(executiveInsights(summaryOf([]))).toEqual([]);
  });

  it('conta o crescimento, o que sobra, o melhor e o pior mês, o prejuízo e o maior gasto', () => {
    const transactions = [
      tx('2024-03-15', 10000, '3.1.1.01'), // ano anterior
      tx('2025-01-10', 12000, '3.1.1.01'),
      tx('2025-01-20', -4000, '3.2.1.01'),
      tx('2025-02-10', 3000, '3.1.1.01'),
      tx('2025-02-20', -5000, '3.3.2.01'), // fevereiro no prejuízo
    ];
    expect(plain(executiveInsights(summaryOf(transactions)))).toEqual([
      'O faturamento cresceu 50,0% frente a jul/23 a jun/24 (de R$ 10.000,00 para R$ 15.000,00).',
      'De cada R$ 100 de receita líquida, sobraram R$ 40,00 de resultado.',
      'Melhor mês: jan/25, com resultado de R$ 8.000,00. Pior: fev/25, com -R$ 2.000,00.',
      '1 de 2 meses com movimento fechou com prejuízo: fev/25.',
      'Maior gasto: Salários e Ordenados, com R$ 5.000,00 (56% dos custos e despesas).',
      'Do total que saiu, 56% foram as despesas operacionais.',
    ]);
  });

  it('sem ano anterior para comparar, não fala em crescimento', () => {
    const insights = plain(executiveInsights(summaryOf([tx('2025-01-10', 12000, '3.1.1.01')])));
    expect(insights.some((t) => t.includes('faturamento'))).toBe(false);
    expect(insights[0]).toBe('De cada R$ 100 de receita líquida, sobraram R$ 100,00 de resultado.');
  });
});
