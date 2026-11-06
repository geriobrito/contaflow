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
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import { writeBatch } from 'firebase/firestore';
import { createFirestoreRepository } from '@/lib/data/firestore-repository';
import { approveTransition, autoClassifyTransition, classifyTransition, resetTransition, splitTransition } from '@/lib/transitions';
import { transactionAudit } from '@/lib/audit';
import { ensureUserProfile } from '@/lib/data/profile';
import { periodAuditId } from '@/lib/periods';
import { fieldsKeptOutsideForm } from '@/lib/client-record';
import { loadLedgerWindow } from '@/lib/services/ledger-loader';
import { buildITG1000Chart, ITG1000_ACCOUNT_COUNT } from '@/lib/chart/itg1000';
import type { BankTransaction } from '@/types/firestore';

const PROJECT = 'demo-contaflow';
let env: RulesTestEnvironment;

// alice (administradora) e carol (operadora): escritório A. bob: escritório B. mallory: autenticado, sem perfil.
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

/**
 * Fechamento de competência e o registro de auditoria que as regras exigem na mesma gravação.
 * As datas são do servidor (serverTimestamp); o id do registro sai da chave `auditKey`.
 */
const lockOf = (month: string, by = 'alice', clientId = 'cA', orgId = ORG_A, auditKey = 'chave-teste-000001') => ({
  id: `${clientId}_${month}`,
  orgId,
  clientId,
  month,
  lockedAt: serverTimestamp(),
  auditKey,
  lockedByUid: by,
});
type Lock = ReturnType<typeof lockOf>;
const auditIdOf = (lock: Pick<Lock, 'id' | 'auditKey'>, kind: 'close' | 'reopen') => periodAuditId({ id: lock.id, auditKey: lock.auditKey }, kind);
const periodAudit = (lock: Lock, kind: 'close' | 'reopen', by = lock.lockedByUid) => ({
  id: auditIdOf(lock, kind),
  orgId: lock.orgId,
  clientId: lock.clientId,
  action: kind === 'close' ? 'PERIOD_CLOSE' : 'PERIOD_REOPEN',
  actorUid: by,
  at: serverTimestamp(),
  month: lock.month,
});
/** Cópia sem o campo (para testar documentos incompletos). */
const omit = <T extends object>(obj: T, key: keyof T): Partial<T> => {
  const copy: Partial<T> = { ...obj };
  delete copy[key];
  return copy;
};
const createClient = (db: Firestore, id: string, orgId: string) => {
  const b = writeBatch(db);
  b.set(doc(db, `clients/${id}`), client(id, orgId));
  b.set(doc(db, `lock_state/${id}`), { id, orgId, clientId: id, count: 0, seq: 0 });
  return b.commit();
};

const closeMonth = async (db: Firestore, lock: Lock = lockOf('2025-03')) => {
  const lsRef = doc(db, `lock_state/${lock.clientId}`);
  const lsSnap = await getDoc(lsRef);
  const prev = lsSnap.exists() ? (lsSnap.data() as { count: number; seq: number }) : { count: 0, seq: 0 };
  const b = writeBatch(db);
  b.set(doc(db, `period_locks/${lock.id}`), lock);
  b.set(lsRef, {
    id: lock.clientId,
    orgId: lock.orgId,
    clientId: lock.clientId,
    count: prev.count + 1,
    seq: prev.seq + 1,
    lastEvent: { kind: 'close', lockId: lock.id },
  });
  b.set(doc(db, `audit_log/${auditIdOf(lock, 'close')}`), periodAudit(lock, 'close'));
  return b.commit();
};
const reopenMonth = async (db: Firestore, lock: Lock = lockOf('2025-03'), by = 'alice') => {
  const lsRef = doc(db, `lock_state/${lock.clientId}`);
  const lsSnap = await getDoc(lsRef);
  const prev = lsSnap.exists() ? (lsSnap.data() as { count: number; seq: number }) : { count: 1, seq: 1 };
  const b = writeBatch(db);
  b.delete(doc(db, `period_locks/${lock.id}`));
  b.set(lsRef, {
    id: lock.clientId,
    orgId: lock.orgId,
    clientId: lock.clientId,
    count: Math.max(0, prev.count - 1),
    seq: prev.seq,
    lastEvent: { kind: 'reopen', lockId: lock.id },
  });
  b.set(doc(db, `audit_log/${auditIdOf(lock, 'reopen')}`), periodAudit(lock, 'reopen', by));
  return b.commit();
};

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
    await setDoc(doc(db, 'users/carol'), { uid: 'carol', orgId: ORG_A, role: 'operator' });
    await setDoc(doc(db, 'users/bob'), { uid: 'bob', orgId: ORG_B });
    await setDoc(doc(db, 'clients/cA'), client('cA', ORG_A));
    await setDoc(doc(db, 'clients/cB'), client('cB', ORG_B));
    await setDoc(doc(db, 'lock_state/cA'), { id: 'cA', orgId: ORG_A, clientId: 'cA', count: 0, seq: 0 });
    await setDoc(doc(db, 'lock_state/cB'), { id: 'cB', orgId: ORG_B, clientId: 'cB', count: 0, seq: 0 });
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
    await assertFails(createClient(asUser('alice'), 'novo', ORG_B));
    await assertFails(setDoc(doc(asUser('alice'), 'clients/novo'), client('novo', ORG_A))); // exige lock_state junto
    await assertSucceeds(createClient(asUser('alice'), 'novo', ORG_A));
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
    expect(await repo.listAccounts('c2')).toHaveLength(ITG1000_ACCOUNT_COUNT);

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
    const lock = { id: 'c2_2025-01', clientId: 'c2', month: '2025-01', lockedAt: 'T', auditKey: 'chave-teste-000003', lockedByUid: 'alice' };
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

    await repo.deleteClient('c2', { uid: 'alice' });
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
    await expect(bob.deleteClient('cA', { uid: 'bob' })).rejects.toThrow();

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
    at: serverTimestamp(),
    transactionId: 'cA_1',
  });

  it('registra em nome próprio; não em nome de outro usuário', async () => {
    await assertSucceeds(setDoc(doc(asUser('alice'), 'audit_log/a1'), entry('a1', 'alice')));
    await assertFails(setDoc(doc(asUser('alice'), 'audit_log/a2'), entry('a2', 'carol')));
  });

  it('a data é a do servidor: texto ou data escolhida pelo computador são recusados', async () => {
    const db = asUser('alice');
    await assertFails(setDoc(doc(db, 'audit_log/a1'), { ...entry('a1', 'alice'), at: '2025-03-01T12:00:00.000Z' }));
    await assertFails(setDoc(doc(db, 'audit_log/a1'), { ...entry('a1', 'alice'), at: Timestamp.fromMillis(Date.now() - 86_400_000) }));
    await assertFails(setDoc(doc(db, 'audit_log/a1'), omit(entry('a1', 'alice'), 'at')));
    await assertSucceeds(setDoc(doc(db, 'audit_log/a1'), entry('a1', 'alice')));
    // Na leitura pelo app, a data volta como texto ISO.
    const [read] = await createFirestoreRepository(db, () => ORG_A).listAudit('cA');
    expect(read.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('só aceita ações da lista de AuditAction', async () => {
    const db = asUser('alice');
    await assertFails(setDoc(doc(db, 'audit_log/a1'), { ...entry('a1', 'alice'), action: 'HACK' }));
    await assertFails(setDoc(doc(db, 'audit_log/a1'), { ...entry('a1', 'alice'), action: 'classify' }));
    await assertFails(setDoc(doc(db, 'audit_log/a1'), omit(entry('a1', 'alice'), 'action')));
    await assertSucceeds(setDoc(doc(db, 'audit_log/a1'), { ...entry('a1', 'alice'), action: 'JOURNAL_DELETE' }));
  });

  it('registros de fechar/reabrir competência ou exercício não nascem sozinhos', async () => {
    const db = asUser('alice');
    const alone = (id: string, action: string, month = '2025-03') =>
      setDoc(doc(db, `audit_log/${id}`), { ...omit(entry(id, 'alice'), 'transactionId'), action, month });
    await assertFails(alone(auditIdOf(lockOf('2025-03'), 'close'), 'PERIOD_CLOSE'));
    await assertFails(alone(auditIdOf(lockOf('2025-03'), 'reopen'), 'PERIOD_REOPEN'));
    await assertFails(alone('cA_2025_close_x', 'YEAR_CLOSE', '2025-12'));
    await assertFails(alone('cA_2025_close_x_reopen', 'YEAR_REOPEN', '2025-12'));
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

describe('termos do Livro Diário no cadastro da empresa', () => {
  it('grava só o campo daybook; editar a empresa pelo formulário o mantém', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    await repo.updateClientDaybook('cA', { number: '2', city: 'Recife/PE', registry: 'NIRE 26200000000' });
    const [stored] = (await repo.listClients()).filter((c) => c.id === 'cA');
    expect(stored).toMatchObject({ name: 'Empresa cA', daybook: { number: '2', city: 'Recife/PE', registry: 'NIRE 26200000000' } });
    await repo.saveClient({ ...stored, name: 'Empresa cA Renomeada', ...fieldsKeptOutsideForm(stored) });
    expect((await repo.listClients()).find((c) => c.id === 'cA')).toMatchObject({ name: 'Empresa cA Renomeada', daybook: { number: '2' } });
  });

  it('recusa formato diferente: campo extra, texto longo ou não texto', async () => {
    const ref = doc(asUser('alice'), 'clients/cA');
    await assertSucceeds(updateDoc(ref, { daybook: { number: '1', city: '', registry: '' } }));
    await assertSucceeds(updateDoc(ref, { daybook: { number: '1' } }));
    await assertFails(updateDoc(ref, { daybook: { number: '1', anexo: 'x' } }));
    await assertFails(updateDoc(ref, { daybook: { number: '1', city: 'x'.repeat(121) } }));
    await assertFails(updateDoc(ref, { daybook: { number: 1 } }));
    await assertFails(updateDoc(ref, { daybook: 'Diário nº 1' }));
    // Outro escritório não grava.
    await assertFails(updateDoc(doc(asUser('bob'), 'clients/cA'), { daybook: { number: '9' } }));
  });
});

describe('atividade principal no cadastro da empresa', () => {
  it('aceita texto de até 300 caracteres; recusa mais longo ou não texto', async () => {
    const ref = doc(asUser('alice'), 'clients/cA');
    await assertSucceeds(updateDoc(ref, { activity: 'Fabricação de produtos de panificação' }));
    await assertSucceeds(updateDoc(ref, { activity: 'x'.repeat(300) }));
    await assertFails(updateDoc(ref, { activity: 'x'.repeat(301) }));
    await assertFails(updateDoc(ref, { activity: 1091101 }));
  });

  it('o formulário grava e mantém a atividade', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    const [stored] = (await repo.listClients()).filter((c) => c.id === 'cA');
    await repo.saveClient({ ...stored, activity: 'Comércio varejista de padaria' });
    expect((await repo.listClients()).find((c) => c.id === 'cA')).toMatchObject({ activity: 'Comércio varejista de padaria' });
  });
});

describe('fechamento de competência', () => {
  const march = lockOf('2025-03');

  it('valida id, competência e autor do fechamento', async () => {
    const db = asUser('alice');
    /** Fechamento com o registro de auditoria e lock_state corretos para o id e o usuário informados. */
    const close = (id: string, lock: Lock, who = db, actor = 'alice') => {
      const auditId = auditIdOf({ id, auditKey: lock.auditKey }, 'close');
      const b = writeBatch(who);
      b.set(doc(who, `period_locks/${id}`), lock);
      b.set(doc(who, `lock_state/${lock.clientId}`), {
        id: lock.clientId,
        orgId: lock.orgId,
        clientId: lock.clientId,
        count: 1,
        seq: 1,
        lastEvent: { kind: 'close', lockId: id },
      });
      b.set(doc(who, `audit_log/${auditId}`), { ...periodAudit(lock, 'close', actor), id: auditId });
      return b.commit();
    };
    await assertFails(close('cA_2025-04', march)); // id não confere
    await assertFails(close('cA_2025-13', lockOf('2025-13'))); // mês inválido
    await assertFails(close('cA_2025-03', lockOf('2025-03', 'carol'))); // autor ≠ usuário
    await assertFails(close('cA_2025-03', lockOf('2025-03', 'bob', 'cA', ORG_B), asUser('bob'), 'bob'));
    await assertFails(close('cA_2025-03', lockOf('2025-03', 'alice', 'cA', ORG_A, 'curta'))); // chave curta demais
    await assertFails(close('cA_2025-03', lockOf('2025-03', 'alice', 'cA', ORG_A, 'chave com espaço 0001'))); // chave fora do formato
    // Fechamento sem chave.
    await assertFails(close('cA_2025-03', omit(march, 'auditKey') as Lock));
    // Data do fechamento escolhida pelo computador (texto ou outro instante).
    await assertFails(close('cA_2025-03', { ...march, lockedAt: '2025-03-31T12:00:00.000Z' as never }));
    await assertFails(close('cA_2025-03', { ...march, lockedAt: Timestamp.fromMillis(Date.now() - 60_000) as never }));
    await assertSucceeds(close('cA_2025-03', march));
    await assertFails(updateDoc(doc(db, 'period_locks/cA_2025-03'), { lockedAt: 'X' }));
    // O app relê o fechamento com a data do servidor, em texto ISO.
    const [stored] = await createFirestoreRepository(db, () => ORG_A).listPeriodLocks('cA');
    expect(stored).toMatchObject({ auditKey: march.auditKey, lockedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.+Z$/) });
  });

  it('fechar e reabrir exigem o registro de auditoria na mesma gravação', async () => {
    const db = asUser('alice');
    const closeWith = (audit: Record<string, unknown>) => {
      const b = writeBatch(db);
      b.set(doc(db, 'period_locks/cA_2025-03'), march);
      b.set(doc(db, 'lock_state/cA'), {
        id: 'cA',
        orgId: ORG_A,
        clientId: 'cA',
        count: 1,
        seq: 1,
        lastEvent: { kind: 'close', lockId: march.id },
      });
      b.set(doc(db, `audit_log/${auditIdOf(march, 'close')}`), { ...periodAudit(march, 'close'), ...audit });
      return b.commit();
    };
    // Fechar sem registro, ou com registro de outra ação, competência ou empresa.
    await assertFails(setDoc(doc(db, 'period_locks/cA_2025-03'), march));
    await assertFails(closeWith({ action: 'PERIOD_REOPEN' }));
    await assertFails(closeWith({ month: '2025-04' }));
    await assertFails(closeWith({ clientId: 'global' }));
    await assertSucceeds(closeMonth(db, march));

    // Reabrir sem registro, ou com o registro errado.
    await assertFails(deleteDoc(doc(db, 'period_locks/cA_2025-03')));
    const reopenWith = (audit: Record<string, unknown>) => {
      const b = writeBatch(db);
      b.delete(doc(db, 'period_locks/cA_2025-03'));
      b.set(doc(db, `audit_log/${auditIdOf(march, 'reopen')}`), { ...periodAudit(march, 'reopen'), ...audit });
      return b.commit();
    };
    await assertFails(reopenWith({ action: 'PERIOD_CLOSE' }));
    await assertSucceeds(reopenMonth(db, march));

    // Cada fechamento deixa o próprio registro: repetir a mesma chave reaproveitaria o antigo.
    await assertFails(closeMonth(db, march));
    await assertFails(setDoc(doc(db, 'period_locks/cA_2025-03'), march));
    await assertSucceeds(closeMonth(db, lockOf('2025-03', 'alice', 'cA', ORG_A, 'chave-teste-000002')));
    const repo = createFirestoreRepository(db, () => ORG_A);
    expect((await repo.listAudit('cA')).map((e) => e.action).sort()).toEqual(['PERIOD_CLOSE', 'PERIOD_CLOSE', 'PERIOD_REOPEN']);
  });

  /** Fechamento gravado antes desta versão: `lockedAt` em texto e id do registro a partir dele. */
  const legacyClose = async (migrated: boolean) => {
    const OLD = '2025-03-31T12:00:00.000Z';
    const oldMs = Date.parse(OLD);
    await env.withSecurityRulesDisabled(async (ctx) => {
      const admin = ctx.firestore() as unknown as Firestore;
      const lock = { id: march.id, orgId: ORG_A, clientId: 'cA', month: '2025-03', lockedByUid: 'alice' };
      // Migrado (scripts/migrar-datas-servidor.mjs): Timestamp + auditKey = texto antigo.
      await setDoc(doc(admin, `period_locks/${march.id}`), migrated ? { ...lock, lockedAt: Timestamp.fromMillis(oldMs), auditKey: OLD } : { ...lock, lockedAt: OLD });
      await setDoc(doc(admin, 'lock_state/cA'), { id: 'cA', orgId: ORG_A, clientId: 'cA', count: 1, seq: 1, lastEvent: { kind: 'close', lockId: march.id } });
      await setDoc(doc(admin, `audit_log/${march.id}_close_${OLD}`), {
        id: `${march.id}_close_${OLD}`, orgId: ORG_A, clientId: 'cA', action: 'PERIOD_CLOSE', actorUid: 'alice', month: '2025-03',
        at: migrated ? Timestamp.fromMillis(oldMs) : OLD,
      });
    });
    return OLD;
  };

  it('fechamento migrado (Timestamp + auditKey) reabre e a trilha sai em ordem', async () => {
    const OLD = await legacyClose(true);
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    const [lock] = await repo.listPeriodLocks('cA');
    // A data volta no mesmo texto de antes: os snapshots que a comparam seguem válidos.
    expect(lock).toMatchObject({ lockedAt: OLD, auditKey: OLD });
    await repo.reopenPeriod(lock, { id: '', clientId: 'cA', action: 'PERIOD_REOPEN', actorUid: 'alice', at: '', month: '2025-03', note: 'ajuste' });
    expect(await repo.listPeriodLocks('cA')).toEqual([]);
    expect((await repo.listAudit('cA')).map((e) => [e.action, e.id])).toEqual([
      ['PERIOD_REOPEN', `${march.id}_reopen_${OLD}`],
      ['PERIOD_CLOSE', `${march.id}_close_${OLD}`],
    ]);
  });

  it('fechamento antigo ainda não migrado também reabre (id pelo lockedAt em texto)', async () => {
    const OLD = await legacyClose(false);
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    const [lock] = await repo.listPeriodLocks('cA');
    expect(lock.auditKey).toBeUndefined();
    await repo.reopenPeriod(lock, { id: '', clientId: 'cA', action: 'PERIOD_REOPEN', actorUid: 'alice', at: '', month: '2025-03', note: 'ajuste' });
    expect(await repo.listPeriodLocks('cA')).toEqual([]);
    expect((await repo.listAudit('cA', { limit: 5 })).some((e) => e.id === `${march.id}_reopen_${OLD}`)).toBe(true);
  });

  it('mês fechado congela lançamentos; outros meses seguem livres; reabrir libera', async () => {
    const db = asUser('alice');
    await closeMonth(db, march);
    await assertFails(updateDoc(doc(db, 'transactions/cA_1'), { status: 'RECONCILED' }));
    // Mesmo um colega (ou quem fechou) não altera sem reabrir.
    await assertFails(updateDoc(doc(asUser('carol'), 'transactions/cA_1'), { status: 'RECONCILED' }));

    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore() as unknown as Firestore, 'transactions/cA_2'), tx('cA_2', 'cA', ORG_A, '2025-04-02'));
    });
    await assertSucceeds(updateDoc(doc(db, 'transactions/cA_2'), { status: 'RECONCILED' }));

    await assertSucceeds(reopenMonth(db, march));
    await assertSucceeds(updateDoc(doc(db, 'transactions/cA_1'), { status: 'RECONCILED' }));
  });

  it('data e valor do lançamento são imutáveis (não dá para "fugir" do mês fechado)', async () => {
    const db = asUser('alice');
    await assertFails(updateDoc(doc(db, 'transactions/cA_1'), { date: '2025-04-01' }));
    await assertFails(updateDoc(doc(db, 'transactions/cA_1'), { amount: -1 }));
  });

  it('importar em mês fechado é permitido (lançamento novo, pendente)', async () => {
    const db = asUser('alice');
    await closeMonth(db, march);
    await assertSucceeds(setDoc(doc(db, 'transactions/cA_9'), tx('cA_9', 'cA', ORG_A, '2025-03-20')));
    await assertSucceeds(setDoc(doc(db, 'transactions/cA_10'), { ...tx('cA_10', 'cA', ORG_A, '2025-03-21'), status: 'AUTO_CLASSIFIED', accountId: 'x' }));
  });

  it('lançamento novo nunca entra conciliado (não altera o resultado de mês fechado nem aberto)', async () => {
    const db = asUser('alice');
    const reconciled = (id: string, date: string) => ({ ...tx(id, 'cA', ORG_A, date), status: 'RECONCILED', accountId: 'x', reconciledAt: 'T' });
    await assertFails(setDoc(doc(db, 'transactions/cA_20'), reconciled('cA_20', '2025-04-05')));
    await closeMonth(db, march);
    await assertFails(setDoc(doc(db, 'transactions/cA_21'), reconciled('cA_21', '2025-03-20')));
    await assertFails(setDoc(doc(db, 'transactions/cA_22'), { ...tx('cA_22', 'cA', ORG_A, '2025-03-20'), status: 'QUALQUER' }));
  });
});

