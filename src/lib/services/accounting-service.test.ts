import { beforeEach, describe, expect, it } from 'vitest';
import { deleteChartAccount } from '@/lib/services/accounting-service';
import { createLocalRepository, type KeyValueStore } from '@/lib/data/local-repository';
import { setSession } from '@/lib/data/scope';
import type { ChartAccount, ClassificationRule, BankAccount, BankTransaction, ImportBatch } from '@/types/firestore';
import { newAccountId, newBatchId, newClientId, newRuleId, newSplitId } from '@/lib/utils/id';

function memoryStore(): KeyValueStore {
  const dump = new Map<string, string>();
  return { getItem: (k) => dump.get(k) ?? null, setItem: (k, v) => void dump.set(k, v) };
}

describe('deleteChartAccount e integridade referencial', () => {
  let store: KeyValueStore;
  let repo: ReturnType<typeof createLocalRepository>;

  beforeEach(() => {
    store = memoryStore();
    repo = createLocalRepository(store);
    setSession('org-1', { uid: 'user-1', email: 'user@teste.com' });
  });

  const account = (id: string, code: string, name: string, extra: Partial<ChartAccount> = {}): ChartAccount => ({
    id,
    clientId: 'c1',
    code,
    name,
    type: 'EXPENSE',
    nature: 'ANALYTIC',
    level: code.split('.').length,
    createdAt: '',
    updatedAt: '',
    ...extra,
  });

  it('bloqueia exclusão de contas globais', async () => {
    const acc = account('g1', '1.1', 'Global', { clientId: 'global' });
    await expect(deleteChartAccount(acc, repo)).rejects.toThrow(/compartilhad/);
  });

  it('bloqueia exclusão de conta com subcontas (por parentId ou código)', async () => {
    const parent = account('p1', '3.1', 'Despesas');
    const child = account('ch1', '3.1.01', 'Despesas Operacionais', { parentId: 'p1' });
    await repo.insertAccounts([parent, child]);

    await expect(deleteChartAccount(parent, repo)).rejects.toThrow(/subconta/);
  });

  it('bloqueia exclusão de conta vinculada a regra de classificação', async () => {
    const acc = account('a1', '3.1.01.001', 'Material');
    const rule: ClassificationRule = {
      id: 'r1',
      clientId: 'c1',
      pattern: 'PAPELARIA',
      accountId: 'a1',
      createdAt: '',
      updatedAt: '',
    };
    await repo.insertAccounts([acc]);
    await repo.saveRule(rule);

    await expect(deleteChartAccount(acc, repo)).rejects.toThrow(/regra/);
  });

  it('bloqueia exclusão de conta vinculada como conta contábil de banco', async () => {
    const acc = account('b1', '1.1.1.02.001', 'Banco do Brasil');
    const bank: BankAccount = {
      id: 'bb',
      clientId: 'c1',
      accountKey: '001-1234-5678',
      nickname: 'BB Movimento',
      ledgerAccountId: 'b1',
      createdAt: '',
      updatedAt: '',
    };
    await repo.insertAccounts([acc]);
    await repo.saveBankAccount(bank);

    await expect(deleteChartAccount(acc, repo)).rejects.toThrow(/banco/);
  });

  it('bloqueia exclusão de conta com saldo de abertura', async () => {
    const acc = account('o1', '1.1.2.01', 'Clientes a Receber');
    await repo.insertAccounts([acc]);
    await repo.saveOpeningBalances(
      {
        id: 'c1',
        clientId: 'c1',
        date: '2024-12-31',
        entries: [{ accountId: 'o1', amount: 500 }],
        updatedAt: '',
      },
      { id: 'aud1', clientId: 'c1', action: 'OPENING_SAVE', actorUid: 'user-1', at: '' }
    );

    await expect(deleteChartAccount(acc, repo)).rejects.toThrow(/saldo de abertura/);
  });

  it('bloqueia exclusão de conta que recebeu lançamentos (diretos ou rateios)', async () => {
    const accDirect = account('d1', '3.1.01.001', 'Combustível');
    const accSplit = account('s1', '3.1.01.002', 'Pedágio');
    await repo.insertAccounts([accDirect, accSplit]);

    const txDirect: BankTransaction = {
      id: 't1',
      clientId: 'c1',
      fitid: 'f1',
      date: '2025-01-15',
      amount: -120,
      type: 'DEBIT',
      memo: 'POSTO IPIRANGA',
      status: 'RECONCILED',
      accountId: 'd1',
      createdAt: '',
    };

    const txSplit: BankTransaction = {
      id: 't2',
      clientId: 'c1',
      fitid: 'f2',
      date: '2025-01-16',
      amount: -50,
      type: 'DEBIT',
      memo: 'SEM PARAR',
      status: 'RECONCILED',
      isSplit: true,
      splits: [{ id: 'sp1', accountId: 's1', amount: -50, memo: '' }],
      createdAt: '',
    };

    await repo.insertTransactions([txDirect, txSplit]);

    await expect(deleteChartAccount(accDirect, repo)).rejects.toThrow(/lançamento/);
    await expect(deleteChartAccount(accSplit, repo)).rejects.toThrow(/lançamento/);
  });

  it('permite excluir conta limpa e grava registro ACCOUNT_DELETE na auditoria', async () => {
    const acc = account('free1', '3.1.99.999', 'Conta Temporária Sem Uso');
    await repo.insertAccounts([acc]);

    expect((await repo.listAccounts('c1')).some((a) => a.id === 'free1')).toBe(true);

    await deleteChartAccount(acc, repo);

    expect((await repo.listAccounts('c1')).some((a) => a.id === 'free1')).toBe(false);

    const audits = await repo.listAudit('c1');
    const delAudit = audits.find((a) => a.action === 'ACCOUNT_DELETE');
    expect(delAudit).toBeDefined();
    expect(delAudit?.note).toContain('3.1.99.999');
    expect(delAudit?.note).toContain('Conta Temporária Sem Uso');
    expect(delAudit?.actorUid).toBe('user-1');
  });
});

