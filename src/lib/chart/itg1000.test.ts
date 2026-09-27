import { describe, expect, it } from 'vitest';
import { buildITG1000Chart, ITG1000_ACCOUNT_COUNT } from '@/lib/chart/itg1000';
import { resolveDREGroup } from '@/lib/dre/build';

const chart = buildITG1000Chart('c', '2025-01-01T00:00:00.000Z');
const byCode = new Map(chart.map((a) => [a.code, a] as const));

describe('Plano de contas ITG 1000 (2022)', () => {
  it('tem 139 contas, 100 analíticas, códigos únicos e IDs determinísticos', () => {
    expect(chart).toHaveLength(ITG1000_ACCOUNT_COUNT);
    expect(chart).toHaveLength(139);
    expect(chart.filter((a) => a.nature === 'ANALYTIC')).toHaveLength(100);
    expect(new Set(chart.map((a) => a.code)).size).toBe(chart.length);
    expect(buildITG1000Chart('c').map((a) => a.id)).toEqual(chart.map((a) => a.id));
  });

  it('hierarquia íntegra: todo pai existe; sintéticas têm filhos; analíticas são folhas', () => {
    const ids = new Set(chart.map((a) => a.id));
    for (const a of chart) {
      if (a.parentId) expect(ids.has(a.parentId)).toBe(true);
      const hasChildren = chart.some((c) => c.parentId === a.id);
      expect(a.nature === 'SYNTHETIC').toBe(hasChildren);
      expect(a.level).toBe(a.code.split('.').length);
    }
  });

  it('natureza econômica por grupo', () => {
    expect(byCode.get('1.1.1.02')?.type).toBe('ASSET');
    expect(byCode.get('2.1.5.01')?.type).toBe('LIABILITY');
    expect(byCode.get('2.3.1.01')?.type).toBe('EQUITY');
    expect(byCode.get('3.1.1.01')?.type).toBe('REVENUE');
    expect(byCode.get('3.2.1.03')?.type).toBe('COST');
    expect(byCode.get('3.3.2.06')?.type).toBe('EXPENSE');
    expect(byCode.get('3.3.9.01')?.type).toBe('REVENUE'); // outras receitas dentro de 3.3.9
  });

  it('toda conta analítica de resultado está amarrada a um grupo da DRE; patrimoniais não', () => {
    const expected: Record<string, string> = {
      '3.1.1': 'GROSS_REVENUE',
      '3.1.2': 'DEDUCTIONS',
      '3.2': 'COSTS',
      '3.3.1': 'OPERATING_EXPENSES',
      '3.3.2': 'OPERATING_EXPENSES',
      '3.4.1.01': 'FINANCIAL_EXPENSES',
      '3.4.1.02': 'FINANCIAL_INCOME',
    };
    for (const a of chart.filter((x) => x.nature === 'ANALYTIC')) {
      const group = resolveDREGroup(a);
      if (a.code.startsWith('1') || a.code.startsWith('2')) {
        expect(group, a.code).toBeNull();
        continue;
      }
      const prefix = Object.keys(expected).find((p) => a.code.startsWith(`${p}.`));
      if (prefix) expect(group, a.code).toBe(expected[prefix]);
      else expect(['OTHER_INCOME', 'OTHER_EXPENSES'], a.code).toContain(group);
    }
  });

  it('marca as contas redutoras', () => {
    for (const code of ['1.1.2.02', '1.2.3.07', '1.2.4.03', '2.3.1.02', '2.3.3.02', '3.1.2.01']) {
      expect(byCode.get(code)?.isContra, code).toBe(true);
    }
    expect(byCode.get('3.1.1.01')?.isContra).toBeUndefined();
  });
});