describe('papéis no escritório (carol é operadora)', () => {
  const april = lockOf('2025-04');

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore() as unknown as Firestore, 'import_batches/bX'), { id: 'bX', orgId: ORG_A, clientId: 'cA', fileName: 'x.ofx' });
    });
  });

  it('operador trabalha normalmente: classifica, cadastra e fecha competência', async () => {
    const db = asUser('carol');
    await assertSucceeds(updateDoc(doc(db, 'transactions/cA_1'), { status: 'RECONCILED' }));
    await assertSucceeds(createClient(db, 'novo', ORG_A));
    await assertSucceeds(closeMonth(db, lockOf('2025-04', 'carol')));
  });

  it('operador não reabre competência nem exclui empresa, extrato, lançamento ou cadastros; o administrador sim', async () => {
    const carol = asUser('carol');
    const alice = asUser('alice');
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, 'chart_of_accounts/cA_acc'), { id: 'cA_acc', orgId: ORG_A, clientId: 'cA', code: '1.1', name: 'Caixa', type: 'ASSET', nature: 'ANALYTIC', level: 2, lockSeq: 0 });
      await setDoc(doc(db, 'bank_accounts/cA_bk'), { id: 'cA_bk', orgId: ORG_A, clientId: 'cA', accountKey: 'bk', nickname: 'Itaú', lockSeq: 0 });
      await setDoc(doc(db, 'opening_balances/cA'), { id: 'cA', orgId: ORG_A, clientId: 'cA', date: '2024-12-31', entries: [], lockSeq: 0 });
    });
    await closeMonth(alice, april);
    await assertFails(reopenMonth(carol, april, 'carol'));
    await assertFails(deleteDoc(doc(carol, 'transactions/cA_1')));
    await assertFails(deleteDoc(doc(carol, 'import_batches/bX')));
    await assertFails(deleteDoc(doc(carol, 'chart_of_accounts/cA_acc')));
    await assertFails(deleteDoc(doc(carol, 'bank_accounts/cA_bk')));
    await assertFails(deleteDoc(doc(carol, 'opening_balances/cA')));
    await assertFails(deleteDoc(doc(carol, 'clients/cA')));

    await assertSucceeds(reopenMonth(alice, april));
    await assertSucceeds(deleteDoc(doc(alice, 'transactions/cA_1')));
    await assertSucceeds(deleteDoc(doc(alice, 'import_batches/bX')));
    await assertSucceeds(deleteDoc(doc(alice, 'chart_of_accounts/cA_acc')));
    await assertSucceeds(deleteDoc(doc(alice, 'bank_accounts/cA_bk')));
    await assertSucceeds(deleteDoc(doc(alice, 'opening_balances/cA')));
    await assertSucceeds(deleteDoc(doc(alice, 'clients/cA')));
  });

  it('regras de classificação: operador exclui apenas as próprias, não exclui legadas/alheias e não toma autoria', async () => {
    const carol = asUser('carol');
    const alice = asUser('alice');
    const rule = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      orgId: ORG_A,
      clientId: 'cA',
      pattern: id,
      accountId: 'a',
      createdAt: 'T',
      updatedAt: 'T',
      ...extra,
    });

    // Não pode criar regra fingindo ser outra pessoa.
    await assertFails(setDoc(doc(carol, 'classification_rules/r_falsa'), rule('r_falsa', { createdByUid: 'alice' })));
    await assertSucceeds(setDoc(doc(carol, 'classification_rules/r_carol'), rule('r_carol', { createdByUid: 'carol' })));
    await assertSucceeds(setDoc(doc(alice, 'classification_rules/r_alice'), rule('r_alice', { createdByUid: 'alice' })));
    await assertSucceeds(setDoc(doc(alice, 'classification_rules/r_legada'), rule('r_legada')));

    // Operadora edita padrão/conta, mas nunca altera ou injeta `createdByUid`.
    await assertSucceeds(updateDoc(doc(carol, 'classification_rules/r_alice'), { pattern: 'novo' }));
    await assertFails(updateDoc(doc(carol, 'classification_rules/r_alice'), { createdByUid: 'carol' }));
    await assertFails(updateDoc(doc(carol, 'classification_rules/r_legada'), { createdByUid: 'carol' }));

    // Operadora exclui a sua, mas não a de colega nem a legada; administradora exclui todas.
    await assertSucceeds(deleteDoc(doc(carol, 'classification_rules/r_carol')));
    await assertFails(deleteDoc(doc(carol, 'classification_rules/r_alice')));
    await assertFails(deleteDoc(doc(carol, 'classification_rules/r_legada')));
    await assertSucceeds(deleteDoc(doc(alice, 'classification_rules/r_alice')));
    await assertSucceeds(deleteDoc(doc(alice, 'classification_rules/r_legada')));
  });

  it('exclusão de empresa por operador é recusada antes de apagar qualquer dado', async () => {
    const repo = createFirestoreRepository(asUser('carol'), () => ORG_A);
    await repo.saveRule({ id: 'r9', clientId: 'cA', pattern: 'x', accountId: 'a', createdAt: '', updatedAt: '' });
    await expect(repo.deleteClient('cA', { uid: 'carol' })).rejects.toThrow(/administrador/);
    expect((await repo.listTransactions('cA')).map((t) => t.id)).toEqual(['cA_1']);
    expect((await repo.listRules('cA')).map((r) => r.id)).toEqual(['r9']);
  });

  it('ninguém altera o próprio papel', async () => {
    await assertFails(updateDoc(doc(asUser('carol'), 'users/carol'), { role: 'admin' }));
    await assertFails(setDoc(doc(asUser('carol'), 'users/carol'), { uid: 'carol', orgId: ORG_A }));
  });
});

