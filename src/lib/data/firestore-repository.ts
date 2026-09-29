import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
  type QueryConstraint,
  type WriteBatch,
} from 'firebase/firestore';
import type {
  AuditEntry,
  BankAccount,
  BankTransaction,
  ClientRequest,
  ClientRequestFile,
  ChartAccount,
  ClassificationRule,
  ClientCompany,
  ImportBatch,
  OrgSettings,
  PeriodLock,
} from '@/types/firestore';
import type { ChangeSet, DataRepository, DateRange } from '@/lib/data/repository';
import { monthOf } from '@/lib/periods';

export const COL = {
  orgs: 'orgs',
  clients: 'clients',
  accounts: 'chart_of_accounts',
  rules: 'classification_rules',
  transactions: 'transactions',
  batches: 'import_batches',
  locks: 'period_locks',
  audit: 'audit_log',
  bankAccounts: 'bank_accounts',
  requests: 'client_requests',
  requestFiles: 'client_request_files',
} as const;

/** Limites do Firestore. */
const BATCH_LIMIT = 500;
const IN_LIMIT = 30;
/**
 * As regras consultam o documento de fechamento de cada competência alterada, e o
 * Firestore permite no máximo 20 documentos distintos consultados por lote. Com o
 * perfil do usuário e o cliente, 15 competências por lote deixam folga.
 */
export const MONTHS_PER_BATCH = 15;

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
 * Grupo indivisível de escritas (ex.: alteração do lançamento + seu registro de auditoria)
 * e a competência que ele toca — nunca é partido entre dois lotes.
 */
interface Group {
  month?: string;
  writes: ((b: WriteBatch) => void)[];
}
const single = (write: (b: WriteBatch) => void, month?: string): Group => ({ month, writes: [write] });

/**
 * Repositório Firestore com isolamento por escritório.
 * - Toda consulta inclui `where('orgId', '==', org)` (exigido pelas regras).
 * - Toda criação carimba `orgId`; atualizações nunca o alteram.
 * - Erros sobem ao chamador.
 */
