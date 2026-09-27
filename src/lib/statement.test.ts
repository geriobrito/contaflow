import { describe, expect, it } from 'vitest';
import { accountKeyOf, addDays, computeBalanceCheck, findCoverageGaps, outOfRangeDates, previousStatement } from '@/lib/statement';

describe('accountKeyOf', () => {
  it('banco-agência-conta, sem número de conta não há chave', () => {
    expect(accountKeyOf({ bankId: '0341', branchId: '0001', accountId: '12345-6' })).toBe('0341-0001-12345-6');
    expect(accountKeyOf({ bankId: '0077', accountId: '9876543-2' })).toBe('0077-9876543-2');
    expect(accountKeyOf({ bankId: '0077' })).toBeUndefined();
  });
});

describe('addDays', () => {
  it('atravessa meses e anos bissextos sem fuso', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
    expect(addDays('2025-01-01', -1)).toBe('2024-12-31');
  });
});

describe('computeBalanceCheck', () => {
  const previous = { id: 'b1', ledgerBalance: 1000, ledgerDate: '2025-01-31' };

  it('OK quando saldo anterior + movimentação = saldo informado', () => {
    const r = computeBalanceCheck({ reported: 1250.5, previous, movement: 250.5 });
    expect(r).toMatchObject({ status: 'OK', expected: 1250.5, difference: 0, previousBatchId: 'b1' });
  });

  it('tolera ponto flutuante, mas acusa 1 centavo', () => {
    expect(computeBalanceCheck({ reported: 0.3, previous: { ...previous, ledgerBalance: 0.1 }, movement: 0.2 }).status).toBe('OK');
    expect(computeBalanceCheck({ reported: 1250.51, previous, movement: 250.5 })).toMatchObject({
      status: 'MISMATCH',
      difference: 0.01,
    });
  });

  it('extrato faltando aparece como diferença', () => {
    // Faltou importar R$ 300 de débitos entre os dois extratos.
    expect(computeBalanceCheck({ reported: 700, previous, movement: 0 })).toMatchObject({ status: 'MISMATCH', difference: -300 });
  });

  it('primeiro extrato vira referência; sem LEDGERBAL não há conferência', () => {
    expect(computeBalanceCheck({ reported: 500, movement: 50 }).status).toBe('BASELINE');
    expect(computeBalanceCheck({ reported: undefined, previous, movement: 1 }).status).toBe('NO_LEDGER');
  });
});

describe('previousStatement', () => {
  it('pega o extrato mais recente anterior, da mesma conta e com saldo', () => {
    const batches = [
      { id: 'a', accountKey: 'K', ledgerDate: '2025-01-31', ledgerBalance: 1 },
      { id: 'b', accountKey: 'K', ledgerDate: '2025-02-28', ledgerBalance: 2 },
      { id: 'c', accountKey: 'K', ledgerDate: '2025-03-31', ledgerBalance: 3 },
      { id: 'outra', accountKey: 'X', ledgerDate: '2025-03-15', ledgerBalance: 9 },
      { id: 'sem-saldo', accountKey: 'K', ledgerDate: '2025-03-20' },
    ];
    expect(previousStatement(batches, 'K', '2025-03-31')?.id).toBe('b');
    expect(previousStatement(batches, 'K', '2025-01-31')).toBeUndefined();
  });
});

describe('findCoverageGaps', () => {
  it('aponta dias sem extrato por conta; sobreposição e contiguidade não são lacuna', () => {
    const gaps = findCoverageGaps([
      { accountKey: 'K', startDate: '2025-01-01', endDate: '2025-01-31' },
      { accountKey: 'K', startDate: '2025-02-01', endDate: '2025-02-28' }, // contíguo
      { accountKey: 'K', startDate: '2025-02-15', endDate: '2025-03-10' }, // sobreposto
      { accountKey: 'K', startDate: '2025-04-01', endDate: '2025-04-30' }, // lacuna 11–31/03
      { accountKey: 'X', startDate: '2025-01-01', endDate: '2025-01-31' },
      { accountKey: 'X', startDate: '2025-03-01', endDate: '2025-03-31' }, // lacuna fevereiro
      { startDate: '2025-01-01', endDate: '2025-12-31' }, // sem conta: ignorado
    ]);
    expect(gaps).toEqual([
      { accountKey: 'K', from: '2025-03-11', to: '2025-03-31' },
      { accountKey: 'X', from: '2025-02-01', to: '2025-02-28' },
    ]);
  });
});

describe('outOfRangeDates', () => {
  it('lista datas fora do intervalo declarado no arquivo', () => {
    expect(outOfRangeDates(['2025-01-01', '2025-02-01', '2024-12-31'], '2025-01-01', '2025-01-31')).toEqual([
      '2025-02-01',
      '2024-12-31',
    ]);
    expect(outOfRangeDates(['2025-01-01'], undefined, '2025-01-31')).toEqual([]);
  });
});
