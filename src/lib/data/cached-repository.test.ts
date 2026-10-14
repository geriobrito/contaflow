import { beforeEach, describe, expect, it } from 'vitest';
import type { BankAccount, ChartAccount, PeriodLock } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { withReadCache } from '@/lib/data/cached-repository';
import { createLocalRepository, type KeyValueStore } from '@/lib/data/local-repository';

function memoryStore(): KeyValueStore {
  const dump = new Map<string, string>();
  return { getItem: (k) => dump.get(k) ?? null, setItem: (k, v) => void dump.set(k, v) };
}

const account = (id: string, clientId = 'c1'): ChartAccount => ({ id, clientId, code: id, name: id, type: 'ASSET', nature: 'ANALYTIC', level: 1, createdAt: '', updatedAt: '' });
const bank = (key: string): BankAccount => ({ id: `c1_${key}`, clientId: 'c1', accountKey: key, nickname: key, createdAt: '', updatedAt: '' });
const lock = (month: string): PeriodLock => ({ id: `c1_${month}`, clientId: 'c1', month, lockedAt: 'T', lockedByUid: 'u' });
const audit = { id: '', clientId: 'c1', action: 'PERIOD_CLOSE' as const, actorUid: 'u', at: 'T' };

describe('cache de leitura do plano, bancos e fechamentos', () => {
  let inner: DataRepository;
  let repo: DataRepository;
  let reads: Record<'accounts' | 'banks' | 'locks', number>;
  let scope: string;
  let clock: number;

  beforeEach(() => {
    const local = createLocalRepository(memoryStore());
    reads = { accounts: 0, banks: 0, locks: 0 };
    scope = 'org-1';
    clock = 0;
    const counted =
      <A extends unknown[], R>(name: keyof typeof reads, read: (...args: A) => R) =>
      (...args: A): R => {
        reads[name]++;
        return read(...args);
      };
    inner = {
      ...local,
      listAccounts: counted('accounts', local.listAccounts),
      listBankAccounts: counted('banks', local.listBankAccounts),
      listPeriodLocks: counted('locks', local.listPeriodLocks),
    };
    repo = withReadCache(inner, () => scope, { ttlMs: 1000, now: () => clock });
  });

  it('lê uma vez por cliente, inclusive com pedidos simultâneos', async () => {
    await inner.insertAccounts([account('a1'), account('a2', 'c2')]);
    const [x, y] = await Promise.all([repo.listAccounts('c1'), repo.listAccounts('c1')]);
    expect(x.map((a) => a.id)).toEqual(['a1']);
    expect(y).toEqual(x);
    await repo.listAccounts('c1');
    expect(reads.accounts).toBe(1);
    expect((await repo.listAccounts('c2')).map((a) => a.id)).toEqual(['a2']);
    expect(reads.accounts).toBe(2);
  });

  it('devolve cópias: alterar a lista recebida não afeta a próxima leitura', async () => {
    await inner.insertAccounts([account('a1')]);
    (await repo.listAccounts('c1')).push(account('intrusa'));
    expect(await repo.listAccounts('c1')).toHaveLength(1);
  });

  it('cada gravação invalida só o que altera', async () => {
    await repo.listAccounts('c1');
    await repo.listBankAccounts('c1');
    await repo.listPeriodLocks('c1');

    await repo.insertAccounts([account('a1')]);
    expect((await repo.listAccounts('c1')).map((a) => a.id)).toEqual(['a1']);
    await repo.saveAccount({ ...account('a1'), name: 'novo nome' });
    expect((await repo.listAccounts('c1'))[0].name).toBe('novo nome');
    await repo.deleteAccount('a1');
    expect(await repo.listAccounts('c1')).toEqual([]);
    expect(reads).toEqual({ accounts: 4, banks: 1, locks: 1 });

    await repo.saveBankAccount(bank('k1'));
    expect(await repo.listBankAccounts('c1')).toHaveLength(1);
    await repo.saveChartSetup({ accounts: [account('a2')], bankAccounts: [bank('k2')] });
    expect(await repo.listAccounts('c1')).toHaveLength(1);
    expect(await repo.listBankAccounts('c1')).toHaveLength(2);
    expect(reads).toEqual({ accounts: 5, banks: 3, locks: 1 });

    await repo.closePeriod(lock('2025-01'), audit);
    expect((await repo.listPeriodLocks('c1')).map((l) => l.month)).toEqual(['2025-01']);
    await repo.reopenPeriod(lock('2025-01'), { ...audit, action: 'PERIOD_REOPEN' });
    expect(await repo.listPeriodLocks('c1')).toEqual([]);
    expect(reads).toEqual({ accounts: 5, banks: 3, locks: 3 });

    await repo.deleteClient('c1', { uid: 'u' });
    expect(await repo.listAccounts('c1')).toEqual([]);
    expect(await repo.listBankAccounts('c1')).toEqual([]);
  });

  it('leitura iniciada durante uma gravação não fica guardada', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = withReadCache(
      {
        ...inner,
        saveAccount: async (acc) => {
          await gate;
          await inner.saveAccount(acc);
        },
      },
      () => scope
    );
    const writing = slow.saveAccount(account('a1'));
    expect(await slow.listAccounts('c1')).toEqual([]); // lida antes de a gravação terminar
    release();
    await writing;
    expect((await slow.listAccounts('c1')).map((a) => a.id)).toEqual(['a1']);
  });

  it('falha de leitura não fica guardada', async () => {
    let fail = true;
    const flaky = withReadCache({ ...inner, listPeriodLocks: (id) => (fail ? Promise.reject(new Error('rede')) : inner.listPeriodLocks(id)) }, () => scope);
    await expect(flaky.listPeriodLocks('c1')).rejects.toThrow('rede');
    fail = false;
    expect(await flaky.listPeriodLocks('c1')).toEqual([]);
  });

  it('expira depois da validade e nunca mistura escritórios', async () => {
    await repo.listBankAccounts('c1');
    clock = 999;
    await repo.listBankAccounts('c1');
    expect(reads.banks).toBe(1);
    clock = 1000;
    await repo.listBankAccounts('c1');
    expect(reads.banks).toBe(2);

    scope = 'org-2';
    await repo.listBankAccounts('c1');
    expect(reads.banks).toBe(3);
  });
});
