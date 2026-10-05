import { describe, expect, it } from 'vitest';
import type { BankAccount } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { openingAccounts, parseMoneyInput, summarizeOpening } from '@/lib/opening';

const chart = buildITG1000Chart('c');
const id = (code: string) => `c_itg22_${code}`;
const bank = (ledger: string | null, opening?: number): BankAccount => ({
  id: 'b', clientId: 'c', accountKey: 'k', nickname: 'k', ...(ledger ? { ledgerAccountId: id(ledger) } : {}), ...(opening !== undefined ? { openingBalance: opening, openingDate: '2024-12-31' } : {}), createdAt: '', updatedAt: '',
});

describe('openingAccounts', () => {
  it('só analíticas patrimoniais, sem resultado e sem a conta de banco vinculada', () => {
    const list = openingAccounts(chart, [bank('1.1.1.02')]);
    const codes = new Set(list.map((a) => a.code));
    expect(codes.has('1.1.2.01')).toBe(true); // clientes
    expect(codes.has('2.3.1.01')).toBe(true); // capital
    expect(codes.has('1.1.1.02')).toBe(false); // banco vinculado
    expect(codes.has('3.1.1.01')).toBe(false); // receita
    expect(codes.has('1.1')).toBe(false); // sintética
    expect(openingAccounts(chart, []).some((a) => a.code === '1.1.1.02')).toBe(true);
  });
});

describe('summarizeOpening', () => {
  it('fecha quando ativo (com bancos) = passivo + PL; retificadora reduz o grupo', () => {
    const s = summarizeOpening(
      [
        { accountId: id('1.1.2.01'), amount: 500 },
        { accountId: id('1.2.3.03'), amount: 4000 },
        { accountId: id('1.2.3.07'), amount: 1000 },
        { accountId: id('2.1.2.01'), amount: 800 },
        { accountId: id('2.3.1.01'), amount: 3700 },
      ],
      chart,
      [bank('1.1.1.02', 1000)]
    );
    expect(s).toMatchObject({ assets: 3500, banks: 1000, liabilities: 800, equity: 3700, difference: 0, balanced: true });
  });

  it('mostra a diferença a detalhar', () => {
    const s = summarizeOpening([{ accountId: id('2.3.1.01'), amount: 1000 }], chart, [bank('1.1.1.02', 400)]);
    expect(s.difference).toBe(-600);
    expect(s.balanced).toBe(false);
  });
});

describe('parseMoneyInput', () => {
  it('formatos digitados', () => {
    expect(parseMoneyInput('1.234,56')).toBe(1234.56);
    expect(parseMoneyInput('1234,5')).toBe(1234.5);
    expect(parseMoneyInput('1234.56')).toBe(1234.56);
    expect(parseMoneyInput('1.234')).toBe(1234);
    expect(parseMoneyInput('')).toBe(0);
    expect(parseMoneyInput('abc')).toBeNull();
    expect(parseMoneyInput('-5')).toBeNull();
  });
});