describe('lançamentos manuais: partidas dobradas e numeração', () => {
  type Line = { id: string; accountId: string; type: 'DEBIT' | 'CREDIT'; amount: number };
  const line = (type: 'DEBIT' | 'CREDIT', amount: number, accountId = 'conta'): Line => ({ id: `${type}-${amount}`, accountId, type, amount });
  const draft = (id: string, overrides: { date?: string; lines?: Line[]; memo?: string } = {}) => ({
    id,
    clientId: 'cA',
    date: '2025-03-31',
    memo: 'Provisão de folha',
    category: 'PAYROLL' as const,
    lines: [line('DEBIT', 100), line('CREDIT', 100)],
    totalAmount: 100,
    createdAt: 'T',
    updatedAt: 'T',
    createdByUid: 'alice',
    ...overrides,
  });
  /** Gravação crua (sem a validação do repositório): contador e lançamento no mesmo lote, como a transação do app. */
  const rawCreate = (db: Firestore, id: string, entryNumber: number, entry: Record<string, unknown> = {}) => {
    const b = writeBatch(db);
    b.set(doc(db, 'journal_counters/cA'), { id: 'cA', orgId: ORG_A, clientId: 'cA', last: entryNumber });
    b.set(doc(db, `journal_entries/${id}`), { ...draft(id), orgId: ORG_A, entryNumber, ...entry });
    return b.commit();
  };

  const rawCreateCounter = (db: Firestore, last: number) =>
    setDoc(doc(db, 'journal_counters/cA'), { id: 'cA', orgId: ORG_A, clientId: 'cA', last });

  it('numera em sequência por cliente; número excluído não é reaproveitado', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    expect((await repo.createJournalEntry(draft('j1'))).entryNumber).toBe(1);
    expect((await repo.createJournalEntry(draft('j2'))).entryNumber).toBe(2);
    expect((await repo.createJournalEntry(draft('j3'))).entryNumber).toBe(3);
    await repo.deleteJournalEntry('j2');
    expect((await repo.createJournalEntry(draft('j4'))).entryNumber).toBe(4);
    expect((await repo.listJournalEntries('cA')).map((e) => e.entryNumber).sort()).toEqual([1, 3, 4]);
  });

  it('dois usuários lançando ao mesmo tempo recebem números diferentes', async () => {
    const alice = createFirestoreRepository(asUser('alice'), () => ORG_A);
    const carol = createFirestoreRepository(asUser('carol'), () => ORG_A);
    const created = await Promise.all([
      alice.createJournalEntry(draft('ja')),
      carol.createJournalEntry(draft('jc')),
      alice.createJournalEntry(draft('ja2')),
    ]);
    expect(created.map((e) => e.entryNumber).sort()).toEqual([1, 2, 3]);
  });

  it('cliente com lançamentos anteriores ao contador continua do maior número', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, 'journal_entries/antigo1'), { ...draft('antigo1'), orgId: ORG_A, entryNumber: 4 });
      await setDoc(doc(db, 'journal_entries/antigo2'), { ...draft('antigo2'), orgId: ORG_A, entryNumber: 7 });
    });
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    expect((await repo.createJournalEntry(draft('novo'))).entryNumber).toBe(8);
  });

  it('o número vem do contador avançado na mesma gravação; não se repete nem muda', async () => {
    const db = asUser('alice');
    await assertSucceeds(rawCreate(db, 'j1', 1));
    // Sem avançar o contador (número repetido) ou com número diferente do contador.
    await assertFails(setDoc(doc(db, 'journal_entries/j2'), { ...draft('j2'), orgId: ORG_A, entryNumber: 1 }));
    await assertFails(setDoc(doc(db, 'journal_entries/j2'), { ...draft('j2'), orgId: ORG_A, entryNumber: 2 }));
    // O contador só avança de um em um e não volta.
    await assertFails(rawCreate(db, 'j2', 5));
    await assertFails(rawCreate(db, 'j2', 1));
    await assertSucceeds(rawCreate(db, 'j2', 2));
    await assertFails(updateDoc(doc(db, 'journal_entries/j2'), { entryNumber: 9 }));
    await assertSucceeds(updateDoc(doc(db, 'journal_entries/j2'), { memo: 'Histórico corrigido' }));
    // Enquanto a empresa existe, ninguém apaga a sequência.
    await assertFails(deleteDoc(doc(db, 'journal_counters/cA')));
    await assertFails(setDoc(doc(asUser('bob'), 'journal_counters/cA'), { id: 'cA', orgId: ORG_B, clientId: 'cA', last: 3 }));
  });

  it('recusa lançamento em que débitos ≠ créditos, na criação e na edição', async () => {
    const db = asUser('alice');
    await assertFails(rawCreate(db, 'j1', 1, { lines: [line('DEBIT', 100), line('CREDIT', 99.99)] }));
    await assertFails(rawCreate(db, 'j1', 1, { lines: [line('DEBIT', 100), line('DEBIT', 100)] }));
    await assertFails(rawCreate(db, 'j1', 1, { lines: [line('DEBIT', 100)] }));
    await assertFails(rawCreate(db, 'j1', 1, { lines: [] }));
    await assertSucceeds(rawCreate(db, 'j1', 1));
    await assertFails(updateDoc(doc(db, 'journal_entries/j1'), { lines: [line('DEBIT', 100), line('CREDIT', 50)] }));
    await assertSucceeds(updateDoc(doc(db, 'journal_entries/j1'), { lines: [line('DEBIT', 80), line('CREDIT', 50), line('CREDIT', 30)] }));
    // O repositório recusa antes mesmo de enviar, com mensagem legível.
    const repo = createFirestoreRepository(db, () => ORG_A);
    await expect(repo.createJournalEntry(draft('j2', { lines: [line('DEBIT', 10), line('CREDIT', 9)] }))).rejects.toThrow(/desbalanceado/);
    await expect(repo.updateJournalEntry({ ...draft('j1', { lines: [line('DEBIT', 10), line('CREDIT', 9)] }), entryNumber: 1 })).rejects.toThrow(/desbalanceado/);
  });

  it('recusa valor que não é número, tipo que não fecha a conta e data inválida', async () => {
    const db = asUser('alice');
    await assertFails(rawCreate(db, 'j1', 1, { lines: [{ ...line('DEBIT', 100), amount: '100' }, line('CREDIT', 100)] }));
    await assertFails(rawCreate(db, 'j1', 1, { lines: [{ ...line('DEBIT', 100), amount: '100' }, { ...line('CREDIT', 100), amount: '100' }] }));
    await assertFails(rawCreate(db, 'j1', 1, { lines: [{ ...line('DEBIT', 100), amount: null }, line('CREDIT', 100)] }));
    // Tipo desconhecido conta como crédito (como no razão): dois "créditos" não fecham.
    await assertFails(rawCreate(db, 'j1', 1, { lines: [{ ...line('DEBIT', 100), type: 'OUTRO' }, line('CREDIT', 100)] }));
    await assertFails(rawCreate(db, 'j1', 1, { date: '2025-3-31' }));
    await assertFails(rawCreate(db, 'j1', 1, { lines: 'nenhuma' }));
    // Conta e valor positivo por partida são validados pelo app antes de gravar.
    const repo = createFirestoreRepository(db, () => ORG_A);
    await expect(repo.createJournalEntry(draft('j1', { lines: [line('DEBIT', 100, ''), line('CREDIT', 100)] }))).rejects.toThrow(/sem conta/);
    await expect(repo.createJournalEntry(draft('j1', { lines: [line('DEBIT', -100), line('CREDIT', -100)] }))).rejects.toThrow(/valor zerado/);
    expect(await repo.listJournalEntries('cA')).toEqual([]);
  });

  it('aceita lançamento composto com centavos e até 20 partidas; a 21ª é recusada', async () => {
    const db = asUser('alice');
    await assertSucceeds(rawCreate(db, 'j1', 1, { lines: [line('DEBIT', 0.1), line('DEBIT', 0.2), line('CREDIT', 0.3)] }));
    await assertSucceeds(rawCreate(db, 'j2', 2, { lines: [line('DEBIT', 100), line('CREDIT', 60.5), line('CREDIT', 39.5)] }));
    const pairs = (n: number) => Array.from({ length: n }, (_, i) => [line('DEBIT', 10.1 + i), line('CREDIT', 10.1 + i)]).flat();
    await assertSucceeds(rawCreate(db, 'j3', 3, { lines: pairs(10) }));
    await assertFails(rawCreate(db, 'j4', 4, { lines: [...pairs(10), line('DEBIT', 1)] }));
    await assertFails(rawCreate(db, 'j4', 4, { lines: pairs(11) }));
    // O caminho real do app (transação com contador e auditoria) também passa com 20 partidas,
    // na criação e na edição, sem estourar o teto de expressões das regras.
    const repo = createFirestoreRepository(db, () => ORG_A);
    const audit = (id: string, action: 'JOURNAL_CREATE' | 'JOURNAL_UPDATE') => ({ id, clientId: 'cA', action, actorUid: 'alice', at: 'T' });
    const saved = await repo.createJournalEntry(draft('j5', { lines: pairs(10) }), audit('au-j5', 'JOURNAL_CREATE'));
    expect(saved.entryNumber).toBe(4);
    await repo.updateJournalEntry({ ...saved, memo: 'Editado' }, audit('au-j5b', 'JOURNAL_UPDATE'));
    expect((await repo.listJournalEntries('cA')).find((e) => e.id === 'j5')).toMatchObject({ memo: 'Editado', entryNumber: 4 });
  });

  it('competência fechada congela os lançamentos manuais', async () => {
    const db = asUser('alice');
    const repo = createFirestoreRepository(db, () => ORG_A);
    const saved = await repo.createJournalEntry(draft('j1'));
    await closeMonth(db);
    await expect(repo.createJournalEntry(draft('j2'))).rejects.toThrow();
    await expect(repo.updateJournalEntry({ ...saved, memo: 'alterado' })).rejects.toThrow();
    await expect(repo.deleteJournalEntry('j1')).rejects.toThrow();
    // Nem mudando a data para "fugir" do mês fechado.
    await expect(repo.updateJournalEntry({ ...saved, date: '2025-04-01' })).rejects.toThrow();
    // Outra competência segue livre, e a numeração continua.
    expect((await repo.createJournalEntry(draft('j3', { date: '2025-04-30' }))).entryNumber).toBe(2);
  });

  it('nenhum lançamento manual antes da data de implantação (saldos de abertura); no próprio dia, sim', async () => {
    const db = asUser('alice');
    const repo = createFirestoreRepository(db, () => ORG_A);
    const saved = await repo.createJournalEntry(draft('j1', { date: '2025-04-30' }));
    await repo.saveOpeningBalances({ id: 'cA', clientId: 'cA', date: '2025-04-01', entries: [], updatedAt: 'T' }, { id: 'au-op', clientId: 'cA', action: 'OPENING_SAVE', actorUid: 'alice', at: 'T' });
    await expect(repo.createJournalEntry(draft('j2', { date: '2025-03-31' }))).rejects.toThrow();
    await expect(repo.createJournalEntry(draft('j2', { date: '2025-01-10' }))).rejects.toThrow();
    await expect(repo.updateJournalEntry({ ...saved, date: '2025-03-15' })).rejects.toThrow();
    expect((await repo.createJournalEntry(draft('j3', { date: '2025-04-01' }))).entryNumber).toBe(2);
  });

  it('abertura, bancos, conta nova do plano e auditoria numa única gravação', async () => {
    const db = asUser('alice');
    const repo = createFirestoreRepository(db, () => ORG_A);
    const now = 'T';
    const plug = { id: 'cA_itg22_2.3.3.04', clientId: 'cA', code: '2.3.3.04', name: 'Balanço de Abertura', type: 'EQUITY', nature: 'ANALYTIC', level: 4, createdAt: now, updatedAt: now } as const;
    const bank = { id: 'cA_k1', clientId: 'cA', accountKey: 'k1', nickname: 'Itaú', openingBalance: 500, openingDate: '2025-01-01', createdAt: now, updatedAt: now };
    await repo.saveOpeningBalances(
      { id: 'cA', clientId: 'cA', date: '2025-01-01', mode: 'OPENING_BALANCE', memo: 'Balanço de abertura', entries: [], updatedAt: now },
      { id: 'au-op-batch', clientId: 'cA', action: 'OPENING_SAVE', actorUid: 'alice', at: now },
      { bankAccounts: [bank], accounts: [plug] }
    );
    expect((await repo.getOpeningBalances('cA'))?.mode).toBe('OPENING_BALANCE');
    expect((await repo.listBankAccounts('cA')).map((b) => b.openingDate)).toEqual(['2025-01-01']);
    expect((await repo.listAccounts('cA')).some((a) => a.code === '2.3.3.04')).toBe(true);
  });

  describe('encerramento do exercício', () => {
    const closing = (id: string, extra: Record<string, unknown> = {}) =>
      ({ ...draft(id, { date: '2025-12-31', memo: 'Encerramento do exercício de 2025' }), category: 'CLOSING', yearClosing: '2025', ...extra }) as never;
    const yearAudit = (id: string, action: 'YEAR_CLOSE' | 'YEAR_REOPEN', actorUid = 'alice') => ({ id, clientId: 'cA', action, actorUid, at: 'T', month: '2025-12' });
    const CLOSE = 'cA_2025_close_t';

    it('entra inteiro, numa gravação, com dezembro fechado e um único registro de auditoria', async () => {
      const db = asUser('alice');
      const repo = createFirestoreRepository(db, () => ORG_A);
      await repo.createJournalEntry(draft('j0'));
      await closeMonth(db, lockOf('2025-12'));
      // Lançamento comum continua barrado em dezembro fechado.
      await expect(repo.createJournalEntry(draft('j1', { date: '2025-12-31' }))).rejects.toThrow();
      // Registro de outra ação, marca que não confere com a data, ou fora de 31/12: nada entra.
      await expect(repo.closeYear([closing('e1'), closing('e2')], yearAudit(CLOSE, 'YEAR_REOPEN'))).rejects.toThrow();
      await expect(repo.closeYear([closing('e1'), closing('e2', { yearClosing: '2024' })], yearAudit(CLOSE, 'YEAR_CLOSE'))).rejects.toThrow();
      await expect(repo.closeYear([closing('e1', { date: '2025-12-30' })], yearAudit(CLOSE, 'YEAR_CLOSE'))).rejects.toThrow();
      expect((await repo.listJournalEntries('cA')).map((e) => e.id)).toEqual(['j0']);

      const saved = await repo.closeYear([closing('e1'), closing('e2'), closing('e3')], yearAudit(CLOSE, 'YEAR_CLOSE'));
      expect(saved.map((e) => e.entryNumber)).toEqual([2, 3, 4]);
      expect((await repo.listAudit('cA')).filter((a) => a.action === 'YEAR_CLOSE').map((a) => a.id)).toEqual([CLOSE]);
      // Dezembro fechado: o encerramento não muda; a numeração segue depois do bloco.
      await expect(repo.updateJournalEntry({ ...saved[0], memo: 'alterado' })).rejects.toThrow();
      expect((await repo.createJournalEntry(draft('j5', { date: '2026-01-31' }))).entryNumber).toBe(5);
    });

    it('o salto do contador exige o YEAR_CLOSE na mesma gravação', async () => {
      const db = asUser('alice');
      await rawCreateCounter(db, 1);
      // Sem registro novo: o contador não salta.
      await assertFails(setDoc(doc(db, 'journal_counters/cA'), { id: 'cA', orgId: ORG_A, clientId: 'cA', last: 4, closingAudit: CLOSE }));
      // Lançamento marcado sem o registro dele nascendo junto.
      await assertFails(setDoc(doc(db, 'journal_entries/e1'), { ...(closing('e1') as object), orgId: ORG_A, entryNumber: 2, closingAuditId: CLOSE }));
    });

    it('sai inteiro pela reabertura: administrador, com o registro do encerramento + _reopen', async () => {
      const db = asUser('alice');
      const repo = createFirestoreRepository(db, () => ORG_A);
      await closeMonth(db, lockOf('2025-12'));
      const saved = await repo.closeYear([closing('e1'), closing('e2')], yearAudit(CLOSE, 'YEAR_CLOSE'));
      await expect(repo.deleteJournalEntry('e1')).rejects.toThrow();
      await expect(repo.reopenYear(saved, yearAudit('outro_reopen', 'YEAR_REOPEN'))).rejects.toThrow();
      await expect(repo.reopenYear(saved, yearAudit(`${CLOSE}_reopen`, 'YEAR_CLOSE'))).rejects.toThrow();
      // Operadora não reabre exercício.
      await expect(createFirestoreRepository(asUser('carol'), () => ORG_A).reopenYear(saved, yearAudit(`${CLOSE}_reopen`, 'YEAR_REOPEN', 'carol'))).rejects.toThrow();
      expect(await repo.listJournalEntries('cA')).toHaveLength(2);
      await repo.reopenYear(saved, yearAudit(`${CLOSE}_reopen`, 'YEAR_REOPEN'));
      expect(await repo.listJournalEntries('cA')).toEqual([]);
    });
  });

  it('isolamento: outro escritório não lê nem grava', async () => {
    await rawCreate(asUser('alice'), 'j1', 1);
    await assertSucceeds(getDoc(doc(asUser('carol'), 'journal_entries/j1')));
    await assertFails(getDoc(doc(asUser('bob'), 'journal_entries/j1')));
    await assertFails(getDoc(doc(asUser('bob'), 'journal_counters/cA')));
    await assertFails(updateDoc(doc(asUser('bob'), 'journal_entries/j1'), { memo: 'x' }));
    await assertFails(deleteDoc(doc(asUser('bob'), 'journal_entries/j1')));
  });

  it('excluir a empresa remove os lançamentos manuais (mesmo de mês fechado) e a sequência', async () => {
    const db = asUser('alice');
    const repo = createFirestoreRepository(db, () => ORG_A);
    await repo.createJournalEntry(draft('j1'));
    await repo.createJournalEntry(draft('j2', { date: '2025-04-30' }));
    await closeMonth(db);
    await repo.deleteClient('cA', { uid: 'alice' });
    await env.withSecurityRulesDisabled(async (ctx) => {
      const admin = ctx.firestore() as unknown as Firestore;
      expect((await getDocs(query(collection(admin, 'journal_entries'), where('clientId', '==', 'cA')))).size).toBe(0);
      expect((await getDoc(doc(admin, 'journal_counters/cA'))).exists()).toBe(false);
    });
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

describe('contas bancárias', () => {
  const account = (orgId = ORG_A, clientId = 'cA') => ({
    id: `${clientId}_0341-1-2`,
    orgId,
    clientId,
    accountKey: '0341-1-2',
    nickname: 'Itaú',
    createdAt: 'T',
    updatedAt: 'T',
  });

  it('cadastra, vincula e lê só no próprio escritório; a chave do extrato é imutável', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    await repo.saveBankAccount({ ...account(), ledgerAccountId: 'x', openingBalance: 10, openingDate: '2024-12-31' });
    expect(await repo.listBankAccounts('cA')).toMatchObject([{ nickname: 'Itaú', openingBalance: 10 }]);
    // Salvar sem o vínculo remove o vínculo (documento substituído).
    await repo.saveBankAccount(account());
    expect((await repo.listBankAccounts('cA'))[0].ledgerAccountId).toBeUndefined();
    await assertFails(updateDoc(doc(asUser('alice'), `bank_accounts/cA_0341-1-2`), { accountKey: 'outra' }));
    await assertFails(getDoc(doc(asUser('bob'), `bank_accounts/cA_0341-1-2`)));
    await assertFails(setDoc(doc(asUser('bob'), 'bank_accounts/cA_x'), account(ORG_B)));
  });
});

describe('exclusão de extrato importado', () => {
  const batch = { id: 'bX', clientId: 'cA', fileName: 'x.ofx', fileSize: 0, totalTransactions: 2, importedCount: 2, duplicateCount: 0, autoClassifiedCount: 0, totalDebit: 0, totalCredit: 0, importedAt: 'IMPORT-T' };

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, 'import_batches/bX'), { ...batch, orgId: ORG_A });
      await setDoc(doc(db, 'transactions/cA_n1'), { ...tx('cA_n1', 'cA', ORG_A, '2025-05-02'), importBatchId: 'bX' });
      await setDoc(doc(db, 'transactions/cA_n2'), { ...tx('cA_n2', 'cA', ORG_A, '2025-06-03'), importBatchId: 'bX' });
    });
  });

  it('lista os lançamentos do lote e exclui tudo com auditoria', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    const txs = await repo.listBatchTransactions(batch);
    expect(txs.map((t) => t.id)).toEqual(['cA_n1', 'cA_n2']);
    await repo.deleteImportBatch(batch, txs, {
      patches: [],
      audits: [{ id: 'au-del', clientId: 'cA', action: 'BATCH_DELETE', actorUid: 'alice', at: 'T', note: 'x.ofx' }],
    });
    expect((await repo.listTransactions('cA')).map((t) => t.id)).toEqual(['cA_1']);
    expect(await repo.listImportBatches('cA')).toEqual([]);
    expect((await repo.listAudit('cA')).map((a) => a.action)).toEqual(['BATCH_DELETE']);
  });

  it('não exclui lançamentos de competência fechada', async () => {
    const db = asUser('alice');
    await closeMonth(db, lockOf('2025-05'));
    await assertFails(deleteDoc(doc(db, 'transactions/cA_n1')));
    await assertSucceeds(deleteDoc(doc(db, 'transactions/cA_n2')));
  });

  it('excluir a empresa remove também fechamentos e lançamentos de meses fechados', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    await closeMonth(asUser('alice'), lockOf('2025-05'));
    await repo.deleteClient('cA', { uid: 'alice' });
    expect(await repo.listTransactions('cA')).toEqual([]);
    expect(await repo.listPeriodLocks('cA')).toEqual([]);
  });
});

