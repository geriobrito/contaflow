import { describe, expect, it } from 'vitest';
import type { BalanceSheet, BalanceSheetLine } from '@/lib/ledger';
import { VIRTUAL } from '@/lib/ledger';
import type { DREStatement } from '@/lib/dre/build';
import { balanceGroups, buildFinancialAnalysis, formatIndicator } from '@/lib/financial-indicators';

const line = (code: string, value: number, synthetic = false, accountId = code): BalanceSheetLine => ({
  accountId,
  code,
  name: code,
  level: code.split('.').length,
  synthetic,
  value,
});

/** AC 1.000 (caixa 300, clientes 400, estoques 300); RLP 100; imobilizado 900; PC 500; PNC 300; PL 1.200. */
function sheet(date = '2025-12-31', extra: Partial<BalanceSheet> = {}): BalanceSheet {
  return {
    date,
    assets: [
      line('1', 2000, true),
      line('1.1', 1000, true),
      line('1.1.1', 300, true),
      line('1.1.1.02', 300),
      line('1.1.2.01', 400),
      line('1.1.3.01', 300),
      line('1.2', 1000, true),
      line('1.2.1.01', 100),
      line('1.2.3.03', 1000),
      line('1.2.3.07', -100),
    ],
    liabilities: [line('2.1', 500, true), line('2.1.1.01', 500), line('2.2.1.01', 300)],
    equity: [line('2.3.1.01', 1000), line('', 200, false, VIRTUAL.CURRENT_RESULT)],
    totalAssets: 2000,
    totalLiabilities: 800,
    totalEquity: 1200,
    difference: 0,
    suspense: 0,
    unlinkedBanks: 0,
    ...extra,
  };
}

const dre = (netRevenue: number, grossProfit: number, operatingExpenses: number, netResult: number): DREStatement =>
  ({ netRevenue, grossProfit, operatingExpenses, otherResult: 0, netResult } as DREStatement);

describe('análise das demonstrações', () => {
  it('soma os grupos pelos códigos do modelo do CFC (folhas só, retificadoras reduzindo)', () => {
    expect(balanceGroups(sheet())).toMatchObject({
      currentAssets: 1000,
      cash: 300,
      inventories: 300,
      longTermReceivables: 100,
      fixedLike: 900,
      currentLiabilities: 500,
      nonCurrentLiabilities: 300,
      equity: 1200,
      unmapped: 0,
    });
  });

  it('calcula liquidez, endividamento e rentabilidade', () => {
    const a = buildFinancialAnalysis({ balanceSheet: sheet(), dre: dre(4000, 1600, 1200, 200) });
    const v = Object.fromEntries(a.indicators.map((i) => [i.key, i.value]));
    expect(v.current).toBeCloseTo(2);
    expect(v.quick).toBeCloseTo(1.4);
    expect(v.immediate).toBeCloseTo(0.6);
    expect(v.general).toBeCloseTo(1100 / 800);
    expect(v.workingCapital).toBe(500);
    expect(v.debtRatio).toBeCloseTo(40);
    expect(v.debtComposition).toBeCloseTo(62.5);
    expect(v.leverage).toBeCloseTo(66.67, 1);
    expect(v.fixedOnEquity).toBeCloseTo(75);
    expect(v.grossMargin).toBeCloseTo(40);
    expect(v.operatingMargin).toBeCloseTo(10);
    expect(v.netMargin).toBeCloseTo(5);
    expect(v.roa).toBeCloseTo(10);
    expect(v.roe).toBeCloseTo(16.67, 1);
    expect(v.assetTurnover).toBeCloseTo(2);
    expect(a.indicators.find((i) => i.key === 'current')?.tone).toBe('good');
    expect(a.warnings).toEqual([]);
  });

  it('põe o exercício anterior ao lado', () => {
    const prev = sheet('2024-12-31', { totalAssets: 2000 });
    const a = buildFinancialAnalysis({ balanceSheet: sheet(), dre: null, previous: { balanceSheet: prev, dre: dre(1000, 500, 400, 100) } });
    const netMargin = a.indicators.find((i) => i.key === 'netMargin')!;
    expect(netMargin.value).toBeNull();
    expect(netMargin.previous).toBeCloseTo(10);
    expect(a.previousDate).toBe('2024-12-31');
  });

  it('sem denominador o índice fica vazio, e PL negativo não gera ROE', () => {
    const negative = sheet('2025-12-31', { equity: [line('2.3.1.01', -300)], totalEquity: -300, liabilities: [], totalLiabilities: 0 });
    const a = buildFinancialAnalysis({ balanceSheet: negative, dre: dre(0, 0, 0, -50) });
    const v = Object.fromEntries(a.indicators.map((i) => [i.key, i.value]));
    expect(v.current).toBeNull();
    expect(v.roe).toBeNull();
    expect(v.netMargin).toBeNull();
    expect(a.warnings.some((w) => w.includes('negativo'))).toBe(true);
  });

  it('avisa quando o plano foge do modelo, há pendências ou o exercício é parcial', () => {
    const offModel = sheet('2025-06-30', {
      assets: [line('9.9', 2000), line('', 50, false, VIRTUAL.SUSPENSE)],
      liabilities: [line('8.8', 800)],
    });
    const a = buildFinancialAnalysis({ balanceSheet: offModel, dre: dre(100, 50, 10, 40), monthsInExercise: 6 });
    expect(a.warnings).toHaveLength(3);
    expect(a.warnings[0]).toMatch(/modelo do CFC/);
    expect(a.warnings[1]).toMatch(/a classificar/);
    expect(a.warnings[2]).toMatch(/6 meses/);
  });

  it('formata cada tipo de índice', () => {
    expect(formatIndicator(1.2345, 'ratio')).toBe('1,23');
    expect(formatIndicator(12.345, 'percent')).toBe('12,3%');
    expect(formatIndicator(null, 'ratio')).toBe('—');
    expect(formatIndicator(1500, 'currency')).toMatch(/1\.500,00/);
  });
});
