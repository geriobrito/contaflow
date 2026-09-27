import { describe, expect, it } from 'vitest';
import { buildTransactionId, findMatchingRule, normalizePattern } from '@/lib/reconciliation';
import type { ClassificationRule } from '@/types/firestore';

const rule = (id: string, pattern: string): ClassificationRule => ({
  id,
  clientId: 'c',
  pattern,
  accountId: `acc-${id}`,
  createdAt: '',
  updatedAt: '',
});

describe('regras de classificação', () => {
  it('normaliza caixa e espaços das pontas', () => {
    expect(normalizePattern('  UBER *Trip ')).toBe('uber *trip');
  });

  it('casa por "contém", sem diferenciar maiúsculas', () => {
    expect(findMatchingRule('UBER *TRIP SAO PAULO', [rule('1', 'uber')])?.id).toBe('1');
    expect(findMatchingRule('IFOOD', [rule('1', 'uber')])).toBeNull();
  });

  it('prefere o padrão mais específico (mais longo)', () => {
    const rules = [rule('amplo', 'pix'), rule('especifico', 'pix recebido cliente'), rule('medio', 'pix recebido')];
    expect(findMatchingRule('PIX RECEBIDO CLIENTE TECH CORP', rules)?.id).toBe('especifico');
  });

  it('ignora padrões vazios', () => {
    expect(findMatchingRule('QUALQUER', [rule('vazio', '   ')])).toBeNull();
  });

  it('ID determinístico por cliente e FITID', () => {
    expect(buildTransactionId('c1', 'ABC')).toBe('c1_ABC');
  });
});
