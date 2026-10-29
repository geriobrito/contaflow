import { describe, expect, it } from 'vitest';
import type { BankTransaction, ChartAccount } from '@/types/firestore';
import {
  bankAccountId,
  bankBalanceAt,
  bankLedgerCandidates,
  newManualAccountKey,
  nextChildCode,
  suggestOpening,
} from '@/lib/bank-accounts';

describe('contas bancárias', () => {
  it('id seguro para o Firestore', () => {
    expect(bankAccountId('c1', '0341-1234-55555/5')).toBe('c1_0341-1234-55555-5');
  });

  it('gera chave manual estável sem colisão para conta ou cartão', () => {
    expect(newManualAccountKey('Banco Inter PJ')).toBe('manual-banco-inter-pj');
    expect(newManualAccountKey('Cartão Nubank Sócios!', 'CARD')).toBe('card-cartao-nubank-socios');
    expect(newManualAccountKey('   ', 'CARD')).toBe('card-cartao');

    const used = new Set(['card-nubank', 'card-nubank-2']);
    expect(newManualAccountKey('Nubank', 'CARD', used)).toBe('card-nubank-3');
  });

  it('filtra contas contábeis candidatas conforme o tipo (banco vs cartão)', () => {
    const acc = (id: string, type: ChartAccount['type'], nature: ChartAccount['nature'] = 'ANALYTIC'): ChartAccount => ({
      id,
      clientId: 'c1',
      code: id,
      name: id,
      type,
      nature,
      level: 3,
      createdAt: '',
      updatedAt: '',
    });
    const chart = [
      acc('1.1.1', 'ASSET', 'SYNTHETIC'),
      acc('1.1.1.02', 'ASSET', 'ANALYTIC'),
      acc('2.1.1.05', 'LIABILITY', 'ANALYTIC'),
      acc('3.1.1.01', 'EXPENSE', 'ANALYTIC'),
    ];

    expect(bankLedgerCandidates(chart, 'BANK').map((a) => a.id)).toEqual(['1.1.1.02']);
    expect(bankLedgerCandidates(chart, 'CARD').map((a) => a.id)).toEqual(['2.1.1.05', '1.1.1.02']);
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
    ).toEqual({ openingBalance: 1250.5, openingDate: '2025-01-01' });
    expect(suggestOpening([], 'k')).toBeNull();
  });

  it('não sugere saldo inicial a partir de saldo posterior ao fim do extrato', () => {
    const after = { accountKey: 'k', startDate: '2026-09-01', endDate: '2026-09-30', ledgerDate: '2026-10-05', ledgerBalance: 778.68, fileNet: -393.1 };
    expect(suggestOpening([after], 'k')).toBeNull();
    const ok = { accountKey: 'k', startDate: '2026-10-01', endDate: '2026-10-31', ledgerDate: '2026-10-31', ledgerBalance: 900, fileNet: 100 };
    expect(suggestOpening([after, ok], 'k')).toEqual({ openingBalance: 800, openingDate: '2026-10-01' });
  });

  it('saldo na data = saldo inicial (início do dia) + movimentação desse dia em diante', () => {
    const t = (date: string, amount: number, accountKey = 'k') => ({ date, amount, accountKey }) as BankTransaction;
    const txs = [t('2024-12-31', 999), t('2025-01-01', 100), t('2025-01-20', -30), t('2025-01-10', 5, 'outra')];
    expect(bankBalanceAt({ accountKey: 'k', openingBalance: 1000, openingDate: '2025-01-01' }, txs, '2025-01-10')).toBe(1100);
    expect(bankBalanceAt({ accountKey: 'k', openingBalance: 1000, openingDate: '2025-01-01' }, txs, '2025-01-31')).toBe(1070);
  });

  it('próximo código de subconta livre', () => {
    expect(nextChildCode('1.1.1.02', [{ code: '1.1.1.02' }])).toBe('1.1.1.02.001');
    expect(nextChildCode('1.1.1.02', [{ code: '1.1.1.02.001' }, { code: '1.1.1.02.003' }])).toBe('1.1.1.02.002');
  });
});
