import { describe, expect, it } from 'vitest';
import {
  conditionFields,
  conditionLabels,
  detectRuleConflicts,
  findMatchingRule,
  findRuleCandidates,
  keyOfRule,
  countAffected,
  pendingWonByRule,
  ruleApplies,
  ruleConditions,
  ruleKey,
  sharedDirection,
} from '@/lib/reconciliation';
import { planRuleCopy } from '@/lib/rule-copy';
import { suggestRules } from '@/lib/rule-suggestions';
import type { BankTransaction, ChartAccount, ClassificationRule } from '@/types/firestore';

const rule = (id: string, pattern: string, extra: Partial<ClassificationRule> = {}): ClassificationRule => ({
  id,
  clientId: 'c1',
  pattern,
  accountId: `acc-${id}`,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...extra,
});

let seq = 0;
const tx = (memo: string, amount: number, extra: Partial<BankTransaction> = {}): BankTransaction => ({
  id: `t${++seq}`,
  clientId: 'c1',
  fitid: `f${seq}`,
  date: '2026-03-10',
  amount,
  type: amount < 0 ? 'DEBIT' : 'CREDIT',
  memo,
  status: 'PENDING',
  createdAt: '',
  ...extra,
});

describe('condições da regra', () => {
  it('sentido: a regra de saídas não vale para a entrada do mesmo favorecido', () => {
    const out = rule('out', 'joao silva', { direction: 'OUT' });
    expect(ruleApplies({ memo: 'PIX ENVIADO - JOAO SILVA', amount: -500 }, out)).toBe(true);
    expect(ruleApplies({ memo: 'PIX RECEBIDO - JOAO SILVA', amount: 500 }, out)).toBe(false);
    // Sem o valor não há como saber o sentido: a condição não é atendida.
    expect(ruleApplies({ memo: 'PIX JOAO SILVA' }, out)).toBe(false);
    expect(ruleApplies({ memo: 'PIX JOAO SILVA' }, rule('any', 'joao silva'))).toBe(true);
  });

  it('conta bancária e faixa do valor absoluto', () => {
    const bank = rule('b', 'tarifa', { bankAccountKey: '341-0001-123' });
    expect(ruleApplies({ memo: 'TARIFA PACOTE', amount: -30, accountKey: '341-0001-123' }, bank)).toBe(true);
    expect(ruleApplies({ memo: 'TARIFA PACOTE', amount: -30, accountKey: '260-0001-9' }, bank)).toBe(false);
    expect(ruleApplies({ memo: 'TARIFA PACOTE', amount: -30 }, bank)).toBe(false);

    const range = rule('r', 'mercado', { minAmount: 100, maxAmount: 500 });
    expect(ruleApplies({ memo: 'MERCADO X', amount: -100 }, range)).toBe(true);
    expect(ruleApplies({ memo: 'MERCADO X', amount: 500 }, range)).toBe(true);
    expect(ruleApplies({ memo: 'MERCADO X', amount: -99.99 }, range)).toBe(false);
    expect(ruleApplies({ memo: 'MERCADO X', amount: -500.01 }, range)).toBe(false);
    expect(ruleApplies({ memo: 'MERCADO X', amount: -9999 }, rule('min', 'mercado', { minAmount: 100 }))).toBe(true);
  });

  it('valores neutros gravados (condição retirada) contam como sem condição', () => {
    const cleared = rule('x', 'uber', { direction: 'ANY', bankAccountKey: '', minAmount: 0, maxAmount: 0 });
    expect(ruleConditions(cleared)).toEqual({});
    expect(ruleApplies({ memo: 'UBER TRIP' }, cleared)).toBe(true);
    expect(keyOfRule(cleared)).toBe(keyOfRule(rule('y', 'uber')));
    expect(conditionFields({})).toEqual({ direction: 'ANY', bankAccountKey: '', minAmount: 0, maxAmount: 0 });
    expect(conditionFields({ direction: 'IN', minCents: 1050 })).toMatchObject({ direction: 'IN', minAmount: 10.5, maxAmount: 0 });
  });

  it('precedência: no mesmo tipo, a regra com mais condições vence a genérica, mesmo mais curta e mais antiga', () => {
    const generic = rule('generic', 'pix joao silva', { updatedAt: '2026-06-01' });
    const directed = rule('directed', 'joao', { direction: 'OUT', updatedAt: '2025-01-01' });
    const pay = { memo: 'PIX JOAO SILVA', amount: -100 };
    expect(findRuleCandidates(pay, [generic, directed]).map((r) => r.id)).toEqual(['directed', 'generic']);
    // Na entrada só a genérica vale.
    expect(findMatchingRule({ memo: 'PIX JOAO SILVA', amount: 100 }, [generic, directed])?.id).toBe('generic');
    // O tipo mais restritivo continua vindo antes das condições.
    const exact = rule('exact', 'pix joao silva', { matchType: 'EXACT' });
    expect(findMatchingRule(pay, [directed, exact])?.id).toBe('exact');
  });

  it('uma regra para entradas e outra para saídas do mesmo termo: chaves diferentes e sem conflito', () => {
    const inRule = rule('in', 'socio', { direction: 'IN', accountId: 'aporte' });
    const outRule = rule('out', 'socio', { direction: 'OUT', accountId: 'retirada' });
    expect(keyOfRule(inRule)).not.toBe(keyOfRule(outRule));
    expect(ruleKey('socio', 'CONTAINS')).toBe('CONTAINS:socio');
    const txs = [tx('PIX SOCIO', 1000), tx('PIX SOCIO', -800)];
    expect(detectRuleConflicts(txs, [inRule, outRule]).size).toBe(0);
    expect(findMatchingRule(txs[0], [inRule, outRule])?.accountId).toBe('aporte');
    expect(findMatchingRule(txs[1], [inRule, outRule])?.accountId).toBe('retirada');
    // Com uma regra genérica para outra conta, ela perde nos dois sentidos.
    const generic = rule('g', 'socio', { accountId: 'outra' });
    expect(detectRuleConflicts(txs, [inRule, outRule, generic]).get('g')?.map((c) => c.winnerId).sort()).toEqual(['in', 'out']);
  });

  it('pendentes vencidos e afetados respeitam as condições', () => {
    const out = rule('out', 'fornecedor', { direction: 'OUT' });
    const pending = [tx('FORNECEDOR ABC', -100), tx('FORNECEDOR ABC ESTORNO', 100)];
    expect(pendingWonByRule(pending, [], out).map((t) => t.amount)).toEqual([-100]);
    expect(countAffected(out, [...pending, tx('OUTRO', 5, { matchedRuleId: 'out' })])).toBe(2);
  });

  it('rótulos das condições e sentido comum', () => {
    expect(conditionLabels(rule('a', 'x', { direction: 'OUT', bankAccountKey: 'k1', minAmount: 100, maxAmount: 500 }), () => 'Itaú')).toEqual([
      'só saídas',
      'conta Itaú',
      `de ${(100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} a ${(500).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
    ]);
    expect(conditionLabels(rule('b', 'x'))).toEqual([]);
    expect(sharedDirection([{ amount: -1 }, { amount: -2 }])).toBe('OUT');
    expect(sharedDirection([{ amount: -1 }, { amount: 2 }])).toBeNull();
    expect(sharedDirection([])).toBeNull();
  });
});

describe('sugestões de regra (favorecidos recorrentes sem regra)', () => {
  const done = (memo: string, amount: number, accountId: string, extra: Partial<BankTransaction> = {}) => tx(memo, amount, { status: 'RECONCILED', accountId, ...extra });

  it('favorecido conciliado 3 vezes na mesma conta, sem regra, vira sugestão no sentido dele', () => {
    const txs = [
      done('Pix enviado - Padaria Sol', -50, 'acc-alim'),
      done('Pix enviado - Padaria Sol', -60, 'acc-alim'),
      done('Pix enviado - Padaria Sol', -70, 'acc-alim'),
      // Só duas vezes: ainda não.
      done('Pix enviado - Posto Azul', -200, 'acc-comb'),
      done('Pix enviado - Posto Azul', -210, 'acc-comb'),
      // Entrada do mesmo favorecido é outro grupo.
      done('Pix recebido - Padaria Sol', 30, 'acc-rec'),
    ];
    const [s, ...rest] = suggestRules(txs, []);
    expect(rest).toEqual([]);
    expect(s).toMatchObject({ term: 'Padaria Sol', direction: 'OUT', accountId: 'acc-alim', count: 3, outOf: 3, total: -180 });
  });

  it('não sugere o que uma regra já classifica, nem favorecido espalhado por contas, rateio ou pendente', () => {
    const sol = [1, 2, 3].map((n) => done('Pix enviado - Padaria Sol', -10 * n, 'acc-alim'));
    expect(suggestRules(sol, [rule('r', 'padaria sol')])).toEqual([]);
    // A regra só de entradas não cobre essas saídas: a sugestão continua.
    expect(suggestRules(sol, [rule('r', 'padaria sol', { direction: 'IN' })])).toHaveLength(1);

    const spread = [done('Pix enviado - Loja Y', -1, 'a'), done('Pix enviado - Loja Y', -2, 'b'), done('Pix enviado - Loja Y', -3, 'c')];
    expect(suggestRules(spread, [])).toEqual([]);

    const notManual = [
      tx('Pix enviado - Loja Z', -1),
      done('Pix enviado - Loja Z', -2, 'a', { isSplit: true }),
      done('Pix enviado - Loja Z', -3, 'a', { transferPairId: 'p' }),
    ];
    expect(suggestRules(notManual, [])).toEqual([]);
  });
});

describe('cópia de regras entre empresas', () => {
  const account = (id: string, code: string, nature: ChartAccount['nature'] = 'ANALYTIC') => ({ id, code, name: `Conta ${code}`, nature }) as ChartAccount;
  const sourceAccounts = [account('s-uber', '3.3.2.05'), account('s-rara', '9.9.9.99'), account('s-sint', '3.3')];
  const targetAccounts = [account('t-uber', '3.3.2.05'), account('t-sint', '3.3', 'SYNTHETIC')];
  let n = 0;
  const base = { sourceClientId: 'c1', sourceAccounts, targetClientId: 'c2', targetAccounts, now: '2026-11-16T00:00:00.000Z', actorUid: 'u1', newId: () => `new-${++n}` };

  it('casa a conta pelo código e leva as condições; contadores da origem não vão', () => {
    const source = [rule('a', 'uber', { accountId: 's-uber', accountCode: 'antigo', direction: 'OUT', minAmount: 10, overrideCount: 4, usageCount: 9, createdByUid: 'outro' })];
    const plan = planRuleCopy({ ...base, sourceRules: source, targetRules: [] });
    expect(plan.skipped).toEqual([]);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0]).toMatchObject({ clientId: 'c2', pattern: 'uber', matchType: 'CONTAINS', accountId: 't-uber', accountCode: '3.3.2.05', direction: 'OUT', minAmount: 10, createdByUid: 'u1' });
    expect(plan.create[0]).not.toHaveProperty('overrideCount');
    expect(plan.create[0]).not.toHaveProperty('usageCount');
    expect(plan.create[0]).not.toHaveProperty('maxAmount');
    expect(plan.create[0].id).not.toBe('a');
  });

  it('pula o que já existe, o que não tem conta no destino e o que depende de conta bancária', () => {
    const source = [
      rule('dup', 'uber', { accountId: 's-uber' }),
      rule('sem-conta', 'raro', { accountId: 's-rara' }),
      rule('sintetica', 'grupo', { accountId: 's-sint' }),
      rule('banco', 'tarifa', { accountId: 's-uber', bankAccountKey: '341-1-2' }),
      rule('global', 'netflix', { accountId: 's-uber', clientId: 'global' }),
      rule('ok', '99 taxi', { accountId: 's-uber' }),
      rule('ok-2', '99  TAXI', { accountId: 's-uber' }),
    ];
    const plan = planRuleCopy({ ...base, sourceRules: source, targetRules: [rule('t', 'UBER', { clientId: 'c2' })] });
    expect(plan.create.map((r) => r.pattern)).toEqual(['99 taxi']);
    expect(plan.skipped.map((s) => [s.rule.id, s.reason])).toEqual([
      ['dup', 'duplicate'],
      ['sem-conta', 'no-account'],
      ['sintetica', 'no-account'],
      ['banco', 'bank-condition'],
      ['ok-2', 'duplicate'],
    ]);
  });
});
