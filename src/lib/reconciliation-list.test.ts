import { describe, expect, it } from 'vitest';
import type { BankAccount, BankTransaction } from '@/types/firestore';
import {
  approvableIds,
  bankFilterOptions,
  bankNamesByKey,
  filterByBank,
  mainSplitAccountId,
  nextSort,
  parseConciliationLink,
  payeeCandidates,
  sortTransactions,
  statusCounts,
  UNLINKED_BANK,
  upsertBank,
  visibleTransactions,
} from '@/lib/reconciliation-list';

const bank = (accountKey: string, extra: Partial<BankAccount> = {}): BankAccount => ({
  id: `c_${accountKey}`,
  clientId: 'c',
  accountKey,
  nickname: '',
  createdAt: '',
  updatedAt: '',
  ...extra,
});

let n = 0;
const tx = (extra: Partial<BankTransaction> = {}): BankTransaction => ({
  id: `t${++n}`,
  clientId: 'c',
  fitid: `f${n}`,
  date: '2025-03-10',
  amount: -10,
  type: 'DEBIT',
  memo: 'Pix enviado',
  status: 'PENDING',
  createdAt: '',
  ...extra,
});

describe('contas no filtro', () => {
  const banks = [bank('itau', { nickname: 'Itaú PJ' }), bank('nubank', { kind: 'CARD', bankName: 'Nubank' }), bank('sem-nome')];
  const txs = [tx({ accountKey: 'itau' }), tx({ accountKey: 'itau' }), tx({ accountKey: 'antiga' }), tx()];

  it('nome curto: apelido, banco ou chave', () => {
    expect([...bankNamesByKey(banks).values()]).toEqual(['Itaú PJ', 'Nubank', 'sem-nome']);
  });

  it('opções com contagem, chaves sem cadastro e lançamentos sem conta', () => {
    expect(bankFilterOptions(banks, txs)).toEqual([
      { value: 'itau', label: 'Itaú PJ', count: 2 },
      { value: 'nubank', label: 'Cartão · Nubank', count: 0 },
      { value: 'sem-nome', label: 'sem-nome', count: 0 },
      { value: 'antiga', label: 'antiga', count: 1 },
      { value: UNLINKED_BANK, label: 'Sem conta identificada', count: 1 },
    ]);
    expect(bankFilterOptions([], [tx({ accountKey: 'x' })]).map((o) => o.value)).toEqual(['x']);
  });

  it('filtra pela conta, pelos sem conta ou nenhum', () => {
    expect(filterByBank(txs, 'ALL')).toBe(txs);
    expect(filterByBank(txs, 'itau')).toHaveLength(2);
    expect(filterByBank(txs, UNLINKED_BANK)).toEqual([txs[3]]);
  });

  it('substitui pelo id ou acrescenta', () => {
    const renamed = { ...banks[0], nickname: 'Itaú' };
    expect(upsertBank(banks, renamed).map((b) => b.nickname ?? '')).toEqual(['Itaú', '', '']);
    expect(upsertBank(banks, bank('inter'))).toHaveLength(4);
  });
});

describe('lista visível, aprovação e favorecidos', () => {
  const locked = new Set(['2025-02']);
  const pending = tx({ memo: 'Pix enviado - ACME' });
  const auto = tx({ status: 'AUTO_CLASSIFIED', accountId: 'a1' });
  const autoNoAccount = tx({ status: 'AUTO_CLASSIFIED' });
  const autoLocked = tx({ status: 'AUTO_CLASSIFIED', accountId: 'a1', date: '2025-02-10' });
  const transfer = tx({ transferPairId: 'x' });
  const pendingLocked = tx({ date: '2025-02-05' });
  const all = [pending, auto, autoNoAccount, autoLocked, transfer, pendingLocked];

  it('pela situação e pela busca', () => {
    expect(visibleTransactions(all, 'ALL', '')).toBe(all);
    expect(visibleTransactions(all, 'AUTO_CLASSIFIED', '')).toHaveLength(3);
    expect(visibleTransactions(all, 'PENDING', 'acme')).toEqual([pending]);
  });

  it('aprova só auto-classificados com conta em competência aberta', () => {
    expect([...approvableIds(all, locked)]).toEqual([auto.id]);
  });

  it('favorecidos: pendentes fora de transferência e de competência fechada', () => {
    expect(payeeCandidates(all, locked)).toEqual([pending]);
  });
});

