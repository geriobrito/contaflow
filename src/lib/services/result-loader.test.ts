import { beforeEach, describe, expect, it } from 'vitest';
import type { BankAccount, BankTransaction, ChartAccount, JournalEntry, PeriodLock } from '@/types/firestore';
import type { DataRepository, DateRange } from '@/lib/data/repository';
import { createLocalRepository, type KeyValueStore } from '@/lib/data/local-repository';
import { loadResultWindow } from '@/lib/services/result-loader';
import { buildDRE } from '@/lib/dre/build';
import { monthlyColumns } from '@/lib/dre/compare';
import { checkAccountingConsistency } from '@/lib/dre/consistency';
import { buildResultSummary, consecutiveRuns, summaryConfigKey, summaryProblem, wholeMonthsIn } from '@/lib/dre/summaries';

function memoryStore(): KeyValueStore {
  const dump = new Map<string, string>();
  return { getItem: (k) => dump.get(k) ?? null, setItem: (k, v) => void dump.set(k, v) };
}

const account = (id: string, code: string, type: ChartAccount['type'], extra: Partial<ChartAccount> = {}): ChartAccount => ({
  id,
  clientId: 'c1',
  code,
  name: id,
  type,
  nature: 'ANALYTIC',
  level: 2,
  createdAt: '',
  updatedAt: '',
  ...extra,
});
const accounts = [
  account('banco', '1.1.1.02', 'ASSET'),
  account('receita', '3.1.1.01', 'REVENUE'),
  account('despesa', '3.3.1.01', 'EXPENSE'),
  account('juros', '3.3.2.01', 'EXPENSE', { dreGroup: 'FINANCIAL_EXPENSES' }),
];
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
  tx('a', '2025-01-10', 1000),
  tx('b', '2025-01-20', -250.5),
  tx('c', '2025-02-03', 400),
  tx('d', '2025-02-15', -80, { status: 'PENDING', accountId: undefined }),
  tx('e', '2025-03-08', 300, { status: 'AUTO_CLASSIFIED' }),
  tx('f', '2025-03-09', -45.25, {
    isSplit: true,
    accountId: undefined,
    splits: [
      { id: 's1', memo: 'tarifa', accountId: 'despesa', amount: -40 },
      { id: 's2', memo: 'juros', accountId: 'juros', amount: -5.25 },
    ],
  }),
  tx('g', '2025-04-02', 700),
];

const journal: JournalEntry[] = [
  {
    id: 'j1',
    clientId: 'c1',
    entryNumber: 1,
    date: '2025-02-28',
    memo: 'provisão',
    lines: [
      { accountId: 'despesa', type: 'DEBIT', amount: 120 },
      { accountId: 'banco', type: 'CREDIT', amount: 120 },
    ],
    createdAt: '',
  } as JournalEntry,
];

const YEAR: DateRange = { start: '2025-01-01', end: '2025-04-30' };

