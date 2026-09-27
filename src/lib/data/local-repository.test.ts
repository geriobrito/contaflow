import { beforeEach, describe, expect, it } from 'vitest';
import { createLocalRepository, LOCAL_KEYS, LOCAL_ORG_ID, type KeyValueStore } from '@/lib/data/local-repository';
import type { DataRepository } from '@/lib/data/repository';
import type { BankTransaction, ClassificationRule } from '@/types/firestore';

function memoryStore(): KeyValueStore & { dump: Map<string, string> } {
  const dump = new Map<string, string>();
  return { dump, getItem: (k) => dump.get(k) ?? null, setItem: (k, v) => void dump.set(k, v) };
}

const tx = (id: string, date: string, extra: Partial<BankTransaction> = {}): BankTransaction => ({
  id,
  clientId: 'c1',
  fitid: id,
  date,
  amount: -10,
  type: 'DEBIT',
  memo: `memo ${id}`,
  status: 'PENDING',
  createdAt: '',
  ...extra,
});

describe('repositório local (modo único, sem Firestore)', () => {
  let store: ReturnType<typeof memoryStore>;
  let repo: DataRepository;

  beforeEach(async () => {
    store = memoryStore();
    repo = createLocalRepository(store);
    await repo.insertTransactions([tx('a', '2025-01-10'), tx('b', '2025-02-10'), tx('c', '2025-03-10', { clientId: 'c2' })]);
  });

  it('carimba orgId e filtra por cliente e período (mais recente primeiro)', async () => {
    const all = await repo.listTransactions('c1');
    expect(all.map((t) => t.id)).toEqual(['b', 'a']);
    expect(all.every((t) => t.orgId === LOCAL_ORG_ID)).toBe(true);
    expect((await repo.listTransactions('c1', { start: '2025-02-01', end: '2025-02-28' })).map((t) => t.id)).toEqual(['b']);
    expect(await repo.latestTransactionDate('c1')).toBe('2025-02-10');
    expect(await repo.latestTransactionDate('nenhum')).toBeNull();
  });

  it('deduplica por ID existente', async () => {
    expect([...(await repo.findExistingTransactionIds('c1', ['a', 'z', 'c']))]).toEqual(['a']);
  });

  it('classificação, rateio e desfazer sobrescrevem o estado anterior', async () => {
    const rule: ClassificationRule = { id: 'r1', clientId: 'c1', pattern: 'memo', accountId: 'x', createdAt: '', updatedAt: '' };
    await repo.commitClassification({
      transactionId: 'a',
      account: { accountId: 'x', accountCode: '1', accountName: 'X' },
      rule,
      similarIds: ['b'],
      now: 'T1',
    });
    const [b, first] = await repo.listTransactions('c1');
    let a = first;
    expect(a).toMatchObject({ status: 'RECONCILED', accountId: 'x', matchedRuleId: 'r1', isSplit: false });
    expect(b).toMatchObject({ status: 'AUTO_CLASSIFIED', accountId: 'x', matchedRuleId: 'r1' });
    expect(await repo.listRules('c1')).toHaveLength(1);

    await repo.saveSplits('a', [{ id: 's', accountId: 'y', amount: -10, memo: '' }], 'T2');
    [, a] = await repo.listTransactions('c1');
    expect(a.isSplit).toBe(true);
    expect(a).not.toHaveProperty('accountId');
    expect(a).not.toHaveProperty('matchedRuleId');

    await repo.resetToPending('a');
    [, a] = await repo.listTransactions('c1');
    expect(a.status).toBe('PENDING');
    for (const f of ['accountId', 'splits', 'reconciledAt', 'matchedRuleId'] as const) expect(a).not.toHaveProperty(f);
  });

  it('falhas sobem ao chamador (sem sucesso falso)', async () => {
    await expect(repo.resetToPending('inexistente')).rejects.toThrow(/não encontrado/);
    store.setItem(LOCAL_KEYS.transactions, '{corrompido');
    await expect(repo.listTransactions('c1')).rejects.toThrow();
  });

  it('exclusão de cliente é em cascata e preserva outros clientes', async () => {
    await repo.saveClient({ id: 'c1', name: 'A', cnpj: '', regime: 'MEI', createdAt: '', updatedAt: '' });
    await repo.saveClient({ id: 'c2', name: 'B', cnpj: '', regime: 'MEI', createdAt: '', updatedAt: '' });
    await repo.deleteClient('c1');
    expect((await repo.listClients()).map((c) => c.id)).toEqual(['c2']);
    expect(await repo.listTransactions('c1')).toEqual([]);
    expect(await repo.listTransactions('c2')).toHaveLength(1);
    await expect(repo.deleteClient('global')).rejects.toThrow();
  });
});