describe('rateio vinculado à nota', () => {
  it('conta da maior linha que soma', () => {
    expect(
      mainSplitAccountId([
        { id: '1', accountId: 'despesa', memo: '', cents: 91100 },
        { id: '2', accountId: 'cbs', memo: '', cents: 8800 },
        { id: '3', accountId: 'tarifa', memo: '', cents: 200000, reduces: true },
      ])
    ).toBe('despesa');
    expect(mainSplitAccountId([])).toBeNull();
    expect(mainSplitAccountId([{ id: '1', accountId: '', memo: '', cents: 1 }])).toBeNull();
  });
});

describe('links do painel', () => {
  it('mês, situação e conta; valores inválidos são ignorados', () => {
    expect(parseConciliationLink('?mes=2025-03&filtro=PENDING&conta=itau')).toEqual({ month: '2025-03', filter: 'PENDING', bank: 'itau' });
    expect(parseConciliationLink('?mes=2025-13&filtro=PENDING')).toEqual({});
    expect(parseConciliationLink('?filtro=AUTO_CLASSIFIED')).toEqual({});
    expect(parseConciliationLink('?mes=2025-03&filtro=RECONCILED')).toEqual({ month: '2025-03' });
    expect(parseConciliationLink('')).toEqual({});
  });
});

describe('fila de trabalho: contagem por situação e ordenação', () => {
  const list = [
    tx({ id: 'a', date: '2025-03-10', amount: -50, memo: 'Padaria', status: 'PENDING' }),
    tx({ id: 'b', date: '2025-03-02', amount: 900, memo: 'água mineral', status: 'AUTO_CLASSIFIED' }),
    tx({ id: 'c', date: '2025-03-20', amount: -300, memo: 'Aluguel', status: 'RECONCILED' }),
    tx({ id: 'd', date: '2025-03-10', amount: 50, memo: 'padaria', status: 'PENDING' }),
  ];
  const ids = (rows: readonly BankTransaction[]) => rows.map((t) => t.id).join('');

  it('conta os lançamentos de cada situação', () => {
    expect(statusCounts(list)).toEqual({ ALL: 4, PENDING: 2, AUTO_CLASSIFIED: 1, RECONCILED: 1 });
    expect(statusCounts([])).toEqual({ ALL: 0, PENDING: 0, AUTO_CLASSIFIED: 0, RECONCILED: 0 });
  });

  it('sem ordenação mantém a ordem do extrato (a mesma lista)', () => {
    expect(sortTransactions(list, null)).toBe(list);
  });

  it('ordena por data, por tamanho do valor e pelo histórico sem diferenciar acento e caixa', () => {
    // Empate (mesma data) mantém a ordem original: a antes de d.
    expect(ids(sortTransactions(list, { key: 'date', dir: 'desc' }))).toBe('cadb');
    expect(ids(sortTransactions(list, { key: 'date', dir: 'asc' }))).toBe('badc');
    // Valor pelo tamanho: a maior entrada e a maior saída sobem juntas.
    expect(ids(sortTransactions(list, { key: 'amount', dir: 'desc' }))).toBe('bcad');
    // "água" vem antes de "Aluguel" e "Padaria" empata com "padaria".
    expect(ids(sortTransactions(list, { key: 'memo', dir: 'asc' }))).toBe('bcad');
    // Não altera a lista recebida.
    expect(ids(list)).toBe('abcd');
  });

  it('clicar no título da coluna: sentido mais útil, inverte e volta à ordem do extrato', () => {
    const first = nextSort(null, 'amount');
    expect(first).toEqual({ key: 'amount', dir: 'desc' });
    const second = nextSort(first, 'amount');
    expect(second).toEqual({ key: 'amount', dir: 'asc' });
    expect(nextSort(second, 'amount')).toBeNull();
    // Histórico começa de A a Z; trocar de coluna recomeça o ciclo.
    expect(nextSort(first, 'memo')).toEqual({ key: 'memo', dir: 'asc' });
  });
});
