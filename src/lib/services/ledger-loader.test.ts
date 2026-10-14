import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BankAccount, BankTransaction, ChartAccount, PeriodLock } from '@/types/firestore';
import type { DataRepository, DateRange } from '@/lib/data/repository';
import { createLocalRepository, type KeyValueStore } from '@/lib/data/local-repository';
import { loadLedgerWindow } from '@/lib/services/ledger-loader';
import { bankBalanceAt } from '@/lib/bank-accounts';
import { buildBalanceSheet, buildPostings } from '@/lib/ledger';
import { buildDashboard } from '@/lib/dashboard';

function memoryStore(): KeyValueStore {
  const dump = new Map<string, string>();
  return { getItem: (k) => dump.get(k) ?? null, setItem: (k, v) => void dump.set(k, v) };
}

const account = (id: string, code: string, type: ChartAccount['type']): ChartAccount => ({
  id,
  clientId: 'c1',
  code,
  name: id,
  type,
  nature: 'ANALYTIC',
  level: 2,
  createdAt: '',
  updatedAt: '',
});
const accounts = [account('banco', '1.1', 'ASSET'), account('receita', '3.1', 'REVENUE'), account('despesa', '4.1', 'EXPENSE')];
const banks: BankAccount[] = [{ id: 'b1', clientId: 'c1', accountKey: 'k1', nickname: 'Itaú', ledgerAccountId: 'banco', createdAt: '', updatedAt: '' }];

const tx = (id: string, date: string, amount: number, extra: Partial<BankTransaction> = {}): BankTransaction => ({
  id,
  clientId: 'c1',
  fitid: id,
  date,
  amount,
  type: amount < 0 ? 'DEBIT' : 'CREDIT',
  memo: id,
  status: 'RECONCILED',
  accountId: amount < 0 ? 'despesa' : 'receita',
  accountKey: 'k1',
  createdAt: '',
  ...extra,
});

const history = [
  tx('a', '2023-05-10', 1000),
  tx('b', '2023-11-20', -250.5),
  tx('c', '2024-03-03', 400),
  tx('d', '2024-12-15', -80, { status: 'PENDING', accountId: undefined }),
  tx('e', '2025-01-08', 300),
  tx('f', '2025-02-09', -45.25),
];

