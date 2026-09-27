/**
 * Regras de segurança do Firestore (firestore.rules) no emulador.
 * Rodar com: npm run test:rules
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import { writeBatch } from 'firebase/firestore';
import { createFirestoreRepository } from '@/lib/data/firestore-repository';
import { approveTransition, autoClassifyTransition, classifyTransition, resetTransition, splitTransition } from '@/lib/transitions';
import { transactionAudit } from '@/lib/audit';
import { ensureUserProfile } from '@/lib/data/profile';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import type { BankTransaction } from '@/types/firestore';

const PROJECT = 'demo-contaflow';
let env: RulesTestEnvironment;

// alice e carol: escritório A. bob: escritório B. mallory: autenticado, sem perfil.
const ORG_A = 'org-a';
const ORG_B = 'org-b';

const asUser = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const anon = () => env.unauthenticatedContext().firestore() as unknown as Firestore;

const client = (id: string, orgId: string) => ({
  id,
  orgId,
  name: `Empresa ${id}`,
  cnpj: '11222333000181',
  regime: 'SIMPLES_NACIONAL',
  createdAt: '2025-01-01',
  updatedAt: '2025-01-01',
});

const tx = (id: string, clientId: string, orgId: string, date = '2025-03-10'): BankTransaction => ({
  id,
  orgId,
  clientId,
  // Convenção do app: ID do documento = `${clientId}_${fitid}`.
  fitid: id.startsWith(`${clientId}_`) ? id.slice(clientId.length + 1) : id,
  date,
  amount: -100,
  type: 'DEBIT',
  memo: 'TARIFA',
  status: 'PENDING',
  createdAt: '2025-03-10',
});

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

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    await setDoc(doc(db, 'users/alice'), { uid: 'alice', orgId: ORG_A });
    await setDoc(doc(db, 'users/carol'), { uid: 'carol', orgId: ORG_A });
    await setDoc(doc(db, 'users/bob'), { uid: 'bob', orgId: ORG_B });
    await setDoc(doc(db, 'clients/cA'), client('cA', ORG_A));
    await setDoc(doc(db, 'clients/cB'), client('cB', ORG_B));
    await setDoc(doc(db, 'transactions/cA_1'), tx('cA_1', 'cA', ORG_A));
    await setDoc(doc(db, 'transactions/cB_1'), tx('cB_1', 'cB', ORG_B));
  });
});

describe('autenticação e perfil', () => {
  it('nega acesso sem login', async () => {
    await assertFails(getDoc(doc(anon(), 'clients/cA')));
    await assertFails(getDocs(query(collection(anon(), 'clients'), where('orgId', '==', ORG_A))));
  });

  it('nega acesso a usuário autenticado sem perfil de escritório', async () => {
    await assertFails(getDoc(doc(asUser('mallory'), 'clients/cA')));
  });

  it('usuário lê apenas o próprio perfil', async () => {
    await assertSucceeds(getDoc(doc(asUser('alice'), 'users/alice')));
    await assertFails(getDoc(doc(asUser('alice'), 'users/bob')));
  });

  it('primeiro acesso cria escritório próprio (orgId = uid) e nunca entra em outro', async () => {
    const db = asUser('dave');
    await assertFails(setDoc(doc(db, 'users/dave'), { uid: 'dave', orgId: ORG_A }));
    await expect(ensureUserProfile(db, { uid: 'dave', email: 'dave@x.com' })).resolves.toBe('dave');
    // Chamadas seguintes reaproveitam o perfil existente.
    await expect(ensureUserProfile(db, { uid: 'dave' })).resolves.toBe('dave');
  });

  it('o próprio usuário não troca de escritório nem apaga o perfil', async () => {
    await assertFails(updateDoc(doc(asUser('alice'), 'users/alice'), { orgId: ORG_B }));
    await assertFails(deleteDoc(doc(asUser('alice'), 'users/alice')));
  });
});

describe('isolamento entre escritórios', () => {
  it('lê documentos do próprio escritório, inclusive de colegas', async () => {
    await assertSucceeds(getDoc(doc(asUser('alice'), 'clients/cA')));
    await assertSucceeds(getDoc(doc(asUser('carol'), 'clients/cA')));
    await assertSucceeds(getDoc(doc(asUser('alice'), 'transactions/cA_1')));
  });

  it('não lê documentos de outro escritório', async () => {
    await assertFails(getDoc(doc(asUser('alice'), 'clients/cB')));
    await assertFails(getDoc(doc(asUser('alice'), 'transactions/cB_1')));
    await assertFails(getDoc(doc(asUser('bob'), 'clients/cA')));
  });

  it('consultas precisam filtrar pelo próprio orgId', async () => {
    const db = asUser('alice');
    await assertFails(getDocs(collection(db, 'clients')));
    await assertFails(getDocs(query(collection(db, 'clients'), where('orgId', '==', ORG_B))));
    await assertSucceeds(getDocs(query(collection(db, 'clients'), where('orgId', '==', ORG_A))));
  });

  it('não cria documento em nome de outro escritório', async () => {
    await assertFails(setDoc(doc(asUser('alice'), 'clients/novo'), client('novo', ORG_B)));
    await assertSucceeds(setDoc(doc(asUser('alice'), 'clients/novo'), client('novo', ORG_A)));
  });

  it('não move documentos entre escritórios nem troca o cliente de um lançamento', async () => {
    const db = asUser('alice');
    await assertFails(updateDoc(doc(db, 'clients/cA'), { orgId: ORG_B }));
    await assertSucceeds(updateDoc(doc(db, 'clients/cA'), { name: 'Renomeada' }));
    await assertFails(updateDoc(doc(db, 'transactions/cA_1'), { clientId: 'cB' }));
    await assertSucceeds(updateDoc(doc(db, 'transactions/cA_1'), { status: 'RECONCILED' }));
  });

  it('não vincula dados a cliente de outro escritório, mesmo com o próprio orgId', async () => {
    await assertFails(setDoc(doc(asUser('alice'), 'transactions/cB_x'), tx('cB_x', 'cB', ORG_A)));
    await assertFails(setDoc(doc(asUser('alice'), 'transactions/fantasma_x'), tx('fantasma_x', 'fantasma', ORG_A)));
  });

  it('não exclui dados de outro escritório', async () => {
    await assertFails(deleteDoc(doc(asUser('bob'), 'clients/cA')));
    await assertFails(deleteDoc(doc(asUser('bob'), 'transactions/cA_1')));
  });
});

describe('repositório da aplicação sob as regras', () => {
  it('fluxo completo do escritório A passa pelas regras', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);

    await repo.saveClient({ id: 'c2', name: 'Nova', cnpj: '11222333000181', regime: 'MEI', createdAt: '', updatedAt: '' });
    expect((await repo.listClients()).map((c) => c.id).sort()).toEqual(['c2', 'cA']);

    await repo.insertAccounts(buildITG1000Chart('c2', '2025-01-01'));
    expect(await repo.listAccounts('c2')).toHaveLength(139);

    await repo.insertTransactions([tx('c2_1', 'c2', ORG_A, '2025-01-15'), tx('c2_2', 'c2', ORG_A, '2025-02-15')], {
      id: 'b1',
      clientId: 'c2',
      fileName: 'x.ofx',
      fileSize: 0,
      totalTransactions: 2,
      importedCount: 2,
      duplicateCount: 0,
      autoClassifiedCount: 0,
      totalDebit: 200,
      totalCredit: 0,
      importedAt: '',
    });
    expect((await repo.listTransactions('c2', { start: '2025-02-01', end: '2025-02-28' })).map((t) => t.id)).toEqual(['c2_2']);
    expect(await repo.latestTransactionDate('c2')).toBe('2025-02-15');
    expect([...(await repo.findExistingTransactionIds('c2', ['c2_1', 'c2_9']))]).toEqual(['c2_1']);

    const account = { accountId: 'c2_itg22_3.4.1.01.002', accountCode: '3.4.1.01.002', accountName: 'Despesas Bancárias' };
    const alice = { uid: 'alice' };
    const [t2, t1] = await repo.listTransactions('c2');
    const c = classifyTransition(t1, account, 'r1', '2025-03-01');
    const auto = autoClassifyTransition(t2, account, 'r1');
    await repo.commitChanges({
      patches: [c.patch, auto.patch],
      rules: [{ id: 'r1', clientId: 'c2', pattern: 'tarifa', ...account, createdAt: '', updatedAt: '' }],
      audits: [transactionAudit('CLASSIFY', alice, t1, c.after, '2025-03-01'), transactionAudit('AUTO_CLASSIFY', alice, t2, auto.after, '2025-03-01')],
    });
    expect((await repo.listRules('c2')).map((r) => r.id)).toEqual(['r1']);
    expect((await repo.listAudit('c2')).map((e) => e.action).sort()).toEqual(['AUTO_CLASSIFY', 'CLASSIFY']);
    expect((await repo.listAudit('c2', { transactionId: 'c2_1' })).map((e) => e.action)).toEqual(['CLASSIFY']);

    const sp = splitTransition(c.after, [{ id: 's1', accountId: account.accountId, amount: -100, memo: '' }], '2025-03-02');
    await repo.commitChanges({ patches: [sp.patch], audits: [transactionAudit('SPLIT', alice, c.after, sp.after, '2025-03-02')] });
    await repo.commitChanges({ patches: [resetTransition(sp.after).patch], audits: [] });
    await repo.commitChanges({ patches: [approveTransition(auto.after, '2025-03-03').patch], audits: [] });
    expect((await repo.listPendingTransactions('c2')).map((t) => t.id)).toEqual(['c2_1']);

    // Fechamento bloqueia alterações daquele mês até a reabertura.
    const lock = { id: 'c2_2025-01', clientId: 'c2', month: '2025-01', lockedAt: 'T', lockedByUid: 'alice' };
    await repo.closePeriod(lock, { id: 'au-close', clientId: 'c2', action: 'PERIOD_CLOSE', actorUid: 'alice', at: 'T', month: '2025-01' });
    expect((await repo.listPeriodLocks('c2')).map((l) => l.month)).toEqual(['2025-01']);
    const [, pending] = await repo.listTransactions('c2');
    await expect(
      repo.commitChanges({ patches: [classifyTransition(pending, account, null, 'T').patch], audits: [] })
    ).rejects.toThrow();
    await repo.reopenPeriod(lock, { id: 'au-reopen', clientId: 'c2', action: 'PERIOD_REOPEN', actorUid: 'alice', at: 'T', month: '2025-01', note: 'ajuste' });
    await repo.commitChanges({ patches: [classifyTransition(pending, account, null, 'T').patch], audits: [] });

    await repo.saveImportBatch({ id: 'b1', clientId: 'c2', fileName: 'x', fileSize: 0, totalTransactions: 2, importedCount: 2, duplicateCount: 0, autoClassifiedCount: 0, totalDebit: 0, totalCredit: 0, importedAt: '', ledgerBalance: 10 });
    expect((await repo.listImportBatches('c2')).find((b) => b.id === 'b1')?.ledgerBalance).toBe(10);

    await repo.deleteClient('c2');
    expect((await repo.listClients()).map((c) => c.id)).toEqual(['cA']);
    expect(await repo.listTransactions('c2')).toEqual([]);
    expect(await repo.listPeriodLocks('c2')).toEqual([]);
    // A trilha de auditoria permanece após excluir a empresa.
    expect((await repo.listAudit('c2')).length).toBeGreaterThan(0);
  });

  it('um colega do mesmo escritório vê os mesmos dados', async () => {
    const carol = createFirestoreRepository(asUser('carol'), () => ORG_A);
    expect((await carol.listClients()).map((c) => c.id)).toEqual(['cA']);
    expect((await carol.listTransactions('cA')).map((t) => t.id)).toEqual(['cA_1']);
  });

  it('usuário de outro escritório não enxerga nem apaga nada do escritório A', async () => {
    const bob = createFirestoreRepository(asUser('bob'), () => ORG_B);
    expect((await bob.listClients()).map((c) => c.id)).toEqual(['cB']);
    expect(await bob.listTransactions('cA')).toEqual([]);
    await expect(bob.deleteClient('cA')).rejects.toThrow();

    // Mesmo forjando o orgId do escritório A, as regras recusam.
    const forged = createFirestoreRepository(asUser('bob'), () => ORG_A);
    await expect(forged.listClients()).rejects.toThrow();
  });
});

describe('trilha de auditoria (somente inclusão)', () => {
  const entry = (id: string, actorUid: string, orgId = ORG_A, clientId = 'cA') => ({
    id,
    orgId,
    clientId,
    action: 'CLASSIFY',
    actorUid,
    at: '2025-03-01',
    transactionId: 'cA_1',
  });

  it('registra em nome próprio; não em nome de outro usuário', async () => {
    await assertSucceeds(setDoc(doc(asUser('alice'), 'audit_log/a1'), entry('a1', 'alice')));
    await assertFails(setDoc(doc(asUser('alice'), 'audit_log/a2'), entry('a2', 'carol')));
  });

  it('ninguém edita nem apaga registros, nem o próprio autor', async () => {
    await assertSucceeds(setDoc(doc(asUser('alice'), 'audit_log/a1'), entry('a1', 'alice')));
    await assertFails(updateDoc(doc(asUser('alice'), 'audit_log/a1'), { action: 'APPROVE' }));
    await assertFails(deleteDoc(doc(asUser('alice'), 'audit_log/a1')));
    await assertFails(setDoc(doc(asUser('alice'), 'audit_log/a1'), entry('a1', 'alice'))); // sobrescrever = update
  });

  it('colega lê a trilha do escritório; outro escritório não', async () => {
    await assertSucceeds(setDoc(doc(asUser('alice'), 'audit_log/a1'), entry('a1', 'alice')));
    await assertSucceeds(getDoc(doc(asUser('carol'), 'audit_log/a1')));
    await assertFails(getDoc(doc(asUser('bob'), 'audit_log/a1')));
    await assertFails(setDoc(doc(asUser('bob'), 'audit_log/b1'), entry('b1', 'bob', ORG_B, 'cA')));
  });
});

describe('fechamento de competência', () => {
  const lock = (month: string, by = 'alice', clientId = 'cA', orgId = ORG_A) => ({
    id: `${clientId}_${month}`,
    orgId,
    clientId,
    month,
    lockedAt: 'T',
    lockedByUid: by,
  });

  it('valida id, competência e autor do fechamento', async () => {
    const db = asUser('alice');
    await assertFails(setDoc(doc(db, 'period_locks/cA_2025-04'), lock('2025-03'))); // id não confere
    await assertFails(setDoc(doc(db, 'period_locks/cA_2025-13'), lock('2025-13'))); // mês inválido
    await assertFails(setDoc(doc(db, 'period_locks/cA_2025-03'), lock('2025-03', 'carol'))); // autor ≠ usuário
    await assertFails(setDoc(doc(asUser('bob'), 'period_locks/cA_2025-03'), lock('2025-03', 'bob', 'cA', ORG_B)));
    await assertSucceeds(setDoc(doc(db, 'period_locks/cA_2025-03'), lock('2025-03')));
    await assertFails(updateDoc(doc(db, 'period_locks/cA_2025-03'), { lockedAt: 'X' }));
  });

  it('mês fechado congela lançamentos; outros meses seguem livres; reabrir libera', async () => {
    const db = asUser('alice');
    await setDoc(doc(db, 'period_locks/cA_2025-03'), lock('2025-03'));
    await assertFails(updateDoc(doc(db, 'transactions/cA_1'), { status: 'RECONCILED' }));
    // Mesmo um colega (ou quem fechou) não altera sem reabrir.
    await assertFails(updateDoc(doc(asUser('carol'), 'transactions/cA_1'), { status: 'RECONCILED' }));

    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore() as unknown as Firestore, 'transactions/cA_2'), tx('cA_2', 'cA', ORG_A, '2025-04-02'));
    });
    await assertSucceeds(updateDoc(doc(db, 'transactions/cA_2'), { status: 'RECONCILED' }));

    await assertSucceeds(deleteDoc(doc(db, 'period_locks/cA_2025-03')));
    await assertSucceeds(updateDoc(doc(db, 'transactions/cA_1'), { status: 'RECONCILED' }));
  });

  it('data e valor do lançamento são imutáveis (não dá para "fugir" do mês fechado)', async () => {
    const db = asUser('alice');
    await assertFails(updateDoc(doc(db, 'transactions/cA_1'), { date: '2025-04-01' }));
    await assertFails(updateDoc(doc(db, 'transactions/cA_1'), { amount: -1 }));
  });

  it('importar em mês fechado é permitido (lançamento novo, pendente)', async () => {
    const db = asUser('alice');
    await setDoc(doc(db, 'period_locks/cA_2025-03'), lock('2025-03'));
    await assertSucceeds(setDoc(doc(db, 'transactions/cA_9'), tx('cA_9', 'cA', ORG_A, '2025-03-20')));
  });
});

describe('limite de documentos consultados por lote', () => {
  const months = Array.from({ length: 26 }, (_, i) => `20${23 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      for (const [i, m] of months.entries()) await setDoc(doc(db, `transactions/cA_m${i}`), tx(`cA_m${i}`, 'cA', ORG_A, `${m}-10`));
    });
  });

  it('um lote cru tocando 26 competências é recusado pelas regras', async () => {
    const db = asUser('alice');
    const b = writeBatch(db);
    months.forEach((_, i) => b.update(doc(db, `transactions/cA_m${i}`), { status: 'RECONCILED' }));
    await assertFails(b.commit());
  });

  it('o repositório agrupa por competência e grava tudo, com auditoria', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    const all = (await repo.listTransactions('cA')).filter((t) => t.id.startsWith('cA_m'));
    const moves = all.map((t) => ({ t, ...approveTransition(t, 'T') }));
    await repo.commitChanges({
      patches: moves.map((m) => m.patch),
      audits: moves.map((m) => transactionAudit('APPROVE', { uid: 'alice' }, m.t, m.after, 'T')),
    });
    const after = (await repo.listTransactions('cA')).filter((t) => t.id.startsWith('cA_m'));
    expect(after).toHaveLength(26);
    expect(after.every((t) => t.status === 'RECONCILED')).toBe(true);
    expect((await repo.listAudit('cA')).filter((e) => e.action === 'APPROVE')).toHaveLength(26);
  });
});

describe('escritório e responsável técnico', () => {
  const settings = (orgId: string) => ({ orgId, officeName: 'Escritório', accountantName: 'Ana', accountantCrc: 'SP-123456/O-5', updatedAt: 'T' });

  it('membros leem e gravam o próprio escritório; nunca o de outro', async () => {
    await assertSucceeds(setDoc(doc(asUser('alice'), `orgs/${ORG_A}`), settings(ORG_A)));
    await assertSucceeds(getDoc(doc(asUser('carol'), `orgs/${ORG_A}`)));
    await assertFails(getDoc(doc(asUser('bob'), `orgs/${ORG_A}`)));
    await assertFails(setDoc(doc(asUser('bob'), `orgs/${ORG_A}`), settings(ORG_A)));
    await assertFails(setDoc(doc(asUser('alice'), `orgs/${ORG_A}`), settings(ORG_B)));
    await assertFails(deleteDoc(doc(asUser('alice'), `orgs/${ORG_A}`)));
  });

  it('repositório lê e grava as configurações', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    expect(await repo.getOrgSettings()).toBeNull();
    await repo.saveOrgSettings(settings(ORG_A));
    expect(await repo.getOrgSettings()).toMatchObject({ accountantCrc: 'SP-123456/O-5' });
  });
});
