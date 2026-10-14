import { describe, expect, it } from 'vitest';
import { buildITG1000Chart, ITG1000_ACCOUNT_COUNT, missingTemplateAccounts, withMissingParents } from '@/lib/chart/itg1000';
import { resolveDREGroup } from '@/lib/dre/build';
import { accountKind } from '@/lib/ledger';

const chart = buildITG1000Chart('c', '2025-01-01T00:00:00.000Z');
const byCode = new Map(chart.map((a) => [a.code, a] as const));

describe('Modelo de plano de contas do CFC (NBC TG 1002)', () => {
  it('tem 148 contas, 106 analíticas, códigos únicos e IDs determinísticos', () => {
    expect(chart).toHaveLength(ITG1000_ACCOUNT_COUNT);
    expect(chart).toHaveLength(148);
    expect(chart.filter((a) => a.nature === 'ANALYTIC')).toHaveLength(106);
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

  it('IBS e CBS a recolher são obrigações fiscais analíticas', () => {
    for (const [code, name] of [['2.1.5.06', 'IBS a Recolher'], ['2.1.5.07', 'CBS a Recolher']]) {
      const acc = byCode.get(code);
      expect(acc?.name, code).toBe(name);
      expect(acc?.type, code).toBe('LIABILITY');
      expect(acc?.nature, code).toBe('ANALYTIC');
      expect(acc?.parentId, code).toBe(byCode.get('2.1.5')?.id);
    }
  });

  it('ARE é conta de resultado analítica, fora dos grupos da DRE e fora do grupo 3', () => {
    const are = byCode.get('5.1.1.01');
    expect(are?.nature).toBe('ANALYTIC');
    expect(are?.dreGroup).toBeUndefined();
    expect(are && accountKind(are)).toBe('RESULT');
    // Nenhum totalizador de receitas e despesas (grupo 3) a soma.
    const ancestors: string[] = [];
    for (let p = are?.parentId; p; p = chart.find((a) => a.id === p)?.parentId) ancestors.push(chart.find((a) => a.id === p)!.code);
    expect(ancestors).toEqual(['5.1.1', '5.1', '5']);
  });

  it('IBS e CBS a recuperar são créditos analíticos do ativo circulante', () => {
    for (const [code, name] of [['1.1.2.07', 'IBS a Recuperar'], ['1.1.2.08', 'CBS a Recuperar']]) {
      expect(byCode.get(code)).toMatchObject({ name, type: 'ASSET', nature: 'ANALYTIC', parentId: byCode.get('1.1.2')?.id });
    }
  });

  it('completar só as contas escolhidas: os grupos que faltam entram junto', () => {
    const missing = missingTemplateAccounts('c', chart.filter((a) => !a.code.startsWith('5')));
    expect([...withMissingParents(['5.1.1.01'], missing)].sort()).toEqual(['5', '5.1', '5.1.1', '5.1.1.01']);
    expect([...withMissingParents(['1.1.2.07'], missing)]).toEqual([]);
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
      // ARE (grupo 5): só recebe o encerramento, que fica fora da DRE.
      if (a.code.startsWith('5')) continue;
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

  it('completar um plano em uso: só as que faltam, penduradas no pai que o cliente já tem', () => {
    // Plano antigo, sem IBS/CBS, com o grupo 2.1.5 criado à mão (outro ID).
    const old = chart
      .filter((a) => !['2.1.5.06', '2.1.5.07'].includes(a.code))
      .map((a) => (a.code === '2.1.5' ? { ...a, id: 'manual-2.1.5' } : a));
    const missing = missingTemplateAccounts('c', old);
    expect(missing.map((a) => a.code)).toEqual(['2.1.5.06', '2.1.5.07']);
    expect(missing.every((a) => a.parentId === 'manual-2.1.5')).toBe(true);
    expect(missingTemplateAccounts('c', chart)).toEqual([]);
    expect(missingTemplateAccounts('c', [])).toHaveLength(chart.length);
  });

  it('marca as contas redutoras', () => {
    for (const code of ['1.1.2.02', '1.2.3.07', '1.2.4.03', '2.3.1.02', '2.3.3.02', '3.1.2.01']) {
      expect(byCode.get(code)?.isContra, code).toBe(true);
    }
    expect(byCode.get('3.1.1.01')?.isContra).toBeUndefined();
  });
});
