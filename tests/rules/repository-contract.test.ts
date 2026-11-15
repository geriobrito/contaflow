/**
 * Contrato do repositório: a mesma bateria contra as duas implementações — Firestore (no
 * emulador, sob as regras de firestore.rules) e local (IndexedDB/localStorage, aqui em memória).
 * Garante que os dois modos se comportam igual, inclusive no que recusam: o app nunca cai de
 * um modo no outro ("sem fallback silencioso"), então uma diferença entre eles só apareceria em
 * produção ou só no modo local. Rodar com: npm run test:rules
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, type Firestore } from 'firebase/firestore';
import type { BankTransaction, ChartAccount, ClientCompany, FeeRegister, InvoiceSummary, JournalEntry, ObligationChecks, PeriodLock, ResultSummary, StockControl } from '@/types/firestore';
import type { DataRepository, JournalEntryDraft } from '@/lib/data/repository';
import { createFirestoreRepository } from '@/lib/data/firestore-repository';
import { createLocalRepository, type KeyValueStore } from '@/lib/data/local-repository';
import { setSession } from '@/lib/data/scope';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { classifyTransition } from '@/lib/transitions';
import { journalAudit, transactionAudit } from '@/lib/audit';
import { RegisterConflictError } from '@/lib/utils/errors';

const PROJECT = 'demo-contaflow';
const ORG = 'org-a';
let env: RulesTestEnvironment;

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host, port: Number(port) },
  });
});
afterAll(async () => {
  await env?.cleanup();
});

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

/** Cada implementação começa vazia, com a sessão de uma administradora do escritório. */
const IMPLEMENTATIONS: readonly [string, () => Promise<DataRepository>][] = [
  [
    'firestore',
    async () => {
      await env.clearFirestore();
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore() as unknown as Firestore, 'users/alice'), { uid: 'alice', orgId: ORG });
      });
      return createFirestoreRepository(env.authenticatedContext('alice').firestore() as unknown as Firestore, () => ORG);
    },
  ],
  [
    'local',
    async () => {
      setSession('local', { uid: 'alice' });
      return createLocalRepository(memoryStore());
    },
  ],
];

/** Tira o que é próprio de cada modo (orgId, datas do servidor) para comparar o conteúdo. */
const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x, (k, v) => (k === 'orgId' || k === 'at' || k === 'lockedAt' ? undefined : v))) as T;

const client = (id: string, extra: Partial<ClientCompany> = {}): ClientCompany => ({
  id,
  name: `Empresa ${id}`,
  cnpj: '11222333000181',
  regime: 'SIMPLES_NACIONAL',
  createdAt: '2025-01-01',
  updatedAt: '2025-01-01',
  ...extra,
});
const tx = (n: number, date: string, amount = -100, extra: Partial<BankTransaction> = {}): BankTransaction => ({
  id: `c1_${n}`,
  clientId: 'c1',
  fitid: String(n),
  date,
  amount,
  type: amount < 0 ? 'DEBIT' : 'CREDIT',
  memo: `MOV ${n}`,
  status: 'PENDING',
  accountKey: 'k1',
  createdAt: 'T',
  ...extra,
});
const lockOf = (month: string): PeriodLock => ({ id: `c1_${month}`, clientId: 'c1', month, lockedAt: 'T', auditKey: `chave-${month}-0000001`, lockedByUid: 'alice' });
const closeAudit = (month: string) => ({ id: '', clientId: 'c1', action: 'PERIOD_CLOSE' as const, actorUid: 'alice', at: 'T', month });