describe('gerador de IDs únicos (sem colisões de Date.now)', () => {
  it('gera IDs válidos com prefixos corretos usando UUID v4', () => {
    const clientId = newClientId();
    const accountId = newAccountId();
    const ruleId = newRuleId();
    const batchId = newBatchId();
    const splitId = newSplitId();

    expect(clientId).toMatch(/^client_[0-9a-f-]+$/);
    expect(accountId).toMatch(/^acc_[0-9a-f-]+$/);
    expect(ruleId).toMatch(/^rule_[0-9a-f-]+$/);
    expect(batchId).toMatch(/^batch_[0-9a-f-]+$/);
    expect(splitId).toMatch(/^split_[0-9a-f-]+$/);

    // Unicidade
    const set = new Set([newRuleId(), newRuleId(), newRuleId()]);
    expect(set.size).toBe(3);
  });
});

describe('gravação do lote antes dos lançamentos', () => {
  it('registra o batch como COMPLETED em caso de sucesso', async () => {
    const store = memoryStore();
    const repo = createLocalRepository(store);
    const batch: ImportBatch = {
      id: 'batch_test_1',
      clientId: 'c1',
      fileName: 'teste.ofx',
      fileSize: 100,
      totalTransactions: 1,
      importedCount: 1,
      duplicateCount: 0,
      autoClassifiedCount: 0,
      totalDebit: 10,
      totalCredit: 0,
      importedAt: '2025-01-01T10:00:00Z',
    };

    const tx: BankTransaction = {
      id: 'tx_b1',
      clientId: 'c1',
      fitid: 'f1',
      date: '2025-01-15',
      amount: -10,
      type: 'DEBIT',
      memo: 'TESTE',
      status: 'PENDING',
      createdAt: '',
      importBatchId: batch.id,
    };

    await repo.insertTransactions([tx], batch);

    const batches = await repo.listImportBatches('c1');
    expect(batches).toHaveLength(1);
    expect(batches[0].status).toBe('COMPLETED');
    expect(batches[0].id).toBe('batch_test_1');
  });
});
