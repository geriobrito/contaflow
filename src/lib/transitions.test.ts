import { describe, expect, it } from 'vitest';
import {
  applyPatch,
  approveTransition,
  autoClassifyTransition,
  classifyTransition,
  resetTransition,
  splitTransition,
} from '@/lib/transitions';
import { AUDIT_LABEL, classifyAction, describeSnapshot, snapshotOf, transactionAudit } from '@/lib/audit';
import { formatMonth, isMonthLocked, lockId, monthOf, monthsBetween } from '@/lib/periods';
import type { BankTransaction } from '@/types/firestore';

const base: BankTransaction = {
  id: 't1',
  clientId: 'c1',
  fitid: '1',
  date: '2025-03-10',
  amount: -450,
  type: 'DEBIT',
  memo: 'AWS',
  status: 'PENDING',
  createdAt: '',
};
const ref = { accountId: 'acc', accountCode: '3.2.1.03', accountName: 'Custo' };

describe('transições', () => {
  it('classificar: grava conta e regra, remove rateio', () => {
    const splitted = splitTransition(base, [{ id: 's', accountId: 'x', amount: -450, memo: '' }], 'T0').after;
    const { patch, after } = classifyTransition(splitted, ref, 'r1', 'T1');
    expect(after).toMatchObject({ status: 'RECONCILED', ...ref, matchedRuleId: 'r1', isSplit: false, reconciledAt: 'T1' });
    expect(after).not.toHaveProperty('splits');
    expect(patch.remove).toContain('splits');
    expect(patch.remove).not.toContain('accountId'); // está no `set`
    expect(patch.date).toBe(base.date);
  });

  it('classificar sem regra desvincula a regra anterior', () => {
    const auto = autoClassifyTransition(base, ref, 'r-antiga').after;
    const { after, patch } = classifyTransition(auto, ref, null, 'T');
    expect(after).not.toHaveProperty('matchedRuleId');
    expect(patch.remove).toContain('matchedRuleId');
  });

  it('rateio remove conta única; desfazer limpa tudo', () => {
    const classified = classifyTransition(base, ref, 'r', 'T').after;
    const splitted = splitTransition(classified, [{ id: 's', accountId: 'x', amount: -450, memo: '' }], 'T2').after;
    for (const f of ['accountId', 'accountCode', 'accountName', 'matchedRuleId'] as const) expect(splitted).not.toHaveProperty(f);
    const reset = resetTransition(splitted).after;
    expect(reset.status).toBe('PENDING');
    for (const f of ['splits', 'reconciledAt', 'accountId'] as const) expect(reset).not.toHaveProperty(f);
  });

  it('aprovar mantém a conta', () => {
    const auto = autoClassifyTransition(base, ref, 'r').after;
    expect(approveTransition(auto, 'T').after).toMatchObject({ status: 'RECONCILED', accountId: 'acc', matchedRuleId: 'r' });
  });

  it('applyPatch não altera o objeto original', () => {
    const copy = { ...base };
    applyPatch(base, classifyTransition(base, ref, null, 'T').patch);
    expect(base).toEqual(copy);
  });
});

describe('auditoria', () => {
  it('registra antes/depois, ator e dados do lançamento', () => {
    const { after } = classifyTransition(base, ref, null, 'T1');
    const entry = transactionAudit(classifyAction(base), { uid: 'u1', email: 'a@b' }, base, after, 'T1');
    expect(entry).toMatchObject({
      action: 'CLASSIFY',
      actorUid: 'u1',
      actorEmail: 'a@b',
      clientId: 'c1',
      transactionId: 't1',
      transactionAmount: -450,
      before: { status: 'PENDING' },
      after: { status: 'RECONCILED', accountCode: '3.2.1.03' },
    });
    expect(classifyAction(after)).toBe('RECLASSIFY');
    expect(AUDIT_LABEL.RECLASSIFY).toBe('Reclassificou');
  });

  it('fotografia de rateio guarda as partes; descrição legível', () => {
    const splitted = splitTransition(base, [
      { id: 'a', accountId: 'x', accountCode: '1', amount: -400, memo: '' },
      { id: 'b', accountId: 'y', amount: -50, memo: '' },
    ], 'T').after;
    expect(snapshotOf(splitted).splits).toHaveLength(2);
    expect(describeSnapshot(snapshotOf(splitted))).toBe('Conciliado · rateado em 2 contas');
    expect(describeSnapshot(snapshotOf(base))).toBe('Pendente');
  });
});

describe('competências', () => {
  it('mês, id do fechamento e bloqueio', () => {
    expect(monthOf('2025-03-10')).toBe('2025-03');
    expect(lockId('c1', '2025-03')).toBe('c1_2025-03');
    expect(isMonthLocked('2025-03-31', new Set(['2025-03']))).toBe(true);
    expect(isMonthLocked('2025-04-01', new Set(['2025-03']))).toBe(false);
  });
  it('lista competências atravessando o ano e formata', () => {
    expect(monthsBetween('2024-11-15', '2025-02-01')).toEqual(['2024-11', '2024-12', '2025-01', '2025-02']);
    expect(formatMonth('2025-03')).toBe('março de 2025');
  });
});
