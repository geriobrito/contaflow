import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
  type QueryConstraint,
  type Transaction,
  type WriteBatch,
} from 'firebase/firestore';
import type {
  AuditEntry,
  BankAccount,
  BankTransaction,
  ClosingChecklist,
  ClientRequest,
  ChartAccount,
  ClassificationRule,
  ClientCompany,
  ExplanatoryNotes,
  FinancingRegister,
  FixedAssetRegister,
  ImportBatch,
  InvoiceSummary,
  PrepaidRegister,
  JournalEntry,
  LockState,
  OpeningBalances,
  OrgSettings,
  PeriodLock,
  PeriodSnapshot,
} from '@/types/firestore';
import type { ChangeSet, DataRepository, DateRange, FixedAssetJournalChange, JournalEntryDraft } from '@/lib/data/repository';
// Leituras contadas para o medidor da cota diária (ver read-meter.ts).
import { getCountFromServer, getDoc, getDocs } from '@/lib/data/counted-reads';
import { addReads } from '@/lib/data/read-meter';
import { assertValidJournalEntry } from '@/lib/journal';
import { invoiceId } from '@/lib/nfe/import';
import { monthOf, periodAuditId } from '@/lib/periods';
import {
  frozenMessage,
  initialLockState,
  nextLockStateOnClose,
  nextLockStateOnReopen,
  nextLockStateOnYearClose,
  prepareProtectedSave,
} from '@/lib/lock-guard';
import { rethrowPermissionDenied } from '@/lib/utils/errors';
import { reportError } from '@/lib/monitoring';