describe('pendências com o cliente (link público)', () => {
  const TOKEN = 'a'.repeat(32);
  const request = (overrides: Record<string, unknown> = {}) => ({
    id: TOKEN,
    orgId: ORG_A,
    clientId: 'cA',
    clientName: 'Empresa cA',
    items: [{ transactionId: 'cA_1', date: '2025-03-10', memo: 'PIX', amount: -100, question: 'O que é?' }],
    status: 'OPEN',
    createdAt: 'T',
    createdByUid: 'alice',
    expiresAtMs: Date.now() + 86_400_000,
    ...overrides,
  });
  const publicRepo = () =>
    createFirestoreRepository(anon(), () => {
      throw new Error('sem sessão');
    });

  it('o escritório cria o link; token curto, outro escritório ou link fechado são recusados', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    await repo.saveClientRequest(request() as never);
    expect((await repo.listClientRequests('cA')).map((r) => r.id)).toEqual([TOKEN]);
    await assertFails(setDoc(doc(asUser('alice'), 'client_requests/curto'), request({ id: 'curto' })));
    await assertFails(setDoc(doc(asUser('bob'), `client_requests/${'b'.repeat(32)}`), request({ id: 'b'.repeat(32) })));
    await assertFails(getDocs(query(collection(asUser('bob'), 'client_requests'), where('orgId', '==', ORG_A))));
  });

  it('sem login: lê pelo token e grava só as respostas; perguntas e demais campos não mudam', async () => {
    await createFirestoreRepository(asUser('alice'), () => ORG_A).saveClientRequest(request() as never);
    const pub = publicRepo();
    const got = await pub.getPublicClientRequest(TOKEN);
    expect(got?.items[0].question).toBe('O que é?');
    await pub.answerPublicClientRequest(TOKEN, [{ text: 'Pagamento de fornecedor', answeredAt: 'T2' }], 'T2');
    const after = await pub.getPublicClientRequest(TOKEN);
    expect(after?.answers).toEqual([{ text: 'Pagamento de fornecedor', answeredAt: 'T2' }]);
    expect(after?.items).toEqual(got?.items);

    const ref = doc(anon(), `client_requests/${TOKEN}`);
    await assertFails(getDocs(collection(anon(), 'client_requests')));
    // Reescrever a pergunta, o valor ou o lançamento perguntado.
    await assertFails(updateDoc(ref, { items: [{ ...got!.items[0], question: 'Outra pergunta' }] }));
    await assertFails(updateDoc(ref, { items: [{ ...got!.items[0], amount: -1 }], respondedAt: 'T3' }));
    await assertFails(updateDoc(ref, { items: [{ ...got!.items[0], transactionId: 'cA_2' }], answers: [{ text: 'x' }], respondedAt: 'T3' }));
    await assertFails(updateDoc(ref, { items: [] }));
    await assertFails(updateDoc(ref, { status: 'CLOSED' }));
    await assertFails(updateDoc(ref, { expiresAtMs: Date.now() + 9e9 }));
    await assertFails(updateDoc(ref, { clientName: 'Outra empresa' }));
    // Uma resposta por pergunta, em lista.
    await assertFails(updateDoc(ref, { answers: [], respondedAt: 'T3' }));
    await assertFails(updateDoc(ref, { answers: [{ text: 'a' }, { text: 'b' }], respondedAt: 'T3' }));
    await assertFails(updateDoc(ref, { answers: 'texto solto', respondedAt: 'T3' }));
    // O cliente pode complementar a resposta enquanto o link estiver aberto.
    await assertSucceeds(updateDoc(ref, { answers: [{ text: 'Fornecedor de embalagens, NF 1234' }], respondedAt: 'T3' }));
  });

  it('cada resposta é só texto, com tamanho limitado', async () => {
    await createFirestoreRepository(asUser('alice'), () => ORG_A).saveClientRequest(request() as never);
    const ref = doc(anon(), `client_requests/${TOKEN}`);
    const send = (answer: unknown) => updateDoc(ref, { answers: [answer], respondedAt: 'T3' });
    await assertSucceeds(send({ text: 'x'.repeat(2000), answeredAt: 'T3' }));
    await assertSucceeds(send({ text: '' }));
    await assertFails(send({ text: 'x'.repeat(2001) }));
    await assertFails(send({ text: 42 }));
    await assertFails(send({ text: { aninhado: 'x'.repeat(50_000) } }));
    await assertFails(send({ text: 'ok', anexo: 'x'.repeat(50_000) }));
    await assertFails(send({ text: 'ok', answeredAt: 'x'.repeat(41) }));
    await assertFails(send({ answeredAt: 'T3' }));
    await assertFails(send('texto solto'));
  });

  it('o link tem de 1 a 24 perguntas, e o tamanho de cada resposta é conferido', async () => {
    const admin = createFirestoreRepository(asUser('alice'), () => ORG_A);
    const items = (n: number) => Array.from({ length: n }, (_, i) => ({ transactionId: `cA_${i}`, date: '2025-03-10', memo: 'PIX', amount: -1, question: '?' }));
    const answers = (n: number, text = 'x'.repeat(2000)) => Array.from({ length: n }, () => ({ text, answeredAt: '2025-03-10T12:00:00.000Z' }));
    const ref = doc(anon(), `client_requests/${TOKEN}`);

    // 24 respostas no tamanho máximo cabem no teto de expressões das regras.
    await admin.saveClientRequest(request({ items: items(24) }) as never);
    await assertSucceeds(updateDoc(ref, { answers: answers(24), respondedAt: 'T3' }));
    // A primeira e a última também são conferidas.
    await assertFails(updateDoc(ref, { answers: [{ text: 'x'.repeat(2001) }, ...answers(23)], respondedAt: 'T3' }));
    await assertFails(updateDoc(ref, { answers: [...answers(23), { text: 'x'.repeat(2001) }], respondedAt: 'T3' }));

    // Acima disso as regras não conseguem conferir uma a uma: o link não nasce.
    const other = 'c'.repeat(32);
    await assertFails(setDoc(doc(asUser('alice'), `client_requests/${other}`), request({ id: other, items: items(25) })));
    await assertFails(setDoc(doc(asUser('alice'), `client_requests/${other}`), request({ id: other, items: [] })));

    // Link antigo com mais de 24 perguntas (gravado antes do limite): não aceita mais respostas.
    await admin.saveClientRequest(request({ items: items(25) }) as never);
    await assertFails(updateDoc(ref, { answers: answers(25, 'curta'), respondedAt: 'T3' }));
  });

  it('encerrar o link preserva respostas que chegaram depois da última leitura do escritório', async () => {
    const admin = createFirestoreRepository(asUser('alice'), () => ORG_A);
    await admin.saveClientRequest(request() as never);
    await publicRepo().answerPublicClientRequest(TOKEN, [{ text: 'Aluguel de março' }], 'T2');
    await admin.closeClientRequest(TOKEN);
    expect(await admin.listClientRequests('cA')).toMatchObject([{ status: 'CLOSED', respondedAt: 'T2', answers: [{ text: 'Aluguel de março' }] }]);
  });

    it('link encerrado ou vencido não aceita respostas, mas renovar reativa o mesmo token e preserva leitura', async () => {
      const admin = createFirestoreRepository(asUser('alice'), () => ORG_A);
      const answer = { answers: [{ text: 'tarde demais' }], respondedAt: 'T' };
      await admin.saveClientRequest(request({ expiresAtMs: Date.now() - 1000 }) as never);
      await assertFails(updateDoc(doc(anon(), `client_requests/${TOKEN}`), answer));
      await admin.saveClientRequest(request({ status: 'CLOSED' }) as never);
      await assertFails(updateDoc(doc(anon(), `client_requests/${TOKEN}`), answer));

      // O escritório renova a validade do mesmo token: o link volta a aceitar respostas e marcação de leitura.
      const renewedUntil = Date.now() + 7 * 86_400_000;
      await admin.renewClientRequest(TOKEN, renewedUntil);
      expect((await admin.listOpenOrgClientRequests()).map((r) => r.id)).toEqual([TOKEN]);
      await publicRepo().answerPublicClientRequest(TOKEN, [{ text: 'Respondido após renovar', answeredAt: 'T1' }], 'T1');
      await admin.markClientRequestsSeen([{ id: TOKEN, seenAt: 'T2' }]);
      // Mesmo após seenAt existir no documento, o cliente ainda pode complementar dentro do prazo.
      await publicRepo().answerPublicClientRequest(TOKEN, [{ text: 'Complemento após leitura', answeredAt: 'T3' }], 'T3');
      expect(await admin.listClientRequests('cA')).toMatchObject([
        { status: 'OPEN', seenAt: 'T2', respondedAt: 'T3', answers: [{ text: 'Complemento após leitura' }] },
      ]);
    });

    it('o cliente não envia arquivos: a coleção antiga de comprovantes fica fechada para todos', async () => {
      const file = { id: 'f1', orgId: ORG_A, clientId: 'cA', requestId: TOKEN, name: 'nota.pdf', data: 'aGVsbG8=' };
      await assertFails(setDoc(doc(anon(), 'client_request_files/f1'), file));
      await assertFails(setDoc(doc(asUser('alice'), 'client_request_files/f1'), file));
      await assertFails(getDoc(doc(asUser('alice'), 'client_request_files/f1')));
    });
  });

  describe('correção de acentuação dos históricos', () => {
    it('altera o histórico em mês aberto, não em mês fechado, e mantém data e valor', async () => {
      const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
      await repo.commitChanges({ patches: [{ id: 'cA_1', date: '2025-03-10', set: { memo: 'Transferência recebida' } }], audits: [] });
      expect((await repo.listTransactions('cA'))[0].memo).toBe('Transferência recebida');

      await closeMonth(asUser('alice'));
      await expect(repo.commitChanges({ patches: [{ id: 'cA_1', date: '2025-03-10', set: { memo: 'outra' } }], audits: [] })).rejects.toThrow();
      await assertFails(updateDoc(doc(asUser('alice'), 'transactions/cA_1'), { memo: 'x', amount: -1 }));
    });
  });

  describe('notas explicativas', () => {
    const notes = (clientId = 'cA', orgId = ORG_A, year = '2025') => ({ id: `${clientId}_${year}`, orgId, clientId, year, notes: [{ id: 'context', title: 'Contexto', text: 'x', enabled: true }], updatedAt: 'T' });

    it('grava por cliente e exercício, isolado entre escritórios', async () => {
      const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
      await repo.saveExplanatoryNotes(notes() as never);
      expect((await repo.getExplanatoryNotes('cA', '2025'))?.notes[0].text).toBe('x');
      // Outro usuário do mesmo escritório vê e edita o mesmo texto.
      await createFirestoreRepository(asUser('carol'), () => ORG_A).saveExplanatoryNotes({ ...notes(), notes: [{ id: 'context', title: 'Contexto', text: 'y', enabled: true }] } as never);
      expect((await repo.getExplanatoryNotes('cA', '2025'))?.notes[0].text).toBe('y');
      expect(await repo.getExplanatoryNotes('cA', '2024')).toBeNull();

      await assertFails(getDoc(doc(asUser('bob'), 'explanatory_notes/cA_2025')));
      // Exercício ainda sem notas: outro escritório também não lê (nem o vazio).
      await assertFails(getDoc(doc(asUser('bob'), 'explanatory_notes/cA_2023')));
      await assertFails(getDoc(doc(asUser('alice'), 'explanatory_notes/cB_2023')));
      await assertFails(setDoc(doc(asUser('bob'), 'explanatory_notes/cA_2025'), notes('cA', ORG_B)));
      await assertFails(setDoc(doc(asUser('alice'), 'explanatory_notes/cA_2024'), notes())); // id ≠ cliente_exercício
      await assertFails(setDoc(doc(asUser('alice'), 'explanatory_notes/cA_25'), { ...notes(), year: '25' }));
      await assertFails(updateDoc(doc(asUser('alice'), 'explanatory_notes/cA_2025'), { year: '2026' }));
    });

    it('excluir a empresa remove as notas', async () => {
      const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
      await repo.saveExplanatoryNotes(notes() as never);
      await repo.deleteClient('cA', { uid: 'alice' });
      await env.withSecurityRulesDisabled(async (ctx) => {
        expect((await getDoc(doc(ctx.firestore() as unknown as Firestore, 'explanatory_notes/cA_2025'))).exists()).toBe(false);
      });
    });
  });

  describe('saldos de abertura', () => {
    const opening = (clientId = 'cA', orgId = ORG_A) => ({ id: clientId, orgId, clientId, date: '2024-12-31', entries: [{ accountId: 'x', amount: 10 }], updatedAt: 'T' });
    const audit = { id: 'au-op', clientId: 'cA', action: 'OPENING_SAVE', actorUid: 'alice', at: 'T' } as const;

    it('grava com auditoria, atualiza, e isola entre escritórios; o id é o cliente', async () => {
      const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
      await repo.saveOpeningBalances(opening() as never, audit);
      expect((await repo.getOpeningBalances('cA'))?.entries).toHaveLength(1);
      await repo.saveOpeningBalances({ ...opening(), entries: [] } as never, { ...audit, id: 'au-op2' });
      expect((await repo.getOpeningBalances('cA'))?.entries).toEqual([]);
      expect((await repo.listAudit('cA')).map((a) => a.action)).toEqual(['OPENING_SAVE', 'OPENING_SAVE']);

      await assertFails(getDoc(doc(asUser('bob'), 'opening_balances/cA')));
      await assertFails(setDoc(doc(asUser('bob'), 'opening_balances/cA'), opening('cA', ORG_B)));
      await assertFails(setDoc(doc(asUser('alice'), 'opening_balances/outro'), opening())); // id ≠ clientId
      await assertFails(updateDoc(doc(asUser('alice'), 'opening_balances/cA'), { clientId: 'cB' }));
    });

    it('excluir a empresa remove os saldos de abertura', async () => {
      const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
      await repo.saveOpeningBalances(opening() as never, audit);
      await repo.deleteClient('cA', { uid: 'alice' });
      // Sem a empresa não há mais o que ler pelas regras: confere direto no banco.
      await env.withSecurityRulesDisabled(async (ctx) => {
        expect((await getDoc(doc(ctx.firestore() as unknown as Firestore, 'opening_balances/cA'))).exists()).toBe(false);
      });
    });

    it('empresa sem saldos informados: ler devolve vazio, não erro', async () => {
      const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
      expect(await repo.getOpeningBalances('cA')).toBeNull();
      await assertFails(getDoc(doc(asUser('bob'), 'opening_balances/cA'))); // cliente de outro escritório
    });
  });

  describe('atomicidade e consultas pontuais', () => {
    const acc = (id: string, code: string, extra: Record<string, unknown> = {}) => ({
      id,
      clientId: 'cA',
      code,
      name: id,
      type: 'ASSET' as const,
      nature: 'ANALYTIC' as const,
      level: 1,
      createdAt: '',
      updatedAt: '',
      ...extra,
    });
    const bank = (key: string, extra: Record<string, unknown> = {}) => ({ id: `cA_${key}`, clientId: 'cA', accountKey: key, nickname: key, createdAt: 'T', updatedAt: 'T', ...extra });
    const deletion = (id: string, actorUid = 'alice') => ({ id, clientId: 'cA', action: 'ACCOUNT_DELETE' as const, actorUid, at: 'T' });

    it('exclui a conta do plano e grava a auditoria juntas; se a auditoria é recusada, a conta fica', async () => {
      const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
      await repo.insertAccounts([acc('x1', '9.1'), acc('x2', '9.2')]);
      await repo.deleteAccount('x1', deletion('au-x1'));
      expect((await repo.listAccounts('cA')).map((a) => a.id)).toEqual(['x2']);
      expect((await repo.listAudit('cA')).map((a) => a.id)).toEqual(['au-x1']);

      // Auditoria em nome de outra pessoa: o lote inteiro é recusado.
      await expect(repo.deleteAccount('x2', deletion('au-x2', 'carol'))).rejects.toThrow();
      expect((await repo.listAccounts('cA')).map((a) => a.id)).toEqual(['x2']);
    });

    it('grava contas e bancos juntos; um item recusado não deixa nada pela metade', async () => {
      const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
      await repo.insertAccounts([acc('mae', '1.1.1.02')]);
      await repo.saveBankAccount(bank('k1', { ledgerAccountId: 'mae' }));

      // Banco apontando para empresa de outro escritório: nada do lote entra.
      await expect(
        repo.saveChartSetup({ accounts: [acc('filha', '1.1.1.02.001'), acc('mae', '1.1.1.02', { nature: 'SYNTHETIC' })], bankAccounts: [bank('kB', { clientId: 'cB', id: 'cB_kB' })] })
      ).rejects.toThrow();
      expect((await repo.listAccounts('cA')).map((a) => [a.id, a.nature])).toEqual([['mae', 'ANALYTIC']]);

      await repo.saveChartSetup({
        accounts: [acc('filha', '1.1.1.02.001'), acc('mae', '1.1.1.02', { nature: 'SYNTHETIC' })],
        bankAccounts: [bank('k1', { ledgerAccountId: 'filha' })],
      });
      expect((await repo.listAccounts('cA')).map((a) => [a.id, a.nature])).toEqual([['mae', 'SYNTHETIC'], ['filha', 'ANALYTIC']]);
      expect(await repo.listBankAccounts('cA')).toMatchObject([{ accountKey: 'k1', ledgerAccountId: 'filha' }]);
    });

    it('conta lançamentos no servidor e detecta o uso de uma conta sem baixar o histórico', async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore() as unknown as Firestore;
        await setDoc(doc(db, 'transactions/cA_d'), { ...tx('cA_d', 'cA', ORG_A, '2025-04-01'), status: 'RECONCILED', accountId: 'direta' });
        await setDoc(doc(db, 'transactions/cA_s'), { ...tx('cA_s', 'cA', ORG_A, '2025-04-02'), status: 'RECONCILED', isSplit: true, splits: [{ id: 's1', accountId: 'rateada', amount: -100, memo: '' }] });
        await setDoc(doc(db, 'transactions/cB_o'), { ...tx('cB_o', 'cB', ORG_B, '2025-04-03'), status: 'RECONCILED', accountId: 'de-outro' });
      });
      const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
      expect(await repo.countTransactions('cA', '2025-03-31')).toBe(1);
      expect(await repo.countTransactions('cA', '2025-04-01')).toBe(2);
      expect(await repo.countTransactions('cA', '2025-12-31')).toBe(3);
      expect(await repo.countTransactionsByStatus('cA', 'RECONCILED')).toBe(2);
      expect(await repo.countTransactionsByStatus('cA', 'AUTO_CLASSIFIED')).toBe(0);
      expect(await repo.oldestTransactionDate('cA', 'RECONCILED')).toBe('2025-04-01');
      expect(await repo.oldestTransactionDate('cA', 'AUTO_CLASSIFIED')).toBeNull();
      expect(await repo.isAccountUsedInTransactions('cA', 'direta')).toBe(true);
      expect(await repo.isAccountUsedInTransactions('cA', 'rateada')).toBe(true);
      expect(await repo.isAccountUsedInTransactions('cA', 'livre')).toBe(false);
      expect(await repo.isAccountUsedInTransactions('cA', 'de-outro')).toBe(false);
      // Outro escritório não conta nem consulta os lançamentos do A.
      const forged = createFirestoreRepository(asUser('bob'), () => ORG_A);
      await expect(forged.countTransactions('cA', '2025-12-31')).rejects.toThrow();
      await expect(forged.countTransactionsByStatus('cA', 'PENDING')).rejects.toThrow();
      await expect(forged.oldestTransactionDate('cA', 'RECONCILED')).rejects.toThrow();
      await expect(forged.isAccountUsedInTransactions('cA', 'direta')).rejects.toThrow();
    });

    it('exclusão de empresa interrompida fica marcada e é retomada de onde parou', async () => {
      const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
      await repo.saveRule({ id: 'r1', clientId: 'cA', pattern: 'x', accountId: 'a', createdAt: '', updatedAt: '' });
      // Um fechamento cuja reabertura já consta na trilha (imutável) faz a cascata falhar no primeiro lote.
      const march = lockOf('2025-03');
      await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore() as unknown as Firestore;
        await setDoc(doc(db, 'period_locks/cA_2025-03'), march);
        await setDoc(doc(db, `audit_log/${auditIdOf(march, 'reopen')}`), periodAudit(march, 'reopen'));
      });
      await expect(repo.deleteClient('cA', { uid: 'alice' })).rejects.toThrow();
      const [stuck] = await repo.listClients();
      expect(stuck).toMatchObject({ id: 'cA' });
      expect(stuck.deletingAt).toEqual(expect.any(String));
      expect((await repo.listTransactions('cA')).map((t) => t.id)).toEqual(['cA_1']);

      // Corrigida a causa, chamar de novo conclui.
      await env.withSecurityRulesDisabled(async (ctx) => {
        await deleteDoc(doc(ctx.firestore() as unknown as Firestore, 'period_locks/cA_2025-03'));
      });
      await repo.deleteClient('cA', { uid: 'alice' });
      expect(await repo.listClients()).toEqual([]);
      expect(await repo.listTransactions('cA')).toEqual([]);
      expect(await repo.listRules('cA')).toEqual([]);
    });
  });

  describe('saldos consolidados de competências fechadas', () => {
    const snapshot = (month: string, orgId = ORG_A, clientId = 'cA') => ({
      id: `${clientId}_${month}`,
      orgId,
      clientId,
      month,
      asOf: `${month}-30`,
      balances: [{ accountId: '__suspense__', value: 100 }],
      txCount: 1,
      months: [],
      locks: [],
      configKey: 'k',
      createdAt: 'T',
    });

    beforeEach(async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore() as unknown as Firestore;
        await setDoc(doc(db, 'transactions/cA_m5'), { ...tx('cA_m5', 'cA', ORG_A, '2024-05-10'), amount: 500, status: 'RECONCILED', accountId: 'receita' });
        await setDoc(doc(db, 'transactions/cA_m11'), tx('cA_m11', 'cA', ORG_A, '2024-11-20'));
      });
    });

    it('isolados por escritório; id, escritório e empresa não mudam', async () => {
      const alice = asUser('alice');
      await assertSucceeds(setDoc(doc(alice, 'period_snapshots/cA_2024-11'), snapshot('2024-11')));
      await assertSucceeds(setDoc(doc(asUser('carol'), 'period_snapshots/cA_2024-11'), { ...snapshot('2024-11'), txCount: 2 }));
      await assertFails(setDoc(doc(alice, 'period_snapshots/outro'), snapshot('2024-10'))); // id não confere
      await assertFails(setDoc(doc(alice, 'period_snapshots/cB_2024-11'), snapshot('2024-11', ORG_A, 'cB'))); // empresa de outro escritório
      await assertFails(updateDoc(doc(alice, 'period_snapshots/cA_2024-11'), { month: '2024-12' }));
      await assertFails(updateDoc(doc(alice, 'period_snapshots/cA_2024-11'), { clientId: 'cB' }));
      await assertFails(getDoc(doc(asUser('bob'), 'period_snapshots/cA_2024-11')));
      await assertFails(setDoc(doc(asUser('bob'), 'period_snapshots/cA_2024-11'), snapshot('2024-11', ORG_B)));
      await assertFails(getDoc(doc(anon(), 'period_snapshots/cA_2024-11')));
    });

    it('o carregador grava o snapshot, passa a ler só o período aberto e o refaz quando um extrato entra em mês fechado', async () => {
      const db = asUser('alice');
      const repo = createFirestoreRepository(db, () => ORG_A);
      await closeMonth(db, lockOf('2024-05'));
      await closeMonth(db, lockOf('2024-11'));
      const load = () => loadLedgerWindow({ clientId: 'cA', accounts: [], banks: [], from: '2025-01-01', until: '2025-12-31' }, repo);

      const first = await load();
      expect(first.asOf).toBe('2024-11-30');
      expect(first.transactions.map((t) => t.id)).toEqual(['cA_1']);
      expect(first.carriedCount).toBe(2);
      expect((await repo.listPeriodSnapshots('cA')).map((s) => [s.month, s.txCount])).toEqual([['2024-11', 2]]);
      expect(await load()).toEqual(first);

      // Importar em competência fechada é permitido e muda os saldos: o snapshot antigo não é usado.
      await setDoc(doc(db, 'transactions/cA_m5b'), { ...tx('cA_m5b', 'cA', ORG_A, '2024-05-25'), amount: -40 });
      const afterImport = await load();
      expect(afterImport.carriedCount).toBe(3);
      expect(afterImport.carry.find((p) => p.accountId === '__suspense__')?.value).toBe(-360);
      expect((await repo.listPeriodSnapshots('cA')).map((s) => [s.month, s.txCount])).toEqual([['2024-11', 3]]);

      // Reaberta uma competência, o consolidado recua para antes dela.
      await reopenMonth(db, lockOf('2024-11'));
      const reopened = await load();
      expect(reopened.asOf).toBe('2024-05-31');
      expect(reopened.transactions.map((t) => t.id).sort()).toEqual(['cA_1', 'cA_m11']);
    });

    it('excluir a empresa remove os snapshots', async () => {
      const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
      await repo.savePeriodSnapshot(snapshot('2024-11') as never);
      await repo.deleteClient('cA', { uid: 'alice' });
      await env.withSecurityRulesDisabled(async (ctx) => {
        expect((await getDoc(doc(ctx.firestore() as unknown as Firestore, 'period_snapshots/cA_2024-11'))).exists()).toBe(false);
      });
    });
  });

