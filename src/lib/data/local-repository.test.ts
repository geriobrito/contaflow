import { beforeEach, describe, expect, it } from 'vitest';
import { createLocalRepository, LOCAL_KEYS, LOCAL_ORG_ID, type KeyValueStore } from '@/lib/data/local-repository';
import type { DataRepository } from '@/lib/data/repository';
import type { BankTransaction, ClassificationRule } from '@/types/firestore';
import { approveTransition, autoClassifyTransition, classifyTransition, resetTransition, splitTransition } from '@/lib/transitions';
import { transactionAudit } from '@/lib/audit';

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

  it('commitChanges aplica patches, regras e auditoria juntos; transições sobrescrevem o estado', async () => {
    const actor = { uid: 'u1', email: 'u1@x' };
    const ref = { accountId: 'x', accountCode: '1', accountName: 'X' };
    const rule: ClassificationRule = { id: 'r1', clientId: 'c1', pattern: 'memo', accountId: 'x', createdAt: '', updatedAt: '' };
    const [b0, a0] = await repo.listTransactions('c1');

    const c = classifyTransition(a0, ref, rule.id, 'T1');
    const auto = autoClassifyTransition(b0, ref, rule.id);
    await repo.commitChanges({
      patches: [c.patch, auto.patch],
      rules: [rule],
      audits: [transactionAudit('CLASSIFY', actor, a0, c.after, 'T1'), transactionAudit('AUTO_CLASSIFY', actor, b0, auto.after, 'T1')],
    });
    const [b, first] = await repo.listTransactions('c1');
    let a = first;
    expect(a).toMatchObject({ status: 'RECONCILED', accountId: 'x', matchedRuleId: 'r1', isSplit: false });
    expect(b).toMatchObject({ status: 'AUTO_CLASSIFIED', accountId: 'x', matchedRuleId: 'r1' });
    expect(await repo.listRules('c1')).toHaveLength(1);
    expect((await repo.listAudit('c1', { transactionId: 'a' })).map((e) => e.action)).toEqual(['CLASSIFY']);

    const s = splitTransition(a, [{ id: 's', accountId: 'y', amount: -10, memo: '' }], 'T2');
    await repo.commitChanges({ patches: [s.patch], audits: [] });
    [, a] = await repo.listTransactions('c1');
    expect(a.isSplit).toBe(true);
    expect(a).not.toHaveProperty('accountId');
    expect(a).not.toHaveProperty('matchedRuleId');

    await repo.commitChanges({ patches: [resetTransition(a).patch], audits: [] });
    [, a] = await repo.listTransactions('c1');
    expect(a.status).toBe('PENDING');
    for (const f of ['accountId', 'splits', 'reconciledAt', 'matchedRuleId'] as const) expect(a).not.toHaveProperty(f);
    expect((await repo.listPendingTransactions('c1')).map((t) => t.id).sort()).toEqual(['a']);
  });

  it('commitChanges é tudo-ou-nada: patch inválido não grava nada', async () => {
    const [, a0] = await repo.listTransactions('c1');
    const ok = approveTransition(a0, 'T');
    await expect(
      repo.commitChanges({ patches: [ok.patch, { id: 'inexistente', date: '2025-01-01', set: {} }], audits: [] })
    ).rejects.toThrow(/não encontrado/);
    expect((await repo.listTransactions('c1')).find((t) => t.id === 'a')?.status).toBe('PENDING');
  });

  it('fechamento de competência é auditado e não duplica', async () => {
    const lock = { id: 'c1_2025-01', clientId: 'c1', month: '2025-01', lockedAt: 'T', lockedByUid: 'u1' };
    const audit = { id: 'au1', clientId: 'c1', action: 'PERIOD_CLOSE' as const, actorUid: 'u1', at: 'T', month: '2025-01' };
    await repo.closePeriod(lock, audit);
    await expect(repo.closePeriod(lock, { ...audit, id: 'au2' })).rejects.toThrow(/já está fechada/);
    expect(await repo.listPeriodLocks('c1')).toHaveLength(1);
    await repo.reopenPeriod(lock, { ...audit, id: 'au3', action: 'PERIOD_REOPEN', note: 'ajuste' });
    expect(await repo.listPeriodLocks('c1')).toHaveLength(0);
    expect((await repo.listAudit('c1')).map((e) => e.action).sort()).toEqual(['PERIOD_CLOSE', 'PERIOD_REOPEN']);
  });

  it('falhas sobem ao chamador (sem sucesso falso)', async () => {
    await expect(repo.commitChanges({ patches: [{ id: 'inexistente', date: '2025-01-01', set: {} }], audits: [] })).rejects.toThrow(
      /não encontrado/
    );
    store.setItem(LOCAL_KEYS.transactions, '{corrompido');
    await expect(repo.listTransactions('c1')).rejects.toThrow();
  });

  it('exclusão de cliente é em cascata e preserva outros clientes', async () => {
    await repo.saveClient({ id: 'c1', name: 'A', cnpj: '', regime: 'MEI', createdAt: '', updatedAt: '' });
    await repo.saveClient({ id: 'c2', name: 'B', cnpj: '', regime: 'MEI', createdAt: '', updatedAt: '' });
    await repo.commitChanges({ patches: [], audits: [{ id: 'keep', clientId: 'c1', action: 'APPROVE', actorUid: 'u', at: 'T' }] });
    await repo.deleteClient('c1');
    expect((await repo.listClients()).map((c) => c.id)).toEqual(['c2']);
    // A trilha de auditoria sobrevive à exclusão da empresa.
    expect(await repo.listAudit('c1')).toHaveLength(1);
    expect(await repo.listTransactions('c1')).toEqual([]);
    expect(await repo.listTransactions('c2')).toHaveLength(1);
    await expect(repo.deleteClient('global')).rejects.toThrow();
  });

  it('extrato: lançamentos pelo lote (ou pela data de gravação, nos antigos) e exclusão com alterações', async () => {
    const batch = { id: 'bt', clientId: 'c1', fileName: 'x.ofx', fileSize: 0, totalTransactions: 2, importedCount: 2, duplicateCount: 0, autoClassifiedCount: 0, totalDebit: 0, totalCredit: 0, importedAt: 'T0' };
    await repo.insertTransactions(
      [tx('n1', '2025-04-01', { importBatchId: 'bt', transferPairId: 'a' }), tx('n2', '2025-04-02', { createdAt: 'T0' }), tx('n3', '2025-04-03', { createdAt: 'T0', importBatchId: 'outro' })],
      batch
    );
    const txs = await repo.listBatchTransactions(batch);
    expect(txs.map((t) => t.id)).toEqual(['n1', 'n2']);
    await repo.deleteImportBatch(batch, txs, {
      patches: [{ id: 'a', date: '2025-01-10', set: { status: 'PENDING' }, remove: ['transferPairId'] }],
      audits: [{ id: 'del', clientId: 'c1', action: 'BATCH_DELETE', actorUid: 'u', at: 'T' }],
    });
    expect((await repo.listTransactions('c1')).map((t) => t.id).sort()).toEqual(['a', 'b', 'n3']);
    expect(await repo.listImportBatches('c1')).toEqual([]);
    expect((await repo.listAudit('c1')).map((a) => a.action)).toEqual(['BATCH_DELETE']);
    expect(await repo.getTransaction('n1')).toBeNull();
  });

  it('contas bancárias: substitui o cadastro (vínculo removido some)', async () => {
    const bank = { id: 'c1_k', clientId: 'c1', accountKey: 'k', nickname: 'Itaú', ledgerAccountId: 'x', createdAt: '', updatedAt: '' };
    await repo.saveBankAccount(bank);
    await repo.saveBankAccount({ ...bank, ledgerAccountId: undefined });
    expect(await repo.listBankAccounts('c1')).toEqual([{ ...bank, ledgerAccountId: undefined, orgId: LOCAL_ORG_ID }]);
  });

  it('pendências: perguntas abertas e link público com validade', async () => {
    await repo.commitChanges({ patches: [{ id: 'a', date: '2025-01-10', set: { clientQuery: { question: 'O que é?', status: 'OPEN', askedAt: 'T', askedByUid: 'u' } } }], audits: [] });
    expect((await repo.listOpenQueries('c1')).map((t) => t.id)).toEqual(['a']);
    const req = { id: 't'.repeat(32), clientId: 'c1', clientName: 'A', items: [{ transactionId: 'a', date: '2025-01-10', memo: 'm', amount: -10, question: 'O que é?' }], status: 'OPEN' as const, createdAt: 'T', createdByUid: 'u', expiresAtMs: Date.now() + 60_000 };
    await repo.saveClientRequest(req);
    await repo.answerPublicClientRequest(req.id, [{ ...req.items[0], answer: 'Fornecedor' }], 'T2');
    expect((await repo.getPublicClientRequest(req.id))?.items[0].answer).toBe('Fornecedor');
    await expect(repo.answerPublicClientRequest(req.id, [], 'T3')).rejects.toThrow();
    await repo.saveClientRequest({ ...req, status: 'CLOSED' });
    await expect(repo.answerPublicClientRequest(req.id, req.items, 'T4')).rejects.toThrow(/não aceita/);
    await expect(
      repo.uploadPublicClientRequestFile({ id: 'f', orgId: 'local', clientId: 'c1', requestId: req.id, transactionId: 'a', name: 'n', type: 'application/pdf', bytes: 1, data: 'x', uploadedAt: 'T' })
    ).rejects.toThrow();
  });

  it('saldos de abertura: um por cliente, com auditoria; excluir o cliente apaga os saldos', async () => {
    await repo.saveClient({ id: 'c1', name: 'A', cnpj: '', regime: 'MEI', createdAt: '', updatedAt: '' });
    const audit = (id: string) => ({ id, clientId: 'c1', action: 'OPENING_SAVE' as const, actorUid: 'u', at: 'T' });
    expect(await repo.getOpeningBalances('c1')).toBeNull();
    await repo.saveOpeningBalances({ id: 'c1', clientId: 'c1', date: '2024-12-31', entries: [{ accountId: 'x', amount: 10 }], updatedAt: 'T' }, audit('a1'));
    await repo.saveOpeningBalances({ id: 'c1', clientId: 'c1', date: '2024-12-31', entries: [{ accountId: 'x', amount: 20 }], updatedAt: 'T2' }, audit('a2'));
    expect((await repo.getOpeningBalances('c1'))?.entries).toEqual([{ accountId: 'x', amount: 20 }]);
    expect((await repo.listAudit('c1')).map((a) => a.id).sort()).toEqual(['a1', 'a2']);
    await repo.deleteClient('c1');
    expect(await repo.getOpeningBalances('c1')).toBeNull();
  });
});
