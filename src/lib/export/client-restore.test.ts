import { describe, expect, it } from 'vitest';
import type { BankTransaction, ClientCompany } from '@/types/firestore';
import { createLocalRepository, type KeyValueStore } from '@/lib/data/local-repository';
import { journalAudit } from '@/lib/audit';
import { buildClientBackup, type ClientBackup } from '@/lib/export/client-backup';
import {
  ClientRestoreError,
  inspectClientBackup,
  parseClientBackup,
  remapBackupForNewClient,
  restoreClientBackup,
  restoreNewCompanyViaRepository,
} from '@/lib/export/client-restore';

function memoryStore(): KeyValueStore {
  const dump = new Map<string, string>();
  return { getItem: (k) => dump.get(k) ?? null, setItem: (k, v) => void dump.set(k, v) };
}

const actor = { uid: 'admin-1', email: 'admin@contaflow.test' };

async function buildRichSampleBackup(): Promise<ClientBackup> {
  const repo = createLocalRepository(memoryStore());
  const alpha: ClientCompany = {
    id: 'c-alpha',
    name: 'Alpha Ltda',
    tradeName: 'Alpha',
    cnpj: '11222333000181',
    regime: 'SIMPLES_NACIONAL',
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
  };
  await repo.saveClient(alpha);
  await repo.insertAccounts([
    { id: 'acc-global-rev', clientId: 'global', code: '3.1.1.01', name: 'Receita de Vendas', type: 'REVENUE', nature: 'ANALYTIC', level: 4, createdAt: 'T', updatedAt: 'T' },
    { id: 'acc-local-parent', clientId: 'c-alpha', code: '1.1.1', name: 'Disponibilidades', type: 'ASSET', nature: 'SYNTHETIC', level: 3, createdAt: 'T', updatedAt: 'T' },
    { id: 'acc-local-bank', clientId: 'c-alpha', parentId: 'acc-local-parent', code: '1.1.1.02', name: 'Itaú', type: 'ASSET', nature: 'ANALYTIC', level: 4, createdAt: 'T', updatedAt: 'T' },
    { id: 'acc-local-exp', clientId: 'c-alpha', code: '3.3.1.01', name: 'Despesa Geral', type: 'EXPENSE', nature: 'ANALYTIC', level: 4, createdAt: 'T', updatedAt: 'T' },
    { id: 'acc-local-fa', clientId: 'c-alpha', code: '1.2.3.04', name: 'Veículos', type: 'ASSET', nature: 'ANALYTIC', level: 4, createdAt: 'T', updatedAt: 'T' },
    { id: 'acc-local-pay', clientId: 'c-alpha', code: '2.1.3.01', name: 'Salários a Pagar', type: 'LIABILITY', nature: 'ANALYTIC', level: 4, createdAt: 'T', updatedAt: 'T' },
  ]);
  await repo.saveRule({
    id: 'rule-global',
    clientId: 'global',
    pattern: 'VENDA',
    accountId: 'acc-global-rev',
    createdAt: 'T',
    updatedAt: 'T',
  });
  await repo.saveRule({
    id: 'rule-local',
    clientId: 'c-alpha',
    pattern: 'ALUGUEL',
    accountId: 'acc-local-exp',
    createdByUid: 'old-user',
    createdAt: 'T',
    updatedAt: 'T',
  });
  await repo.saveBankAccount({
    id: 'c-alpha_itau',
    clientId: 'c-alpha',
    accountKey: 'itau',
    nickname: 'Itaú',
    ledgerAccountId: 'acc-local-bank',
    ledgerAccountCode: '1.1.1.02',
    openingBalance: 1000,
    openingDate: '2025-01-01',
    createdAt: 'T',
    updatedAt: 'T',
  });
  await repo.saveImportBatch({
    id: 'batch-1',
    clientId: 'c-alpha',
    status: 'COMPLETED',
    fileName: 'extrato.ofx',
    fileSize: 1200,
    totalTransactions: 2,
    importedCount: 2,
    duplicateCount: 0,
    autoClassifiedCount: 0,
    totalDebit: 200,
    totalCredit: 500,
    importedAt: '2025-02-01',
  });
  const t1: BankTransaction = {
    id: 'c-alpha_tx1',
    clientId: 'c-alpha',
    fitid: 'tx1',
    date: '2025-01-15',
    amount: 500,
    type: 'CREDIT',
    memo: 'VENDA PIX',
    importBatchId: 'batch-1',
    accountKey: 'itau',
    status: 'RECONCILED',
    accountId: 'acc-global-rev',
    matchedRuleId: 'rule-global',
    reconciledAt: '2025-01-16',
    createdAt: '2025-01-15',
  };
  const t2: BankTransaction = {
    id: 'c-alpha_tx2',
    clientId: 'c-alpha',
    fitid: 'tx2',
    date: '2025-01-20',
    amount: -200,
    type: 'DEBIT',
    memo: 'RATEIO',
    importBatchId: 'batch-1',
    accountKey: 'itau',
    status: 'RECONCILED',
    isSplit: true,
    splits: [{ id: 'sp-1', accountId: 'acc-local-exp', amount: -200, memo: 'Aluguel' }],
    reconciledAt: '2025-01-21',
    createdAt: '2025-01-20',
  };
  await repo.insertTransactions([t1, t2]);
  await repo.saveOpeningBalances(
    {
      id: 'c-alpha',
      clientId: 'c-alpha',
      date: '2025-01-01',
      mode: 'CONTINUITY',
      entries: [{ accountId: 'acc-local-bank', amount: 1000 }],
      updatedAt: 'T',
    },
    { id: 'au-open', clientId: 'c-alpha', action: 'OPENING_SAVE', actorUid: 'u', at: 'T1' }
  );

  const je1 = await repo.createJournalEntry(
    {
      id: 'je-disp',
      clientId: 'c-alpha',
      date: '2025-01-31',
      memo: 'Baixa veículo',
      category: 'ADJUSTMENT',
      lines: [
        { id: 'l1', accountId: 'acc-local-exp', type: 'DEBIT', amount: 100 },
        { id: 'l2', accountId: 'acc-local-fa', type: 'CREDIT', amount: 100 },
      ],
      totalAmount: 100,
      fixedAssetId: 'fa-1',
      createdAt: 'T',
      updatedAt: 'T',
      createdByUid: 'u',
    },
    journalAudit('JOURNAL_CREATE', actor, 'c-alpha', 'T2', { id: 'je-disp' })
  );
  await repo.saveFixedAssets(
    {
      id: 'c-alpha',
      clientId: 'c-alpha',
      assets: [
        {
          id: 'fa-1',
          description: 'Carro',
          accountId: 'acc-local-fa',
          accountCode: '1.2.3.04',
          use: 'EXPENSE',
          acquisitionDate: '2024-01-01',
          inUseDate: '2024-01-01',
          invoiceValue: 100,
          annualRate: 20,
          disposal: { date: '2025-01-31', reason: 'SCRAP', journalEntryId: je1.id },
          createdAt: 'T',
          updatedAt: 'T',
        },
      ],
      updatedAt: 'T',
    },
    { id: 'au-fa', clientId: 'c-alpha', action: 'ASSET_SAVE', actorUid: 'u', at: 'T3' }
  );
  await repo.savePayrollRegister(
    {
      id: 'c-alpha',
      clientId: 'c-alpha',
      summaries: [
        {
          id: '2025-01',
          clientId: 'c-alpha',
          month: '2025-01',
          date: '2025-01-31',
          grossSalaries: 100,
          grossProLabore: 0,
          inssEmployees: 10,
          inssProLabore: 0,
          irrfEmployees: 0,
          irrfProLabore: 0,
          netSalaries: 90,
          netProLabore: 0,
          fgts: 8,
          journalEntryIds: [je1.id],
          updatedAt: 'T',
        },
      ],
      updatedAt: 'T',
    },
    { id: 'au-pay', clientId: 'c-alpha', action: 'PAYROLL_SAVE', actorUid: 'u', at: 'T4' }
  );
  await repo.saveInvoices([
    {
      id: 'c-alpha_35250111222333000181550010000000011000000010',
      clientId: 'c-alpha',
      key: '35250111222333000181550010000000011000000010',
      number: '1',
      series: '1',
      model: '55',
      issueDate: '2025-01-10',
      direction: 'PURCHASE',
      counterpartyDoc: '11222333000181',
      counterpartyName: 'Fornecedor',
      total: 200,
      cfops: [{ cfop: '1556', amount: 200 }],
      installments: [{ dueDate: '2025-01-20', amount: 200 }],
      status: 'AUTHORIZED',
      importedAt: 'T',
    },
  ]);
  await repo.linkInvoice('c-alpha_35250111222333000181550010000000011000000010', {
    transactionId: t2.id,
    amount: 200,
    accountId: 'acc-local-exp',
    linkedAt: 'T',
  });
  await repo.saveClosingChecklist({
    id: 'c-alpha_2025',
    clientId: 'c-alpha',
    year: '2025',
    items: { cash: { done: true, at: 'T', byUid: 'u' } },
    updatedAt: 'T',
  });
  await repo.saveExplanatoryNotes({
    id: 'c-alpha_2025',
    clientId: 'c-alpha',
    year: '2025',
    notes: [{ id: 'context', title: 'Contexto', text: 'Texto salvo', enabled: true }],
    updatedAt: 'T',
  });
  await repo.saveClientRequest({
    id: 'old-open-token-must-close-on-restore-0001',
    clientId: 'c-alpha',
    clientName: 'Alpha Ltda',
    items: [{ transactionId: t1.id, date: t1.date, memo: t1.memo, amount: t1.amount, question: 'Qual origem?' }],
    status: 'OPEN',
    createdAt: 'T',
    createdByUid: 'u',
    expiresAtMs: Date.now() + 86_400_000,
  });
  await repo.closePeriod(
    { id: 'c-alpha_2025-01', clientId: 'c-alpha', month: '2025-01', lockedAt: 'T', lockedByUid: 'u' },
    { id: '', clientId: 'c-alpha', action: 'PERIOD_CLOSE', actorUid: 'u', at: 'T5', month: '2025-01' }
  );
  await repo.closePeriod(
    { id: 'c-alpha_2025-12', clientId: 'c-alpha', month: '2025-12', lockedAt: 'T', lockedByUid: 'u' },
    { id: '', clientId: 'c-alpha', action: 'PERIOD_CLOSE', actorUid: 'u', at: 'T6', month: '2025-12' }
  );
  await repo.closeYear(
    [
      {
        id: 'je-close-1',
        clientId: 'c-alpha',
        date: '2025-12-31',
        memo: 'Encerramento 2025',
        category: 'CLOSING',
        yearClosing: '2025',
        lines: [
          { id: 'c1', accountId: 'acc-global-rev', type: 'DEBIT', amount: 500 },
          { id: 'c2', accountId: 'acc-local-exp', type: 'CREDIT', amount: 500 },
        ],
        totalAmount: 500,
        createdAt: 'T',
        updatedAt: 'T',
        createdByUid: 'u',
      },
    ],
    { id: 'c-alpha_2025_close_au', clientId: 'c-alpha', action: 'YEAR_CLOSE', actorUid: 'u', at: 'T7', month: '2025-12' }
  );

  return buildClientBackup(alpha, repo, '2026-11-12T10:00:00.000Z');
}