describe('cadastros congelados por competência fechada e integridade do lock_state', () => {
  const opAudit = (id: string) => ({ id, clientId: 'cA', action: 'OPENING_SAVE' as const, actorUid: 'alice', at: 'T' });

  it('saldos de abertura: bloqueia primeiro cadastro (D1) e edições com mês fechado; reabertura parcial mantém congelado e total libera', async () => {
    const db = asUser('alice');
    const repo = createFirestoreRepository(db, () => ORG_A);

    await closeMonth(db, lockOf('2025-03'));
    // D1: sem abertura prévia e com mês fechado, nem pelo repositório nem direto no Firestore.
    await expect(
      repo.saveOpeningBalances({ id: 'cA', clientId: 'cA', date: '2025-01-01', entries: [{ accountId: 'a', amount: 100 }], updatedAt: 'T' }, opAudit('op1'))
    ).rejects.toThrow(/competências fechadas/);
    await assertFails(
      setDoc(doc(db, 'opening_balances/cA'), { id: 'cA', orgId: ORG_A, clientId: 'cA', date: '2025-01-01', entries: [], lockSeq: 1, updatedAt: 'T' })
    );

    // Reabre tudo (count = 0, seq = 1): primeiro cadastro passa com lockSeq = 1.
    await reopenMonth(db, lockOf('2025-03'));
    await repo.saveOpeningBalances(
      { id: 'cA', clientId: 'cA', date: '2025-01-01', mode: 'OPENING_BALANCE', memo: 'Inicial', entries: [{ accountId: 'a', amount: 100 }], updatedAt: 'T' },
      opAudit('op2')
    );
    expect((await repo.getOpeningBalances('cA'))?.lockSeq).toBe(1);

    // Fecha dois meses (count = 2, seq = 3): abertura congela, inclusive contra escrita crua no Firestore.
    await closeMonth(db, lockOf('2025-03', 'alice', 'cA', ORG_A, 'chave-teste-000002'));
    await closeMonth(db, lockOf('2025-04', 'alice', 'cA', ORG_A, 'chave-teste-000002'));
    await expect(
      repo.saveOpeningBalances({ id: 'cA', clientId: 'cA', date: '2025-01-01', entries: [{ accountId: 'a', amount: 200 }], updatedAt: 'T3' }, opAudit('op3'))
    ).rejects.toThrow(/competências fechadas/);
    await assertFails(updateDoc(doc(db, 'opening_balances/cA'), { entries: [], lockSeq: 3 }));
    await assertFails(updateDoc(doc(db, 'opening_balances/cA'), { date: '2025-02-01', lockSeq: 3 }));
    await assertFails(updateDoc(doc(db, 'opening_balances/cA'), { memo: 'Alterado', lockSeq: 3 }));
    await assertFails(updateDoc(doc(db, 'opening_balances/cA'), { lockSeq: 3 })); // renovar lockSeq sozinho é recusado
    await assertSucceeds(updateDoc(doc(db, 'opening_balances/cA'), { updatedAt: 'T3' }));

    // Reabertura parcial (2025-04 abre, 2025-03 segue fechado: count = 1, seq = 3) mantém congelado.
    await reopenMonth(db, lockOf('2025-04', 'alice', 'cA', ORG_A, 'chave-teste-000002'));
    await assertFails(updateDoc(doc(db, 'opening_balances/cA'), { memo: 'Tentativa parcial', lockSeq: 3 }));

    // Reabertura total (count = 0, seq = 3) libera e carimba lockSeq = 3.
    await reopenMonth(db, lockOf('2025-03', 'alice', 'cA', ORG_A, 'chave-teste-000002'));
    await repo.saveOpeningBalances(
      { id: 'cA', clientId: 'cA', date: '2025-01-01', memo: 'Revisado', entries: [{ accountId: 'a', amount: 250 }], updatedAt: 'T4' },
      opAudit('op4')
    );
    expect(await repo.getOpeningBalances('cA')).toMatchObject({ memo: 'Revisado', lockSeq: 3 });
  });

  it('bancos e plano de contas: congela campos estruturais/contábeis, libera campos livres, permite editar cadastro novo e congela após encerramento anual', async () => {
    const db = asUser('alice');
    const repo = createFirestoreRepository(db, () => ORG_A);

    // Semeia também conta legada (sem lockSeq) e conta global (D3).
    await env.withSecurityRulesDisabled(async (ctx) => {
      const admin = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(admin, 'chart_of_accounts/cA_legada'), {
        id: 'cA_legada', orgId: ORG_A, clientId: 'cA', code: '4.1.9.01', name: 'Legada', type: 'EXPENSE', nature: 'ANALYTIC', dreGroup: 'ADMIN_EXPENSES', level: 4, createdAt: 'T', updatedAt: 'T',
      });
      await setDoc(doc(admin, 'chart_of_accounts/global_1'), {
        id: 'global_1', orgId: ORG_A, clientId: 'global', code: '3.1.1.01', name: 'Receita Global', type: 'REVENUE', nature: 'ANALYTIC', dreGroup: 'GROSS_REVENUE', level: 4, createdAt: 'T', updatedAt: 'T',
      });
    });

    // D3: conta global nunca aceita alteração estrutural, mesmo sem nenhum mês fechado; nome/descrição aceitam.
    await assertFails(updateDoc(doc(db, 'chart_of_accounts/global_1'), { dreGroup: 'OTHER_INCOME' }));
    await assertSucceeds(updateDoc(doc(db, 'chart_of_accounts/global_1'), { name: 'Receita Compartilhada', description: 'ok' }));

    const acc1 = { id: 'cA_a1', clientId: 'cA', code: '4.1.1.01', name: 'Aluguel', type: 'EXPENSE' as const, nature: 'ANALYTIC' as const, dreGroup: 'OPERATING_EXPENSES' as const, level: 4, createdAt: 'T', updatedAt: 'T' };
    const bank1 = { id: 'cA_b1', clientId: 'cA', accountKey: 'b1', nickname: 'Itaú', openingBalance: 1000, openingDate: '2025-01-01', ledgerAccountId: 'cA_a1', createdAt: 'T', updatedAt: 'T' };
    await repo.saveAccount(acc1);
    await repo.saveBankAccount(bank1);

    await closeMonth(db, lockOf('2025-03'));

    // Campos protegidos recusados (inclusive tentando carimbar lockSeq = 1 direto no Firestore).
    await assertFails(updateDoc(doc(db, 'chart_of_accounts/cA_a1'), { dreGroup: 'OTHER_EXPENSES', lockSeq: 1 }));
    await assertFails(updateDoc(doc(db, 'chart_of_accounts/cA_a1'), { isContra: true, lockSeq: 1 }));
    await assertFails(updateDoc(doc(db, 'chart_of_accounts/cA_legada'), { dreGroup: 'OTHER_EXPENSES', lockSeq: 1 }));
    await assertFails(updateDoc(doc(db, 'chart_of_accounts/cA_a1'), { lockSeq: 1 }));
    await assertFails(updateDoc(doc(db, 'bank_accounts/cA_b1'), { openingBalance: 999, lockSeq: 1 }));
    await assertFails(updateDoc(doc(db, 'bank_accounts/cA_b1'), { openingDate: '2025-02-01', lockSeq: 1 }));
    await assertFails(updateDoc(doc(db, 'bank_accounts/cA_b1'), { ledgerAccountId: 'outra', lockSeq: 1 }));
    await assertFails(updateDoc(doc(db, 'bank_accounts/cA_b1'), { kind: 'CARD', lockSeq: 1 }));
    await assertFails(updateDoc(doc(db, 'bank_accounts/cA_b1'), { lockSeq: 1 }));

    // Campos livres continuam liberados.
    await repo.saveAccount({ ...acc1, name: 'Aluguel Sede', description: 'Escritório central' });
    await repo.saveBankAccount({
      ...bank1,
      nickname: 'Itaú Principal',
      csvPreset: { delimiter: ';', mapping: { dateCol: 0, memoCol: 1, valueMode: 'single', amountCol: 2, hasHeader: true } },
    });
    expect((await repo.listAccounts('cA')).find((a) => a.id === 'cA_a1')?.name).toBe('Aluguel Sede');
    expect((await repo.listBankAccounts('cA')).find((b) => b.id === 'cA_b1')?.nickname).toBe('Itaú Principal');

    // Criar novo banco/conta com competência fechada exige lockSeq == seq atual (1) e permanece editável até novo fechamento.
    await assertFails(setDoc(doc(db, 'bank_accounts/cA_sem_seq'), { ...bank1, id: 'cA_sem_seq', accountKey: 'sem', orgId: ORG_A, lockSeq: 0 }));
    const acc2 = { ...acc1, id: 'cA_a2', code: '4.1.1.02', name: 'Energia' };
    const bank2 = { ...bank1, id: 'cA_b2', accountKey: 'b2', nickname: 'Bradesco', openingBalance: 0 };
    await repo.saveAccount(acc2);
    await repo.saveBankAccount(bank2);
    await repo.saveAccount({ ...acc2, dreGroup: 'OTHER_EXPENSES' });
    await repo.saveBankAccount({ ...bank2, openingBalance: 350 });
    expect((await repo.listBankAccounts('cA')).find((b) => b.id === 'cA_b2')?.openingBalance).toBe(350);

    // Fecha dezembro (seq = 2), cria conta `cA_a3` (lockSeq = 2) e encerra o exercício (seq = 3): `cA_a3` congela!
    await closeMonth(db, lockOf('2025-12'));
    const acc3 = { ...acc1, id: 'cA_a3', code: '2.3.3.01', name: 'Lucros Acumulados', type: 'EQUITY' as const, dreGroup: undefined };
    await repo.saveAccount(acc3);
    expect((await repo.listAccounts('cA')).find((a) => a.id === 'cA_a3')?.lockSeq).toBe(2);

    await repo.closeYear(
      [{
        id: 'yc1', clientId: 'cA', date: '2025-12-31', memo: 'Encerramento 2025', category: 'CLOSING', yearClosing: '2025',
        lines: [{ id: 'd', accountId: 'cA_a3', type: 'DEBIT', amount: 100 }, { id: 'c', accountId: 'cA_a1', type: 'CREDIT', amount: 100 }],
        totalAmount: 100, createdAt: 'T', updatedAt: 'T', createdByUid: 'alice',
      }],
      { id: 'cA_2025_close_y', clientId: 'cA', action: 'YEAR_CLOSE', actorUid: 'alice', at: 'T', month: '2025-12' }
    );
    expect(await repo.getLockState('cA')).toMatchObject({ count: 2, seq: 3 });
    await assertFails(updateDoc(doc(db, 'chart_of_accounts/cA_a3'), { code: '2.3.3.09', lockSeq: 3 }));
  });

  it('integridade do lock_state: não aceita adulteração, falha fechado sem backfill e é removido ao excluir a empresa', async () => {
    const db = asUser('alice');
    const march = lockOf('2025-03');

    // Fechar competência sem avançar lock_state é recusado.
    const semLockState = writeBatch(db);
    semLockState.set(doc(db, `period_locks/${march.id}`), march);
    semLockState.set(doc(db, `audit_log/${auditIdOf(march, 'close')}`), periodAudit(march, 'close'));
    await assertFails(semLockState.commit());

    // Alterar lock_state sem o fechamento/reabertura/encerramento real correspondente é recusado.
    await assertFails(updateDoc(doc(db, 'lock_state/cA'), { count: 1, seq: 1, lastEvent: { kind: 'close', lockId: march.id } }));
    await closeMonth(db, march);
    await assertFails(updateDoc(doc(db, 'lock_state/cA'), { count: 0, seq: 1, lastEvent: { kind: 'reopen', lockId: march.id } }));
    await assertFails(updateDoc(doc(db, 'lock_state/cA'), { count: 1, seq: 2, lastEvent: { kind: 'year', lockId: 'falso' } }));
    // Não pode excluir lock_state enquanto a empresa existir.
    await assertFails(deleteDoc(doc(db, 'lock_state/cA')));

    // Empresa legada ainda sem lock_state: falha fechado em campos protegidos, mas permite campos livres.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const admin = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(admin, 'clients/cLeg'), client('cLeg', ORG_A));
      await setDoc(doc(admin, 'bank_accounts/cLeg_b'), { id: 'cLeg_b', orgId: ORG_A, clientId: 'cLeg', accountKey: 'b', nickname: 'Antigo' });
    });
    await assertFails(setDoc(doc(db, 'lock_state/cLeg'), { id: 'cLeg', orgId: ORG_A, clientId: 'cLeg', count: 0, seq: 0 }));
    await assertFails(updateDoc(doc(db, 'bank_accounts/cLeg_b'), { openingBalance: 10, lockSeq: 0 }));
    await assertSucceeds(updateDoc(doc(db, 'bank_accounts/cLeg_b'), { nickname: 'Renomeado' }));

    // Excluir a empresa remove também o lock_state.
    const repo = createFirestoreRepository(db, () => ORG_A);
    await repo.deleteClient('cA', { uid: 'alice' });
    await env.withSecurityRulesDisabled(async (ctx) => {
      expect((await getDoc(doc(ctx.firestore() as unknown as Firestore, 'lock_state/cA'))).exists()).toBe(false);
    });
  });
});

