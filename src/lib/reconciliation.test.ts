import { describe, expect, it } from 'vitest';
import {
  buildTransactionId,
  compareRules,
  detectRuleConflicts,
  findMatchingRule,
  findRuleCandidates,
  matchesRule,
  normalizePattern,
  pendingWonByRule,
} from '@/lib/reconciliation';
import type { BankTransaction, ClassificationRule, RuleMatchType } from '@/types/firestore';

const rule = (id: string, pattern: string, extra: Partial<ClassificationRule> = {}): ClassificationRule => ({
  id,
  clientId: 'c',
  pattern,
  accountId: `acc-${id}`,
  createdAt: '2025-01-01',
  updatedAt: '2025-01-01',
  ...extra,
});
const typed = (id: string, pattern: string, matchType: RuleMatchType, extra: Partial<ClassificationRule> = {}) =>
  rule(id, pattern, { matchType, ...extra });

describe('normalização', () => {
  it('minúsculas e espaços colapsados/aparados', () => {
    expect(normalizePattern('  UBER   *Trip ')).toBe('uber *trip');
  });
  it('ID determinístico por cliente e FITID', () => {
    expect(buildTransactionId('c1', 'ABC')).toBe('c1_ABC');
  });
});

describe('matchesRule (tipo de comparação)', () => {
  const memo = 'PIX RECEBIDO CLIENTE TECH CORP';
  it('CONTAINS é o padrão', () => {
    expect(matchesRule(memo, rule('1', 'cliente tech'))).toBe(true);
    expect(matchesRule('IFOOD', rule('1', 'uber'))).toBe(false);
  });
  it('STARTS_WITH só casa no início', () => {
    expect(matchesRule(memo, typed('1', 'pix recebido', 'STARTS_WITH'))).toBe(true);
    expect(matchesRule(memo, typed('1', 'recebido', 'STARTS_WITH'))).toBe(false);
  });
  it('EXACT exige o histórico inteiro (ignorando caixa e espaços extras)', () => {
    expect(matchesRule('TARIFA   PACOTE', typed('1', 'tarifa pacote', 'EXACT'))).toBe(true);
    expect(matchesRule('TARIFA PACOTE MENSAL', typed('1', 'tarifa pacote', 'EXACT'))).toBe(false);
  });
  it('REGEX inválida nunca casa (sem lançar erro)', () => {
    expect(matchesRule('ABC 123', typed('1', '^abc \\d+$', 'REGEX'))).toBe(true);
    expect(matchesRule('ABC', typed('1', '([', 'REGEX'))).toBe(false);
  });
  it('padrão vazio nunca casa', () => {
    expect(matchesRule('QUALQUER', rule('1', '   '))).toBe(false);
  });
});

describe('resolução de conflito', () => {
  const memo = 'PIX RECEBIDO CLIENTE TECH CORP';

  it('tipo mais restritivo vence, mesmo com padrão mais curto', () => {
    const rules = [rule('contem-longo', 'pix recebido cliente tech'), typed('comeca', 'pix', 'STARTS_WITH')];
    expect(findMatchingRule(memo, rules)?.id).toBe('comeca');
    expect(findMatchingRule(memo, [...rules, typed('exato', memo, 'EXACT')])?.id).toBe('exato');
  });

  it('no mesmo tipo, o padrão mais longo vence; depois a mais recente; depois o id', () => {
    expect(findMatchingRule(memo, [rule('a', 'pix'), rule('b', 'pix recebido')])?.id).toBe('b');
    const older = rule('old', 'pix', { updatedAt: '2024-01-01' });
    const newer = rule('new', 'pix', { updatedAt: '2025-06-01' });
    expect(findMatchingRule(memo, [older, newer])?.id).toBe('new');
    expect(findRuleCandidates(memo, [rule('z', 'pix'), rule('a', 'pix')]).map((r) => r.id)).toEqual(['a', 'z']);
  });

  it('a ordem é total e estável (independe da ordem de entrada)', () => {
    const rules = [rule('a', 'pix'), typed('b', 'pix', 'STARTS_WITH'), rule('c', 'pix recebido')];
    const sorted = [...rules].sort(compareRules).map((r) => r.id);
    expect([...rules].reverse().sort(compareRules).map((r) => r.id)).toEqual(sorted);
  });

  it('detecta conflito só quando as regras levam a contas diferentes', () => {
    const rules = [
      rule('uber', 'uber'),
      rule('uber-eats', 'uber eats'),
      // Perde para 'uber-eats' nos pedidos, mas leva à mesma conta: não é conflito.
      rule('mesma-conta', 'eats', { accountId: 'acc-uber-eats', updatedAt: '2000-01-01' }),
    ];
    const conflicts = detectRuleConflicts(['UBER EATS PEDIDO 1', 'UBER EATS PEDIDO 2', 'UBER TRIP'], rules);
    expect(conflicts.get('uber')?.[0]).toMatchObject({ winnerId: 'uber-eats', count: 2 });
    expect(conflicts.has('mesma-conta')).toBe(false);
    expect(conflicts.has('uber-eats')).toBe(false);
  });
});

describe('pendingWonByRule (aplicar regra a pendentes antigos)', () => {
  const tx = (id: string, memo: string, status: BankTransaction['status'] = 'PENDING'): BankTransaction => ({
    id,
    clientId: 'c',
    fitid: id,
    date: '2024-01-01',
    amount: -1,
    type: 'DEBIT',
    memo,
    status,
    createdAt: '',
  });

  it('só pega pendentes que a nova regra vence', () => {
    const existing = [typed('eats', 'uber eats', 'STARTS_WITH')];
    const nova = rule('uber', 'uber');
    const won = pendingWonByRule(
      [tx('1', 'UBER TRIP'), tx('2', 'UBER EATS PEDIDO'), tx('3', 'UBER TRIP', 'RECONCILED'), tx('4', 'IFOOD')],
      existing,
      nova
    );
    expect(won.map((t) => t.id)).toEqual(['1']);
  });
});
