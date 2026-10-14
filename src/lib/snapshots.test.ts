import { describe, expect, it } from 'vitest';
import type { BankAccount, BankTransaction, ChartAccount, JournalEntry, OpeningBalances, PeriodLock } from '@/types/firestore';
import { bankBalanceAt } from '@/lib/bank-accounts';
import { buildAccountLedger, buildBalanceSheet, buildPostings, buildTrialBalance } from '@/lib/ledger';
import { checkAccountingConsistency } from '@/lib/dre/consistency';
import { buildSnapshot, carryOf, ledgerConfigKey, monthEnd, snapshotProblem, snapshotTarget } from '@/lib/snapshots';

const account = (id: string, code: string, type: ChartAccount['type'], extra: Partial<ChartAccount> = {}): ChartAccount => ({
  id,
  clientId: 'c1',
  code,
  name: id,
  type,
  nature: 'ANALYTIC',
  level: code.split('.').length,
  createdAt: '',
  updatedAt: '',
  ...extra,
});

const accounts: ChartAccount[] = [
  account('ativo', '1', 'ASSET', { nature: 'SYNTHETIC' }),
  account('banco', '1.1', 'ASSET', { parentId: 'ativo' }),
  account('clientes', '1.2', 'ASSET', { parentId: 'ativo' }),
  account('fornecedores', '2.1', 'LIABILITY'),
  account('capital', '2.3', 'EQUITY'),
  account('receita', '3.1', 'REVENUE', { dreGroup: 'GROSS_REVENUE' }),
  account('despesa', '4.1', 'EXPENSE', { dreGroup: 'OPERATING_EXPENSES' }),
  account('tarifas', '4.2', 'EXPENSE', { dreGroup: 'FINANCIAL_EXPENSES' }),
];

const banks: BankAccount[] = [
  // Saldo inicial no meio de 2023: o movimento anterior a ele não entra no razão.
  { id: 'b1', clientId: 'c1', accountKey: 'k1', nickname: 'Itaú', ledgerAccountId: 'banco', openingBalance: 1000, openingDate: '2023-02-28', createdAt: '', updatedAt: '' },
  // Banco sem vínculo contábil.
  { id: 'b2', clientId: 'c1', accountKey: 'k2', nickname: 'Caixa', createdAt: '', updatedAt: '' },
];

const openings: OpeningBalances = { id: 'c1', clientId: 'c1', date: '2023-02-28', entries: [{ accountId: 'capital', amount: 1000 }], updatedAt: '' };

let seq = 0;
const tx = (date: string, amount: number, extra: Partial<BankTransaction> = {}): BankTransaction => ({
  id: `t${++seq}`,
  clientId: 'c1',
  fitid: `f${seq}`,
  date,
  amount,
  type: amount < 0 ? 'DEBIT' : 'CREDIT',
  memo: `memo ${seq}`,
  status: 'RECONCILED',
  accountKey: 'k1',
  createdAt: '',
  ...extra,
});

/** Três exercícios de movimento, com todos os casos que mudam a conta de destino. */
const transactions: BankTransaction[] = [
  tx('2023-01-15', -50, { accountId: 'despesa' }), // anterior ao saldo inicial do banco: ignorado
  tx('2023-03-10', 800.1, { accountId: 'receita' }),
  tx('2023-03-12', -120.33, { accountId: 'despesa' }),
  tx('2023-06-30', -300, { isSplit: true, splits: [{ id: 's1', accountId: 'despesa', amount: -200.5, memo: '' }, { id: 's2', accountId: 'tarifas', amount: -99.5, memo: '' }] }),
  tx('2023-11-05', -75, { status: 'PENDING' }), // fica em "a classificar"
  tx('2023-12-20', 410, { accountId: 'conta-removida' }), // conta que não existe mais
  tx('2023-12-28', 60, { accountKey: 'k2', accountId: 'receita' }), // banco sem vínculo
  tx('2024-02-01', -90.9, { accountId: 'fornecedores' }),
  tx('2024-07-19', 1500, { accountId: 'receita' }),
  tx('2024-12-31', -33.33, { status: 'AUTO_CLASSIFIED', accountId: 'tarifas' }),
  tx('2025-01-10', 700, { accountId: 'receita' }),
  tx('2025-02-14', -210.45, { accountId: 'despesa' }),
  tx('2025-03-03', -18, { accountId: 'tarifas' }),
];

const journal = (id: string, date: string, debit: string, credit: string, amount: number): JournalEntry => ({
  id,
  clientId: 'c1',
  entryNumber: 1,
  date,
  memo: id,
  category: 'OTHER',
  lines: [
    { id: 'd', accountId: debit, type: 'DEBIT', amount },
    { id: 'c', accountId: credit, type: 'CREDIT', amount },
  ],
  totalAmount: amount,
  createdAt: '',
  updatedAt: '',
  createdByUid: 'u',
});
const journals = [journal('j1', '2023-12-31', 'despesa', 'fornecedores', 250), journal('j2', '2025-01-31', 'clientes', 'receita', 80)];