describe('notas fiscais (resumos dos XML)', () => {
  const KEY = '35250311444777000161550010000000011123456780';
  const summary = (clientId = 'cA', key = KEY) => ({
    id: `${clientId}_${key}`,
    clientId,
    key,
    number: '1',
    series: '1',
    model: '55',
    issueDate: '2025-03-05',
    direction: 'PURCHASE' as const,
    counterpartyDoc: '11444777000161',
    counterpartyName: 'ACME LTDA',
    total: 1500,
    cfops: [{ cfop: '1102', amount: 1500 }],
    installments: [],
    status: 'AUTHORIZED' as const,
    importedAt: 'T',
  });

  it('grava, lê por período, vincula e cancela; reimportar não desfaz vínculo nem cancelamento', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    await repo.saveInvoices([summary()]);
    expect((await repo.listInvoices('cA', { start: '2025-03-01', end: '2025-03-31' })).map((i) => i.number)).toEqual(['1']);
    expect(await repo.listInvoices('cA', { start: '2025-04-01', end: '2025-04-30' })).toEqual([]);

    const linked = await repo.linkInvoice(`cA_${KEY}`, { transactionId: 'cA_1', amount: 1500, accountId: 'x', linkedAt: 'T' });
    expect(linked.links).toHaveLength(1);
    expect(await repo.cancelInvoices('cA', [KEY, '0'.repeat(44)])).toBe(1);

    await repo.saveInvoices([summary()]);
    const [again] = await repo.listInvoices('cA');
    expect(again.links).toHaveLength(1);
    expect(again.status).toBe('CANCELLED');

    await repo.deleteInvoice(`cA_${KEY}`);
    expect(await repo.listInvoices('cA')).toEqual([]);
  });

  it('isoladas por escritório; id, chave e campos validados', async () => {
    const alice = asUser('alice');
    const data = { ...summary(), orgId: ORG_A };
    await assertSucceeds(setDoc(doc(alice, `invoice_summaries/cA_${KEY}`), data));
    await assertSucceeds(setDoc(doc(asUser('carol'), `invoice_summaries/cA_${KEY}`), { ...data, total: 10 }));
    await assertFails(setDoc(doc(alice, 'invoice_summaries/outro'), data)); // id não confere
    await assertFails(setDoc(doc(alice, `invoice_summaries/cB_${KEY}`), { ...data, clientId: 'cB' })); // empresa de outro escritório
    await assertFails(setDoc(doc(alice, 'invoice_summaries/cA_123'), { ...data, key: '123' })); // chave inválida
    await assertFails(setDoc(doc(alice, `invoice_summaries/cA_${KEY}`), { ...data, direction: 'OUTRA' }));
    await assertFails(setDoc(doc(alice, `invoice_summaries/cA_${KEY}`), { ...data, total: 0 }));
    // NFS-e do padrão nacional: chave de 50 dígitos, IBS/CBS e código do serviço.
    // município (7) + ambiente (1) + tipo de inscrição (1) + CNPJ (14) + número (13) + AAMM (4) + código (9) + DV (1)
    const NFSE_KEY = `3550308${'2'}${'2'}11444777000161${'1'.padStart(13, '0')}2601${'1'.padStart(9, '0')}6`;
    const nfse = { ...data, id: `cA_${NFSE_KEY}`, key: NFSE_KEY, model: 'NFSE', series: '', cfops: [], altTotal: 1600, ibs: 1.5, cbs: 13.5, serviceCode: '170201' };
    await assertSucceeds(setDoc(doc(alice, `invoice_summaries/cA_${NFSE_KEY}`), nfse));
    await assertFails(setDoc(doc(alice, `invoice_summaries/cA_${NFSE_KEY}`), { ...nfse, ibs: '1,50' }));
    await assertFails(setDoc(doc(alice, `invoice_summaries/cA_${NFSE_KEY}`), { ...nfse, serviceCode: 'x'.repeat(11) }));
    // Retenções da NFS-e: mapa com até 8 tributos.
    await assertSucceeds(setDoc(doc(alice, `invoice_summaries/cA_${NFSE_KEY}`), { ...nfse, retentions: { irrf: 11.25, pis: 4.87, cofins: 22.5, csll: 7.5 } }));
    await assertFails(setDoc(doc(alice, `invoice_summaries/cA_${NFSE_KEY}`), { ...nfse, retentions: 46.12 }));
    await assertFails(setDoc(doc(alice, `invoice_summaries/cA_${KEY.slice(0, 43)}A1234`), { ...data, key: `${KEY.slice(0, 43)}A1234` })); // 48: nem NF-e nem NFS-e
    await assertFails(updateDoc(doc(alice, `invoice_summaries/cA_${KEY}`), { key: '35250311444777000161550010000000021123456780' }));
    await assertFails(updateDoc(doc(alice, `invoice_summaries/cA_${KEY}`), { clientId: 'cB' }));
    await assertFails(getDoc(doc(asUser('bob'), `invoice_summaries/cA_${KEY}`)));
    await assertFails(setDoc(doc(asUser('bob'), `invoice_summaries/cA_${KEY}`), { ...data, orgId: ORG_B }));
    await assertFails(deleteDoc(doc(asUser('bob'), `invoice_summaries/cA_${KEY}`)));
    await assertFails(getDoc(doc(anon(), `invoice_summaries/cA_${KEY}`)));
  });

  it('excluir a empresa remove as notas', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    await repo.saveInvoices([summary()]);
    await repo.deleteClient('cA', { uid: 'alice' });
    await env.withSecurityRulesDisabled(async (ctx) => {
      expect((await getDoc(doc(ctx.firestore() as unknown as Firestore, `invoice_summaries/cA_${KEY}`))).exists()).toBe(false);
    });
  });
});

