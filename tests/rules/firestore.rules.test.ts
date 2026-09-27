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
import { createFirestoreRepository } from '@/lib/data/firestore-repository';
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
    await repo.commitClassification({
      transactionId: 'c2_1',
      account,
      rule: { id: 'r1', clientId: 'c2', pattern: 'tarifa', ...account, createdAt: '', updatedAt: '' },
      similarIds: ['c2_2'],
      now: '2025-03-01',
    });
    expect((await repo.listRules('c2')).map((r) => r.id)).toEqual(['r1']);

    await repo.saveSplits('c2_1', [{ id: 's1', accountId: account.accountId, amount: -100, memo: '' }], '2025-03-02');
    await repo.resetToPending('c2_1');
    await repo.approveTransactions(['c2_2'], '2025-03-03');

    await repo.deleteClient('c2');
    expect((await repo.listClients()).map((c) => c.id)).toEqual(['cA']);
    expect(await repo.listTransactions('c2')).toEqual([]);
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