describe('carregamento do razão por janela (snapshot + período aberto)', () => {
  let repo: DataRepository;
  /** Intervalos pedidos a `listTransactions`: mostra quanto do histórico foi lido. */
  let reads: (DateRange | undefined)[];

  const close = (month: string, lockedAt = 'T') => {
    const lock: PeriodLock = { id: `c1_${month}`, clientId: 'c1', month, lockedAt, lockedByUid: 'u' };
    return repo.closePeriod(lock, { id: '', clientId: 'c1', action: 'PERIOD_CLOSE', actorUid: 'u', at: 'T', month });
  };
  const load = (from?: string, until?: string) => loadLedgerWindow({ clientId: 'c1', accounts, banks, from, until }, repo);
  const balanceAt = async (date: string, w: Awaited<ReturnType<typeof load>>) =>
    buildBalanceSheet(buildPostings(w.transactions, banks, accounts, date, null, null, w.carry), accounts, date);
  const fullBalanceAt = async (date: string) =>
    buildBalanceSheet(buildPostings(await repo.listTransactions('c1'), banks, accounts, date), accounts, date);

  beforeEach(async () => {
    const local = createLocalRepository(memoryStore());
    reads = [];
    repo = {
      ...local,
      listTransactions: (clientId, range) => {
        reads.push(range);
        return local.listTransactions(clientId, range);
      },
    };
    await repo.insertTransactions(history);
  });

  it('sem competência fechada lê o histórico inteiro e não grava snapshot', async () => {
    const w = await load('2025-01-01', '2025-12-31');
    expect(w.asOf).toBeNull();
    expect(w.carry).toEqual([]);
    expect(w.transactions).toHaveLength(6);
    expect(await repo.listPeriodSnapshots('c1')).toEqual([]);
  });

  it('com os meses anteriores fechados: grava o snapshot na primeira leitura e depois lê só o exercício', async () => {
    for (const m of ['2023-05', '2023-11', '2024-03', '2024-12']) await close(m);

    const first = await load('2025-01-01', '2025-12-31');
    expect(first.asOf).toBe('2024-12-31');
    expect(first.transactions.map((t) => t.id).sort()).toEqual(['e', 'f']);
    expect(first.carriedCount).toBe(4);
    expect((await repo.listPeriodSnapshots('c1')).map((s) => s.month)).toEqual(['2024-12']);

    reads = [];
    const second = await load('2025-01-01', '2025-12-31');
    expect(reads).toEqual([{ start: '2025-01-01', end: '2025-12-31' }]);
    expect(second).toEqual(first);
    expect(await balanceAt('2025-02-28', second)).toEqual(await fullBalanceAt('2025-02-28'));
    // O pendente de dez/2024 segue em "a classificar" via snapshot.
    expect((await balanceAt('2025-02-28', second)).suspense).toBe(80);
  });

  it('exercício anterior usa um snapshot mais antigo, nunca um posterior ao início dele', async () => {
    for (const m of ['2023-05', '2023-11', '2024-03', '2024-12']) await close(m);
    await load('2025-01-01', '2025-12-31');
    const w = await load('2024-01-01', '2024-12-31');
    expect(w.asOf).toBe('2023-11-30');
    expect(w.transactions.map((t) => t.id).sort()).toEqual(['c', 'd']);
    expect(await balanceAt('2024-12-31', w)).toEqual(await fullBalanceAt('2024-12-31'));
    expect((await repo.listPeriodSnapshots('c1')).map((s) => s.month).sort()).toEqual(['2023-11', '2024-12']);
  });

  it('importar extrato em competência fechada invalida o snapshot (a contagem muda) e ele é refeito', async () => {
    for (const m of ['2023-05', '2023-11', '2024-03', '2024-12']) await close(m);
    await load('2025-01-01', '2025-12-31');

    await repo.insertTransactions([tx('novo', '2024-03-20', -999, { status: 'PENDING', accountId: undefined })]);
    reads = [];
    const w = await load('2025-01-01', '2025-12-31');
    // Releu tudo, incluiu o lançamento novo no consolidado e regravou.
    expect(reads[0]?.start).toBe('0000-01-01');
    expect(w.carriedCount).toBe(5);
    expect((await balanceAt('2025-02-28', w)).suspense).toBe(1079);
    expect(await balanceAt('2025-02-28', w)).toEqual(await fullBalanceAt('2025-02-28'));
    expect((await repo.listPeriodSnapshots('c1'))[0].txCount).toBe(5);

    reads = [];
    await load('2025-01-01', '2025-12-31');
    expect(reads).toEqual([{ start: '2025-01-01', end: '2025-12-31' }]);
  });

  it('reabrir uma competência invalida o snapshot; o consolidado recua para antes dela', async () => {
    for (const m of ['2023-05', '2023-11', '2024-03', '2024-12']) await close(m);
    await load('2025-01-01', '2025-12-31');
    const [reopened] = (await repo.listPeriodLocks('c1')).filter((l) => l.month === '2024-03');
    await repo.reopenPeriod(reopened, { id: '', clientId: 'c1', action: 'PERIOD_REOPEN', actorUid: 'u', at: 'T', month: '2024-03' });

    const w = await load('2025-01-01', '2025-12-31');
    expect(w.asOf).toBe('2023-11-30');
    expect(w.transactions.map((t) => t.id).sort()).toEqual(['c', 'd', 'e', 'f']);
    expect(await balanceAt('2025-02-28', w)).toEqual(await fullBalanceAt('2025-02-28'));

    // Fechada de novo (outro fechamento), volta a consolidar até dezembro.
    await close('2024-03', 'T2');
    expect((await load('2025-01-01', '2025-12-31')).asOf).toBe('2024-12-31');
  });

  it('trocar o vínculo contábil do banco invalida o snapshot', async () => {
    for (const m of ['2023-05', '2023-11', '2024-03', '2024-12']) await close(m);
    await load('2025-01-01', '2025-12-31');
    const unlinked = [{ ...banks[0], ledgerAccountId: undefined }];
    reads = [];
    const w = await loadLedgerWindow({ clientId: 'c1', accounts, banks: unlinked, from: '2025-01-01', until: '2025-12-31' }, repo);
    expect(reads[0]?.start).toBe('0000-01-01');
    const date = '2025-02-28';
    const resumed = buildBalanceSheet(buildPostings(w.transactions, unlinked, accounts, date, null, null, w.carry), accounts, date);
    expect(resumed).toEqual(buildBalanceSheet(buildPostings(await repo.listTransactions('c1'), unlinked, accounts, date), accounts, date));
    expect(resumed.unlinkedBanks).not.toBe(0);
  });

  it('falha ao ler ou gravar snapshots não impede o relatório: lê o histórico completo', async () => {
    for (const m of ['2023-05', '2023-11', '2024-03', '2024-12']) await close(m);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const denied = () => Promise.reject(new Error('Missing or insufficient permissions'));
    const broken: DataRepository = { ...repo, listPeriodSnapshots: denied, savePeriodSnapshot: denied };
    const w = await loadLedgerWindow({ clientId: 'c1', accounts, banks, from: '2025-01-01', until: '2025-12-31' }, broken);
    expect(await balanceAt('2025-02-28', w)).toEqual(await fullBalanceAt('2025-02-28'));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('contas e extratos: o saldo do banco parte do consolidado e nunca de uma data anterior a ele', async () => {
    for (const m of ['2023-05', '2023-11', '2024-03', '2024-12']) await close(m);
    await repo.insertTransactions([tx('solto', '2025-02-20', 12, { accountKey: undefined })]);
    const full = await repo.listTransactions('c1');
    const balance = (w: Awaited<ReturnType<typeof load>>, date: string) =>
      bankBalanceAt(banks[0], w.transactions, date, w.carriedBanks.find((b) => b.accountKey === 'k1')?.value);

    const recent = await load();
    expect(recent.asOf).toBe('2024-12-31');
    expect(recent.carriedBanks).toEqual([{ accountKey: 'k1', value: 1069.5 }]);
    expect(balance(recent, '2025-03-01')).toBe(bankBalanceAt(banks[0], full, '2025-03-01'));
    expect(recent.carriedUnlinked + recent.transactions.filter((t) => !t.accountKey).length).toBe(1);

    // Último saldo informado pelo banco em mar/2024: o consolidado termina antes desse mês.
    const older = await load('2024-03-31');
    expect(older.asOf).toBe('2023-11-30');
    expect(balance(older, '2024-03-31')).toBe(bankBalanceAt(banks[0], full, '2024-03-31'));
  });

  it('painel: meses fechados chegam como contagens e só o período aberto é lido', async () => {
    for (const m of ['2023-05', '2023-11', '2024-03', '2024-12']) await close(m);
    await load();
    reads = [];
    const w = await load();
    expect(reads).toEqual([{ start: '2025-01-01', end: '9999-12-31' }]);
    expect(w.transactions.map((t) => t.id).sort()).toEqual(['e', 'f']);

    const locks = await repo.listPeriodLocks('c1');
    const input = { client: { id: 'c1', name: 'A', cnpj: '', regime: 'MEI' as const, createdAt: '', updatedAt: '' }, accounts, batches: [], banks, locks, requests: [], org: null, openings: null, today: '2025-03-01', nowMs: 0 };
    const viaSnapshot = buildDashboard({ ...input, transactions: w.transactions, carriedMonths: w.carriedMonths, openQueries: [] });
    const viaHistory = buildDashboard({ ...input, transactions: await repo.listTransactions('c1') });
    expect(viaSnapshot.months).toEqual(viaHistory.months);
    expect(viaSnapshot.totals).toEqual(viaHistory.totals);
    expect(viaSnapshot.totals).toMatchObject({ transactions: 6, pending: 1, monthsLocked: 4 });
  });
});
