import { describe, expect, it } from 'vitest';
import type { BankTransaction } from '@/types/firestore';
import { bankAccountId, bankBalanceAt, nextChildCode, suggestOpening } from '@/lib/bank-accounts';

describe('contas bancárias', () => {
  it('id seguro para o Firestore', () => {
    expect(bankAccountId('c1', '0341-1234-55555/5')).toBe('c1_0341-1234-55555-5');
  });

  it('saldo inicial sugerido = saldo final do primeiro extrato − movimentação do arquivo', () => {
    expect(
      suggestOpening(
        [
          { accountKey: 'k', startDate: '2025-02-01', ledgerBalance: 900, fileNet: 100 },
          { accountKey: 'k', startDate: '2025-01-01', ledgerBalance: 1000, fileNet: -250.5 },
          { accountKey: 'outra', startDate: '2024-01-01', ledgerBalance: 1, fileNet: 1 },
        ],
        'k'
      )
    ).toEqual({ openingBalance: 1250.5, openingDate: '2024-12-31' });
    expect(suggestOpening([], 'k')).toBeNull();
  });

  it('não sugere saldo inicial a partir de saldo posterior ao fim do extrato', () => {
    const after = { accountKey: 'k', startDate: '2026-09-01', endDate: '2026-09-30', ledgerDate: '2026-10-05', ledgerBalance: 778.68, fileNet: -393.1 };
    expect(suggestOpening([after], 'k')).toBeNull();
    const ok = { accountKey: 'k', startDate: '2026-10-01', endDate: '2026-10-31', ledgerDate: '2026-10-31', ledgerBalance: 900, fileNet: 100 };
    expect(suggestOpening([after, ok], 'k')).toEqual({ openingBalance: 800, openingDate: '2026-09-30' });
  });

  it('saldo na data = saldo inicial + movimentação posterior', () => {
    const t = (date: string, amount: number, accountKey = 'k') => ({ date, amount, accountKey }) as BankTransaction;
    const txs = [t('2024-12-31', 999), t('2025-01-05', 100), t('2025-01-20', -30), t('2025-01-10', 5, 'outra')];
    expect(bankBalanceAt({ accountKey: 'k', openingBalance: 1000, openingDate: '2024-12-31' }, txs, '2025-01-10')).toBe(1100);
    expect(bankBalanceAt({ accountKey: 'k', openingBalance: 1000, openingDate: '2024-12-31' }, txs, '2025-01-31')).toBe(1070);
  });

  it('próximo código de subconta livre', () => {
    expect(nextChildCode('1.1.1.02', [{ code: '1.1.1.02' }])).toBe('1.1.1.02.001');
    expect(nextChildCode('1.1.1.02', [{ code: '1.1.1.02.001' }, { code: '1.1.1.02.003' }])).toBe('1.1.1.02.002');
  });
});
