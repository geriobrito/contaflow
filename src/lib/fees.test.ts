import { describe, expect, it } from 'vitest';
import type { FeeRegister } from '@/types/firestore';
import { addPayment, applyAdjustment, clearPayments, feeArrears, feeCharges, feeDue, feePortfolio, newFeeRegister, pendingAdjustment, rateFor } from '@/lib/fees';

const base = (extra: Partial<FeeRegister> = {}): FeeRegister => ({ ...newFeeRegister('c1', 800, '2025-03', 10, 'T'), ...extra });

describe('honorários', () => {
  it('valor vigente por competência, com reajuste e fim de contrato', () => {
    const r = base({ rates: [{ fromMonth: '2025-03', amount: 800 }, { fromMonth: '2026-03', amount: 840 }], endMonth: '2026-06' });
    expect(rateFor(r, '2025-02')).toBeNull();
    expect(rateFor(r, '2025-12')).toBe(800);
    expect(rateFor(r, '2026-03')).toBe(840);
    expect(rateFor(r, '2026-06')).toBeNull();
  });

  it('vencimento no mês ou no seguinte, limitado ao fim do mês', () => {
    expect(feeDue(base({ dueDay: 31 }), '2026-02')).toBe('2026-02-28');
    expect(feeDue(base({ dueDay: 5, dueNextMonth: true }), '2026-12')).toBe('2027-01-05');
    expect(feeDue(base({ dueDay: 5, dueNextMonth: true }), '2026-13')).toBe('2027-01-05');
  });

  it('cobranças, 13º, pagamentos parciais e atrasos', () => {
    let r = base({ thirteenth: true, rates: [{ fromMonth: '2025-11', amount: 1000 }] });
    r = addPayment(r, { month: '2025-11', amount: 1000, paidAt: '2025-11-08' });
    r = addPayment(r, { month: '2025-12', amount: 400, paidAt: '2025-12-12' });
    const charges = feeCharges(r, '2026-02', '2026-02-05');
    expect(charges.map((c) => `${c.label}:${c.status}`)).toEqual(['fev/2026:open', 'jan/2026:overdue', '13º/2025:overdue', 'dez/2025:partial', 'nov/2025:paid']);
    expect(feeArrears(charges, '2026-02-05')).toEqual({ count: 3, amount: 2600 });
    expect(feeCharges(clearPayments(r, '2025-12'), '2025-12', '2025-12-01').find((c) => c.month === '2025-12')?.status).toBe('open');
    expect(() => addPayment(r, { month: '2026-01', amount: 0, paidAt: '2026-01-10' })).toThrow();
  });

  it('reajuste anual: pendente no mês combinado, aplicado sobre o valor vigente', () => {
    const r = base({ adjustmentMonth: 3 });
    expect(pendingAdjustment(r, '2026-02-20')).toBeNull(); // ainda não chegou março
    expect(pendingAdjustment(r, '2026-03-02')).toEqual({ month: '2026-03' });
    expect(pendingAdjustment(base({ adjustmentMonth: 3, rates: [{ fromMonth: '2025-09', amount: 800 }] }), '2026-03-02')).toBeNull(); // menos de 12 meses
    const adjusted = applyAdjustment(r, 4.83, '2026-03', 'IPCA');
    expect(adjusted.rates).toEqual([{ fromMonth: '2025-03', amount: 800 }, { fromMonth: '2026-03', amount: 838.64, note: 'IPCA' }]);
    expect(pendingAdjustment(adjusted, '2026-03-02')).toBeNull();
  });

  it('resumo da carteira', () => {
    const a = addPayment(base(), { month: '2026-05', amount: 800, paidAt: '2026-05-09' });
    const b = base({ clientId: 'c2', rates: [{ fromMonth: '2026-01', amount: 500 }] });
    expect(feePortfolio([a, b], '2026-05', '2026-05-20')).toEqual({ monthly: 1300, received: 800, arrears: 15 * 800 + 5 * 500 - 800, lateClients: 2 });
  });
});
