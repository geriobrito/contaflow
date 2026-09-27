import {
  collection,
  deleteField,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where,
  writeBatch,
  deleteDoc,
  updateDoc,
  type DocumentData,
  type Firestore,
  type QueryConstraint,
  type WriteBatch,
} from 'firebase/firestore';
import type {
  BankTransaction,
  ChartAccount,
  ClassificationRule,
  ClientCompany,
  ImportBatch,
  TransactionSplit,
} from '@/types/firestore';
import type { ClassificationCommit, DataRepository, DateRange } from '@/lib/data/repository';

const COL = {
  clients: 'clients',
  accounts: 'chart_of_accounts',
  rules: 'classification_rules',
  transactions: 'transactions',
  batches: 'import_batches',
} as const;

/** Limites do Firestore. */
const BATCH_LIMIT = 500;
const IN_LIMIT = 30;

const chunk = <T,>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** Firestore rejeita campos `undefined`. */
const clean = <T extends object>(obj: T): DocumentData =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

/** Converte Timestamp (ou ausência) em ISO string. */
function toISO(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toDate' in value) {
    const toDate = (value as { toDate: () => Date }).toDate;
    if (typeof toDate === 'function') return toDate.call(value).toISOString();
  }
  return '';
}

const byCode = (a: ChartAccount, b: ChartAccount) => a.code.localeCompare(b.code, undefined, { numeric: true });

/**
 * Repositório Firestore com isolamento por escritório.
 *
 * - Toda consulta inclui `where('orgId', '==', org)` — exigido pelas regras de
 *   segurança, que recusam consultas capazes de retornar documentos de outro escritório.
 * - Toda escrita de criação carimba `orgId`; atualizações nunca o alteram.
 * - Erros sobem ao chamador.
 */
