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
import { periodAuditId } from '@/lib/periods';
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

/** Fechamento de competência e o registro de auditoria que as regras exigem na mesma gravação. */
const lockOf = (month: string, by = 'alice', clientId = 'cA', orgId = ORG_A, lockedAt = 'T') => ({
  id: `${clientId}_${month}`,
  orgId,
  clientId,
  month,
  lockedAt,
  lockedByUid: by,
});
type Lock = ReturnType<typeof lockOf>;
const periodAudit = (lock: Lock, kind: 'close' | 'reopen', by = lock.lockedByUid) => ({
  id: periodAuditId(lock, kind),
  orgId: lock.orgId,
  clientId: lock.clientId,
  action: kind === 'close' ? 'PERIOD_CLOSE' : 'PERIOD_REOPEN',
  actorUid: by,
  at: 'T',
  month: lock.month,
});
const closeMonth = (db: Firestore, lock: Lock = lockOf('2025-03')) => {
  const b = writeBatch(db);
  b.set(doc(db, `period_locks/${lock.id}`), lock);
  b.set(doc(db, `audit_log/${periodAuditId(lock, 'close')}`), periodAudit(lock, 'close'));
  return b.commit();
};
const reopenMonth = (db: Firestore, lock: Lock = lockOf('2025-03'), by = 'alice') => {
  const b = writeBatch(db);
  b.delete(doc(db, `period_locks/${lock.id}`));
  b.set(doc(db, `audit_log/${periodAuditId(lock, 'reopen')}`), periodAudit(lock, 'reopen', by));
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
  const march = lockOf('2025-03');

  it('valida id, competência e autor do fechamento', async () => {
    const db = asUser('alice');
    /** Fechamento com o registro de auditoria correto para o id e o usuário informados. */
    const close = (id: string, lock: Lock, who = db, actor = 'alice') => {
      const auditId = periodAuditId({ id, lockedAt: lock.lockedAt }, 'close');
      const b = writeBatch(who);
      b.set(doc(who, `period_locks/${id}`), lock);
      b.set(doc(who, `audit_log/${auditId}`), { ...periodAudit(lock, 'close', actor), id: auditId });
      return b.commit();
    };
    await assertFails(close('cA_2025-04', march)); // id não confere
    await assertFails(close('cA_2025-13', lockOf('2025-13'))); // mês inválido
    await assertFails(close('cA_2025-03', lockOf('2025-03', 'carol'))); // autor ≠ usuário
    await assertFails(close('cA_2025-03', lockOf('2025-03', 'bob', 'cA', ORG_B), asUser('bob'), 'bob'));
    await assertFails(close('cA_2025-03', lockOf('2025-03', 'alice', 'cA', ORG_A, 'data invalida'))); // data/hora fora do formato
    await assertSucceeds(close('cA_2025-03', march));
    await assertFails(updateDoc(doc(db, 'period_locks/cA_2025-03'), { lockedAt: 'X' }));
  });

  it('fechar e reabrir exigem o registro de auditoria na mesma gravação', async () => {
    const db = asUser('alice');
    const closeWith = (audit: Record<string, unknown>) => {
      const b = writeBatch(db);
      b.set(doc(db, 'period_locks/cA_2025-03'), march);
      b.set(doc(db, `audit_log/${periodAuditId(march, 'close')}`), { ...periodAudit(march, 'close'), ...audit });
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
      b.set(doc(db, `audit_log/${periodAuditId(march, 'reopen')}`), { ...periodAudit(march, 'reopen'), ...audit });
      return b.commit();
    };
    await assertFails(reopenWith({ action: 'PERIOD_CLOSE' }));
    await assertSucceeds(reopenMonth(db, march));

    // Cada fechamento deixa o próprio registro: repetir o mesmo (mesma data/hora) reaproveitaria o antigo.
    await assertFails(closeMonth(db, march));
    await assertFails(setDoc(doc(db, 'period_locks/cA_2025-03'), march));
    await assertSucceeds(closeMonth(db, lockOf('2025-03', 'alice', 'cA', ORG_A, 'T2')));
    const repo = createFirestoreRepository(db, () => ORG_A);
    expect((await repo.listAudit('cA')).map((e) => e.action).sort()).toEqual(['PERIOD_CLOSE', 'PERIOD_CLOSE', 'PERIOD_REOPEN']);
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
    await assertSucceeds(setDoc(doc(db, 'clients/novo'), client('novo', ORG_A)));
    await assertSucceeds(closeMonth(db, lockOf('2025-04', 'carol')));
  });

  it('operador não reabre competência nem exclui empresa, extrato ou lançamento; o administrador sim', async () => {
    const carol = asUser('carol');
    const alice = asUser('alice');
    await closeMonth(alice, april);
    await assertFails(reopenMonth(carol, april, 'carol'));
    await assertFails(deleteDoc(doc(carol, 'transactions/cA_1')));
    await assertFails(deleteDoc(doc(carol, 'import_batches/bX')));
    await assertFails(deleteDoc(doc(carol, 'clients/cA')));

    await assertSucceeds(reopenMonth(alice, april));
    await assertSucceeds(deleteDoc(doc(alice, 'transactions/cA_1')));
    await assertSucceeds(deleteDoc(doc(alice, 'import_batches/bX')));
    await assertSucceeds(deleteDoc(doc(alice, 'clients/cA')));
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

  it('nenhum lançamento manual até a data de implantação (saldos de abertura)', async () => {
    const db = asUser('alice');
    const repo = createFirestoreRepository(db, () => ORG_A);
    const saved = await repo.createJournalEntry(draft('j1', { date: '2025-04-30' }));
    await repo.saveOpeningBalances({ id: 'cA', clientId: 'cA', date: '2025-03-31', entries: [], updatedAt: 'T' }, { id: 'au-op', clientId: 'cA', action: 'OPENING_SAVE', actorUid: 'alice', at: 'T' });
    await expect(repo.createJournalEntry(draft('j2', { date: '2025-03-31' }))).rejects.toThrow();
    await expect(repo.createJournalEntry(draft('j2', { date: '2025-01-10' }))).rejects.toThrow();
    await expect(repo.updateJournalEntry({ ...saved, date: '2025-03-15' })).rejects.toThrow();
    expect((await repo.createJournalEntry(draft('j3', { date: '2025-04-01' }))).entryNumber).toBe(2);
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
      // Extrato antigo, sem importBatchId: identificado pela data/hora de gravação.
      await setDoc(doc(db, 'transactions/cA_n2'), { ...tx('cA_n2', 'cA', ORG_A, '2025-06-03'), createdAt: 'IMPORT-T' });
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

  it('o tamanho é conferido resposta a resposta em links de até 24 perguntas; links maiores continuam respondíveis', async () => {
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

    // Acima disso as regras não conseguem conferir uma a uma: o link segue aceitando respostas.
    await admin.saveClientRequest(request({ items: items(25) }) as never);
    await assertSucceeds(updateDoc(ref, { answers: answers(25, 'curta'), respondedAt: 'T3' }));
    await assertFails(updateDoc(ref, { answers: answers(24, 'curta'), respondedAt: 'T3' }));
  });

  it('encerrar o link preserva respostas que chegaram depois da última leitura do escritório', async () => {
    const admin = createFirestoreRepository(asUser('alice'), () => ORG_A);
    await admin.saveClientRequest(request() as never);
    await publicRepo().answerPublicClientRequest(TOKEN, [{ text: 'Aluguel de março' }], 'T2');
    await admin.closeClientRequest(TOKEN);
    expect(await admin.listClientRequests('cA')).toMatchObject([{ status: 'CLOSED', respondedAt: 'T2', answers: [{ text: 'Aluguel de março' }] }]);
  });

  it('link encerrado ou vencido não aceita respostas', async () => {
    const admin = createFirestoreRepository(asUser('alice'), () => ORG_A);
    const answer = { answers: [{ text: 'tarde demais' }], respondedAt: 'T' };
    await admin.saveClientRequest(request({ expiresAtMs: Date.now() - 1000 }) as never);
    await assertFails(updateDoc(doc(anon(), `client_requests/${TOKEN}`), answer));
    await admin.saveClientRequest(request({ status: 'CLOSED' }) as never);
    await assertFails(updateDoc(doc(anon(), `client_requests/${TOKEN}`), answer));
  });

  it('o cliente não envia arquivos: a coleção antiga não aceita nada novo, só leitura e limpeza pelo escritório', async () => {
    const admin = createFirestoreRepository(asUser('alice'), () => ORG_A);
    await admin.saveClientRequest(request() as never);
    const file = (id: string) => ({ id, orgId: ORG_A, clientId: 'cA', requestId: TOKEN, transactionId: 'cA_1', name: 'nota.pdf', type: 'application/pdf', bytes: 10, data: 'aGVsbG8=', uploadedAt: 'T' });
    await assertFails(setDoc(doc(anon(), 'client_request_files/f1'), file('f1')));
    await assertFails(setDoc(doc(asUser('alice'), 'client_request_files/f1'), file('f1')));

    // Comprovante gravado quando o envio ainda existia.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore() as unknown as Firestore, 'client_request_files/antigo'), file('antigo'));
    });
    await assertFails(getDoc(doc(anon(), 'client_request_files/antigo')));
    await assertFails(getDoc(doc(asUser('bob'), 'client_request_files/antigo')));
    await assertFails(updateDoc(doc(asUser('alice'), 'client_request_files/antigo'), { name: 'outro.pdf' }));
    await assertSucceeds(getDoc(doc(asUser('alice'), 'client_request_files/antigo')));
    await admin.deleteClient('cA', { uid: 'alice' });
    await env.withSecurityRulesDisabled(async (ctx) => {
      expect((await getDoc(doc(ctx.firestore() as unknown as Firestore, 'client_request_files/antigo'))).exists()).toBe(false);
    });
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
    expect(await repo.isAccountUsedInTransactions('cA', 'direta')).toBe(true);
    expect(await repo.isAccountUsedInTransactions('cA', 'rateada')).toBe(true);
    expect(await repo.isAccountUsedInTransactions('cA', 'livre')).toBe(false);
    expect(await repo.isAccountUsedInTransactions('cA', 'de-outro')).toBe(false);
    // Outro escritório não conta nem consulta os lançamentos do A.
    const forged = createFirestoreRepository(asUser('bob'), () => ORG_A);
    await expect(forged.countTransactions('cA', '2025-12-31')).rejects.toThrow();
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
      await setDoc(doc(db, `audit_log/${periodAuditId(march, 'reopen')}`), periodAudit(march, 'reopen'));
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
