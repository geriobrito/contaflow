import type { AuditEntry, BankTransaction, ClassificationRule, ChartAccount, JournalCounter, JournalEntry, LockState, PeriodLock } from '@/types/firestore';
import { type ChangeSet, type FixedAssetJournalChange, type RegisterSaveOptions, resolveNextRegisterVersion } from '@/lib/data/repository';
import { isAdminSession, peekActor } from '@/lib/data/scope';
import { assertValidJournalEntry } from '@/lib/journal';
import { canDeleteRule } from '@/lib/lock-guard';
import { applyPatch } from '@/lib/transitions';

/** Subconjunto de `Storage` usado — opera com cache síncrono em memória e persistência em IndexedDB/localStorage. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
  /** Indica se o cache síncrono já está integralmente hidratado no momento da chamada. */
  readonly isHydrated?: boolean;
  /** Promessa opcional resolvida quando a hidratação inicial do IndexedDB no boot termina. */
  readonly ready?: Promise<void>;
}

export const LOCAL_KEYS = {
  clients: 'contaflow_clients',
  accounts: 'contaflow_accounts',
  transactions: 'contaflow_transactions',
  rules: 'contaflow_rules',
  batches: 'contaflow_batches',
  locks: 'contaflow_period_locks',
  lockState: 'contaflow_lock_state',
  audit: 'contaflow_audit_log',
  org: 'contaflow_org',
  bankAccounts: 'contaflow_bank_accounts',
  openings: 'contaflow_opening_balances',
  requests: 'contaflow_client_requests',
  journalEntries: 'contaflow_journal_entries',
  journalCounters: 'contaflow_journal_counters',
  snapshots: 'contaflow_period_snapshots',
  resultSummaries: 'contaflow_result_summaries',
  notes: 'contaflow_explanatory_notes',
  invoices: 'contaflow_invoice_summaries',
  fixedAssets: 'contaflow_fixed_assets',
  checklists: 'contaflow_closing_checklists',
  prepaid: 'contaflow_prepaid_expenses',
  financing: 'contaflow_financing_contracts',
  investments: 'contaflow_investment_accounts',
  stock: 'contaflow_stock_controls',
  payroll: 'contaflow_payroll_registers',
  fees: 'contaflow_fee_registers',
  obligations: 'contaflow_obligation_checks',
} as const;

/** orgId gravado nos documentos do modo local (um único usuário por navegador). */
export const LOCAL_ORG_ID = 'local';

export const byCode = (a: ChartAccount, b: ChartAccount) => a.code.localeCompare(b.code, undefined, { numeric: true });
export const byDateDesc = (a: BankTransaction, b: BankTransaction) => b.date.localeCompare(a.date);

/** O que todos os módulos do repositório local compartilham: leitura/gravação das listas e as validações comuns. */
export interface LocalContext {
  /** Espera a hidratação inicial do IndexedDB (no boot), se ainda não terminou. */
  ready: () => Promise<void>;
  read: <T>(key: string) => T[];
  write: <T>(key: string, items: readonly T[]) => void;
  /** Mescla campos no item de mesmo id (ou inclui). */
  upsert: <T extends { id: string }>(key: string, item: T) => void;
  remove: <T extends { id: string }>(key: string, id: T['id']) => void;
  /** Substitui o item de mesmo id (ou inclui). */
  replace: <T extends { id: string }>(key: string, item: T) => void;
  stamp: <T extends object>(x: T) => T;
  appendAudit: (...entries: readonly AuditEntry[]) => void;
  /** Cadastro de um documento por cliente com auditoria, versão otimista e lançamentos atômicos. */
  saveRegister: <T extends { clientId: string; version?: number }>(
    key: string,
    register: T,
    audit: AuditEntry,
    journal: FixedAssetJournalChange,
    options?: RegisterSaveOptions
  ) => Promise<JournalEntry | null>;
  lockedMonthsOf: (clientId: string) => string[];
  readLockState: (clientId: string) => LockState;
  /** Valida tudo antes de gravar (equivalente à atomicidade do writeBatch). */
  applyChanges: (changes: ChangeSet) => void;
  /** Recusa (permission-denied) se algum lançamento cai em competência fechada. */
  assertMonthsOpen: (items: readonly { clientId: string; date: string }[]) => void;
  /** O item é do cliente ou do plano global. */
  inScope: (owner: string, clientId: string) => boolean;
  /** Último número de lançamento manual do cliente (contador ou maior número já usado). */
  lastJournalNumber: (clientId: string, entries: readonly JournalEntry[], counters: readonly JournalCounter[]) => number;
}

