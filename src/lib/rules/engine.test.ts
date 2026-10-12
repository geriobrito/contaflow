import { describe, expect, it } from 'vitest';
import { matchTransactionWithRules } from '@/lib/rules/engine';
import type { ClassificationRule } from '@/types/firestore';

const makeRule = (id: string, pattern: string, clientId: string, extra: Partial<ClassificationRule> = {}): ClassificationRule => ({
  id,
  clientId,
  pattern,
  accountId: `acc-${id}`,
  matchType: 'CONTAINS',
  createdAt: '',
  updatedAt: '',
  ...extra,
});

describe('engine: matchTransactionWithRules', () => {
  it('dá preferência para regra específica do cliente sobre regra global, mesmo se a global tiver padrão mais longo', () => {
    const globalRule = makeRule('r-global', 'POSTO IPIRANGA COMBUSTIVEL', 'global', { matchType: 'CONTAINS' });
    const clientRule = makeRule('r-client', 'POSTO', 'client-1', { matchType: 'CONTAINS' });

    const result = matchTransactionWithRules('POSTO IPIRANGA COMBUSTIVEL LTDA', [globalRule, clientRule], 'client-1');

    expect(result.matched).toBe(true);
    expect(result.rule?.id).toBe('r-client');
  });

  it('usa a regra global quando não há regra específica do cliente que case', () => {
    const globalRule = makeRule('r-global', 'TARIFA BANCARIA', 'global');
    const clientRule = makeRule('r-client', 'PADARIA', 'client-1');

    const result = matchTransactionWithRules('TARIFA BANCARIA CESTA BASICA', [globalRule, clientRule], 'client-1');

    expect(result.matched).toBe(true);
    expect(result.rule?.id).toBe('r-global');
  });

  it('no mesmo nível de escopo (duas regras do cliente), padrão mais longo tem precedência', () => {
    const shortRule = makeRule('short', 'PAGAMENTO', 'client-1');
    const longRule = makeRule('long', 'PAGAMENTO FORNECEDOR ABC', 'client-1');

    const result = matchTransactionWithRules('PAGAMENTO FORNECEDOR ABC DE SOUSA', [shortRule, longRule], 'client-1');

    expect(result.matched).toBe(true);
    expect(result.rule?.id).toBe('long');
  });

  it('respeita os tipos de match (EXACT, STARTS_WITH, CONTAINS, REGEX)', () => {
    const exact = makeRule('exact', 'TARIFA PIX', 'c1', { matchType: 'EXACT' });
    expect(matchTransactionWithRules('TARIFA PIX', [exact], 'c1').matched).toBe(true);
    expect(matchTransactionWithRules('TARIFA PIX MENSAL', [exact], 'c1').matched).toBe(false);

    const starts = makeRule('starts', 'TARIFA', 'c1', { matchType: 'STARTS_WITH' });
    expect(matchTransactionWithRules('TARIFA PIX', [starts], 'c1').matched).toBe(true);
    expect(matchTransactionWithRules('PAGTO TARIFA', [starts], 'c1').matched).toBe(false);
  });
});
