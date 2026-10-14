import { describe, expect, it } from 'vitest';
import { draftsToSplits, grossNetDrafts, grossOriginsFor, retentionPresetsFor, splitsToDrafts, summarizeSplits, toCents, type SplitDraft } from '@/lib/splits';
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

describe('bruto × líquido (linhas redutoras)', () => {
  const reducing = (code: string, cents: number, memo = ''): SplitDraft => ({ ...draft(code, cents, memo), reduces: true });

  it('recebimento líquido: receita pelo bruto, retenções e taxa subtraindo', () => {
    // NF de 1.000,00: IRRF 15,00, ISS 50,00 e taxa de 20,35 → 914,65 no extrato.
    const drafts = [draft('3.1.1.01', 100_000), reducing('1.1.2.05', 1_500), reducing('3.1.2.03', 5_000), reducing('3.4.1.01.002', 2_035)];
    const s = summarizeSplits(914.65, drafts, byId);
    expect(s).toMatchObject({ allocatedCents: 91_465, remainingCents: 0, isBalanced: true, isComplete: true });
    const splits = draftsToSplits({ amount: 914.65 }, drafts, byId);
    expect(splits.map((x) => x.amount)).toEqual([1000, -15, -50, -20.35]);
    expect(toCents(splits.reduce((sum, x) => sum + x.amount, 0))).toBe(91_465);
    // Volta ao editor com as redutoras marcadas.
    expect(splitsToDrafts(splits, 914.65).map((d) => [d.cents, Boolean(d.reduces)])).toEqual([
      [100_000, false],
      [1_500, true],
      [5_000, true],
      [2_035, true],
    ]);
  });

  it('pagamento líquido: despesa pelo bruto e imposto retido a recolher', () => {
    const drafts = [draft('3.3.2.11', 100_000), reducing('2.1.5.04', 1_500)];
    const splits = draftsToSplits({ amount: -985 }, drafts, byId);
    expect(splits.map((x) => x.amount)).toEqual([-1000, 15]);
    expect(summarizeSplits(-985, drafts, byId).isBalanced).toBe(true);
  });

  it('precisa de uma linha que soma', () => {
    expect(summarizeSplits(10, [reducing('1.1.2.05', 500), reducing('3.1.2.03', 500)], byId).errors.join(' ')).toMatch(/valor bruto/);
  });

  it('monta o rateio a partir do líquido e das retenções', () => {
    const drafts = grossNetDrafts({
      transactionAmount: 914.65,
      grossAccountId: id('3.1.1.01'),
      retentions: [
        { accountId: id('1.1.2.05'), memo: 'IRRF', cents: 1_500 },
        { accountId: id('3.1.2.03'), memo: 'ISS', cents: 5_000 },
        { accountId: id('3.4.1.01.002'), memo: 'Taxa', cents: 2_035 },
        { accountId: id('1.1.2.05'), memo: 'Sem valor', cents: 0 },
      ],
    });
    expect(drafts.map((d) => [d.cents, Boolean(d.reduces)])).toEqual([
      [100_000, false],
      [1_500, true],
      [5_000, true],
      [2_035, true],
    ]);
    expect(summarizeSplits(914.65, drafts, byId).isBalanced).toBe(true);
  });

  it('retenções sugeridas existem no modelo de plano de contas, conforme a direção', () => {
    for (const p of [...retentionPresetsFor(100), ...retentionPresetsFor(-100)]) {
      for (const o of p.options) expect(byId.get(id(o.code))?.nature, o.code).toBe('ANALYTIC');
    }
    expect(retentionPresetsFor(-1).every((p) => p.options.every((o) => o.code.startsWith('2.')))).toBe(true);
    expect(retentionPresetsFor(1).some((p) => p.options[0].code === '1.1.2.05')).toBe(true);
  });

  it('ISS retido no recebimento abate o imposto a recolher ou vira crédito, nunca uma segunda dedução da receita', () => {
    const iss = retentionPresetsFor(1).find((p) => p.key === 'iss')!;
    expect(iss.options.map((o) => o.code)).toEqual(['2.1.5.03', '2.1.5.01', '1.1.2.05']);
    expect(iss.options.some((o) => o.code.startsWith('3.'))).toBe(false);
  });

  it('valor bruto: à vista na receita/despesa, ou baixa de Clientes/Fornecedores sem repetir o resultado', () => {
    expect(grossOriginsFor(100).find((o) => o.key === 'settle')?.code).toBe('1.1.2.01');
    expect(grossOriginsFor(-100).find((o) => o.key === 'settle')?.code).toBe('2.1.2.01');
    for (const o of [...grossOriginsFor(1), ...grossOriginsFor(-1)]) if (o.code) expect(byId.get(id(o.code))?.nature).toBe('ANALYTIC');
    // Baixa de cliente com retenções: Clientes pelo bruto, nada na receita.
    const drafts = grossNetDrafts({ transactionAmount: 985, grossAccountId: id('1.1.2.01'), retentions: [{ accountId: id('1.1.2.05'), memo: 'IRRF', cents: 1_500 }] });
    expect(draftsToSplits({ amount: 985 }, drafts, byId).map((s) => [s.accountCode, s.amount])).toEqual([
      ['1.1.2.01', 1000],
      ['1.1.2.05', -15],
    ]);
  });
});
