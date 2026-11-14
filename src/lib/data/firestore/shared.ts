import {
  collection,
  deleteField,
  doc,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
  type Query,
  type QueryConstraint,
  type WriteBatch,
} from 'firebase/firestore';
import type { AuditEntry, BankTransaction, ChartAccount, InvoiceSummary, LockState, PeriodLock } from '@/types/firestore';
import type { ChangeSet } from '@/lib/data/repository';
import { getDoc, getDocs } from '@/lib/data/counted-reads';
import { monthOf } from '@/lib/periods';

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
  resultSummaries: 'result_summaries',
  notes: 'explanatory_notes',
  invoices: 'invoice_summaries',
  fixedAssets: 'fixed_assets',
  checklists: 'closing_checklists',
  prepaid: 'prepaid_expenses',
  financing: 'financing_contracts',
  investments: 'investment_accounts',
  stock: 'stock_controls',
  payroll: 'payroll_registers',
  fees: 'fee_registers',
  obligations: 'obligation_checks',
} as const;

/** Limites do Firestore. */
export const BATCH_LIMIT = 500;
export const IN_LIMIT = 30;
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
export const REOPENS_PER_BATCH = 8;
/** Tentativas de obter o próximo número de lançamento manual quando há disputa entre usuários. */
export const JOURNAL_NUMBER_ATTEMPTS = 5;

export const chunk = <T,>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** Firestore rejeita campos `undefined`. */
export const clean = <T extends object>(obj: T): DocumentData =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

/** Converte Timestamp (ou ausência) em ISO string. */
export function toISO(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toDate' in value) {
    const toDate = (value as { toDate: () => Date }).toDate;
    if (typeof toDate === 'function') return toDate.call(value).toISOString();
  }
  return '';
}

export const byCode = (a: ChartAccount, b: ChartAccount) => a.code.localeCompare(b.code, undefined, { numeric: true });

/**
 * Grupo indivisível de escritas (ex.: alteração do lançamento + seu registro de auditoria)
 * e a competência que ele toca — nunca é partido entre dois lotes.
 */
export interface Group {
  month?: string;
  writes: ((b: WriteBatch) => void)[];
}
export const single = (write: (b: WriteBatch) => void, month?: string): Group => ({ month, writes: [write] });

type Snap = { id: string; data: () => DocumentData | undefined };

/** O que todos os módulos do repositório Firestore compartilham: conexão, escopo do escritório e ajudantes de gravação. */
export interface FirestoreContext {
  db: Firestore;
  getOrgId: () => string;
  /** Consulta já filtrada pelo escritório (exigido pelas regras). */
  scoped: (name: string, ...constraints: QueryConstraint[]) => Query<DocumentData>;
  /** Carimba `orgId` e tira campos `undefined`. */
  stamp: <T extends object>(data: T) => DocumentData;
  /** Executa grupos em lotes de até 500 escritas e no máximo `monthsPerBatch` competências. */
  run: (groups: readonly Group[], monthsPerBatch?: number) => Promise<void>;
  deleteByClient: (name: string, clientId: string) => Promise<void>;
  auditData: (entry: AuditEntry) => DocumentData;
  lockData: (lock: PeriodLock) => DocumentData;
  auditFrom: (d: Snap) => AuditEntry;
  invoiceFrom: (d: Snap) => InvoiceSummary;
  lockFrom: (d: Snap) => PeriodLock;
  txFrom: (d: Snap) => BankTransaction;
  auditWrite: (entry: AuditEntry) => (b: WriteBatch) => void;
  readLockState: (clientId: string) => Promise<LockState | null>;
  /** Grupos de um ChangeSet: cada patch vai junto da sua auditoria, ordenados por competência. */
  changeGroups: (changes: ChangeSet) => Group[];
  /** Documento único por chave (cadastros por empresa): o dado com o id, ou null. */
  getById: <T extends object>(name: string, id: string) => Promise<T | null>;
}

export function createFirestoreContext(db: Firestore, getOrgId: () => string): FirestoreContext {
  const scoped = (name: string, ...constraints: QueryConstraint[]) =>
    query(collection(db, name), where('orgId', '==', getOrgId()), ...constraints);

  const stamp = <T extends object>(data: T): DocumentData => clean({ ...data, orgId: getOrgId() });

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
  const auditFrom = (d: Snap): AuditEntry => {
    const data = d.data() ?? {};
    return { ...(data as AuditEntry), id: d.id, at: toISO(data.at) };
  };
  const invoiceFrom = (d: Snap): InvoiceSummary => {
    const data = (d.data() ?? {}) as InvoiceSummary;
    return { ...data, id: d.id, status: data.status ?? 'AUTHORIZED', cfops: data.cfops ?? [], installments: data.installments ?? [] };
  };
  const lockFrom = (d: Snap): PeriodLock => {
    const data = d.data() ?? {};
    return { ...(data as PeriodLock), id: d.id, lockedAt: toISO(data.lockedAt) };
  };
  const txFrom = (d: Snap): BankTransaction => ({ ...(d.data() as BankTransaction), id: d.id });

  const auditWrite = (entry: AuditEntry) => (b: WriteBatch) => b.set(doc(db, COL.audit, entry.id), auditData(entry));

  async function readLockState(clientId: string): Promise<LockState | null> {
    const snap = await getDoc(doc(db, COL.lockState, clientId));
    return snap.exists() ? { ...(snap.data() as LockState), id: snap.id } : null;
  }

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

  async function getById<T extends object>(name: string, id: string): Promise<T | null> {
    const snap = await getDoc(doc(db, name, id));
    return snap.exists() ? ({ ...(snap.data() as T), id: snap.id } as T) : null;
  }

  return {
    db,
    getOrgId,
    scoped,
    stamp,
    run,
    deleteByClient,
    auditData,
    lockData,
    auditFrom,
    invoiceFrom,
    lockFrom,
    txFrom,
    auditWrite,
    readLockState,
    changeGroups,
    getById,
  };
}
