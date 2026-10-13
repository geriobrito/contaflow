import { describe, expect, it } from 'vitest';
import { matchesAmountCriteria, matchTransaction, normalizeText, parseAmountCriteria } from './search';
import type { BankTransaction } from '@/types/firestore';

const sampleTx: BankTransaction = {
  id: 'tx_1',
  clientId: 'cli_1',
  fitid: 'FIT_20240115_999',
  date: '2024-01-15',
  amount: -1500.5,
  type: 'DEBIT',
  memo: 'PAGAMENTO FORNECEDOR KALUNGA S/A',
  status: 'RECONCILED',
  accountCode: '4.1.02.001',
  accountName: 'Material de Escritório',
  createdAt: '2024-01-15T10:00:00Z',
};

const splitTx: BankTransaction = {
  id: 'tx_2',
  clientId: 'cli_1',
  fitid: 'FIT_20240116_100',
  date: '2024-01-16',
  amount: -3000,
  type: 'DEBIT',
  memo: 'FATURA CARTAO NUBANK',
  status: 'RECONCILED',
  isSplit: true,
  splits: [
    { id: 's1', accountId: 'a1', accountCode: '4.1.03', accountName: 'Software e TI', amount: -2000, memo: 'AWS Cloud' },
    { id: 's2', accountId: 'a2', accountCode: '4.1.04', accountName: 'Refeições', amount: -1000, memo: 'Almoço equipe' },
  ],
  createdAt: '2024-01-16T10:00:00Z',
};

describe('normalizeText', () => {
  it('remove acentos e converte para minúsculas', () => {
    expect(normalizeText('Transação Bancária')).toBe('transacao bancaria');
    expect(normalizeText('  NUBANK  ')).toBe('nubank');
  });
});

describe('parseAmountCriteria e matchesAmountCriteria', () => {
  it('identifica valores inteiros e decimais brasileiros e americanos', () => {
    expect(parseAmountCriteria('1500')).toEqual({ operator: '=', value: 1500 });
    expect(parseAmountCriteria('1500,50')).toEqual({ operator: '=', value: 1500.5 });
    expect(parseAmountCriteria('1.500,50')).toEqual({ operator: '=', value: 1500.5 });
    expect(parseAmountCriteria('R$ 1.500,50')).toEqual({ operator: '=', value: 1500.5 });
  });

  it('identifica operadores relacionais', () => {
    expect(parseAmountCriteria('> 1000')).toEqual({ operator: '>', value: 1000 });
    expect(parseAmountCriteria('<= 500,25')).toEqual({ operator: '<=', value: 500.25 });
  });

  it('compara valores absolutos com tolerância', () => {
    expect(matchesAmountCriteria(-1500.5, { operator: '=', value: 1500.5 })).toBe(true);
    expect(matchesAmountCriteria(-1500.5, { operator: '>', value: 1000 })).toBe(true);
    expect(matchesAmountCriteria(-1500.5, { operator: '<', value: 2000 })).toBe(true);
    expect(matchesAmountCriteria(-1500.5, { operator: '<', value: 1000 })).toBe(false);
  });
});

describe('matchTransaction', () => {
  it('casa por parte do histórico (memo) sem case nem acento', () => {
    expect(matchTransaction(sampleTx, 'kalunga')).toBe(true);
    expect(matchTransaction(sampleTx, 'fornecedor')).toBe(true);
    expect(matchTransaction(sampleTx, 'inexistente')).toBe(false);
  });

  it('casa por FITID', () => {
    expect(matchTransaction(sampleTx, '20240115')).toBe(true);
  });

  it('casa por conta contábil (nome ou código)', () => {
    expect(matchTransaction(sampleTx, 'Material')).toBe(true);
    expect(matchTransaction(sampleTx, '4.1.02')).toBe(true);
  });

  it('casa por valor exato digitado de várias formas', () => {
    expect(matchTransaction(sampleTx, '1500,50')).toBe(true);
    expect(matchTransaction(sampleTx, '1.500,50')).toBe(true);
    expect(matchTransaction(sampleTx, '1500.50')).toBe(true);
    expect(matchTransaction(sampleTx, 'R$ 1.500,50')).toBe(true);
    expect(matchTransaction(sampleTx, '200')).toBe(false);
  });

  it('casa por faixas de valor com operadores', () => {
    expect(matchTransaction(sampleTx, '> 1000')).toBe(true);
    expect(matchTransaction(sampleTx, '< 1000')).toBe(false);
  });

  it('casa em lançamentos com split (subcontas e histórico do rateio)', () => {
    expect(matchTransaction(splitTx, 'AWS')).toBe(true);
    expect(matchTransaction(splitTx, 'Software')).toBe(true);
    expect(matchTransaction(splitTx, '1000')).toBe(true); // sub-item de R$ 1000
    expect(matchTransaction(splitTx, '3000')).toBe(true); // total
  });
});