export function createFirestoreRepository(db: Firestore, getOrgId: () => string): DataRepository {
  const scoped = (name: string, ...constraints: QueryConstraint[]) =>
    query(collection(db, name), where('orgId', '==', getOrgId()), ...constraints);

  const stamp = <T extends object>(data: T): DocumentData => clean({ ...data, orgId: getOrgId() });

  /** Executa grupos em lotes de até 500 escritas e no máximo MONTHS_PER_BATCH competências. */
  async function run(groups: readonly Group[]) {
    let writes: Group['writes'] = [];
    let months = new Set<string>();
    const flush = async () => {
      if (!writes.length) return;
      const b = writeBatch(db);
      writes.forEach((w) => w(b));
      await b.commit();
      writes = [];
      months = new Set();
    };
    for (const g of groups) {
      if (g.writes.length > BATCH_LIMIT) throw new Error('Grupo de escrita maior que o limite do lote.');
      const newMonth = g.month !== undefined && !months.has(g.month);
      if (writes.length + g.writes.length > BATCH_LIMIT || (newMonth && months.size >= MONTHS_PER_BATCH)) await flush();
      if (g.month !== undefined) months.add(g.month);
      writes.push(...g.writes);
    }
    await flush();
  }

  async function deleteByClient(name: string, clientId: string) {
    const snap = await getDocs(scoped(name, where('clientId', '==', clientId)));
    // Lançamentos: agrupados por competência (as regras consultam o fechamento de cada mês).
    const monthOfDoc = (data: DocumentData) =>
      name === COL.transactions && typeof data.date === 'string' ? monthOf(data.date) : undefined;
    await run(snap.docs.map((d) => single((b) => b.delete(d.ref), monthOfDoc(d.data()))));
  }

  const auditWrite = (entry: AuditEntry) => (b: WriteBatch) => b.set(doc(db, COL.audit, entry.id), stamp(entry));

  /** Grupos de um ChangeSet: cada patch vai junto da sua auditoria, ordenados por competência. */
  function changeGroups({ patches, rules = [], audits }: ChangeSet): Group[] {
    const groups: Group[] = rules.map((rule) => single((b) => b.set(doc(db, COL.rules, rule.id), stamp(rule), { merge: true })));
    const auditByTx = new Map<string, AuditEntry[]>();
    const loose: AuditEntry[] = [];
    for (const a of audits) {
      if (a.transactionId) auditByTx.set(a.transactionId, [...(auditByTx.get(a.transactionId) ?? []), a]);
      else loose.push(a);
    }
    for (const p of [...patches].sort((a, b) => a.date.localeCompare(b.date))) {
      const update: DocumentData = { ...clean(p.set) };
      for (const f of p.remove ?? []) update[f] = deleteField();
      groups.push({
        month: monthOf(p.date),
        writes: [(b) => b.update(doc(db, COL.transactions, p.id), update), ...(auditByTx.get(p.id) ?? []).map(auditWrite)],
      });
      auditByTx.delete(p.id);
    }
    for (const a of [...loose, ...[...auditByTx.values()].flat()]) groups.push(single(auditWrite(a)));
    return groups;
  }

  const txFrom = (d: { id: string; data: () => DocumentData }) => ({ ...(d.data() as BankTransaction), id: d.id });

  return {
    mode: 'firestore',

    /* ── Escritório ───────────────────────────────────────────────────── */
    async getOrgSettings() {
      const snap = await getDoc(doc(db, COL.orgs, getOrgId()));
      return snap.exists() ? ({ ...(snap.data() as OrgSettings), orgId: snap.id }) : null;
    },
    async saveOrgSettings(settings) {
      await setDoc(doc(db, COL.orgs, getOrgId()), stamp(settings));
    },

    /* ── Clientes ─────────────────────────────────────────────────────── */
    async listClients() {
      const snap = await getDocs(scoped(COL.clients));
      return snap.docs.map((d) => ({ ...(d.data() as ClientCompany), id: d.id }));
    },
    async saveClient(client) {
      // Substitui o documento: campos apagados no formulário (ex.: CPF do representante) somem de fato.
      await setDoc(doc(db, COL.clients, client.id), stamp(client));
    },
    async deleteClient(clientId) {
      if (!clientId || clientId === 'global') throw new Error('Cliente inválido para exclusão.');
      // A trilha de auditoria é preservada (imutável por regra). Os fechamentos saem primeiro:
      // lançamentos de competência fechada não podem ser excluídos.
      for (const name of [COL.locks, COL.transactions, COL.rules, COL.accounts, COL.batches, COL.bankAccounts, COL.requestFiles, COL.requests]) {
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
      await run(accounts.map((acc) => single((b) => b.set(doc(db, COL.accounts, acc.id), stamp(acc)))));
    },

    /* ── Regras ───────────────────────────────────────────────────────── */
    async listRules(clientId) {
      const snap = await getDocs(scoped(COL.rules, where('clientId', 'in', [clientId, 'global'])));
      return snap.docs.map((d) => {
        const data = d.data();
        return { ...(data as ClassificationRule), id: d.id, createdAt: toISO(data.createdAt), updatedAt: toISO(data.updatedAt) };
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
      // Índice composto: orgId ASC, clientId ASC, date DESC.
      const constraints: QueryConstraint[] = [where('clientId', '==', clientId)];
      if (range) constraints.push(where('date', '>=', range.start), where('date', '<=', range.end));
      constraints.push(orderBy('date', 'desc'));
      const snap = await getDocs(scoped(COL.transactions, ...constraints));
      return snap.docs.map((d) => ({ ...(d.data() as BankTransaction), id: d.id }));
    },
    async listPendingTransactions(clientId) {
      const snap = await getDocs(scoped(COL.transactions, where('clientId', '==', clientId), where('status', '==', 'PENDING')));
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
      const fitids = ids.map((id) => (id.startsWith(prefix) ? id.slice(prefix.length) : id));
      const existing = new Set<string>();
      for (const group of chunk(fitids, IN_LIMIT)) {
        const snap = await getDocs(scoped(COL.transactions, where('clientId', '==', clientId), where('fitid', 'in', group)));
        snap.docs.forEach((d) => existing.add(d.id));
      }
      return existing;
    },
    async insertTransactions(transactions, batch?: ImportBatch) {
      await run(transactions.map((tx) => single((b) => b.set(doc(db, COL.transactions, tx.id), stamp(tx)))));
      if (batch) await setDoc(doc(db, COL.batches, batch.id), stamp(batch));
    },

    async commitChanges(changes: ChangeSet) {
      await run(changeGroups(changes));
    },
    async getTransaction(id) {
      const snap = await getDoc(doc(db, COL.transactions, id));
      return snap.exists() ? txFrom(snap) : null;
    },
    async listOpenQueries(clientId) {
      const snap = await getDocs(scoped(COL.transactions, where('clientId', '==', clientId), where('clientQuery.status', '==', 'OPEN')));
      return snap.docs.map(txFrom).sort((a, b) => b.date.localeCompare(a.date));
    },

    /* ── Extratos ─────────────────────────────────────────────────────── */
    async listImportBatches(clientId) {
      const snap = await getDocs(scoped(COL.batches, where('clientId', '==', clientId)));
      return snap.docs.map((d) => ({ ...(d.data() as ImportBatch), id: d.id }));
    },
    async saveImportBatch(batch) {
      await setDoc(doc(db, COL.batches, batch.id), stamp(batch), { merge: true });
    },
    async listBatchTransactions(batch) {
      const found = new Map<string, BankTransaction>();
      const byBatch = await getDocs(scoped(COL.transactions, where('clientId', '==', batch.clientId), where('importBatchId', '==', batch.id)));
      byBatch.docs.forEach((d) => found.set(d.id, txFrom(d)));
      // Extratos importados antes do vínculo explícito: mesma data/hora de gravação do lote.
      const legacy = await getDocs(scoped(COL.transactions, where('clientId', '==', batch.clientId), where('createdAt', '==', batch.importedAt)));
      legacy.docs.map(txFrom).filter((t) => !t.importBatchId).forEach((t) => found.set(t.id, t));
      return [...found.values()].sort((a, b) => a.date.localeCompare(b.date));
    },
    async deleteImportBatch(batch, transactions, changes) {
      const groups = changeGroups(changes);
      for (const t of [...transactions].sort((a, b) => a.date.localeCompare(b.date))) {
        groups.push(single((b) => b.delete(doc(db, COL.transactions, t.id)), monthOf(t.date)));
      }
      groups.push(single((b) => b.delete(doc(db, COL.batches, batch.id))));
      await run(groups);
    },

    /* ── Contas bancárias ─────────────────────────────────────────────── */
    async listBankAccounts(clientId) {
      const snap = await getDocs(scoped(COL.bankAccounts, where('clientId', '==', clientId)));
      return snap.docs.map((d) => ({ ...(d.data() as BankAccount), id: d.id }));
    },
    async saveBankAccount(account) {
      // Substitui o documento: vínculo ou saldo inicial removidos somem de fato.
      await setDoc(doc(db, COL.bankAccounts, account.id), stamp(account));
    },

    /* ── Fechamento de período ────────────────────────────────────────── */
    async listPeriodLocks(clientId) {
      const snap = await getDocs(scoped(COL.locks, where('clientId', '==', clientId)));
      return snap.docs.map((d) => ({ ...(d.data() as PeriodLock), id: d.id }));
    },
    async closePeriod(lock, audit) {
      const b = writeBatch(db);
      b.set(doc(db, COL.locks, lock.id), stamp(lock));
      b.set(doc(db, COL.audit, audit.id), stamp(audit));
      await b.commit();
    },
    async reopenPeriod(lock, audit) {
      const b = writeBatch(db);
      b.delete(doc(db, COL.locks, lock.id));
      b.set(doc(db, COL.audit, audit.id), stamp(audit));
      await b.commit();
    },

    /* ── Auditoria ────────────────────────────────────────────────────── */
    async listAudit(clientId, options = {}) {
      // Índices compostos: (orgId, clientId, at desc) e (orgId, clientId, transactionId, at desc).
      const constraints: QueryConstraint[] = [where('clientId', '==', clientId)];
      if (options.transactionId) constraints.push(where('transactionId', '==', options.transactionId));
      constraints.push(orderBy('at', 'desc'), limit(options.limit ?? 200));
      const snap = await getDocs(scoped(COL.audit, ...constraints));
      return snap.docs.map((d) => ({ ...(d.data() as AuditEntry), id: d.id }));
    },

    /* ── Pendências com o cliente ─────────────────────────────────────── */
    async listClientRequests(clientId) {
      const snap = await getDocs(scoped(COL.requests, where('clientId', '==', clientId)));
      return snap.docs.map((d) => ({ ...(d.data() as ClientRequest), id: d.id })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async saveClientRequest(request) {
      await setDoc(doc(db, COL.requests, request.id), stamp(request));
    },
    async getClientRequestFile(fileId) {
      const snap = await getDoc(doc(db, COL.requestFiles, fileId));
      return snap.exists() ? ({ ...(snap.data() as ClientRequestFile), id: snap.id }) : null;
    },

    /* Acesso público pelo link: sem orgId de sessão; as regras validam pelo token. */
    async getPublicClientRequest(token) {
      const snap = await getDoc(doc(db, COL.requests, token));
      return snap.exists() ? ({ ...(snap.data() as ClientRequest), id: snap.id }) : null;
    },
    async answerPublicClientRequest(token, items, respondedAt) {
      await updateDoc(doc(db, COL.requests, token), { items: items.map((i) => clean(i)), respondedAt });
    },
    async uploadPublicClientRequestFile(file) {
      await setDoc(doc(db, COL.requestFiles, file.id), clean(file));
    },
  };
}