export function createLocalContext(store: KeyValueStore): LocalContext {
  let hydrated = store.isHydrated ?? !store.ready;
  if (!hydrated && store.ready) {
    void store.ready.finally(() => {
      hydrated = true;
    });
  }
  const ready = async () => {
    if (!hydrated) await store.ready;
  };

  function read<T>(key: string): T[] {
    const raw = store.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error(`Armazenamento local corrompido em "${key}".`);
    return parsed as T[];
  }
  function write<T>(key: string, items: readonly T[]): void {
    store.setItem(key, JSON.stringify(items));
  }
  function upsert<T extends { id: string }>(key: string, item: T): void {
    const items = read<T>(key);
    const i = items.findIndex((x) => x.id === item.id);
    if (i >= 0) items[i] = { ...items[i], ...item };
    else items.push(item);
    write(key, items);
  }
  function remove<T extends { id: string }>(key: string, id: T['id']): void {
    write(
      key,
      read<T>(key).filter((x) => x.id !== id)
    );
  }
  function replace<T extends { id: string }>(key: string, item: T): void {
    const items = read<T>(key);
    const i = items.findIndex((x) => x.id === item.id);
    if (i >= 0) items[i] = item;
    else items.push(item);
    write(key, items);
  }
  const stamp = <T extends object>(x: T): T => ({ ...x, orgId: LOCAL_ORG_ID });
  const appendAudit = (...entries: readonly AuditEntry[]) => write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), ...entries.map(stamp)]);

  const lastJournalNumber = (clientId: string, entries: readonly JournalEntry[], counters: readonly JournalCounter[]) =>
    counters.find((c) => c.clientId === clientId)?.last ??
    entries.filter((j) => j.clientId === clientId).reduce((max, j) => Math.max(max, j.entryNumber || 0), 0);

  async function saveRegister<T extends { clientId: string; version?: number }>(
    key: string,
    register: T,
    audit: AuditEntry,
    journal: FixedAssetJournalChange,
    options?: RegisterSaveOptions
  ): Promise<JournalEntry | null> {
    const id = register.clientId;
    const deleteIds = Array.from(new Set([...(journal.deleteId ? [journal.deleteId] : []), ...(journal.deleteIds ?? [])]));
    if (deleteIds.length > 0 && !isAdminSession()) {
      throw Object.assign(new Error('Somente administradores podem excluir lançamentos do Diário.'), {
        code: 'permission-denied',
      });
    }
    if (journal.create) assertValidJournalEntry(journal.create);
    if (journal.replace) assertValidJournalEntry(journal.replace.draft);

    const regs = read<T>(key);
    const existing = regs.find((r) => r.clientId === id) ?? null;
    const nextVersion = resolveNextRegisterVersion(register, existing as { version?: unknown; updatedAt?: unknown } | null, options);

    const entries = read<JournalEntry>(LOCAL_KEYS.journalEntries);
    const counters = read<JournalCounter>(LOCAL_KEYS.journalCounters);
    let lastCounter = lastJournalNumber(id, entries, counters);

    const deleteSet = new Set(deleteIds);
    const nextEntries = deleteSet.size > 0 ? entries.filter((j) => !deleteSet.has(j.id)) : [...entries];
    let resultEntry: JournalEntry | null = null;
    let counterTouched = false;

    if (journal.replace) {
      const idx = nextEntries.findIndex((j) => j.id === journal.replace!.id);
      if (idx >= 0) {
        const prev = nextEntries[idx];
        resultEntry = stamp({
          ...journal.replace.draft,
          id: journal.replace.id,
          entryNumber: prev.entryNumber,
          ...(prev.createdAt ? { createdAt: prev.createdAt } : {}),
          ...(prev.createdByUid ? { createdByUid: prev.createdByUid } : {}),
        });
        nextEntries[idx] = resultEntry;
      } else {
        lastCounter += 1;
        counterTouched = true;
        resultEntry = stamp({ ...journal.replace.draft, id: journal.replace.id, entryNumber: lastCounter });
        nextEntries.push(resultEntry);
      }
    }

    if (journal.create) {
      lastCounter += 1;
      counterTouched = true;
      resultEntry = stamp({ ...journal.create, entryNumber: lastCounter });
      nextEntries.push(resultEntry);
    }

    if (counterTouched) {
      write(LOCAL_KEYS.journalCounters, [...counters.filter((c) => c.clientId !== id), stamp({ id, clientId: id, last: lastCounter })]);
    }
    if (journal.create || journal.replace || deleteSet.size > 0) {
      write(LOCAL_KEYS.journalEntries, nextEntries);
    }

    const storedReg = stamp({
      ...(JSON.parse(JSON.stringify(register)) as T),
      id,
      version: nextVersion,
    });
    write(key, [...regs.filter((r) => r.clientId !== id), storedReg]);
    appendAudit(audit);
    return resultEntry;
  }

  function lockedMonthsOf(clientId: string): string[] {
    return read<PeriodLock>(LOCAL_KEYS.locks)
      .filter((l) => l.clientId === clientId)
      .map((l) => l.month);
  }

  function readLockState(clientId: string): LockState {
    const stored = read<LockState>(LOCAL_KEYS.lockState).find((s) => s.clientId === clientId);
    if (stored) return stored;
    const count = lockedMonthsOf(clientId).length;
    return { id: clientId, clientId, count, seq: count };
  }

  function applyChanges({ patches, rules = [], deleteRuleIds = [], audits }: ChangeSet): void {
    const txs = read<BankTransaction>(LOCAL_KEYS.transactions);
    const index = new Map(txs.map((t, i) => [t.id, i] as const));
    for (const p of patches) if (!index.has(p.id)) throw new Error(`Lançamento ${p.id} não encontrado.`);
    // Como as regras do Firestore: nada muda em competência fechada.
    assertMonthsOpen(patches.map((p) => txs[index.get(p.id)!]));
    for (const p of patches) {
      const i = index.get(p.id)!;
      txs[i] = applyPatch(txs[i], p);
    }
    const storedRules = read<ClassificationRule>(LOCAL_KEYS.rules);
    const dropped = new Set(deleteRuleIds);
    for (const r of storedRules) {
      if (dropped.has(r.id) && !canDeleteRule(r, peekActor()?.uid, isAdminSession())) {
        throw new Error('Operadores só podem excluir regras criadas por si mesmos.');
      }
    }
    for (const rule of rules) {
      const i = storedRules.findIndex((r) => r.id === rule.id);
      if (i >= 0) {
        const prevAuthor = storedRules[i].createdByUid ?? '';
        const nextAuthor = rule.createdByUid ?? prevAuthor;
        if (nextAuthor !== prevAuthor) throw new Error('A autoria de uma regra não pode ser alterada.');
        storedRules[i] = { ...storedRules[i], ...stamp(rule) };
      } else {
        storedRules.push(stamp(rule));
      }
    }
    write(LOCAL_KEYS.rules, storedRules.filter((r) => !dropped.has(r.id)));
    write(LOCAL_KEYS.transactions, txs);
    appendAudit(...audits);
  }

  const inScope = (owner: string, clientId: string) => owner === clientId || owner === 'global';

  /** Recusa, como as regras do Firestore, alterar ou excluir lançamento de competência fechada. */
  function assertMonthsOpen(items: readonly { clientId: string; date: string }[]): void {
    const locked = new Map<string, Set<string>>();
    for (const it of items) {
      if (!locked.has(it.clientId)) locked.set(it.clientId, new Set(lockedMonthsOf(it.clientId)));
      if (locked.get(it.clientId)!.has(it.date.slice(0, 7))) {
        throw Object.assign(new Error(`Competência ${it.date.slice(5, 7)}/${it.date.slice(0, 4)} fechada: reabra-a para alterar os lançamentos.`), {
          code: 'permission-denied',
        });
      }
    }
  }

  return {
    assertMonthsOpen,
    ready,
    read,
    write,
    upsert,
    remove,
    replace,
    stamp,
    appendAudit,
    saveRegister,
    lockedMonthsOf,
    readLockState,
    applyChanges,
    inScope,
    lastJournalNumber,
  };
}