describe.each(IMPLEMENTATIONS)('contrato do repositório (%s)', (_mode, create) => {
  let repo: DataRepository;
  let chart: ChartAccount[];
  const byCode = (code: string) => chart.find((a) => a.code === code)!;

  beforeEach(async () => {
    repo = await create();
    await repo.saveClient(client('c1'));
    chart = buildITG1000Chart('c1', '2025-01-01');
    await repo.insertAccounts(chart);
  });

  it('empresas: cadastro substitui o documento; termos do Diário não tocam no resto', async () => {
    await repo.saveClient(client('c1', { tradeName: 'Fantasia', email: 'x@y.com' }));
    await repo.saveClient(client('c1', { tradeName: 'Fantasia' })); // e-mail apagado no formulário
    await repo.updateClientDaybook('c1', { number: '3', city: 'Recife/PE' });
    const [c] = await repo.listClients();
    expect(plain(c)).toEqual(plain(client('c1', { tradeName: 'Fantasia', daybook: { number: '3', city: 'Recife/PE' } })));
    expect(await repo.getLockState('c1')).toMatchObject({ clientId: 'c1', count: 0, seq: 0 });
  });

  it('plano de contas: ordenado por código, sem contas de outra empresa', async () => {
    await repo.saveClient(client('c2'));
    await repo.insertAccounts(buildITG1000Chart('c2', '2025-01-01').slice(0, 3));
    const list = await repo.listAccounts('c1');
    expect(list).toHaveLength(chart.length);
    expect(list.map((a) => a.code)).toEqual([...chart.map((a) => a.code)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
    expect(list.every((a) => a.clientId === 'c1')).toBe(true);
  });

  it('lançamentos: consultas, contagens e classificação', async () => {
    await repo.insertTransactions([tx(1, '2025-01-10'), tx(2, '2025-02-05', 300, { status: 'AUTO_CLASSIFIED' }), tx(3, '2025-02-20')]);
    expect((await repo.listTransactions('c1')).map((t) => t.id)).toEqual(['c1_3', 'c1_2', 'c1_1']);
    expect((await repo.listTransactions('c1', { start: '2025-02-01', end: '2025-02-28' })).map((t) => t.id)).toEqual(['c1_3', 'c1_2']);
    expect(await repo.countTransactions('c1', '2025-02-05')).toBe(2);
    expect(await repo.countTransactionsByStatus('c1', 'PENDING')).toBe(2);
    expect(await repo.latestTransactionDate('c1')).toBe('2025-02-20');
    expect(await repo.oldestTransactionDate('c1', 'PENDING')).toBe('2025-01-10');
    expect([...(await repo.findExistingTransactionIds('c1', ['c1_1', 'c1_9']))]).toEqual(['c1_1']);

    const expense = byCode('3.3.1.01');
    const account = { accountId: expense.id, accountCode: expense.code, accountName: expense.name };
    const t1 = (await repo.getTransaction('c1_1'))!;
    const c = classifyTransition(t1, account, null, '2025-03-01');
    await repo.commitChanges({ patches: [c.patch], audits: [transactionAudit('CLASSIFY', { uid: 'alice' }, t1, c.after, '2025-03-01')] });
    expect(plain(await repo.getTransaction('c1_1'))).toEqual(plain(c.after));
    expect((await repo.listPendingTransactions('c1')).map((t) => t.id)).toEqual(['c1_3']);
    expect(await repo.isAccountUsedInTransactions('c1', expense.id)).toBe(true);
    expect((await repo.listAudit('c1', { transactionId: 'c1_1' })).map((a) => a.action)).toEqual(['CLASSIFY']);
  });

  it('competência fechada congela lançamentos bancários e manuais até a reabertura', async () => {
    await repo.insertTransactions([tx(1, '2025-01-10')]);
    await repo.closePeriod(lockOf('2025-01'), closeAudit('2025-01'));
    expect((await repo.listPeriodLocks('c1')).map((l) => l.month)).toEqual(['2025-01']);
    expect(await repo.getLockState('c1')).toMatchObject({ count: 1, seq: 1 });

    const expense = byCode('3.3.1.01');
    const t1 = (await repo.getTransaction('c1_1'))!;
    const patch = classifyTransition(t1, { accountId: expense.id, accountCode: expense.code, accountName: expense.name }, null, 'T').patch;
    await expect(repo.commitChanges({ patches: [patch], audits: [] })).rejects.toThrow();
    const draft = journalDraft('j1', '2025-01-31');
    await expect(repo.createJournalEntry(draft, journalAudit('JOURNAL_CREATE', { uid: 'alice' }, 'c1', 'T', draft))).rejects.toThrow();

    await repo.reopenPeriod(lockOf('2025-01'), { id: '', clientId: 'c1', action: 'PERIOD_REOPEN', actorUid: 'alice', at: 'T', month: '2025-01' });
    await repo.commitChanges({ patches: [patch], audits: [] });
    expect((await repo.getTransaction('c1_1'))?.status).toBe('RECONCILED');
  });

  const journalDraft = (id: string, date: string, amount = 150): JournalEntryDraft => ({
    id,
    clientId: 'c1',
    date,
    memo: `Provisão ${id}`,
    category: 'ADJUSTMENT',
    lines: [
      { id: 'l1', accountId: byCode('3.3.1.01').id, accountCode: '3.3.1.01', accountName: 'x', type: 'DEBIT', amount },
      { id: 'l2', accountId: byCode('1.1.1.01').id, accountCode: '1.1.1.01', accountName: 'y', type: 'CREDIT', amount },
    ],
    totalAmount: amount,
    createdAt: 'T',
    updatedAt: 'T',
    createdByUid: 'alice',
  } as JournalEntryDraft);

  it('Diário: numeração sequencial, número imutável e partidas dobradas', async () => {
    const audit = (d: JournalEntryDraft | JournalEntry, action: 'JOURNAL_CREATE' | 'JOURNAL_UPDATE' | 'JOURNAL_DELETE') => journalAudit(action, { uid: 'alice' }, 'c1', 'T', d);
    const a = await repo.createJournalEntry(journalDraft('j1', '2025-03-31'), audit(journalDraft('j1', '2025-03-31'), 'JOURNAL_CREATE'));
    const b = await repo.createJournalEntry(journalDraft('j2', '2025-03-15'), audit(journalDraft('j2', '2025-03-15'), 'JOURNAL_CREATE'));
    expect([a.entryNumber, b.entryNumber]).toEqual([1, 2]);
    await repo.updateJournalEntry({ ...a, memo: 'Editado' }, audit(a, 'JOURNAL_UPDATE'));
    expect((await repo.listJournalEntries('c1')).map((j) => [j.id, j.entryNumber, j.memo])).toEqual([
      ['j1', 1, 'Editado'],
      ['j2', 2, 'Provisão j2'],
    ]);
    expect((await repo.getJournalCounter('c1'))?.last).toBe(2);
    const unbalanced = { ...journalDraft('j3', '2025-03-10'), lines: [journalDraft('j3', '2025-03-10').lines[0]] };
    await expect(repo.createJournalEntry(unbalanced, audit(unbalanced, 'JOURNAL_CREATE'))).rejects.toThrow();
    await repo.deleteJournalEntry('j2', audit(b, 'JOURNAL_DELETE'));
    expect((await repo.listJournalEntries('c1', { start: '2025-03-01', end: '2025-03-31' })).map((j) => j.id)).toEqual(['j1']);
  });

  it('caches: saldos consolidados e resumos da DRE por intervalo de meses', async () => {
    const summary = (month: string, amount: number): ResultSummary => ({
      id: `c1_${month}`,
      clientId: 'c1',
      month,
      lockedAt: 'L',
      txCount: 2,
      configKey: 'k',
      lines: [{ accountId: byCode('3.3.1.01').id, amount, count: 2 }],
      reconciledCount: 2,
      awaitingApproval: 0,
      pendingCount: 0,
      postings: [{ accountId: byCode('3.3.1.01').id, value: -amount }],
      createdAt: 'T',
    });
    await repo.saveResultSummaries([summary('2025-01', -10), summary('2025-02', -20), summary('2025-03', -30)]);
    await repo.saveResultSummaries([summary('2025-02', -25)]); // substitui
    expect((await repo.listResultSummaries('c1', '2025-02', '2025-03')).map((s) => [s.month, s.lines[0].amount])).toEqual([
      ['2025-02', -25],
      ['2025-03', -30],
    ]);
    // O resumo guarda o fechamento com que foi montado (não é carimbado pelo servidor).
    expect((await repo.listResultSummaries('c1', '2025-01', '2025-01'))[0].lockedAt).toBe('L');
  });

  it('honorários e agenda: um documento por empresa, gravação substitui', async () => {
    const fees: FeeRegister = {
      id: 'c1',
      clientId: 'c1',
      dueDay: 10,
      adjustmentMonth: 3,
      rates: [{ fromMonth: '2025-01', amount: 800 }],
      payments: [{ month: '2025-01', amount: 800, paidAt: '2025-01-09' }],
      updatedAt: 'T',
    };
    await repo.saveFeeRegister(fees);
    const withoutAdjustment: FeeRegister = { ...fees, adjustmentMonth: undefined, payments: [] };
    await repo.saveFeeRegister(withoutAdjustment);
    expect(plain(await repo.listFeeRegisters())).toEqual([plain(withoutAdjustment)]);

    const checks: ObligationChecks = { id: 'c1', clientId: 'c1', enabled: ['EFD_REINF'], disabled: [], done: [{ key: 'DAS|2025-01', doneAt: '2025-02-18' }], updatedAt: 'T' };
    await repo.saveObligationChecks(checks);
    expect(plain(await repo.listObligationChecks())).toEqual([plain(checks)]);
  });

  it('cadastro por empresa recusa gravação com versão desatualizada', async () => {
    const audit = (id: string) => ({ id, clientId: 'c1', action: 'STOCK_SAVE' as const, actorUid: 'alice', at: 'T' });
    const stock: StockControl = {
      id: 'c1',
      clientId: 'c1',
      stockAccountId: byCode('1.1.3.01').id,
      stockAccountCode: '1.1.3.01',
      costAccountId: byCode('3.2.1.01').id,
      costAccountCode: '3.2.1.01',
      startMonth: '2025-01',
      frequency: 'MONTHLY',
      counts: {},
      updatedAt: 'T',
    };
    await repo.saveStockControl(stock, audit('a1'), { expectedVersion: null, expectedUpdatedAt: null });
    expect((await repo.getStockControl('c1'))?.version).toBe(1);
    await expect(repo.saveStockControl(stock, audit('a2'), { expectedVersion: null, expectedUpdatedAt: null })).rejects.toBeInstanceOf(RegisterConflictError);
    await repo.saveStockControl(stock, audit('a3'), { expectedVersion: 1 });
    expect((await repo.getStockControl('c1'))?.version).toBe(2);
  });

  it('notas explicativas por exercício', async () => {
    await repo.saveExplanatoryNotes({ id: '', clientId: 'c1', year: '2025', notes: [], updatedAt: 'T' });
    expect((await repo.getExplanatoryNotes('c1', '2025'))?.id).toBe('c1_2025');
    expect(await repo.getExplanatoryNotes('c1', '2024')).toBeNull();
    expect((await repo.listExplanatoryNotes('c1')).map((n) => n.year)).toEqual(['2025']);
  });

  it('notas fiscais: chaves existentes, preservação de vínculos e cancelamento', async () => {
    const k1 = '35250311444777000161550010000000011123456780';
    const k2 = '35250311444777000161550010000000021123456780';
    const inv = (key: string, number: string): InvoiceSummary => ({
      id: `c1_${key}`,
      clientId: 'c1',
      key,
      number,
      series: '1',
      model: '55',
      issueDate: '2025-03-10',
      direction: 'PURCHASE',
      counterpartyDoc: '11444777000161',
      counterpartyName: 'Fornecedor',
      total: 500,
      cfops: [{ cfop: '5102', amount: 500 }],
      installments: [],
      status: 'AUTHORIZED',
      importedAt: 'T',
    });
    await repo.saveInvoices([inv(k1, '1')]);
    expect([...(await repo.findExistingInvoiceKeys('c1', [k1, k2]))]).toEqual([k1]);
    await repo.linkInvoice(`c1_${k1}`, { transactionId: 'c1_1', amount: 500, accountId: byCode('3.2.1.01').id, linkedAt: 'T' });
    await repo.saveInvoices([inv(k1, '1')]); // reimportar preserva links
    expect((await repo.listInvoices('c1'))[0].links).toHaveLength(1);
    expect(await repo.cancelInvoices('c1', [k1, k2])).toBe(1);
    expect((await repo.listInvoices('c1'))[0].status).toBe('CANCELLED');
  });

  it('exclusão da empresa apaga em cascata e preserva a auditoria', async () => {
    await repo.insertTransactions([tx(1, '2025-01-10')]);
    await repo.closePeriod(lockOf('2025-01'), closeAudit('2025-01'));
    await repo.saveFeeRegister({ id: 'c1', clientId: 'c1', dueDay: 5, rates: [{ fromMonth: '2025-01', amount: 1 }], payments: [], updatedAt: 'T' });
    await repo.saveObligationChecks({ id: 'c1', clientId: 'c1', enabled: [], disabled: [], done: [], updatedAt: 'T' });
    await repo.saveResultSummaries([
      { id: 'c1_2025-01', clientId: 'c1', month: '2025-01', lockedAt: 'L', txCount: 1, configKey: 'k', lines: [], reconciledCount: 0, awaitingApproval: 0, pendingCount: 1, postings: [], createdAt: 'T' },
    ]);
    await repo.deleteClient('c1', { uid: 'alice' });
    expect(await repo.listClients()).toEqual([]);
    expect(await repo.listTransactions('c1')).toEqual([]);
    expect(await repo.listPeriodLocks('c1')).toEqual([]);
    expect(await repo.listAccounts('c1')).toEqual([]);
    expect(await repo.listFeeRegisters()).toEqual([]);
    expect(await repo.listObligationChecks()).toEqual([]);
    expect(await repo.listResultSummaries('c1', '0000-01', '9999-12')).toEqual([]);
    expect((await repo.listAudit('c1')).map((a) => a.action).sort()).toEqual(['PERIOD_CLOSE', 'PERIOD_REOPEN']);
  });
});