const lock = (month: string, lockedAt = 'T'): PeriodLock => ({ id: `c1_${month}`, clientId: 'c1', month, lockedAt, lockedByUid: 'u' });
const monthsOf = (list: readonly BankTransaction[]) => [...new Set(list.map((t) => t.date.slice(0, 7)))];
const allLocked = (until: string) => monthsOf(transactions.filter((t) => t.date <= until)).map((m) => lock(m));

const snapshotAt = (month: string, base: ReturnType<typeof buildSnapshot> = null, locks = allLocked(monthEnd(month))) =>
  buildSnapshot({
    clientId: 'c1',
    month,
    base,
    transactions: transactions.filter((t) => t.date <= monthEnd(month) && (!base || t.date > base.asOf)),
    banks,
    accounts,
    locks,
    createdAt: 'agora',
  });

describe('saldos consolidados de competências fechadas', () => {
  it('monthEnd devolve o último dia do mês, inclusive em ano bissexto', () => {
    expect(monthEnd('2024-02')).toBe('2024-02-29');
    expect(monthEnd('2023-02')).toBe('2023-02-28');
    expect(monthEnd('2024-12')).toBe('2024-12-31');
  });

  it('balancete, balanço, razão e conferência com a DRE saem idênticos com snapshot ou com o histórico inteiro', () => {
    const snap = snapshotAt('2024-12')!;
    expect(snap).not.toBeNull();
    const after = transactions.filter((t) => t.date > snap.asOf);
    const carry = carryOf(snap);
    expect(after).toHaveLength(3);

    for (const range of [
      { start: '2025-01-01', end: '2025-01-31' },
      { start: '2025-03-01', end: '2025-03-31' },
      { start: '2025-01-01', end: '2025-12-31' },
    ]) {
      const full = buildPostings(transactions, banks, accounts, range.end, openings, journals);
      const resumed = buildPostings(after, banks, accounts, range.end, openings, journals, carry);
      expect(buildTrialBalance(resumed, accounts, range)).toEqual(buildTrialBalance(full, accounts, range));
      expect(buildBalanceSheet(resumed, accounts, range.end)).toEqual(buildBalanceSheet(full, accounts, range.end));
      for (const accountId of ['banco', 'ativo', 'receita', 'despesa', 'fornecedores', '__suspense__', '__bank_unlinked__']) {
        const options = { accountId, accounts, bankAccounts: banks, range, openings, journalEntries: journals };
        expect(buildAccountLedger({ ...options, transactions: after, carry })).toEqual(buildAccountLedger({ ...options, transactions }));
      }
      const consistency = { accounts, banks, date: range.end, openings, journalEntries: journals };
      const withSnapshot = checkAccountingConsistency({ ...consistency, transactions: after, carry });
      const withHistory = checkAccountingConsistency({ ...consistency, transactions });
      expect(withSnapshot.balanceSheet).toEqual(withHistory.balanceSheet);
      expect(withSnapshot.difference).toBe(withHistory.difference);
      expect(withSnapshot.dreNetResult).toBe(withHistory.dreNetResult);
    }
  });

  it('o balanço fecha (ativo = passivo + PL) partindo do snapshot', () => {
    const snap = snapshotAt('2024-12')!;
    const postings = buildPostings(transactions.filter((t) => t.date > snap.asOf), banks, accounts, '2025-03-31', openings, journals, carryOf(snap));
    expect(buildBalanceSheet(postings, accounts, '2025-03-31').difference).toBe(0);
  });

  it('o saldo de cada banco sai idêntico com snapshot ou com o histórico inteiro', () => {
    const snap = snapshotAt('2024-12')!;
    const after = transactions.filter((t) => t.date > snap.asOf);
    const carried = new Map(snap.bankMovements.map((b) => [b.accountKey, b.value] as const));
    for (const bank of banks) {
      for (const date of ['2024-12-31', '2025-01-31', '2025-12-31']) {
        expect(bankBalanceAt(bank, after, date, carried.get(bank.accountKey))).toBe(bankBalanceAt(bank, transactions, date));
      }
    }
    // O lançamento de jan/2023 é anterior ao saldo inicial do Itaú: não entra na movimentação.
    expect(carried.get('k1')).toBe(bankBalanceAt({ ...banks[0], openingBalance: 0 }, transactions, '2024-12-31'));
    expect(carried.get('k2')).toBe(60);
    expect(snap.unlinkedCount).toBe(0);

    // Lançamento de extrato sem banco/conta: só é contado.
    const loose = buildSnapshot({
      clientId: 'c1',
      month: '2023-03',
      base: null,
      transactions: [tx('2023-03-15', 10, { accountKey: undefined })],
      banks,
      accounts,
      locks: [lock('2023-03')],
      createdAt: '',
    });
    expect(loose).toMatchObject({ bankMovements: [], unlinkedCount: 1, txCount: 1 });
  });

  it('encadear snapshots (dez/2023 → dez/2024) dá o mesmo que consolidar de uma vez', () => {
    const chained = snapshotAt('2024-12', snapshotAt('2023-12'));
    const direct = snapshotAt('2024-12');
    expect(chained).toEqual(direct);
    expect(direct?.txCount).toBe(10);
    expect(direct?.months.find((m) => m.month === '2023-11')).toEqual({ month: '2023-11', total: 1, pending: 1, auto: 0, reconciled: 0 });
    expect(direct?.months.find((m) => m.month === '2024-12')).toMatchObject({ total: 1, auto: 1 });
  });

  it('não consolida enquanto houver competência com lançamentos em aberto', () => {
    const locks = allLocked('2024-12-31').filter((l) => l.month !== '2023-06');
    expect(snapshotAt('2024-12', null, locks)).toBeNull();
    // Até o mês anterior ao aberto, pode.
    expect(snapshotAt('2023-03', null, locks)).not.toBeNull();
    expect(snapshotTarget(locks, monthsOf(transactions), '2025-01')).toBe('2023-03');
    expect(snapshotTarget(allLocked('2024-12-31'), monthsOf(transactions), '2025-01')).toBe('2024-12');
    expect(snapshotTarget(allLocked('2024-12-31'), monthsOf(transactions), '2024-01')).toBe('2023-12');
    expect(snapshotTarget([], monthsOf(transactions))).toBeNull();
  });

  it('recusa lançamentos fora do intervalo que o snapshot cobre', () => {
    const args = { clientId: 'c1', month: '2023-12', base: null, banks, accounts, locks: allLocked('2025-12-31'), createdAt: '' };
    expect(() => buildSnapshot({ ...args, transactions })).toThrow(/fora do intervalo/);
    expect(() => buildSnapshot({ ...args, month: '2024-12', base: snapshotAt('2023-12'), transactions: transactions.filter((t) => t.date <= '2024-12-31') })).toThrow(
      /fora do intervalo/
    );
  });

  it('deixa de valer quando algo que ele resume pode ter mudado', () => {
    const snap = snapshotAt('2024-12')!;
    const locks = allLocked('2024-12-31');
    expect(snapshotProblem(snap, { banks, accounts, locks })).toBeNull();
    // Competência reaberta, ou reaberta e fechada de novo (outro fechamento).
    expect(snapshotProblem(snap, { banks, accounts, locks: locks.filter((l) => l.month !== '2023-06') })).toMatch(/2023-06 reaberta/);
    expect(snapshotProblem(snap, { banks, accounts, locks: locks.map((l) => (l.month === '2023-06' ? lock('2023-06', 'T2') : l)) })).toMatch(/reaberta/);
    // Banco religado a outra conta, data do saldo inicial alterada, conta criada ou excluída.
    expect(snapshotProblem(snap, { banks: banks.map((b) => (b.id === 'b2' ? { ...b, ledgerAccountId: 'clientes' } : b)), accounts, locks })).toMatch(/bancos ou plano/);
    expect(snapshotProblem(snap, { banks: banks.map((b) => (b.id === 'b1' ? { ...b, openingDate: '2023-01-01' } : b)), accounts, locks })).toMatch(/bancos ou plano/);
    expect(snapshotProblem(snap, { banks, accounts: [...accounts, account('conta-removida', '4.9', 'EXPENSE')], locks })).toMatch(/bancos ou plano/);
    expect(snapshotProblem(snap, { banks, accounts: accounts.filter((a) => a.id !== 'tarifas'), locks })).toMatch(/bancos ou plano/);
    // Só o valor do saldo inicial ou o nome das contas não afetam as partidas dos lançamentos.
    expect(snapshotProblem(snap, { banks: banks.map((b) => ({ ...b, openingBalance: 5, nickname: 'x' })), accounts: accounts.map((a) => ({ ...a, name: 'y' })), locks })).toBeNull();
    // Documento adulterado.
    expect(snapshotProblem({ ...snap, asOf: '2024-12-30' }, { banks, accounts, locks })).toMatch(/data/);
    expect(snapshotProblem({ ...snap, locks: snap.locks.slice(1) }, { banks, accounts, locks })).toMatch(/sem fechamento/);
  });

  it('a chave de configuração não depende da ordem', () => {
    expect(ledgerConfigKey([...banks].reverse(), [...accounts].reverse())).toBe(ledgerConfigKey(banks, accounts));
  });
});
