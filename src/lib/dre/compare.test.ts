import { describe, expect, it } from 'vitest';
import type { BankTransaction } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { buildDRE } from '@/lib/dre/build';
import { compareRows, monthlyColumns, previousYearRange, variation } from '@/lib/dre/compare';

const chart = buildITG1000Chart('c');
let n = 0;
const tx = (date: string, amount: number, code: string): BankTransaction => ({
  id: `t${++n}`,
  clientId: 'c',
  fitid: `f${n}`,
  date,
  amount,
  type: amount < 0 ? 'DEBIT' : 'CREDIT',
  memo: 'x',
  status: 'RECONCILED',
  accountId: `c_itg22_${code}`,
  createdAt: '',
});

const txs = [tx('2025-01-10', 1000, '3.1.1.01'), tx('2025-02-10', 1500, '3.1.1.01'), tx('2025-02-15', -300, '3.3.2.07'), tx('2024-02-10', 1200, '3.1.1.01')];

describe('DRE comparativa', () => {
  it('colunas mês a mês somam o período', () => {
    const cols = monthlyColumns(txs, chart, { start: '2025-01-01', end: '2025-03-31' });
    expect(cols.map((c) => [c.label, c.statement.netResult])).toEqual([
      ['jan/25', 1000],
      ['fev/25', 1200],
      ['mar/25', 0],
    ]);
    expect(cols[1].range).toEqual({ start: '2025-02-01', end: '2025-02-28' });
  });

  it('mesmo período do ano anterior (29/02 → 28/02)', () => {
    expect(previousYearRange({ start: '2024-02-01', end: '2024-02-29' })).toEqual({ start: '2023-02-01', end: '2023-02-28' });
  });

  it('variação percentual sobre o valor absoluto anterior', () => {
    expect(variation(1500, 1200)).toBeCloseTo(25);
    expect(variation(-50, -100)).toBeCloseTo(50);
    expect(variation(10, 0)).toBeNull();
  });

  it('linhas: grupos com movimento, contas de cada grupo e totais', () => {
    const cur = buildDRE(txs, chart, { start: '2025-02-01', end: '2025-02-28' });
    const prev = buildDRE(txs, chart, { start: '2024-02-01', end: '2024-02-29' });
    const rows = compareRows([cur, prev]);
    const get = (id: string) => rows.find((r) => r.id === id)!;
    expect(get('gross').values).toEqual([1500, 1200]);
    expect(get('opex').values).toEqual([300, 0]);
    expect(get('result').values).toEqual([1200, 1200]);
    expect(rows.find((r) => r.id === 'costs')).toBeUndefined();
    expect(rows.filter((r) => r.kind === 'account').map((r) => r.code)).toEqual(['3.1.1.01', '3.3.2.07']);
  });
});