export function createFirestoreRepository(db: Firestore, getOrgId: () => string): DataRepository {
  const scoped = (name: string, ...constraints: QueryConstraint[]) =>
    query(collection(db, name), where('orgId', '==', getOrgId()), ...constraints);

  const stamp = <T extends object>(data: T): DocumentData => clean({ ...data, orgId: getOrgId() });

  async function commitInBatches<T>(items: readonly T[], apply: (b: WriteBatch, item: T) => void) {
    for (const group of chunk(items, BATCH_LIMIT)) {
      const b = writeBatch(db);
      group.forEach((item) => apply(b, item));
      await b.commit();
    }
  }

  async function deleteByClient(name: string, clientId: string) {
    const snap = await getDocs(scoped(name, where('clientId', '==', clientId)));
    await commitInBatches(snap.docs, (b, d) => b.delete(d.ref));
  }

  return {
    mode: 'firestore',

    /* ── Clientes ─────────────────────────────────────────────────────── */
    async listClients() {
      const snap = await getDocs(scoped(COL.clients));
      return snap.docs.map((d) => ({ ...(d.data() as ClientCompany), id: d.id }));
    },

    async saveClient(client) {
      await setDoc(doc(db, COL.clients, client.id), stamp(client), { merge: true });
    },

    async deleteClient(clientId) {
      if (!clientId || clientId === 'global') throw new Error('Cliente inválido para exclusão.');
      for (const name of [COL.transactions, COL.rules, COL.accounts, COL.batches]) {
        await deleteByClient(name, clientId);
      }
      await deleteDoc(doc(db, COL.clients, clientId));
    },

    /* ── Plano de contas ──────────────────────────────────────────────── */
    async listAccounts(clientId) {
      const snap = await getDocs(scoped(COL.accounts, where('clientId', 'in', [clientId, 'global'])));
      return snap.docs.map((d) => ({ ...(d.data() as ChartAccount), id: d.id })).sort(byCode);
    },

    async saveAccount(account) {
      await setDoc(doc(db, COL.accounts, account.id), stamp(account), { merge: true });
    },

    async deleteAccount(accountId) {
      await deleteDoc(doc(db, COL.accounts, accountId));
    },

    async insertAccounts(accounts) {
      await commitInBatches(accounts, (b, acc) => b.set(doc(db, COL.accounts, acc.id), stamp(acc)));
    },

    /* ── Regras ───────────────────────────────────────────────────────── */
    async listRules(clientId) {
      const snap = await getDocs(scoped(COL.rules, where('clientId', 'in', [clientId, 'global'])));
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          ...(data as ClassificationRule),
          id: d.id,
          createdAt: toISO(data.createdAt),
          updatedAt: toISO(data.updatedAt),
        };
      });
    },

    async saveRule(rule) {
      await setDoc(doc(db, COL.rules, rule.id), stamp(rule), { merge: true });
    },

    async deleteRule(ruleId) {
      await deleteDoc(doc(db, COL.rules, ruleId));
    },

    /* ── Lançamentos ──────────────────────────────────────────────────── */
    async listTransactions(clientId, range?: DateRange) {
      // Índice composto: orgId ASC, clientId ASC, date DESC (firestore.indexes.json).
      const constraints: QueryConstraint[] = [where('clientId', '==', clientId)];
      if (range) constraints.push(where('date', '>=', range.start), where('date', '<=', range.end));
      constraints.push(orderBy('date', 'desc'));
      const snap = await getDocs(scoped(COL.transactions, ...constraints));
      return snap.docs.map((d) => ({ ...(d.data() as BankTransaction), id: d.id }));
    },

    async latestTransactionDate(clientId) {
      const snap = await getDocs(
        scoped(COL.transactions, where('clientId', '==', clientId), orderBy('date', 'desc'), limit(1))
      );
      return snap.empty ? null : ((snap.docs[0].data() as BankTransaction).date ?? null);
    },

    async findExistingTransactionIds(clientId, ids) {
      // Consulta pelo campo `fitid` (e não por documentId): consultas por ID são avaliadas
      // documento a documento pelas regras, inclusive IDs inexistentes, e seriam recusadas.
      const prefix = `${clientId}_`;
      const fitidToId = new Map(ids.map((id) => [id.startsWith(prefix) ? id.slice(prefix.length) : id, id] as const));
      const existing = new Set<string>();
      for (const group of chunk([...fitidToId.keys()], IN_LIMIT)) {
        const snap = await getDocs(
          scoped(COL.transactions, where('clientId', '==', clientId), where('fitid', 'in', group))
        );
        snap.docs.forEach((d) => existing.add(d.id));
      }
      return existing;
    },

    async insertTransactions(transactions, batch?: ImportBatch) {
      await commitInBatches(transactions, (b, tx) => b.set(doc(db, COL.transactions, tx.id), stamp(tx)));
      if (batch) await setDoc(doc(db, COL.batches, batch.id), stamp(batch));
    },

    async commitClassification({ transactionId, account, rule, similarIds, now }: ClassificationCommit) {
      const b = writeBatch(db);
      b.update(doc(db, COL.transactions, transactionId), {
        status: 'RECONCILED',
        ...account,
        reconciledAt: now,
        // Conta única sobrescreve rateio anterior.
        isSplit: false,
        splits: deleteField(),
        matchedRuleId: rule ? rule.id : deleteField(),
      });
      if (rule) b.set(doc(db, COL.rules, rule.id), stamp(rule), { merge: true });

      // Transação + regra + semelhantes no mesmo batch; o excedente vai em lotes extras.
      const head = similarIds.slice(0, BATCH_LIMIT - 2);
      const similarUpdate = { status: 'AUTO_CLASSIFIED', ...account, ...(rule ? { matchedRuleId: rule.id } : {}) };
      head.forEach((id) => b.update(doc(db, COL.transactions, id), similarUpdate));
      await b.commit();
      await commitInBatches(similarIds.slice(BATCH_LIMIT - 2), (bb, id) =>
        bb.update(doc(db, COL.transactions, id), similarUpdate)
      );
    },

    async saveSplits(transactionId, splits: readonly TransactionSplit[], now) {
      await updateDoc(doc(db, COL.transactions, transactionId), {
        status: 'RECONCILED',
        isSplit: true,
        splits: splits.map((s) => clean(s)),
        accountId: deleteField(),
        accountCode: deleteField(),
        accountName: deleteField(),
        matchedRuleId: deleteField(),
        reconciledAt: now,
      });
    },

    async resetToPending(transactionId) {
      await updateDoc(doc(db, COL.transactions, transactionId), {
        status: 'PENDING',
        isSplit: false,
        accountId: deleteField(),
        accountCode: deleteField(),
        accountName: deleteField(),
        matchedRuleId: deleteField(),
        splits: deleteField(),
        reconciledAt: deleteField(),
      });
    },

    async approveTransactions(ids, now) {
      await commitInBatches(ids, (b, id) =>
        b.update(doc(db, COL.transactions, id), { status: 'RECONCILED', reconciledAt: now })
      );
    },
  };
}
