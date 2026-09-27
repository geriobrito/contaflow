import { describe, expect, it } from 'vitest';
import { draftsToSplits, splitsToDrafts, summarizeSplits, toCents, type SplitDraft } from '@/lib/splits';
import { buildITG1000Chart } from '@/lib/chart/itg1000';

const accounts = buildITG1000Chart('c', 'x');
const byId = new Map(accounts.map((a) => [a.id, a] as const));
const id = (code: string) => `c_itg22_${code}`;
const draft = (code: string, cents: number, memo = ''): SplitDraft => ({ id: code + cents, accountId: id(code), memo, cents });

describe('summarizeSplits', () => {
  const invoice = -802.66;

  it('fecha exatamente no valor da fatura', () => {
    const s = summarizeSplits(invoice, [draft('3.2.1.02', 45_010), draft('3.3.2.12', 3_490), draft('2.3.3.03', 31_766)], byId);
    expect(s.totalCents).toBe(80_266);
    expect(s.remainingCents).toBe(0);
    expect(s.isBalanced).toBe(true);
    expect(s.isComplete).toBe(true);
  });

  it('recusa diferença de 1 centavo e de R$ 5,00', () => {
    expect(summarizeSplits(invoice, [draft('3.2.1.02', 45_010), draft('3.3.2.12', 35_255)], byId).isBalanced).toBe(false);
    expect(summarizeSplits(invoice, [draft('3.2.1.02', 45_010), draft('3.3.2.12', 35_756)], byId).isBalanced).toBe(false);
  });

  it('não sofre com erro de ponto flutuante (0,1 + 0,2)', () => {
    const s = summarizeSplits(-0.3, [draft('3.3.2.06', 10), draft('3.3.2.08', 20)], byId);
    expect(s.isBalanced).toBe(true);
  });

  it('valida linhas: mínimo de duas, conta obrigatória e analítica, valor positivo', () => {
    expect(summarizeSplits(-10, [draft('3.3.2.06', 1_000)], byId).errors).toContain('Um rateio precisa de pelo menos duas linhas.');
    const s = summarizeSplits(-10, [{ id: 'a', accountId: '', memo: '', cents: 500 }, draft('3.3.2', 0)], byId);
    expect(s.isComplete).toBe(false);
    expect(s.errors.join(' ')).toMatch(/selecione a conta/);
    expect(s.errors.join(' ')).toMatch(/sintética/);
    expect(s.errors.join(' ')).toMatch(/maior que zero/);
  });
});

describe('draftsToSplits / splitsToDrafts', () => {
  it('aplica o sinal do lançamento e a soma reproduz o valor original', () => {
    const drafts = [draft('3.2.1.02', 45_010, 'tecidos'), draft('3.3.2.12', 35_256, 'canva')];
    const splits = draftsToSplits({ amount: -802.66 }, drafts, byId);
    expect(splits.every((s) => s.amount < 0)).toBe(true);
    expect(toCents(splits.reduce((sum, s) => sum + s.amount, 0))).toBe(-80_266);
    expect(splits[0]).toMatchObject({ accountCode: '3.2.1.02', memo: 'tecidos' });
    expect(splitsToDrafts(splits).map((d) => d.cents)).toEqual([45_010, 35_256]);
  });

  it('mantém sinal positivo para créditos', () => {
    const splits = draftsToSplits({ amount: 100 }, [draft('3.1.1.01', 6_000), draft('3.1.1.02', 4_000)], byId);
    expect(splits.map((s) => s.amount)).toEqual([60, 40]);
  });
});