describe('resumos da DRE de competências fechadas', () => {
  let repo: DataRepository;
  let reads: DateRange[];

  const close = (month: string, lockedAt = `${month}-T`) => {
    const lock: PeriodLock = { id: `c1_${month}`, clientId: 'c1', month, lockedAt, lockedByUid: 'u' };
    return repo.closePeriod(lock, { id: '', clientId: 'c1', action: 'PERIOD_CLOSE', actorUid: 'u', at: 'T', month });
  };
  const reopen = async (month: string) => {
    const lock = (await repo.listPeriodLocks('c1')).find((l) => l.month === month)!;
    return repo.reopenPeriod(lock, { id: '', clientId: 'c1', action: 'PERIOD_REOPEN', actorUid: 'u', at: 'T', month });
  };
  const load = async (range: DateRange = YEAR) =>
    loadResultWindow({ clientId: 'c1', range, accounts, banks, locks: await repo.listPeriodLocks('c1') }, repo);

  beforeEach(async () => {
    const local = createLocalRepository(memoryStore());
    reads = [];
    repo = {
      ...local,
      listTransactions: (clientId, range) => {
        if (range) reads.push(range);
        return local.listTransactions(clientId, range);
      },
    };
    await repo.insertTransactions(history);
  });

  it('a DRE com resumos é idêntica à calculada lançamento a lançamento', async () => {
    await close('2025-01');
    await close('2025-02');
    await close('2025-03');
    await load(); // monta os resumos
    reads = [];
    const w = await load();
    expect(w.summaries.map((s) => s.month)).toEqual(['2025-01', '2025-02', '2025-03']);
    // Só abril (aberto) foi lido lançamento a lançamento.
    expect(reads).toEqual([{ start: '2025-04-01', end: '2025-04-30' }]);

    const full = buildDRE(history, accounts, YEAR, journal);
    expect(buildDRE(w.transactions, accounts, YEAR, journal, w.summaries)).toEqual(full);
    // Colunas mês a mês e um trimestre também batem.
    expect(monthlyColumns(w.transactions, accounts, YEAR, journal, w.summaries)).toEqual(monthlyColumns(history, accounts, YEAR, journal));
    const q1 = { start: '2025-01-01', end: '2025-03-31' };
    expect(buildDRE(w.transactions, accounts, q1, journal, w.summaries)).toEqual(buildDRE(history, accounts, q1, journal));
  });

  it('a conferência DRE × balanço dá o mesmo resultado com os resumos', async () => {
    await close('2025-01');
    await close('2025-02');
    await load();
    const w = await load();
    expect(w.summaries).toHaveLength(2);
    const date = '2025-04-30';
    const viaSummaries = checkAccountingConsistency({ transactions: w.transactions, accounts, banks, date, journalEntries: journal, summaries: w.summaries });
    const viaFull = checkAccountingConsistency({ transactions: history, accounts, banks, date, journalEntries: journal });
    expect(viaSummaries.dreNetResult).toBe(viaFull.dreNetResult);
    expect(viaSummaries.balanceCurrentResult).toBe(viaFull.balanceCurrentResult);
    expect(viaSummaries.suspenseAmount).toBe(viaFull.suspenseAmount);
    expect(viaSummaries.pendingCount).toBe(viaFull.pendingCount);
    expect(viaSummaries.awaitingApprovalCount).toBe(viaFull.awaitingApprovalCount);
    expect(viaSummaries.issues.map((i) => i.id)).toEqual(viaFull.issues.map((i) => i.id));
  });

  it('mês cortado nas pontas do intervalo nunca vem do resumo', async () => {
    await close('2025-01');
    await load();
    const w = await load({ start: '2025-01-15', end: '2025-02-10' });
    expect(w.summaries).toEqual([]);
    expect(buildDRE(w.transactions, accounts, { start: '2025-01-15', end: '2025-02-10' })).toEqual(
      buildDRE(history, accounts, { start: '2025-01-15', end: '2025-02-10' })
    );
  });

  it('extrato importado em mês fechado invalida o resumo (contagem no servidor)', async () => {
    await close('2025-01');
    await load();
    await repo.insertTransactions([tx('x', '2025-01-25', 99, { status: 'PENDING', accountId: undefined })]);
    const w = await load();
    expect(w.summaries).toEqual([]);
    expect(w.rebuilt).toEqual(['2025-01']);
    // Refeito, volta a valer.
    expect((await load()).summaries.map((s) => s.month)).toEqual(['2025-01']);
  });

  it('reabrir e fechar de novo invalida o resumo', async () => {
    await close('2025-01', 'primeiro');
    await load();
    await reopen('2025-01');
    expect((await load()).summaries).toEqual([]);
    await close('2025-01', 'segundo');
    const w = await load();
    expect(w.summaries).toEqual([]);
    expect(w.rebuilt).toEqual(['2025-01']);
  });

  it('mudar o tipo de uma conta (resultado ↔ patrimonial) invalida o resumo', () => {
    const lock: PeriodLock = { id: 'c1_2025-01', clientId: 'c1', month: '2025-01', lockedAt: 'T', lockedByUid: 'u' };
    const s = buildResultSummary({ clientId: 'c1', month: '2025-01', transactions: history.slice(0, 2), banks, accounts, lockedAt: 'T', createdAt: '' });
    expect(summaryProblem(s, { lock, configKey: summaryConfigKey(banks, accounts) })).toBeNull();
    const changed = accounts.map((a) => (a.id === 'despesa' ? { ...a, type: 'ASSET' as const } : a));
    expect(summaryProblem(s, { lock, configKey: summaryConfigKey(banks, changed) })).toMatch(/plano/);
    expect(summaryProblem(s, { lock: undefined, configKey: summaryConfigKey(banks, accounts) })).toMatch(/reaberta/);
  });

  it('falha ao ler os resumos não impede a DRE: lê tudo', async () => {
    await close('2025-01');
    await load();
    const broken: DataRepository = { ...repo, listResultSummaries: () => Promise.reject(new Error('fora do ar')) };
    const w = await loadResultWindow({ clientId: 'c1', range: YEAR, accounts, banks, locks: await repo.listPeriodLocks('c1') }, broken);
    expect(w.summaries).toEqual([]);
    expect(buildDRE(w.transactions, accounts, YEAR)).toEqual(buildDRE(history, accounts, YEAR));
  });
});

describe('meses do intervalo', () => {
  it('só meses inteiros', () => {
    expect(wholeMonthsIn({ start: '2025-01-01', end: '2025-03-15' })).toEqual(['2025-01', '2025-02']);
    expect(wholeMonthsIn({ start: '2025-01-02', end: '2025-01-31' })).toEqual([]);
  });
  it('sequências consecutivas, inclusive na virada do ano', () => {
    expect(consecutiveRuns(['2025-03', '2024-12', '2025-01', '2025-05'])).toEqual([['2024-12', '2025-01'], ['2025-03'], ['2025-05']]);
  });
});