describe('parser e restauração de backup da empresa', () => {
  it('rejeita JSON inválido, formato desconhecido ou versão não suportada', () => {
    expect(() => parseClientBackup('{invalido')).toThrow(/JSON válido/i);
    expect(() => parseClientBackup(JSON.stringify({ format: 'outro', version: 2 }))).toThrow(/backup do ContaFlow/i);
    expect(() => parseClientBackup(JSON.stringify({ format: 'contaflow-backup', version: 99 }))).toThrow(/não suportada/i);
  });

  it('lê backups v1 (sem checklists/notas/lockState/journalCounter) mantendo compatibilidade', async () => {
    const v2 = await buildRichSampleBackup();
    const {
      closingChecklists: _cc,
      explanatoryNotes: _en,
      lockState: _ls,
      journalCounter: _jc,
      ...rest
    } = v2;
    void _cc;
    void _en;
    void _ls;
    void _jc;
    const v1Json = JSON.stringify({ ...rest, version: 1 });
    const parsed = parseClientBackup(v1Json);
    const summary = inspectClientBackup(parsed);
    expect(summary.version).toBe(1);
    expect(summary.closingChecklists).toBe(0);
    expect(summary.explanatoryNotes).toBe(0);
    expect(summary.transactions).toBe(2);
    expect(summary.journalEntries).toBe(2);
  });

  it('restaura fielmente no modo local (IDs originais, auditoria histórica e CLIENT_RESTORE)', async () => {
    const backup = parseClientBackup(JSON.stringify(await buildRichSampleBackup()));
    const targetRepo = createLocalRepository(memoryStore());
    const result = await restoreClientBackup(backup, { mode: 'local-exact', actor, repo: targetRepo });

    expect(result.client.id).toBe('c-alpha');
    expect((await targetRepo.listTransactions('c-alpha')).map((t) => t.status)).toEqual(['RECONCILED', 'RECONCILED']);
    expect((await targetRepo.listClosingChecklists('c-alpha'))[0]?.year).toBe('2025');
    expect((await targetRepo.listExplanatoryNotes('c-alpha'))[0]?.notes[0]?.text).toBe('Texto salvo');
    expect((await targetRepo.getJournalCounter('c-alpha'))?.last).toBe(2);
    expect((await targetRepo.getLockState('c-alpha'))?.count).toBe(2);
    const audits = await targetRepo.listAudit('c-alpha');
    expect(audits.some((a) => a.action === 'CLIENT_RESTORE')).toBe(true);
    expect(audits.some((a) => a.action === 'OPENING_SAVE')).toBe(true);
  });

  it('impede modo local-exact em repositório Firestore', async () => {
    const backup = parseClientBackup(JSON.stringify(await buildRichSampleBackup()));
    const fakeFirestoreRepo = { ...createLocalRepository(memoryStore()), mode: 'firestore' as const };
    await expect(restoreClientBackup(backup, { mode: 'local-exact', actor, repo: fakeFirestoreRepo })).rejects.toBeInstanceOf(ClientRestoreError);
  });

  it('executa restauração em 6 etapas como nova empresa remapeando contas, regras, lançamentos, vínculos e fechamentos', async () => {
    const backup = parseClientBackup(JSON.stringify(await buildRichSampleBackup()));
    const targetRepo = createLocalRepository(memoryStore());
    // Pré-existente no destino: a conta global já existe; a regra global foi excluída no destino e deve virar local.
    await targetRepo.insertAccounts([
      { id: 'acc-global-rev', clientId: 'global', code: '3.1.1.01', name: 'Receita de Vendas', type: 'REVENUE', nature: 'ANALYTIC', level: 4, createdAt: 'T', updatedAt: 'T' },
    ]);

    const stages: string[] = [];
    const remapped = remapBackupForNewClient(backup, {
      targetName: 'Alpha Restaurada',
      existingGlobalAccounts: await targetRepo.listAccounts('global'),
      existingGlobalRules: await targetRepo.listRules('global'),
      actorUid: actor.uid,
    });
    const res = await restoreNewCompanyViaRepository(backup, remapped, targetRepo, actor, (s) => stages.push(s));

    expect(stages).toHaveLength(6);
    expect(res.client.id).not.toBe('c-alpha');
    expect(res.client.name).toBe('Alpha Restaurada');

    const newId = res.client.id;
    const restoredAccounts = await targetRepo.listAccounts(newId);
    expect(restoredAccounts.some((a) => a.id === 'acc-global-rev' && a.clientId === 'global')).toBe(true);
    const childBank = restoredAccounts.find((a) => a.code === '1.1.1.02');
    const parentCash = restoredAccounts.find((a) => a.code === '1.1.1');
    expect(childBank?.clientId).toBe(newId);
    expect(childBank?.parentId).toBe(parentCash?.id);

    // Regra local e regra global faltante viraram regras do cliente com createdByUid = ator atual.
    const rules = await targetRepo.listRules(newId);
    expect(rules.every((r) => r.clientId === newId && r.createdByUid === actor.uid)).toBe(true);

    // Lançamentos reconciliados e splits com novas IDs de conta.
    const txs = await targetRepo.listTransactions(newId);
    expect(txs).toHaveLength(2);
    expect(txs.every((t) => t.status === 'RECONCILED')).toBe(true);
    const splitTx = txs.find((t) => t.isSplit);
    expect(splitTx?.splits?.[0]?.accountId).toBe(restoredAccounts.find((a) => a.code === '3.3.1.01')?.id);

    // Cadastros auxiliares apontam para os novos entryIds do Diário.
    const entries = await targetRepo.listJournalEntries(newId);
    expect(entries).toHaveLength(2);
    const fa = await targetRepo.getFixedAssets(newId);
    expect(entries.some((e) => e.id === fa?.assets[0]?.disposal?.journalEntryId)).toBe(true);
    const payroll = await targetRepo.getPayrollRegister(newId);
    expect(entries.some((e) => e.id === payroll?.summaries[0]?.journalEntryIds[0])).toBe(true);

    // Vínculo da nota fiscal foi preservado com novo transactionId e novo accountId.
    const [inv] = await targetRepo.listInvoices(newId);
    expect(inv?.links?.[0]?.transactionId).toBe(splitTx?.id);
    expect(inv?.links?.[0]?.accountId).toBe(splitTx?.splits?.[0]?.accountId);

    // Pendências antigas voltam sempre CLOSED (não abrem novo link público).
    const requests = await targetRepo.listClientRequests(newId);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.status).toBe('CLOSED');

    // Competências fechadas + encerramento anual + registro CLIENT_RESTORE gravados.
    expect((await targetRepo.listPeriodLocks(newId)).map((l) => l.month).sort()).toEqual(['2025-01', '2025-12']);
    expect((await targetRepo.listAudit(newId)).some((a) => a.action === 'CLIENT_RESTORE')).toBe(true);
  });
});