describe('imobilizado (cadastro de bens)', () => {
  const asset = { id: 'fa1', description: 'Veículo', accountId: 'v', accountCode: '1.2.3.04', use: 'EXPENSE', acquisitionDate: '2025-03-01', inUseDate: '2025-03-01', invoiceValue: 72280, annualRate: 20, createdAt: 'T', updatedAt: 'T' };
  const register = (clientId = 'cA', assets: unknown[] = [asset]) => ({ id: clientId, clientId, assets, updatedAt: 'T' });
  const audit = (id: string) => ({ id, clientId: 'cA', action: 'ASSET_SAVE', actorUid: 'alice', at: 'T' }) as const;
  const disposal = (id: string, date = '2025-03-31') => ({
    id,
    clientId: 'cA',
    date,
    memo: 'Baixa do bem Veículo por venda',
    category: 'ADJUSTMENT' as const,
    lines: [
      { id: 'b1', accountId: 'acum', type: 'DEBIT' as const, amount: 1204.67 },
      { id: 'b2', accountId: 'perda', type: 'DEBIT' as const, amount: 71075.33 },
      { id: 'b3', accountId: 'v', type: 'CREDIT' as const, amount: 72280 },
    ],
    totalAmount: 72280,
    fixedAssetId: 'fa1',
    createdAt: 'T',
    updatedAt: 'T',
    createdByUid: 'alice',
  });

  it('grava com auditoria, lê o vazio do próprio escritório e isola entre escritórios', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    expect(await repo.getFixedAssets('cA')).toBeNull();
    await repo.saveFixedAssets(register() as never, audit('au-fa1'));
    expect((await repo.getFixedAssets('cA'))?.assets).toHaveLength(1);
    expect((await repo.listAudit('cA')).map((a) => a.action)).toEqual(['ASSET_SAVE']);

    await assertFails(getDoc(doc(asUser('bob'), 'fixed_assets/cA')));
    await assertFails(getDoc(doc(asUser('bob'), 'fixed_assets/cA_inexistente')));
    await assertFails(setDoc(doc(asUser('bob'), 'fixed_assets/cA'), { ...register(), orgId: ORG_B }));
    await assertFails(setDoc(doc(asUser('alice'), 'fixed_assets/outro'), { ...register(), orgId: ORG_A })); // id ≠ cliente
    await assertFails(updateDoc(doc(asUser('alice'), 'fixed_assets/cA'), { clientId: 'cB' }));
    await assertFails(updateDoc(doc(asUser('alice'), 'fixed_assets/cA'), { assets: 'x' }));
  });

  it('a baixa cria o lançamento numerado e grava o cadastro na mesma operação; desfazer exclui os dois juntos', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    const disposed = { ...asset, disposal: { date: '2025-03-31', reason: 'SALE', journalEntryId: 'jb1' } };
    const entry = await repo.saveFixedAssets(register('cA', [disposed]) as never, audit('au-fa2'), { create: disposal('jb1') });
    expect(entry?.entryNumber).toBe(1);
    expect((await repo.listJournalEntries('cA')).map((e) => e.fixedAssetId)).toEqual(['fa1']);
    expect((await repo.getFixedAssets('cA'))?.assets[0].disposal?.journalEntryId).toBe('jb1');

    await repo.saveFixedAssets(register() as never, audit('au-fa3'), { deleteId: 'jb1' });
    expect(await repo.listJournalEntries('cA')).toEqual([]);
    expect((await repo.getFixedAssets('cA'))?.assets[0].disposal).toBeUndefined();
  });

  it('baixa em competência fechada é recusada inteira: nem lançamento nem cadastro', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    await repo.saveFixedAssets(register() as never, audit('au-fa4'));
    await closeMonth(asUser('alice'));
    const disposed = { ...asset, disposal: { date: '2025-03-31', reason: 'SALE', journalEntryId: 'jb2' } };
    await expect(repo.saveFixedAssets(register('cA', [disposed]) as never, audit('au-fa5'), { create: disposal('jb2') })).rejects.toThrow();
    expect((await repo.getFixedAssets('cA'))?.assets[0].disposal).toBeUndefined();
    expect(await repo.listJournalEntries('cA')).toEqual([]);
  });

  it('excluir a empresa remove o cadastro', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    await repo.saveFixedAssets(register() as never, audit('au-fa6'));
    await repo.deleteClient('cA', { uid: 'alice' });
    await env.withSecurityRulesDisabled(async (ctx) => {
      expect((await getDoc(doc(ctx.firestore() as unknown as Firestore, 'fixed_assets/cA'))).exists()).toBe(false);
    });
  });
});

