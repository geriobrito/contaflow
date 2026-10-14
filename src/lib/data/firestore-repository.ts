import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
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
  ChartAccount,
  ClassificationRule,
  ClientCompany,
  ExplanatoryNotes,
  ImportBatch,
  JournalEntry,
  OpeningBalances,
  OrgSettings,
  PeriodLock,
  PeriodSnapshot,
} from '@/types/firestore';
import type { ChangeSet, DataRepository, DateRange } from '@/lib/data/repository';
import { assertValidJournalEntry } from '@/lib/journal';
import { monthOf, periodAuditId } from '@/lib/periods';

export const COL = {
  users: 'users',
  orgs: 'orgs',
  clients: 'clients',
  accounts: 'chart_of_accounts',
  rules: 'classification_rules',
  transactions: 'transactions',
  batches: 'import_batches',
  locks: 'period_locks',
  audit: 'audit_log',
  bankAccounts: 'bank_accounts',
  openings: 'opening_balances',
  requests: 'client_requests',
  requestFiles: 'client_request_files',
  journalEntries: 'journal_entries',
  journalCounters: 'journal_counters',
  snapshots: 'period_snapshots',
  notes: 'explanatory_notes',
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
/** Tentativas de obter o próximo número de lançamento manual quando há disputa entre usuários. */
const JOURNAL_NUMBER_ATTEMPTS = 5;

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
    // Lançamentos (bancários e manuais): agrupados por competência (as regras consultam o fechamento de cada mês).
    const dated = name === COL.transactions || name === COL.journalEntries;
    const monthOfDoc = (data: DocumentData) => (dated && typeof data.date === 'string' ? monthOf(data.date) : undefined);
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
    async deleteClient(clientId, actor) {
      if (!clientId || clientId === 'global') throw new Error('Cliente inválido para exclusão.');
      // Recusa antes de apagar qualquer coisa: as regras só barrariam o operador no meio da cascata.
      const profile = await getDoc(doc(db, COL.users, actor.uid));
      if (profile.data()?.role === 'operator') throw new Error('Somente o administrador do escritório pode excluir empresas.');

      // A cascata são vários lotes independentes. A marca vem antes do primeiro: se algo
      // falhar no meio, a empresa fica visivelmente "em exclusão" e esta função, chamada de
      // novo, apaga o que restou (cada etapa só consulta o que ainda existe).
      const clientRef = doc(db, COL.clients, clientId);
      if (!(await getDoc(clientRef)).exists()) throw new Error('Empresa não encontrada.');
      await updateDoc(clientRef, { deletingAt: new Date().toISOString() });

      // A trilha de auditoria é preservada (imutável por regra). Os fechamentos saem primeiro
      // (lançamentos de competência fechada não podem ser excluídos), cada um com o registro
      // de reabertura que as regras exigem — agrupados por competência pelo limite de consultas.
      const now = new Date().toISOString();
      const locks = await getDocs(scoped(COL.locks, where('clientId', '==', clientId)));
      await run(
        locks.docs.map((d): Group => {
          const lock = { ...(d.data() as PeriodLock), id: d.id };
          const audit: AuditEntry = {
            id: periodAuditId(lock, 'reopen'),
            clientId,
            action: 'PERIOD_REOPEN',
            actorUid: actor.uid,
            ...(actor.email ? { actorEmail: actor.email } : {}),
            at: now,
            month: lock.month,
            note: 'Competência liberada pela exclusão da empresa',
          };
          return { month: lock.month, writes: [(b) => b.delete(d.ref), auditWrite(audit)] };
        })
      );
      // `requestFiles` é legado (comprovantes de quando o cliente podia anexar): só limpeza.
      for (const name of [COL.transactions, COL.journalEntries, COL.snapshots, COL.rules, COL.accounts, COL.batches, COL.bankAccounts, COL.openings, COL.notes, COL.requestFiles, COL.requests]) {
        await deleteByClient(name, clientId);
      }
      await deleteDoc(clientRef);
      // A sequência dos lançamentos manuais só pode ser apagada depois da empresa (regra):
      // enquanto a empresa existe, o contador nunca volta atrás.
      await deleteByClient(COL.journalCounters, clientId);
    },

    /* ── Plano de contas ──────────────────────────────────────────────── */
    async listAccounts(clientId) {
      const snap = await getDocs(scoped(COL.accounts, where('clientId', 'in', [clientId, 'global'])));
      return snap.docs.map((d) => ({ ...(d.data() as ChartAccount), id: d.id })).sort(byCode);
    },
    async saveAccount(account) {
      await setDoc(doc(db, COL.accounts, account.id), stamp(account), { merge: true });
    },
    async deleteAccount(accountId, audit) {
      const b = writeBatch(db);
      b.delete(doc(db, COL.accounts, accountId));
      if (audit) auditWrite(audit)(b);
      await b.commit();
    },
    async insertAccounts(accounts) {
      await run(accounts.map((acc) => single((b) => b.set(doc(db, COL.accounts, acc.id), stamp(acc)))));
    },
    async saveChartSetup({ accounts, bankAccounts }) {
      if (accounts.length + bankAccounts.length > BATCH_LIMIT) throw new Error('Alteração do plano maior que o limite de uma gravação.');
      const b = writeBatch(db);
      for (const acc of accounts) b.set(doc(db, COL.accounts, acc.id), stamp(acc), { merge: true });
      // Substitui o documento, como `saveBankAccount`.
      for (const bank of bankAccounts) b.set(doc(db, COL.bankAccounts, bank.id), stamp(bank));
      await b.commit();
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
    async countTransactions(clientId, until) {
      // Mesmo índice de `listTransactions` (orgId, clientId, date desc) — por isso o `orderBy`
      // explícito: sem ele a ordem implícita é crescente e pediria outro índice. A contagem
      // custa uma leitura a cada mil lançamentos, em vez de uma por lançamento.
      const snap = await getCountFromServer(
        scoped(COL.transactions, where('clientId', '==', clientId), where('date', '<=', until), orderBy('date', 'desc'))
      );
      return snap.data().count;
    },
    async isAccountUsedInTransactions(clientId, accountId) {
      const direct = await getDocs(scoped(COL.transactions, where('clientId', '==', clientId), where('accountId', '==', accountId), limit(1)));
      if (!direct.empty) return true;
      // Rateios guardam as contas dentro de `splits`, que não é consultável: confere só os rateados.
      const splits = await getDocs(scoped(COL.transactions, where('clientId', '==', clientId), where('isSplit', '==', true)));
      return splits.docs.some((d) => (d.data() as BankTransaction).splits?.some((s) => s.accountId === accountId));
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
      if (batch) {
        await setDoc(doc(db, COL.batches, batch.id), stamp({ ...batch, status: 'PROCESSING' }));
      }
      try {
        await run(transactions.map((tx) => single((b) => b.set(doc(db, COL.transactions, tx.id), stamp(tx)))));
        if (batch) {
          await setDoc(doc(db, COL.batches, batch.id), stamp({ ...batch, status: 'COMPLETED' }), { merge: true });
        }
      } catch (err) {
        if (batch) {
          try {
            await setDoc(doc(db, COL.batches, batch.id), stamp({ ...batch, status: 'FAILED' }), { merge: true });
          } catch (innerErr) {
            console.error('[insertTransactions] Falha ao marcar lote como FAILED:', innerErr);
          }
        }
        throw err;
      }
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

    /* ── Saldos de abertura ───────────────────────────────────────────── */
    async getOpeningBalances(clientId) {
      const snap = await getDoc(doc(db, COL.openings, clientId));
      return snap.exists() ? ({ ...(snap.data() as OpeningBalances), id: snap.id }) : null;
    },
    async saveOpeningBalances(balances, audit) {
      const b = writeBatch(db);
      b.set(doc(db, COL.openings, balances.clientId), stamp({ ...balances, id: balances.clientId }));
      b.set(doc(db, COL.audit, audit.id), stamp(audit));
      await b.commit();
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
    // As regras exigem o registro de auditoria na mesma gravação, sob um id derivado do fechamento.
    async closePeriod(lock, audit) {
      const b = writeBatch(db);
      b.set(doc(db, COL.locks, lock.id), stamp(lock));
      auditWrite({ ...audit, id: periodAuditId(lock, 'close') })(b);
      await b.commit();
    },
    async reopenPeriod(lock, audit) {
      const b = writeBatch(db);
      b.delete(doc(db, COL.locks, lock.id));
      auditWrite({ ...audit, id: periodAuditId(lock, 'reopen') })(b);
      await b.commit();
    },

    /* ── Saldos consolidados (cache) ──────────────────────────────────── */
    async listPeriodSnapshots(clientId) {
      const snap = await getDocs(scoped(COL.snapshots, where('clientId', '==', clientId)));
      return snap.docs.map((d) => ({ ...(d.data() as PeriodSnapshot), id: d.id }));
    },
    async savePeriodSnapshot(snapshot) {
      await setDoc(doc(db, COL.snapshots, snapshot.id), stamp(snapshot));
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
    async closeClientRequest(requestId) {
      await updateDoc(doc(db, COL.requests, requestId), { status: 'CLOSED' });
    },

    /* ── Lançamentos manuais de fechamento (Diário Avulso) ─────────────── */
    async listJournalEntries(clientId, range) {
      const constraints: QueryConstraint[] = [where('clientId', '==', clientId)];
      if (range) {
        constraints.push(where('date', '>=', range.start), where('date', '<=', range.end));
      }
      const snap = await getDocs(scoped(COL.journalEntries, ...constraints));
      return snap.docs
        .map((d) => ({ ...(d.data() as JournalEntry), id: d.id }))
        .sort((a, b) => b.date.localeCompare(a.date) || b.entryNumber - a.entryNumber);
    },
    async createJournalEntry(draft, audit) {
      assertValidJournalEntry(draft);
      const counterRef = doc(db, COL.journalCounters, draft.clientId);
      // Cliente ainda sem contador: a sequência parte do maior número já usado. A consulta
      // fica fora da transação, que só lê documentos por referência.
      let seed = 0;
      if (!(await getDoc(counterRef)).exists()) {
        const snap = await getDocs(scoped(COL.journalEntries, where('clientId', '==', draft.clientId)));
        seed = snap.docs.reduce((max, d) => Math.max(max, Number(d.data().entryNumber) || 0), 0);
      }
      // Número e lançamento gravados juntos: dois usuários simultâneos nunca recebem o mesmo número.
      for (let attempt = 1; ; attempt++) {
        let seen: number | null = null;
        try {
          return await runTransaction(db, async (t) => {
            const counter = await t.get(counterRef);
            seen = counter.exists() ? Number(counter.data().last) || 0 : null;
            const entry: JournalEntry = { ...draft, entryNumber: (seen ?? seed) + 1 };
            t.set(counterRef, stamp({ id: draft.clientId, clientId: draft.clientId, last: entry.entryNumber }));
            t.set(doc(db, COL.journalEntries, entry.id), stamp(entry));
            if (audit) t.set(doc(db, COL.audit, audit.id), stamp(audit));
            return entry;
          });
        } catch (err) {
          // Se outro usuário avançou o contador entre a leitura e a gravação, as regras recusam
          // o número repetido (em vez de a transação repetir sozinha). Só nesse caso tenta de
          // novo; qualquer outra recusa (ex.: competência fechada) sobe ao chamador.
          const current = await getDoc(counterRef);
          const now = current.exists() ? Number(current.data().last) || 0 : null;
          if (now === seen || attempt >= JOURNAL_NUMBER_ATTEMPTS) throw err;
        }
      }
    },
    async updateJournalEntry(entry, audit) {
      assertValidJournalEntry(entry);
      const b = writeBatch(db);
      b.set(doc(db, COL.journalEntries, entry.id), stamp(entry));
      if (audit) b.set(doc(db, COL.audit, audit.id), stamp(audit));
      await b.commit();
    },
    async deleteJournalEntry(entryId, audit) {
      const b = writeBatch(db);
      b.delete(doc(db, COL.journalEntries, entryId));
      if (audit) b.set(doc(db, COL.audit, audit.id), stamp(audit));
      await b.commit();
    },

    /* ── Encerramento do exercício ────────────────────────────────────── */
    // Transação (não um lote simples) porque os números saem do contador lido nela. As regras
    // aceitam o contador saltar o bloco inteiro quando o YEAR_CLOSE nasce na mesma gravação.
    async closeYear(drafts, audit) {
      if (drafts.length === 0) throw new Error('Nada a encerrar.');
      if (drafts.length + 2 > BATCH_LIMIT) throw new Error('Encerramento maior que o limite de uma gravação.');
      drafts.forEach(assertValidJournalEntry);
      const clientId = drafts[0].clientId;
      const counterRef = doc(db, COL.journalCounters, clientId);
      let seed = 0;
      if (!(await getDoc(counterRef)).exists()) {
        const snap = await getDocs(scoped(COL.journalEntries, where('clientId', '==', clientId)));
        seed = snap.docs.reduce((max, d) => Math.max(max, Number(d.data().entryNumber) || 0), 0);
      }
      return runTransaction(db, async (t) => {
        const counter = await t.get(counterRef);
        const base = counter.exists() ? Number(counter.data().last) || 0 : seed;
        const entries: JournalEntry[] = drafts.map((d, i) => ({ ...d, entryNumber: base + i + 1, closingAuditId: audit.id }));
        t.set(counterRef, stamp({ id: clientId, clientId, last: base + entries.length, closingAudit: audit.id }));
        for (const e of entries) t.set(doc(db, COL.journalEntries, e.id), stamp(e));
        t.set(doc(db, COL.audit, audit.id), stamp(audit));
        return entries;
      });
    },
    async reopenYear(entries, audit) {
      if (entries.length + 1 > BATCH_LIMIT) throw new Error('Encerramento maior que o limite de uma gravação.');
      const b = writeBatch(db);
      for (const e of entries) b.delete(doc(db, COL.journalEntries, e.id));
      auditWrite(audit)(b);
      await b.commit();
    },

    /* ── Notas explicativas ───────────────────────────────────────────── */
    async getExplanatoryNotes(clientId, year) {
      const snap = await getDoc(doc(db, COL.notes, `${clientId}_${year}`));
      return snap.exists() ? ({ ...(snap.data() as ExplanatoryNotes), id: snap.id }) : null;
    },
    async saveExplanatoryNotes(notes) {
      await setDoc(doc(db, COL.notes, `${notes.clientId}_${notes.year}`), stamp({ ...notes, id: `${notes.clientId}_${notes.year}` }));
    },

    /* Acesso público pelo link: sem orgId de sessão; as regras validam pelo token. */
    async getPublicClientRequest(token) {
      const snap = await getDoc(doc(db, COL.requests, token));
      return snap.exists() ? ({ ...(snap.data() as ClientRequest), id: snap.id }) : null;
    },
    async answerPublicClientRequest(token, answers, respondedAt) {
      await updateDoc(doc(db, COL.requests, token), { answers: answers.map((a) => clean(a)), respondedAt });
    },
  };
}
