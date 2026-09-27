import { describe, expect, it } from 'vitest';
import { buildDRE, periodRange, resolveDREGroup } from '@/lib/dre/build';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import type { BankTransaction, ChartAccount } from '@/types/firestore';

const CLIENT = 'c1';
const accounts = buildITG1000Chart(CLIENT, '2025-01-01T00:00:00.000Z');
const id = (code: string) => `${CLIENT}_itg22_${code}`;
const YEAR = { start: '2025-01-01', end: '2025-12-31' };

let seq = 0;
function tx(code: string | null, amount: number, extra: Partial<BankTransaction> = {}): BankTransaction {
  seq += 1;
  return {
    id: `t${seq}`,
    clientId: CLIENT,
    fitid: `f${seq}`,
    date: '2025-03-10',
    amount,
    type: amount < 0 ? 'DEBIT' : 'CREDIT',
    memo: 'x',
    status: 'RECONCILED',
    createdAt: '',
    ...(code ? { accountId: id(code) } : {}),
    ...extra,
  };
}

describe('buildDRE', () => {
  it('monta a cascata da DRE com os grupos da ITG 1000', () => {
    const d = buildDRE(
      [
        tx('3.1.1.01', 10_000), // receita de serviços
        tx('3.1.2.01', -600), // (-) Simples Nacional
        tx('3.2.1.03', -2_000), // custo dos serviços
        tx('3.3.2.06', -300), // energia (adm)
        tx('3.3.1.02', -200), // propaganda (vendas)
        tx('3.4.1.02.001', 90), // rendimento de aplicação
        tx('3.4.1.01.002', -40), // tarifa bancária
        tx('3.3.9.01', 150), // outras receitas
        tx('3.3.9.03', -50), // outras despesas
      ],
      accounts,
      YEAR
    );

    expect(d.grossRevenue).toBe(10_000);
    expect(d.deductions).toBe(600);
    expect(d.netRevenue).toBe(9_400);
    expect(d.costs).toBe(2_000);
    expect(d.grossProfit).toBe(7_400);
    expect(d.operatingExpenses).toBe(500);
    expect(d.financialResult).toBe(50);
    expect(d.otherResult).toBe(100);
    expect(d.netResult).toBe(7_050);
    expect(d.netMargin).toBeCloseTo((7_050 / 9_400) * 100, 6);
    expect(d.reconciledCount).toBe(9);
  });

  it('ignora pendentes e conta auto-classificados como aguardando aprovação', () => {
    const d = buildDRE(
      [tx('3.1.1.01', 1_000), tx('3.1.1.01', 500, { status: 'AUTO_CLASSIFIED' }), tx(null, -80, { status: 'PENDING' })],
      accounts,
      YEAR
    );
    expect(d.grossRevenue).toBe(1_000);
    expect(d.awaitingApproval).toBe(1);
    expect(d.reconciledCount).toBe(1);
  });

  it('respeita o período (limites inclusivos)', () => {
    const d = buildDRE(
      [
        tx('3.1.1.01', 100, { date: '2024-12-31' }),
        tx('3.1.1.01', 200, { date: '2025-01-01' }),
        tx('3.1.1.01', 300, { date: '2025-12-31' }),
        tx('3.1.1.01', 400, { date: '2026-01-01' }),
      ],
      accounts,
      YEAR
    );
    expect(d.grossRevenue).toBe(500);
  });

  it('um estorno numa conta de despesa reduz a despesa', () => {
    const d = buildDRE([tx('3.3.2.06', -300), tx('3.3.2.06', 100)], accounts, YEAR);
    expect(d.operatingExpenses).toBe(200);
  });

  it('contas patrimoniais não transitam pela DRE', () => {
    const d = buildDRE([tx('1.1.1.02', 5_000), tx('2.3.3.03', -1_000)], accounts, YEAR);
    expect(d.netResult).toBe(0);
    expect(d.reconciledCount).toBe(0);
  });

  it('lançamento rateado entra conta a conta; parte patrimonial fica fora', () => {
    const split = tx(null, -450, {
      isSplit: true,
      splits: [
        { id: 's1', accountId: id('3.2.1.03'), amount: -300, memo: 'hospedagem' },
        { id: 's2', accountId: id('3.3.2.12'), amount: -49.9, memo: 'canva' },
        { id: 's3', accountId: id('2.3.3.03'), amount: -100.1, memo: 'pessoal' },
      ],
    });
    const d = buildDRE([split], accounts, YEAR);
    expect(d.costs).toBe(300);
    expect(d.operatingExpenses).toBeCloseTo(49.9, 10);
    expect(d.netResult).toBeCloseTo(-349.9, 10);
    expect(d.reconciledCount).toBe(1);
  });

  it('aceita contas com grupos legados em português', () => {
    const legacy: ChartAccount = {
      id: 'legacy',
      clientId: CLIENT,
      code: '9.9',
      name: 'Tarifa (legado)',
      type: 'EXPENSE',
      nature: 'ANALYTIC',
      level: 2,
      dreGroup: 'DESPESAS_FINANCEIRAS',
      createdAt: '',
      updatedAt: '',
    };
    expect(resolveDREGroup(legacy)).toBe('FINANCIAL_EXPENSES');
    const d = buildDRE([{ ...tx(null, -20), accountId: 'legacy' }], [...accounts, legacy], YEAR);
    expect(d.financialResult).toBe(-20);
  });
});

describe('periodRange', () => {
  it('gera mês, trimestre e ano com o último dia correto', () => {
    expect(periodRange('month', 2024, 2)).toEqual({ start: '2024-02-01', end: '2024-02-29' }); // bissexto
    expect(periodRange('month', 2025, 2)).toEqual({ start: '2025-02-01', end: '2025-02-28' });
    expect(periodRange('quarter', 2025, 4)).toEqual({ start: '2025-10-01', end: '2025-12-31' });
    expect(periodRange('year', 2025, 1)).toEqual({ start: '2025-01-01', end: '2025-12-31' });
  });
});