describe('checklist do fechamento do exercício', () => {
  const checklist = (clientId = 'cA', year = '2025') => ({
    id: `${clientId}_${year}`,
    clientId,
    year,
    items: { cash: { done: true, at: 'T', byUid: 'alice' } },
    books: { method: 'JUNTA', date: '2026-04-30', protocol: '123' },
    updatedAt: 'T',
  });

  it('grava por cliente e exercício, lê o vazio do próprio escritório e isola entre escritórios', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    expect(await repo.getClosingChecklist('cA', '2025')).toBeNull();
    await repo.saveClosingChecklist(checklist() as never);
    expect((await repo.getClosingChecklist('cA', '2025'))?.items.cash.done).toBe(true);

    await assertFails(getDoc(doc(asUser('bob'), 'closing_checklists/cA_2025')));
    await assertFails(getDoc(doc(asUser('bob'), 'closing_checklists/cA_2024')));
    await assertFails(setDoc(doc(asUser('bob'), 'closing_checklists/cA_2025'), { ...checklist(), orgId: ORG_B }));
    await assertFails(setDoc(doc(asUser('alice'), 'closing_checklists/cA_2024'), { ...checklist(), orgId: ORG_A })); // id ≠ cliente_exercício
    await assertFails(updateDoc(doc(asUser('alice'), 'closing_checklists/cA_2025'), { year: '2026' }));
    await assertFails(updateDoc(doc(asUser('alice'), 'closing_checklists/cA_2025'), { items: 'x' }));
  });

  it('excluir a empresa remove o checklist', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    await repo.saveClosingChecklist(checklist() as never);
    await repo.deleteClient('cA', { uid: 'alice' });
    await env.withSecurityRulesDisabled(async (ctx) => {
      expect((await getDoc(doc(ctx.firestore() as unknown as Firestore, 'closing_checklists/cA_2025'))).exists()).toBe(false);
    });
  });
});

describe('despesas antecipadas (seguros)', () => {
  const item = { id: 'pp1', kind: 'INSURANCE', description: 'Seguro auto', use: 'EXPENSE', amount: 1410.88, startDate: '2025-03-01', months: 12, assetAccountId: 'a', assetAccountCode: '1.1.4.01', payableAccountId: 'p', payableAccountCode: '2.1.3.05', expenseAccountId: 'e', expenseAccountCode: '3.3.2.18', createdAt: 'T', updatedAt: 'T' };
  const register = (items: unknown[] = [item]) => ({ id: 'cA', clientId: 'cA', items, updatedAt: 'T' });
  const audit = (id: string) => ({ id, clientId: 'cA', action: 'PREPAID_SAVE', actorUid: 'alice', at: 'T' }) as const;
  const recognition = (id: string) => ({
    id,
    clientId: 'cA',
    date: '2025-03-01',
    memo: 'Apólice de seguro - Seguro auto',
    category: 'PROVISION' as const,
    lines: [
      { id: 'p1', accountId: 'a', type: 'DEBIT' as const, amount: 1410.88 },
      { id: 'p2', accountId: 'p', type: 'CREDIT' as const, amount: 1410.88 },
    ],
    totalAmount: 1410.88,
    prepaidId: 'pp1',
    createdAt: 'T',
    updatedAt: 'T',
    createdByUid: 'alice',
  });

  it('grava o cadastro com o lançamento inicial numerado, e isola entre escritórios', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    expect(await repo.getPrepaidExpenses('cA')).toBeNull();
    const entry = await repo.savePrepaidExpenses(register([{ ...item, recognitionEntryId: 'jr1' }]) as never, audit('au-pp1'), { create: recognition('jr1') });
    expect(entry?.entryNumber).toBe(1);
    expect((await repo.getPrepaidExpenses('cA'))?.items).toHaveLength(1);
    expect((await repo.listAudit('cA')).map((a) => a.action)).toEqual(['PREPAID_SAVE']);

    // Refeito na mesma gravação: o antigo sai, o novo entra com o próximo número.
    const again = await repo.savePrepaidExpenses(register([{ ...item, amount: 1500, recognitionEntryId: 'jr2' }]) as never, audit('au-pp2'), { create: recognition('jr2'), deleteId: 'jr1' });
    expect(again?.entryNumber).toBe(2);
    expect((await repo.listJournalEntries('cA')).map((e) => e.id)).toEqual(['jr2']);

    await assertFails(getDoc(doc(asUser('bob'), 'prepaid_expenses/cA')));
    await assertFails(setDoc(doc(asUser('bob'), 'prepaid_expenses/cA'), { ...register(), orgId: ORG_B }));
    await assertFails(setDoc(doc(asUser('alice'), 'prepaid_expenses/outro'), { ...register(), orgId: ORG_A }));
    await assertFails(updateDoc(doc(asUser('alice'), 'prepaid_expenses/cA'), { items: 'x' }));
  });

  it('lançamento inicial em competência fechada é recusado inteiro', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    await closeMonth(asUser('alice'));
    await expect(repo.savePrepaidExpenses(register() as never, audit('au-pp3'), { create: recognition('jr3') })).rejects.toThrow();
    expect(await repo.getPrepaidExpenses('cA')).toBeNull();
  });

  it('excluir a empresa remove o cadastro', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    await repo.savePrepaidExpenses(register() as never, audit('au-pp4'));
    await repo.deleteClient('cA', { uid: 'alice' });
    await env.withSecurityRulesDisabled(async (ctx) => {
      expect((await getDoc(doc(ctx.firestore() as unknown as Firestore, 'prepaid_expenses/cA'))).exists()).toBe(false);
    });
  });
});

describe('contratos de empréstimo, financiamento e parcelamento', () => {
  const contract = { id: 'fc1', kind: 'LOAN', description: 'Capital de giro', date: '2025-03-01', principal: 10000, installments: 12, installmentAmount: 900, firstDueDate: '2025-04-10', interestMode: 'PREFIXED', counterpartAccountId: 't', counterpartAccountCode: '1.1.1.04', shortTermAccountId: 's', shortTermAccountCode: '2.1.4.01', longTermAccountId: 'l', longTermAccountCode: '2.2.1.01', interestExpenseAccountId: 'j', interestExpenseAccountCode: '3.4.1.01.005', createdAt: 'T', updatedAt: 'T' };
  const register = (contracts: unknown[] = [contract]) => ({ id: 'cA', clientId: 'cA', contracts, updatedAt: 'T' });
  const audit = (id: string) => ({ id, clientId: 'cA', action: 'FINANCING_SAVE', actorUid: 'alice', at: 'T' }) as const;
  const initial = (id: string) => ({
    id,
    clientId: 'cA',
    date: '2025-03-01',
    memo: 'Empréstimo - Capital de giro',
    category: 'ADJUSTMENT' as const,
    lines: [
      { id: 'f1', accountId: 't', type: 'DEBIT' as const, amount: 10000 },
      { id: 'f2', accountId: 'e', type: 'DEBIT' as const, amount: 800 },
      { id: 'f3', accountId: 's', type: 'CREDIT' as const, amount: 10800 },
    ],
    totalAmount: 10800,
    financingId: 'fc1',
    createdAt: 'T',
    updatedAt: 'T',
    createdByUid: 'alice',
  });

  it('grava o contrato com o lançamento inicial numerado, e isola entre escritórios', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    expect(await repo.getFinancingContracts('cA')).toBeNull();
    const entry = await repo.saveFinancingContracts(register([{ ...contract, initialEntryId: 'jf1' }]) as never, audit('au-fc1'), { create: initial('jf1') });
    expect(entry?.entryNumber).toBe(1);
    expect((await repo.getFinancingContracts('cA'))?.contracts).toHaveLength(1);
    expect((await repo.listAudit('cA')).map((a) => a.action)).toEqual(['FINANCING_SAVE']);

    await assertFails(getDoc(doc(asUser('bob'), 'financing_contracts/cA')));
    await assertFails(setDoc(doc(asUser('bob'), 'financing_contracts/cA'), { ...register(), orgId: ORG_B }));
    await assertFails(setDoc(doc(asUser('alice'), 'financing_contracts/outro'), { ...register(), orgId: ORG_A }));
    await assertFails(updateDoc(doc(asUser('alice'), 'financing_contracts/cA'), { contracts: 'x' }));
  });

  it('lançamento inicial em competência fechada é recusado inteiro', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    await closeMonth(asUser('alice'));
    await expect(repo.saveFinancingContracts(register() as never, audit('au-fc2'), { create: initial('jf2') })).rejects.toThrow();
    expect(await repo.getFinancingContracts('cA')).toBeNull();
  });

  it('excluir a empresa remove os contratos', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    await repo.saveFinancingContracts(register() as never, audit('au-fc3'));
    await repo.deleteClient('cA', { uid: 'alice' });
    await env.withSecurityRulesDisabled(async (ctx) => {
      expect((await getDoc(doc(ctx.firestore() as unknown as Firestore, 'financing_contracts/cA'))).exists()).toBe(false);
    });
  });
});

describe('aplicações financeiras', () => {
  const investment = { id: 'inv1', description: 'Caixinha', ledgerAccountId: 'a', ledgerAccountCode: '1.1.1.03', startMonth: '2025-12', balances: { '2025-12': 3088.42 }, createdAt: 'T', updatedAt: 'T' };
  const register = (accounts: unknown[] = [investment]) => ({ id: 'cA', clientId: 'cA', accounts, updatedAt: 'T' });
  const audit = (id: string) => ({ id, clientId: 'cA', action: 'INVESTMENT_SAVE', actorUid: 'alice', at: 'T' }) as const;

  it('grava as aplicações com a auditoria, e isola entre escritórios', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    expect(await repo.getInvestments('cA')).toBeNull();
    await repo.saveInvestments(register() as never, audit('au-inv1'));
    expect((await repo.getInvestments('cA'))?.accounts).toHaveLength(1);
    expect((await repo.listAudit('cA')).map((a) => a.action)).toEqual(['INVESTMENT_SAVE']);

    await assertFails(getDoc(doc(asUser('bob'), 'investment_accounts/cA')));
    await assertFails(setDoc(doc(asUser('bob'), 'investment_accounts/cA'), { ...register(), orgId: ORG_B }));
    await assertFails(setDoc(doc(asUser('alice'), 'investment_accounts/outro'), { ...register(), orgId: ORG_A }));
    await assertFails(updateDoc(doc(asUser('alice'), 'investment_accounts/cA'), { accounts: 'x' }));
  });

  it('excluir a empresa remove as aplicações', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    await repo.saveInvestments(register() as never, audit('au-inv2'));
    await repo.deleteClient('cA', { uid: 'alice' });
    await env.withSecurityRulesDisabled(async (ctx) => {
      expect((await getDoc(doc(ctx.firestore() as unknown as Firestore, 'investment_accounts/cA'))).exists()).toBe(false);
    });
  });
});

describe('controle de estoque', () => {
  const control = { id: 'cA', clientId: 'cA', stockAccountId: 's', stockAccountCode: '1.1.3.01', costAccountId: 'c', costAccountCode: '3.2.1.01', startMonth: '2026-07', frequency: 'MONTHLY', counts: { '2026-07': 511749.82 }, updatedAt: 'T' };
  const audit = (id: string) => ({ id, clientId: 'cA', action: 'STOCK_SAVE', actorUid: 'alice', at: 'T' }) as const;

  it('grava o controle com a auditoria, valida a frequência e isola entre escritórios', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    expect(await repo.getStockControl('cA')).toBeNull();
    await repo.saveStockControl(control as never, audit('au-st1'));
    expect((await repo.getStockControl('cA'))?.counts).toEqual({ '2026-07': 511749.82 });
    expect((await repo.listAudit('cA')).map((a) => a.action)).toEqual(['STOCK_SAVE']);

    await assertFails(getDoc(doc(asUser('bob'), 'stock_controls/cA')));
    await assertFails(setDoc(doc(asUser('bob'), 'stock_controls/cA'), { ...control, orgId: ORG_B }));
    await assertFails(setDoc(doc(asUser('alice'), 'stock_controls/outro'), { ...control, orgId: ORG_A }));
    await assertFails(updateDoc(doc(asUser('alice'), 'stock_controls/cA'), { frequency: 'ANUAL' }));
    await assertFails(updateDoc(doc(asUser('alice'), 'stock_controls/cA'), { counts: 'x' }));
  });

  it('excluir a empresa remove o controle de estoque', async () => {
    const repo = createFirestoreRepository(asUser('alice'), () => ORG_A);
    await repo.saveStockControl(control as never, audit('au-st2'));
    await repo.deleteClient('cA', { uid: 'alice' });
    await env.withSecurityRulesDisabled(async (ctx) => {
      expect((await getDoc(doc(ctx.firestore() as unknown as Firestore, 'stock_controls/cA'))).exists()).toBe(false);
    });
  });
});
