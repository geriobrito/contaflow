import { beforeEach, describe, expect, it } from 'vitest';
import { createLocalRepository, LOCAL_KEYS, LOCAL_ORG_ID, type KeyValueStore } from '@/lib/data/local-repository';
import type { DataRepository, JournalEntryDraft } from '@/lib/data/repository';
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
  const actor = { uid: 'u1', email: 'u1@x' };
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
    // Os registros levam o id derivado do fechamento (o que as regras do Firestore exigem).
    expect((await repo.listAudit('c1')).map((e) => [e.action, e.id]).sort()).toEqual([
      ['PERIOD_CLOSE', 'c1_2025-01_close_T'],
      ['PERIOD_REOPEN', 'c1_2025-01_reopen_T'],
    ]);
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
    await repo.closePeriod({ id: 'c1_2025-01', clientId: 'c1', month: '2025-01', lockedAt: 'T', lockedByUid: 'u1' }, { id: '', clientId: 'c1', action: 'PERIOD_CLOSE', actorUid: 'u1', at: 'T', month: '2025-01' });
    await repo.deleteClient('c1', actor);
    expect((await repo.listClients()).map((c) => c.id)).toEqual(['c2']);
    expect(await repo.listPeriodLocks('c1')).toEqual([]);
    // A trilha de auditoria sobrevive à exclusão da empresa e registra o fechamento removido.
    expect((await repo.listAudit('c1')).map((e) => e.action).sort()).toEqual(['APPROVE', 'PERIOD_CLOSE', 'PERIOD_REOPEN']);
    expect((await repo.listAudit('c1')).find((e) => e.action === 'PERIOD_REOPEN')).toMatchObject({ actorUid: 'u1', month: '2025-01', id: 'c1_2025-01_reopen_T' });
    expect(await repo.listTransactions('c1')).toEqual([]);
    expect(await repo.listTransactions('c2')).toHaveLength(1);
    await expect(repo.deleteClient('global', actor)).rejects.toThrow();
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
    await repo.answerPublicClientRequest(req.id, [{ text: 'Fornecedor', answeredAt: 'T2' }], 'T2');
    const answered = await repo.getPublicClientRequest(req.id);
    expect(answered?.answers).toEqual([{ text: 'Fornecedor', answeredAt: 'T2' }]);
    // As perguntas ficam como o escritório gravou.
    expect(answered?.items).toEqual(req.items);
    await expect(repo.answerPublicClientRequest(req.id, [], 'T3')).rejects.toThrow(/uma resposta por pergunta/);
    // Encerrar mantém a resposta recebida.
    await repo.closeClientRequest(req.id);
    expect(await repo.getPublicClientRequest(req.id)).toMatchObject({ status: 'CLOSED', answers: [{ text: 'Fornecedor' }] });
    await expect(repo.answerPublicClientRequest(req.id, [{ text: 'tarde' }], 'T4')).rejects.toThrow(/não aceita/);
    await expect(repo.closeClientRequest('inexistente')).rejects.toThrow(/não encontrado/);
  });

  it('saldos de abertura: um por cliente, com auditoria; excluir o cliente apaga os saldos', async () => {
    await repo.saveClient({ id: 'c1', name: 'A', cnpj: '', regime: 'MEI', createdAt: '', updatedAt: '' });
    const audit = (id: string) => ({ id, clientId: 'c1', action: 'OPENING_SAVE' as const, actorUid: 'u', at: 'T' });
    expect(await repo.getOpeningBalances('c1')).toBeNull();
    await repo.saveOpeningBalances({ id: 'c1', clientId: 'c1', date: '2024-12-31', entries: [{ accountId: 'x', amount: 10 }], updatedAt: 'T' }, audit('a1'));
    await repo.saveOpeningBalances({ id: 'c1', clientId: 'c1', date: '2024-12-31', entries: [{ accountId: 'x', amount: 20 }], updatedAt: 'T2' }, audit('a2'));
    expect((await repo.getOpeningBalances('c1'))?.entries).toEqual([{ accountId: 'x', amount: 20 }]);
    expect((await repo.listAudit('c1')).map((a) => a.id).sort()).toEqual(['a1', 'a2']);
    await repo.deleteClient('c1', actor);
    expect(await repo.getOpeningBalances('c1')).toBeNull();
  });

  it('plano de contas: exclusão com auditoria e alteração conjunta de contas e bancos', async () => {
    const acc = (id: string, nature: 'ANALYTIC' | 'SYNTHETIC' = 'ANALYTIC') => ({ id, clientId: 'c1', code: id, name: id, type: 'ASSET' as const, nature, level: 1, createdAt: '', updatedAt: '' });
    const bank = { id: 'c1_k', clientId: 'c1', accountKey: 'k', nickname: 'Itaú', ledgerAccountId: 'mae', openingBalance: 10, createdAt: '', updatedAt: '' };
    await repo.insertAccounts([acc('mae'), acc('solta')]);
    await repo.saveBankAccount(bank);

    await repo.saveChartSetup({
      accounts: [acc('filha'), { ...acc('mae', 'SYNTHETIC'), description: 'grupo' }],
      bankAccounts: [{ ...bank, ledgerAccountId: 'filha', openingBalance: undefined }],
    });
    const byId = new Map((await repo.listAccounts('c1')).map((a) => [a.id, a] as const));
    expect([...byId.keys()].sort()).toEqual(['filha', 'mae', 'solta']);
    expect(byId.get('mae')).toMatchObject({ nature: 'SYNTHETIC', description: 'grupo' });
    // O banco é substituído: o saldo inicial removido some de fato.
    expect(await repo.listBankAccounts('c1')).toEqual([{ ...bank, ledgerAccountId: 'filha', openingBalance: undefined, orgId: LOCAL_ORG_ID }]);

    await repo.deleteAccount('solta', { id: 'del', clientId: 'c1', action: 'ACCOUNT_DELETE', actorUid: 'u', at: 'T' });
    expect((await repo.listAccounts('c1')).map((a) => a.id).sort()).toEqual(['filha', 'mae']);
    expect((await repo.listAudit('c1')).map((a) => a.id)).toEqual(['del']);
  });

  it('conta e usa de conta sem baixar o histórico: contagem até uma data e uso em classificação ou rateio', async () => {
    expect(await repo.countTransactions('c1', '2025-01-31')).toBe(1);
    expect(await repo.countTransactions('c1', '2025-12-31')).toBe(2);
    expect(await repo.countTransactions('c2', '2025-12-31')).toBe(1);
    await repo.insertTransactions([
      tx('d', '2025-04-01', { status: 'RECONCILED', accountId: 'direta' }),
      tx('s', '2025-04-02', { status: 'RECONCILED', isSplit: true, splits: [{ id: 's1', accountId: 'rateada', amount: -10, memo: '' }] }),
      tx('o', '2025-04-03', { clientId: 'c2', status: 'RECONCILED', accountId: 'de-outro-cliente' }),
    ]);
    expect(await repo.isAccountUsedInTransactions('c1', 'direta')).toBe(true);
    expect(await repo.isAccountUsedInTransactions('c1', 'rateada')).toBe(true);
    expect(await repo.isAccountUsedInTransactions('c1', 'livre')).toBe(false);
    expect(await repo.isAccountUsedInTransactions('c1', 'de-outro-cliente')).toBe(false);
  });

  it('saldos consolidados: grava por competência (substitui) e some com o cliente', async () => {
    const snapshot = (month: string, clientId = 'c1', txCount = 1) => ({ id: `${clientId}_${month}`, clientId, month, asOf: `${month}-28`, balances: [], bankMovements: [], unlinkedCount: 0, txCount, months: [], locks: [], configKey: 'k', createdAt: '' });
    await repo.savePeriodSnapshot(snapshot('2025-01'));
    await repo.savePeriodSnapshot(snapshot('2025-01', 'c1', 7));
    await repo.savePeriodSnapshot(snapshot('2025-02'));
    await repo.savePeriodSnapshot(snapshot('2025-01', 'c2'));
    expect((await repo.listPeriodSnapshots('c1')).map((s) => [s.month, s.txCount]).sort()).toEqual([['2025-01', 7], ['2025-02', 1]]);
    await repo.deleteClient('c1', actor);
    expect(await repo.listPeriodSnapshots('c1')).toEqual([]);
    expect(await repo.listPeriodSnapshots('c2')).toHaveLength(1);
  });

  describe('lançamentos manuais', () => {
    const draft = (id: string, clientId = 'c1', amounts: [number, number] = [100, 100]): JournalEntryDraft => ({
      id,
      clientId,
      date: '2025-03-31',
      memo: 'Provisão',
      category: 'PROVISION',
      lines: [
        { id: 'd', accountId: 'x', type: 'DEBIT', amount: amounts[0] },
        { id: 'c', accountId: 'y', type: 'CREDIT', amount: amounts[1] },
      ],
      totalAmount: amounts[0],
      createdAt: 'T',
      updatedAt: 'T',
      createdByUid: 'u',
    });

    it('numeração sequencial por cliente; número excluído não é reaproveitado', async () => {
      expect((await repo.createJournalEntry(draft('j1'))).entryNumber).toBe(1);
      expect((await repo.createJournalEntry(draft('j2'))).entryNumber).toBe(2);
      expect((await repo.createJournalEntry(draft('j3'))).entryNumber).toBe(3);
      expect((await repo.createJournalEntry(draft('k1', 'c2'))).entryNumber).toBe(1);
      await repo.deleteJournalEntry('j2');
      await repo.deleteJournalEntry('j3');
      expect((await repo.createJournalEntry(draft('j4'))).entryNumber).toBe(4);
      expect((await repo.listJournalEntries('c1')).map((e) => e.entryNumber).sort()).toEqual([1, 4]);
    });

    it('lançamentos anteriores ao contador: continua do maior número já usado', async () => {
      store.setItem(LOCAL_KEYS.journalEntries, JSON.stringify([{ ...draft('antigo'), entryNumber: 7 }]));
      expect((await repo.createJournalEntry(draft('novo'))).entryNumber).toBe(8);
    });

    it('edição preserva o número e exige o lançamento existente', async () => {
      const saved = await repo.createJournalEntry(draft('j1'));
      await repo.updateJournalEntry({ ...saved, memo: 'Corrigido', entryNumber: 99 });
      expect(await repo.listJournalEntries('c1')).toMatchObject([{ id: 'j1', memo: 'Corrigido', entryNumber: 1 }]);
      await expect(repo.updateJournalEntry({ ...saved, id: 'inexistente' })).rejects.toThrow(/não encontrado/);
    });

    it('recusa débito ≠ crédito na criação e na edição, sem gravar nem gastar número', async () => {
      await expect(repo.createJournalEntry(draft('j1', 'c1', [100, 90]))).rejects.toThrow(/desbalanceado/);
      expect(await repo.listJournalEntries('c1')).toEqual([]);
      const saved = await repo.createJournalEntry(draft('j2'));
      expect(saved.entryNumber).toBe(1);
      await expect(repo.updateJournalEntry({ ...saved, lines: draft('x', 'c1', [5, 4]).lines })).rejects.toThrow(/desbalanceado/);
      expect((await repo.listJournalEntries('c1'))[0].lines[0].amount).toBe(100);
    });

    it('excluir o cliente remove os lançamentos manuais e a sequência', async () => {
      await repo.createJournalEntry(draft('j1'));
      await repo.createJournalEntry(draft('k1', 'c2'));
      await repo.deleteClient('c1', actor);
      expect(await repo.listJournalEntries('c1')).toEqual([]);
      expect(await repo.listJournalEntries('c2')).toHaveLength(1);
      // Um cliente recriado com o mesmo id começa a sequência do zero.
      expect((await repo.createJournalEntry(draft('j9'))).entryNumber).toBe(1);
    });
  });
});