export const COL = {
  users: 'users',
  orgs: 'orgs',
  clients: 'clients',
  accounts: 'chart_of_accounts',
  rules: 'classification_rules',
  transactions: 'transactions',
  batches: 'import_batches',
  locks: 'period_locks',
  lockState: 'lock_state',
  audit: 'audit_log',
  bankAccounts: 'bank_accounts',
  openings: 'opening_balances',
  requests: 'client_requests',
  journalEntries: 'journal_entries',
  journalCounters: 'journal_counters',
  snapshots: 'period_snapshots',
  notes: 'explanatory_notes',
  invoices: 'invoice_summaries',
  fixedAssets: 'fixed_assets',
  checklists: 'closing_checklists',
  prepaid: 'prepaid_expenses',
  financing: 'financing_contracts',
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
/**
 * Reaberturas por lote na exclusão da empresa: cada uma consulta o fechamento e o próprio
 * registro de auditoria (2 documentos); com o perfil e a empresa, 8 ficam em 18 de 20.
 */
const REOPENS_PER_BATCH = 8;
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

  /** Executa grupos em lotes de até 500 escritas e no máximo `monthsPerBatch` competências. */
  async function run(groups: readonly Group[], monthsPerBatch = MONTHS_PER_BATCH) {
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
      if (writes.length + g.writes.length > BATCH_LIMIT || (newMonth && months.size >= monthsPerBatch)) await flush();
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

  // A data de auditoria e a do fechamento são do servidor (as regras exigem `request.time`),
  // não do relógio do computador; na leitura voltam a texto ISO (toISO).
  const auditData = (entry: AuditEntry): DocumentData => ({ ...stamp(entry), at: serverTimestamp() });
  const lockData = (lock: PeriodLock): DocumentData => ({ ...stamp(lock), lockedAt: serverTimestamp() });
  const auditFrom = (d: { id: string; data: () => DocumentData }): AuditEntry => {
    const data = d.data();
    return { ...(data as AuditEntry), id: d.id, at: toISO(data.at) };
  };
  const invoiceFrom = (d: { id: string; data: () => DocumentData | undefined }): InvoiceSummary => {
    const data = (d.data() ?? {}) as InvoiceSummary;
    return { ...data, id: d.id, status: data.status ?? 'AUTHORIZED', cfops: data.cfops ?? [], installments: data.installments ?? [] };
  };
  const lockFrom = (d: { id: string; data: () => DocumentData }): PeriodLock => {
    const data = d.data();
    return { ...(data as PeriodLock), id: d.id, lockedAt: toISO(data.lockedAt) };
  };

  const auditWrite = (entry: AuditEntry) => (b: WriteBatch) => b.set(doc(db, COL.audit, entry.id), auditData(entry));

  async function readLockState(clientId: string): Promise<LockState | null> {
    const snap = await getDoc(doc(db, COL.lockState, clientId));
    return snap.exists() ? ({ ...(snap.data() as LockState), id: snap.id }) : null;
  }

  /** Grupos de um ChangeSet: cada patch vai junto da sua auditoria, ordenados por competência. */
  function changeGroups({ patches, rules = [], deleteRuleIds = [], audits }: ChangeSet): Group[] {
    const groups: Group[] = [
      ...rules.map((rule) => single((b) => b.set(doc(db, COL.rules, rule.id), stamp(rule), { merge: true }))),
      ...deleteRuleIds.map((id) => single((b) => b.delete(doc(db, COL.rules, id)))),
    ];
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

  /**
   * Cadastro de um documento por cliente (imobilizado, despesas antecipadas) gravado com a
   * auditoria e, se houver, o lançamento a criar (com o próximo número) e/ou a excluir, tudo junto.
   */
  async function saveRegister(name: string, register: { clientId: string }, audit: AuditEntry, journal: FixedAssetJournalChange): Promise<JournalEntry | null> {
    const ref = doc(db, name, register.clientId);
    // Itens aninhados: campos `undefined` saem pelo JSON (o Firestore os recusa).
    const data = stamp(JSON.parse(JSON.stringify({ ...register, id: register.clientId })) as object);
    const removed = journal.deleteId ? doc(db, COL.journalEntries, journal.deleteId) : null;
    if (journal.create) {
      return createJournalWith(journal.create, audit, (t) => {
        t.set(ref, data);
        if (removed) t.delete(removed);
      });
    }
    const b = writeBatch(db);
    b.set(ref, data);
    if (removed) b.delete(removed);
    auditWrite(audit)(b);
    await b.commit();
    return null;
  }

  /**
   * Grava um lançamento manual novo com o próximo número da sequência do cliente e, na mesma
   * transação, o registro de auditoria e as escritas de `extra` (ex.: o cadastro do imobilizado
   * na baixa de um bem).
   */
  async function createJournalWith(draft: JournalEntryDraft, audit?: AuditEntry, extra?: (t: Transaction) => void): Promise<JournalEntry> {
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
          addReads(1);
          seen = counter.exists() ? Number(counter.data().last) || 0 : null;
          const entry: JournalEntry = { ...draft, entryNumber: (seen ?? seed) + 1 };
          t.set(counterRef, stamp({ id: draft.clientId, clientId: draft.clientId, last: entry.entryNumber }));
          t.set(doc(db, COL.journalEntries, entry.id), stamp(entry));
          if (audit) t.set(doc(db, COL.audit, audit.id), auditData(audit));
          extra?.(t);
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
  }


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
      const clientRef = doc(db, COL.clients, client.id);
      if (!(await getDoc(clientRef)).exists()) {
        const b = writeBatch(db);
        b.set(clientRef, stamp(client));
        b.set(doc(db, COL.lockState, client.id), stamp(initialLockState(client.id)));
        await b.commit();
        return;
      }
      // Substitui o documento: campos apagados no formulário (ex.: CPF do representante) somem de fato.
      await setDoc(clientRef, stamp(client));
    },
    async updateClientDaybook(clientId, daybook) {
      // Só este campo: o resto do cadastro fica como está (saveClient substituiria tudo).
      await updateDoc(doc(db, COL.clients, clientId), { daybook: { ...daybook } });
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
          const lock = lockFrom(d);
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
        }),
        // Cada reabertura consulta o fechamento e o registro dela: 2 documentos por competência.
        REOPENS_PER_BATCH
      );
      for (const name of [COL.transactions, COL.journalEntries, COL.snapshots, COL.rules, COL.accounts, COL.batches, COL.bankAccounts, COL.openings, COL.notes, COL.invoices, COL.requests, COL.fixedAssets, COL.checklists, COL.prepaid, COL.financing]) {
        await deleteByClient(name, clientId);
      }
      await deleteDoc(clientRef);
      // A sequência dos lançamentos manuais e o controle de fechamentos só podem ser apagados
      // depois da empresa (regra): enquanto a empresa existe, nenhum contador volta atrás.
      await deleteByClient(COL.journalCounters, clientId);
      await deleteByClient(COL.lockState, clientId);
    },

    /* ── Plano de contas ──────────────────────────────────────────────── */
    async listAccounts(clientId) {
      const snap = await getDocs(scoped(COL.accounts, where('clientId', 'in', [clientId, 'global'])));
      return snap.docs.map((d) => ({ ...(d.data() as ChartAccount), id: d.id })).sort(byCode);
    },
    async saveAccount(account) {
      const ref = doc(db, COL.accounts, account.id);
      const [existingSnap, ls] = await Promise.all([
        getDoc(ref),
        account.clientId === 'global' ? Promise.resolve(null) : readLockState(account.clientId),
      ]);
      const existing = existingSnap.exists() ? ({ ...(existingSnap.data() as ChartAccount), id: existingSnap.id }) : null;
      const prepared = prepareProtectedSave('chart_of_accounts', existing, account, ls);
      try {
        await setDoc(ref, stamp(prepared));
      } catch (e) {
        rethrowPermissionDenied(e, frozenMessage('chart_of_accounts', { isGlobal: account.clientId === 'global' }));
      }
    },
    async deleteAccount(accountId, audit) {
      const b = writeBatch(db);
      b.delete(doc(db, COL.accounts, accountId));
      if (audit) auditWrite(audit)(b);
      try {
        await b.commit();
      } catch (e) {
        rethrowPermissionDenied(e, 'Somente o administrador do escritório pode excluir contas do plano.');
      }
    },
    async insertAccounts(accounts) {
      if (!accounts.length) return;
      const clientIds = [...new Set(accounts.map((a) => a.clientId).filter((id) => id !== 'global'))];
      const lockStates = new Map<string, LockState | null>(
        await Promise.all(clientIds.map(async (id) => [id, await readLockState(id)] as const))
      );
      const prepared = accounts.map((acc) =>
        prepareProtectedSave('chart_of_accounts', null, acc, acc.clientId === 'global' ? null : lockStates.get(acc.clientId))
      );
      await run(prepared.map((acc) => single((b) => b.set(doc(db, COL.accounts, acc.id), stamp(acc)))));
    },
    async saveChartSetup({ accounts, bankAccounts }) {
      if (accounts.length + bankAccounts.length > BATCH_LIMIT) throw new Error('Alteração do plano maior que o limite de uma gravação.');
      if (!accounts.length && !bankAccounts.length) return;
      const clientIds = [
        ...new Set(
          [...accounts.map((a) => a.clientId), ...bankAccounts.map((bk) => bk.clientId)].filter((id) => id !== 'global')
        ),
      ];
      const [lockStateEntries, accountSnaps, bankSnaps] = await Promise.all([
        Promise.all(clientIds.map(async (id) => [id, await readLockState(id)] as const)),
        Promise.all(accounts.map((a) => getDoc(doc(db, COL.accounts, a.id)))),
        Promise.all(bankAccounts.map((bk) => getDoc(doc(db, COL.bankAccounts, bk.id)))),
      ]);
      const lockStates = new Map<string, LockState | null>(lockStateEntries);
      const preparedAccounts = accounts.map((acc, i) => {
        const snap = accountSnaps[i];
        const existing = snap.exists() ? ({ ...(snap.data() as ChartAccount), id: snap.id }) : null;
        return prepareProtectedSave(
          'chart_of_accounts',
          existing,
          acc,
          acc.clientId === 'global' ? null : lockStates.get(acc.clientId)
        );
      });
      const preparedBanks = bankAccounts.map((bank, i) => {
        const snap = bankSnaps[i];
        const existing = snap.exists() ? ({ ...(snap.data() as BankAccount), id: snap.id }) : null;
        return prepareProtectedSave('bank_accounts', existing, bank, lockStates.get(bank.clientId));
      });
      const b = writeBatch(db);
      // Substitui os documentos: campos opcionais removidos somem de fato e `lockSeq` fica exato.
      for (const acc of preparedAccounts) b.set(doc(db, COL.accounts, acc.id), stamp(acc));
      for (const bank of preparedBanks) b.set(doc(db, COL.bankAccounts, bank.id), stamp(bank));
      try {
        await b.commit();
      } catch (e) {
        rethrowPermissionDenied(e, frozenMessage('bank_accounts'));
      }
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
      try {
        await deleteDoc(doc(db, COL.rules, ruleId));
      } catch (e) {
        rethrowPermissionDenied(e, 'Operadores só podem excluir regras criadas por si mesmos.');
      }
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
    async countTransactionsByStatus(clientId, status) {
      // Mesma consulta de `listPendingTransactions` (só igualdades): uma leitura a cada mil.
      const snap = await getCountFromServer(scoped(COL.transactions, where('clientId', '==', clientId), where('status', '==', status)));
      return snap.data().count;
    },
    async oldestTransactionDate(clientId, status) {
      // Índice (orgId, clientId, status, date asc) em firestore.indexes.json.
      const snap = await getDocs(scoped(COL.transactions, where('clientId', '==', clientId), where('status', '==', status), orderBy('date', 'asc'), limit(1)));
      return snap.empty ? null : ((snap.docs[0].data() as BankTransaction).date ?? null);
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
            reportError(innerErr, { area: 'importacao', op: 'marcar lote como falho' });
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
      const snap = await getDocs(scoped(COL.transactions, where('clientId', '==', batch.clientId), where('importBatchId', '==', batch.id)));
      return snap.docs.map(txFrom).sort((a, b) => a.date.localeCompare(b.date));
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
    async saveOpeningBalances(balances, audit, related = {}) {
      const banks = related.bankAccounts ?? [];
      const accounts = related.accounts ?? [];
      if (banks.length + accounts.length + 2 > BATCH_LIMIT) throw new Error('Abertura maior que o limite de uma gravação.');
      const clientId = balances.clientId;
      const openingRef = doc(db, COL.openings, clientId);
      const [openingSnap, ls, accountSnaps, bankSnaps] = await Promise.all([
        getDoc(openingRef),
        readLockState(clientId),
        Promise.all(accounts.map((a) => getDoc(doc(db, COL.accounts, a.id)))),
        Promise.all(banks.map((bk) => getDoc(doc(db, COL.bankAccounts, bk.id)))),
      ]);
      const existingOpening = openingSnap.exists() ? ({ ...(openingSnap.data() as OpeningBalances), id: openingSnap.id }) : null;
      const preparedOpening = prepareProtectedSave('opening_balances', existingOpening, { ...balances, id: clientId }, ls);
      const preparedAccounts = accounts.map((acc, i) => {
        const snap = accountSnaps[i];
        const existing = snap.exists() ? ({ ...(snap.data() as ChartAccount), id: snap.id }) : null;
        return prepareProtectedSave('chart_of_accounts', existing, acc, acc.clientId === 'global' ? null : ls);
      });
      const preparedBanks = banks.map((bank, i) => {
        const snap = bankSnaps[i];
        const existing = snap.exists() ? ({ ...(snap.data() as BankAccount), id: snap.id }) : null;
        return prepareProtectedSave('bank_accounts', existing, bank, ls);
      });
      const b = writeBatch(db);
      for (const acc of preparedAccounts) b.set(doc(db, COL.accounts, acc.id), stamp(acc));
      // Substitui o documento, como `saveBankAccount`.
      for (const bank of preparedBanks) b.set(doc(db, COL.bankAccounts, bank.id), stamp(bank));
      b.set(openingRef, stamp(preparedOpening));
      auditWrite(audit)(b);
      try {
        await b.commit();
      } catch (e) {
        rethrowPermissionDenied(e, frozenMessage('opening_balances', { firstTime: !existingOpening }));
      }
    },

    /* ── Contas bancárias ─────────────────────────────────────────────── */
    async listBankAccounts(clientId) {
      const snap = await getDocs(scoped(COL.bankAccounts, where('clientId', '==', clientId)));
      return snap.docs.map((d) => ({ ...(d.data() as BankAccount), id: d.id }));
    },
    async saveBankAccount(account) {
      const ref = doc(db, COL.bankAccounts, account.id);
      const [existingSnap, ls] = await Promise.all([getDoc(ref), readLockState(account.clientId)]);
      const existing = existingSnap.exists() ? ({ ...(existingSnap.data() as BankAccount), id: existingSnap.id }) : null;
      const prepared = prepareProtectedSave('bank_accounts', existing, account, ls);
      try {
        // Substitui o documento: vínculo ou saldo inicial removidos somem de fato.
        await setDoc(ref, stamp(prepared));
      } catch (e) {
        rethrowPermissionDenied(e, frozenMessage('bank_accounts'));
      }
    },

    /* ── Fechamento de período ────────────────────────────────────────── */
    async listPeriodLocks(clientId) {
      const snap = await getDocs(scoped(COL.locks, where('clientId', '==', clientId)));
      return snap.docs.map(lockFrom);
    },
    async getLockState(clientId) {
      return readLockState(clientId);
    },
    // As regras exigem o registro de auditoria e o avanço do lock_state na mesma gravação.
    async closePeriod(lock, audit) {
      const nextLs = nextLockStateOnClose(await readLockState(lock.clientId), lock.id);
      const b = writeBatch(db);
      b.set(doc(db, COL.locks, lock.id), lockData(lock));
      b.set(doc(db, COL.lockState, lock.clientId), stamp(nextLs));
      auditWrite({ ...audit, id: periodAuditId(lock, 'close') })(b);
      await b.commit();
    },
    async reopenPeriod(lock, audit) {
      const nextLs = nextLockStateOnReopen(await readLockState(lock.clientId), lock.id);
      const b = writeBatch(db);
      b.delete(doc(db, COL.locks, lock.id));
      b.set(doc(db, COL.lockState, lock.clientId), stamp(nextLs));
      auditWrite({ ...audit, id: periodAuditId(lock, 'reopen') })(b);
      try {
        await b.commit();
      } catch (e) {
        rethrowPermissionDenied(e, 'Somente o administrador do escritório pode reabrir competências.');
      }
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
      return snap.docs.map(auditFrom);
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

    async renewClientRequest(requestId, expiresAtMs) {
      await updateDoc(doc(db, COL.requests, requestId), { status: 'OPEN', expiresAtMs: Math.trunc(expiresAtMs) });
    },
    async markClientRequestsSeen(items) {
      if (!items.length) return;
      await run(items.map(({ id, seenAt }) => single((b) => b.update(doc(db, COL.requests, id), { seenAt }))));
    },
    async listOpenOrgClientRequests() {
      const snap = await getDocs(scoped(COL.requests, where('status', '==', 'OPEN')));
      return snap.docs.map((d) => ({ ...(d.data() as ClientRequest), id: d.id })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    /* ── Lançamentos manuais de fechamento (Diário Avulso) ─────────────── */
    async listJournalEntries(clientId, range) {
      // Com `range`, índice composto: (orgId, clientId, date).
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
      return createJournalWith(draft, audit);
    },
    async updateJournalEntry(entry, audit) {
      assertValidJournalEntry(entry);
      const b = writeBatch(db);
      b.set(doc(db, COL.journalEntries, entry.id), stamp(entry));
      if (audit) auditWrite(audit)(b);
      await b.commit();
    },
    async deleteJournalEntry(entryId, audit) {
      const b = writeBatch(db);
      b.delete(doc(db, COL.journalEntries, entryId));
      if (audit) auditWrite(audit)(b);
      await b.commit();
    },

    /* ── Encerramento do exercício ────────────────────────────────────── */
    // Transação (não um lote simples) porque os números saem do contador lido nela. As regras
    // aceitam o contador saltar o bloco inteiro quando o YEAR_CLOSE nasce na mesma gravação.
    async closeYear(drafts, audit) {
      if (drafts.length === 0) throw new Error('Nada a encerrar.');
      if (drafts.length + 3 > BATCH_LIMIT) throw new Error('Encerramento maior que o limite de uma gravação.');
      drafts.forEach(assertValidJournalEntry);
      const clientId = drafts[0].clientId;
      const counterRef = doc(db, COL.journalCounters, clientId);
      const lockStateRef = doc(db, COL.lockState, clientId);
      let seed = 0;
      if (!(await getDoc(counterRef)).exists()) {
        const snap = await getDocs(scoped(COL.journalEntries, where('clientId', '==', clientId)));
        seed = snap.docs.reduce((max, d) => Math.max(max, Number(d.data().entryNumber) || 0), 0);
      }
      return runTransaction(db, async (t) => {
        const [counter, lockStateSnap] = await Promise.all([t.get(counterRef), t.get(lockStateRef)]);
        addReads(2);
        const currentLs = lockStateSnap.exists() ? ({ ...(lockStateSnap.data() as LockState), id: lockStateSnap.id }) : null;
        const nextLs = nextLockStateOnYearClose(currentLs, audit.id);
        const base = counter.exists() ? Number(counter.data().last) || 0 : seed;
        const entries: JournalEntry[] = drafts.map((d, i) => ({ ...d, entryNumber: base + i + 1, closingAuditId: audit.id }));
        t.set(counterRef, stamp({ id: clientId, clientId, last: base + entries.length, closingAudit: audit.id }));
        t.set(lockStateRef, stamp(nextLs));
        for (const e of entries) t.set(doc(db, COL.journalEntries, e.id), stamp(e));
        t.set(doc(db, COL.audit, audit.id), auditData(audit));
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

    /* ── Notas fiscais (resumos dos XML) ──────────────────────────────── */
    async listInvoices(clientId, range) {
      // Índice composto: (orgId, clientId, issueDate).
      const constraints: QueryConstraint[] = [where('clientId', '==', clientId)];
      if (range) constraints.push(where('issueDate', '>=', range.start), where('issueDate', '<=', range.end));
      const snap = await getDocs(scoped(COL.invoices, ...constraints));
      return snap.docs.map(invoiceFrom).sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number, undefined, { numeric: true }));
    },
    async saveInvoices(invoices) {
      // Mescla, sem ler antes: os vínculos ficam como estão, e a situação só é gravada quando
      // é cancelamento (sem o campo, a nota é autorizada) — reimportar não "descancela".
      await run(
        invoices.map((inv) => {
          const { links: _links, status, ...rest } = inv;
          void _links;
          const data = stamp(status === 'CANCELLED' ? { ...rest, status } : rest);
          return single((b) => b.set(doc(db, COL.invoices, inv.id), data, { merge: true }));
        })
      );
    },
    async cancelInvoices(clientId, keys) {
      const refs = keys.map((k) => doc(db, COL.invoices, invoiceId(clientId, k)));
      const snaps = await Promise.all(refs.map(async (ref) => {
        try {
          return await getDoc(ref);
        } catch {
          return null; // nota de outro escritório ou inexistente com outra dona: ignora
        }
      }));
      const existing = refs.filter((_, i) => snaps[i]?.exists());
      await run(existing.map((ref) => single((b) => b.update(ref, { status: 'CANCELLED' }))));
      return existing.length;
    },
    async linkInvoice(id, link) {
      const ref = doc(db, COL.invoices, id);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error('Nota fiscal não encontrada.');
      const current = invoiceFrom(snap);
      const links = [...(current.links ?? []).filter((l) => l.transactionId !== link.transactionId), clean(link) as typeof link];
      await updateDoc(ref, { links });
      return { ...current, links };
    },
    async deleteInvoice(id) {
      await deleteDoc(doc(db, COL.invoices, id));
    },

    /* ── Imobilizado ──────────────────────────────────────────────────── */
    async getFixedAssets(clientId) {
      const snap = await getDoc(doc(db, COL.fixedAssets, clientId));
      return snap.exists() ? ({ ...(snap.data() as FixedAssetRegister), id: snap.id }) : null;
    },
    async saveFixedAssets(register, audit, journal = {}) {
      return saveRegister(COL.fixedAssets, register, audit, journal);
    },

    /* ── Despesas antecipadas ─────────────────────────────────────────── */
    async getPrepaidExpenses(clientId) {
      const snap = await getDoc(doc(db, COL.prepaid, clientId));
      return snap.exists() ? ({ ...(snap.data() as PrepaidRegister), id: snap.id }) : null;
    },
    async savePrepaidExpenses(register, audit, journal = {}) {
      return saveRegister(COL.prepaid, register, audit, journal);
    },

    /* ── Empréstimos, financiamentos e parcelamentos ─────────────────── */
    async getFinancingContracts(clientId) {
      const snap = await getDoc(doc(db, COL.financing, clientId));
      return snap.exists() ? ({ ...(snap.data() as FinancingRegister), id: snap.id }) : null;
    },
    async saveFinancingContracts(register, audit, journal = {}) {
      return saveRegister(COL.financing, register, audit, journal);
    },

    /* ── Checklist do fechamento ──────────────────────────────────────── */
    async getClosingChecklist(clientId, year) {
      const snap = await getDoc(doc(db, COL.checklists, `${clientId}_${year}`));
      return snap.exists() ? ({ ...(snap.data() as ClosingChecklist), id: snap.id }) : null;
    },
    async saveClosingChecklist(checklist) {
      const id = `${checklist.clientId}_${checklist.year}`;
      // Itens aninhados: campos `undefined` saem pelo JSON (o Firestore os recusa).
      await setDoc(doc(db, COL.checklists, id), stamp(JSON.parse(JSON.stringify({ ...checklist, id })) as ClosingChecklist));
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
