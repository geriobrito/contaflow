import { describe, expect, it } from 'vitest';
import type { BankTransaction, ClassificationRule } from '@/types/firestore';
import { planTextRepair } from '@/lib/text-repair';

const damaged = (s: string) => new TextDecoder('windows-1252').decode(new TextEncoder().encode(s));

const tx = (id: string, date: string, memo: string): BankTransaction => ({
  id, clientId: 'c', fitid: id, date, amount: -1, type: 'DEBIT', memo, status: 'PENDING', createdAt: '',
});
const rule = (id: string, pattern: string, accountId = 'a1', extra: Partial<ClassificationRule> = {}): ClassificationRule => ({
  id, clientId: 'c', pattern, accountId, createdAt: '2025-01-01', updatedAt: '2025-01-01', ...extra,
});

describe('planTextRepair', () => {
  const txs = [
    tx('1', '2025-03-10', damaged('Transferência recebida - Agência 1')),
    tx('2', '2025-04-10', damaged('Pagamento de boleto - Claro •')),
    tx('3', '2025-04-11', 'Pagamento de fatura'),
    tx('4', '2025-05-02', damaged('Pix recebido - Magalhães')),
  ];

  it('separa históricos corrigíveis dos de competência fechada e ignora os corretos', () => {
    const plan = planTextRepair(txs, [], 'c', new Set(['2025-04']));
    expect(plan.memos.map((m) => [m.id, m.after])).toEqual([
      ['1', 'Transferência recebida - Agência 1'],
      ['4', 'Pix recebido - Magalhães'],
    ]);
    expect(plan.lockedMemos.map((m) => m.id)).toEqual(['2']);
    expect(plan.total).toBe(3);
  });

  it('corrige o termo das regras (minúsculo) e só as regras do cliente', () => {
    const plan = planTextRepair(
      [],
      [
        rule('r1', damaged('Transferência recebida').toLowerCase()),
        rule('r2', 'pagamento de fatura'),
        rule('r3', damaged('Agência').toLowerCase(), 'a1', { clientId: 'global' }),
        rule('r4', 'Agência|Ã', 'a1', { matchType: 'REGEX' }),
      ],
      'c',
      new Set()
    );
    expect(plan.rules.map((r) => [r.rule.id, r.after])).toEqual([['r1', 'transferência recebida']]);
  });

  it('regra que fica idêntica a outra (mesmo termo, tipo e conta) é duplicada; a mais recente fica', () => {
    const plan = planTextRepair(
      [],
      [
        rule('velha', damaged('Transferência').toLowerCase(), 'a1', { updatedAt: '2025-01-01' }),
        rule('nova', 'transferência', 'a1', { updatedAt: '2025-06-01' }),
        rule('outra-conta', damaged('Transferência').toLowerCase(), 'a2'),
      ],
      'c',
      new Set()
    );
    expect(plan.duplicateRuleIds).toEqual(['velha']);
    expect(plan.rules.map((r) => r.rule.id)).toEqual(['outra-conta']);
  });
});
