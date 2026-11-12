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
  InvestmentRegister,
  StockControl,
  PayrollRegister,
  PrepaidRegister,
  InvoiceSummary,
  JournalCounter,
  JournalEntry,
  LockState,
  OpeningBalances,
  OrgSettings,
  PeriodLock,
  PeriodSnapshot,
} from '@/types/firestore';
import {
  type ChangeSet,
  type DataRepository,
  type DateRange,
  type FixedAssetJournalChange,
  type JournalEntryDraft,
  type LocalClientRestorePayload,
  type RegisterSaveOptions,
  resolveNextRegisterVersion,
} from '@/lib/data/repository';
import { isAdminSession, peekActor } from '@/lib/data/scope';
import { assertValidJournalEntry } from '@/lib/journal';
import { invoiceId } from '@/lib/nfe/import';
import {
  canDeleteRule,
  initialLockState,
  nextLockStateOnClose,
  nextLockStateOnReopen,
  nextLockStateOnYearClose,
  prepareProtectedSave,
} from '@/lib/lock-guard';
import { periodAuditId } from '@/lib/periods';
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
  notes: 'contaflow_explanatory_notes',
  invoices: 'contaflow_invoice_summaries',
  fixedAssets: 'contaflow_fixed_assets',
  checklists: 'contaflow_closing_checklists',
  prepaid: 'contaflow_prepaid_expenses',
  financing: 'contaflow_financing_contracts',
  investments: 'contaflow_investment_accounts',
  stock: 'contaflow_stock_controls',
  payroll: 'contaflow_payroll_registers',
} as const;

/** orgId gravado nos documentos do modo local (um único usuário por navegador). */
export const LOCAL_ORG_ID = 'local';

const byCode = (a: ChartAccount, b: ChartAccount) => a.code.localeCompare(b.code, undefined, { numeric: true });
const byDateDesc = (a: BankTransaction, b: BankTransaction) => b.date.localeCompare(a.date);

/**
 * Repositório de desenvolvimento/demonstração em modo local (IndexedDB + localStorage + cache em memória).
 * Usado apenas quando o Firebase não está configurado — nunca em paralelo ao Firestore.
 * Falhas de leitura ou escrita (JSON corrompido, cota excedida) são propagadas.
 */
export function createLocalRepository(store: KeyValueStore): DataRepository {
  let hydrated = store.isHydrated ?? !store.ready;
  if (!hydrated && store.ready) {
    void store.ready.finally(() => {
      hydrated = true;
    });
  }

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
  function remove<T extends { id: string }>(key: string, id: string): void {
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

  /** Cadastro de um documento por cliente com auditoria, versão otimista e lançamentos atômicos. */
  async function saveRegister<T extends { clientId: string; version?: number }>(
    key: string,
    register: T,
    audit: AuditEntry,
    journal: FixedAssetJournalChange,
    options?: RegisterSaveOptions
  ): Promise<JournalEntry | null> {
    const id = register.clientId;
    const deleteIds = Array.from(
      new Set([...(journal.deleteId ? [journal.deleteId] : []), ...(journal.deleteIds ?? [])])
    );
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
    let lastCounter =
      counters.find((c) => c.clientId === id)?.last ??
      entries.filter((j) => j.clientId === id).reduce((max, j) => Math.max(max, j.entryNumber || 0), 0);

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
      write(LOCAL_KEYS.journalCounters, [
        ...counters.filter((c) => c.clientId !== id),
        stamp({ id, clientId: id, last: lastCounter }),
      ]);
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
    write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), stamp(audit)]);
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

  /** Valida tudo antes de gravar (equivalente à atomicidade do writeBatch). */
  function applyChanges({ patches, rules = [], deleteRuleIds = [], audits }: ChangeSet): void {
    const txs = read<BankTransaction>(LOCAL_KEYS.transactions);
    const index = new Map(txs.map((t, i) => [t.id, i] as const));
    for (const p of patches) if (!index.has(p.id)) throw new Error(`Lançamento ${p.id} não encontrado.`);
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
    write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), ...audits.map(stamp)]);
  }

  const inScope = (owner: string, clientId: string) => owner === clientId || owner === 'global';

  const repo: DataRepository = {
    mode: 'local',

    async getOrgSettings() {
      if (!hydrated) await store.ready;
      return read<OrgSettings>(LOCAL_KEYS.org)[0] ?? null;
    },
    async saveOrgSettings(settings) {
      write(LOCAL_KEYS.org, [stamp(settings)]);
    },

    async listClients() {
      if (!hydrated) await store.ready;
      return read<ClientCompany>(LOCAL_KEYS.clients);
    },
    async saveClient(client) {
      const isNew = !read<ClientCompany>(LOCAL_KEYS.clients).some((c) => c.id === client.id);
      replace(LOCAL_KEYS.clients, stamp(client));
      if (isNew && !read<LockState>(LOCAL_KEYS.lockState).some((s) => s.clientId === client.id)) {
        replace(LOCAL_KEYS.lockState, stamp(initialLockState(client.id)));
      }
    },
    async updateClientDaybook(clientId, daybook) {
      const client = read<ClientCompany>(LOCAL_KEYS.clients).find((c) => c.id === clientId);
      if (!client) throw new Error('Empresa não encontrada.');
      replace(LOCAL_KEYS.clients, { ...client, daybook: { ...daybook } });
    },
    async deleteClient(clientId, actor) {
      if (!clientId || clientId === 'global') throw new Error('Cliente inválido para exclusão.');
      if (!isAdminSession()) throw new Error('Somente o administrador do escritório pode excluir empresas.');
      // A trilha de auditoria é preservada, como no Firestore, e registra os fechamentos removidos.
      const now = new Date().toISOString();
      const reopened = read<PeriodLock>(LOCAL_KEYS.locks)
        .filter((l) => l.clientId === clientId)
        .map((lock): AuditEntry => ({
          id: periodAuditId(lock, 'reopen'),
          clientId,
          action: 'PERIOD_REOPEN',
          actorUid: actor.uid,
          ...(actor.email ? { actorEmail: actor.email } : {}),
          at: now,
          month: lock.month,
          note: 'Competência liberada pela exclusão da empresa',
        }));
      if (reopened.length) write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), ...reopened.map(stamp)]);
      for (const key of [
        LOCAL_KEYS.accounts,
        LOCAL_KEYS.rules,
        LOCAL_KEYS.transactions,
        LOCAL_KEYS.batches,
        LOCAL_KEYS.locks,
        LOCAL_KEYS.lockState,
        LOCAL_KEYS.bankAccounts,
        LOCAL_KEYS.openings,
        LOCAL_KEYS.requests,
        LOCAL_KEYS.journalEntries,
        LOCAL_KEYS.journalCounters,
        LOCAL_KEYS.snapshots,
        LOCAL_KEYS.notes,
        LOCAL_KEYS.invoices,
        LOCAL_KEYS.fixedAssets,
        LOCAL_KEYS.checklists,
        LOCAL_KEYS.prepaid,
        LOCAL_KEYS.financing,
        LOCAL_KEYS.investments,
        LOCAL_KEYS.stock,
        LOCAL_KEYS.payroll,
      ]) {
        write(
          key,
          read<{ clientId: string }>(key).filter((x) => x.clientId !== clientId)
        );
      }
      remove<ClientCompany>(LOCAL_KEYS.clients, clientId);
    },

    async listAccounts(clientId) {
      if (!hydrated) await store.ready;
      return read<ChartAccount>(LOCAL_KEYS.accounts).filter((a) => inScope(a.clientId, clientId)).sort(byCode);
    },
    async saveAccount(account) {
      const existing = read<ChartAccount>(LOCAL_KEYS.accounts).find((a) => a.id === account.id);
      const ls = account.clientId === 'global' ? null : readLockState(account.clientId);
      const months = account.clientId === 'global' ? undefined : lockedMonthsOf(account.clientId);
      const prepared = prepareProtectedSave('chart_of_accounts', existing, account, ls, months);
      replace(LOCAL_KEYS.accounts, stamp(prepared));
    },
    async deleteAccount(accountId, audit) {
      if (!isAdminSession()) throw new Error('Somente o administrador do escritório pode excluir contas do plano.');
      remove<ChartAccount>(LOCAL_KEYS.accounts, accountId);
      if (audit) write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), stamp(audit)]);
    },
    async insertAccounts(accounts) {
      if (!accounts.length) return;
      const prepared = accounts.map((acc) => {
        const ls = acc.clientId === 'global' ? null : readLockState(acc.clientId);
        const months = acc.clientId === 'global' ? undefined : lockedMonthsOf(acc.clientId);
        return stamp(prepareProtectedSave('chart_of_accounts', null, acc, ls, months));
      });
      write(LOCAL_KEYS.accounts, [...read<ChartAccount>(LOCAL_KEYS.accounts), ...prepared]);
    },
    async saveChartSetup({ accounts, bankAccounts }) {
      // Valida e monta as duas listas antes de gravar qualquer uma.
      const storedAccounts = read<ChartAccount>(LOCAL_KEYS.accounts);
      for (const acc of accounts) {
        const i = storedAccounts.findIndex((a) => a.id === acc.id);
        const existing = i >= 0 ? storedAccounts[i] : null;
        const ls = acc.clientId === 'global' ? null : readLockState(acc.clientId);
        const months = acc.clientId === 'global' ? undefined : lockedMonthsOf(acc.clientId);
        const prepared = stamp(prepareProtectedSave('chart_of_accounts', existing, acc, ls, months));
        if (i >= 0) storedAccounts[i] = prepared;
        else storedAccounts.push(prepared);
      }
      const existingBanks = read<BankAccount>(LOCAL_KEYS.bankAccounts);
      const preparedBanks = bankAccounts.map((bank) => {
        const existing = existingBanks.find((b) => b.id === bank.id);
        return stamp(
          prepareProtectedSave('bank_accounts', existing, bank, readLockState(bank.clientId), lockedMonthsOf(bank.clientId))
        );
      });
      const replaced = new Set(bankAccounts.map((b) => b.id));
      const storedBanks = [...existingBanks.filter((b) => !replaced.has(b.id)), ...preparedBanks];
      write(LOCAL_KEYS.accounts, storedAccounts);
      write(LOCAL_KEYS.bankAccounts, storedBanks);
    },

    async listRules(clientId) {
      if (!hydrated) await store.ready;
      return read<ClassificationRule>(LOCAL_KEYS.rules).filter((r) => inScope(r.clientId, clientId));
    },
    async saveRule(rule) {
      const existing = read<ClassificationRule>(LOCAL_KEYS.rules).find((r) => r.id === rule.id);
      if (existing) {
        const prevAuthor = existing.createdByUid ?? '';
        const nextAuthor = rule.createdByUid ?? prevAuthor;
        if (nextAuthor !== prevAuthor) throw new Error('A autoria de uma regra não pode ser alterada.');
      }
      upsert(LOCAL_KEYS.rules, stamp(rule));
    },
    async deleteRule(ruleId) {
      const existing = read<ClassificationRule>(LOCAL_KEYS.rules).find((r) => r.id === ruleId);
      if (existing && !canDeleteRule(existing, peekActor()?.uid, isAdminSession())) {
        throw new Error('Operadores só podem excluir regras criadas por si mesmos.');
      }
      remove<ClassificationRule>(LOCAL_KEYS.rules, ruleId);
    },

    async listTransactions(clientId, range) {
      if (!hydrated) await store.ready;
      return read<BankTransaction>(LOCAL_KEYS.transactions)
        .filter((t) => t.clientId === clientId && (!range || (t.date >= range.start && t.date <= range.end)))
        .sort(byDateDesc);
    },
    async listPendingTransactions(clientId) {
      if (!hydrated) await store.ready;
      return read<BankTransaction>(LOCAL_KEYS.transactions).filter((t) => t.clientId === clientId && t.status === 'PENDING');
    },
    async latestTransactionDate(clientId) {
      if (!hydrated) await store.ready;
      const dates = read<BankTransaction>(LOCAL_KEYS.transactions)
        .filter((t) => t.clientId === clientId)
        .map((t) => t.date);
      return dates.length ? dates.reduce((max, d) => (d > max ? d : max)) : null;
    },
    async countTransactions(clientId, until) {
      if (!hydrated) await store.ready;
      return read<BankTransaction>(LOCAL_KEYS.transactions).filter((t) => t.clientId === clientId && t.date <= until).length;
    },
    async countTransactionsByStatus(clientId, status) {
      if (!hydrated) await store.ready;
      return read<BankTransaction>(LOCAL_KEYS.transactions).filter((t) => t.clientId === clientId && t.status === status).length;
    },
    async oldestTransactionDate(clientId, status) {
      if (!hydrated) await store.ready;
      const dates = read<BankTransaction>(LOCAL_KEYS.transactions)
        .filter((t) => t.clientId === clientId && t.status === status)
        .map((t) => t.date)
        .sort();
      return dates[0] ?? null;
    },
    async isAccountUsedInTransactions(clientId, accountId) {
      if (!hydrated) await store.ready;
      return read<BankTransaction>(LOCAL_KEYS.transactions).some(
        (t) => t.clientId === clientId && (t.accountId === accountId || Boolean(t.isSplit && t.splits?.some((s) => s.accountId === accountId)))
      );
    },
    async findExistingTransactionIds(clientId, ids) {
      if (!hydrated) await store.ready;
      const wanted = new Set(ids);
      return new Set(
        read<BankTransaction>(LOCAL_KEYS.transactions)
          .filter((t) => t.clientId === clientId && wanted.has(t.id))
          .map((t) => t.id)
      );
    },
    async insertTransactions(transactions, batch?: ImportBatch) {
      if (batch) {
        upsert(LOCAL_KEYS.batches, stamp({ ...batch, status: 'PROCESSING' }));
      }
      try {
        write(LOCAL_KEYS.transactions, [...read<BankTransaction>(LOCAL_KEYS.transactions), ...transactions.map(stamp)]);
        if (batch) {
          upsert(LOCAL_KEYS.batches, stamp({ ...batch, status: 'COMPLETED' }));
        }
      } catch (err) {
        if (batch) {
          upsert(LOCAL_KEYS.batches, stamp({ ...batch, status: 'FAILED' }));
        }
        throw err;
      }
    },

    async commitChanges(changes: ChangeSet) {
      applyChanges(changes);
    },
    async getTransaction(id) {
      if (!hydrated) await store.ready;
      return read<BankTransaction>(LOCAL_KEYS.transactions).find((t) => t.id === id) ?? null;
    },
    async listOpenQueries(clientId) {
      if (!hydrated) await store.ready;
      return read<BankTransaction>(LOCAL_KEYS.transactions)
        .filter((t) => t.clientId === clientId && t.clientQuery?.status === 'OPEN')
        .sort(byDateDesc);
    },

    async listImportBatches(clientId) {
      if (!hydrated) await store.ready;
      return read<ImportBatch>(LOCAL_KEYS.batches).filter((b) => b.clientId === clientId);
    },
    async saveImportBatch(batch) {
      upsert(LOCAL_KEYS.batches, stamp(batch));
    },
    async listBatchTransactions(batch) {
      if (!hydrated) await store.ready;
      return read<BankTransaction>(LOCAL_KEYS.transactions)
        .filter((t) => t.clientId === batch.clientId && t.importBatchId === batch.id)
        .sort((a, b) => a.date.localeCompare(b.date));
    },
    async deleteImportBatch(batch, transactions, changes) {
      const gone = new Set(transactions.map((t) => t.id));
      applyChanges(changes);
      write(
        LOCAL_KEYS.transactions,
        read<BankTransaction>(LOCAL_KEYS.transactions).filter((t) => !gone.has(t.id))
      );
      remove<ImportBatch>(LOCAL_KEYS.batches, batch.id);
    },

    async getOpeningBalances(clientId) {
      if (!hydrated) await store.ready;
      return read<OpeningBalances>(LOCAL_KEYS.openings).find((o) => o.clientId === clientId) ?? null;
    },
    async saveOpeningBalances(balances, audit, related = {}) {
      // Valida e monta todas as listas antes de gravar qualquer uma.
      const clientId = balances.clientId;
      const ls = readLockState(clientId);
      const months = lockedMonthsOf(clientId);
      const allOpenings = read<OpeningBalances>(LOCAL_KEYS.openings);
      const existingOpening = allOpenings.find((o) => o.clientId === clientId);
      const preparedOpening = stamp(
        prepareProtectedSave('opening_balances', existingOpening, { ...balances, id: clientId }, ls, months)
      );
      const others = allOpenings.filter((o) => o.clientId !== clientId);

      const allAccounts = read<ChartAccount>(LOCAL_KEYS.accounts);
      const newAccounts = related.accounts ?? [];
      const preparedAccounts = newAccounts.map((acc) => {
        const existingAcc = allAccounts.find((a) => a.id === acc.id);
        return stamp(
          prepareProtectedSave('chart_of_accounts', existingAcc, acc, acc.clientId === 'global' ? null : ls, months)
        );
      });
      const knownAccounts = new Set(newAccounts.map((a) => a.id));
      const accounts = [...allAccounts.filter((a) => !knownAccounts.has(a.id)), ...preparedAccounts];

      const allBanks = read<BankAccount>(LOCAL_KEYS.bankAccounts);
      const nextBanks = related.bankAccounts ?? [];
      const preparedBanks = nextBanks.map((bank) => {
        const existingBank = allBanks.find((b) => b.id === bank.id);
        return stamp(prepareProtectedSave('bank_accounts', existingBank, bank, ls, months));
      });
      const replaced = new Set(nextBanks.map((b) => b.id));
      const banks = [...allBanks.filter((b) => !replaced.has(b.id)), ...preparedBanks];

      if (newAccounts.length) write(LOCAL_KEYS.accounts, accounts);
      if (replaced.size) write(LOCAL_KEYS.bankAccounts, banks);
      write(LOCAL_KEYS.openings, [...others, preparedOpening]);
      write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), stamp(audit)]);
    },

    async listBankAccounts(clientId) {
      if (!hydrated) await store.ready;
      return read<BankAccount>(LOCAL_KEYS.bankAccounts).filter((b) => b.clientId === clientId);
    },
    async saveBankAccount(account) {
      const all = read<BankAccount>(LOCAL_KEYS.bankAccounts);
      const existing = all.find((b) => b.id === account.id);
      const prepared = prepareProtectedSave(
        'bank_accounts',
        existing,
        account,
        readLockState(account.clientId),
        lockedMonthsOf(account.clientId)
      );
      write(LOCAL_KEYS.bankAccounts, [...all.filter((b) => b.id !== account.id), stamp(prepared)]);
    },

    async listPeriodLocks(clientId) {
      if (!hydrated) await store.ready;
      return read<PeriodLock>(LOCAL_KEYS.locks).filter((l) => l.clientId === clientId);
    },
    async getLockState(clientId) {
      if (!hydrated) await store.ready;
      return readLockState(clientId);
    },
    async closePeriod(lock, audit) {
      if (read<PeriodLock>(LOCAL_KEYS.locks).some((l) => l.id === lock.id)) throw new Error('Competência já está fechada.');
      const nextLs = nextLockStateOnClose(readLockState(lock.clientId), lock.id);
      upsert(LOCAL_KEYS.locks, stamp(lock));
      replace(LOCAL_KEYS.lockState, stamp(nextLs));
      write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), stamp({ ...audit, id: periodAuditId(lock, 'close') })]);
    },
    async reopenPeriod(lock, audit) {
      if (!isAdminSession()) throw new Error('Somente o administrador do escritório pode reabrir competências.');
      const nextLs = nextLockStateOnReopen(readLockState(lock.clientId), lock.id);
      remove<PeriodLock>(LOCAL_KEYS.locks, lock.id);
      replace(LOCAL_KEYS.lockState, stamp(nextLs));
      write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), stamp({ ...audit, id: periodAuditId(lock, 'reopen') })]);
    },

    async listPeriodSnapshots(clientId) {
      if (!hydrated) await store.ready;
      return read<PeriodSnapshot>(LOCAL_KEYS.snapshots).filter((s) => s.clientId === clientId);
    },
    async savePeriodSnapshot(snapshot) {
      const others = read<PeriodSnapshot>(LOCAL_KEYS.snapshots).filter((s) => s.id !== snapshot.id);
      write(LOCAL_KEYS.snapshots, [...others, stamp(snapshot)]);
    },

    async listAudit(clientId, options = {}) {
      if (!hydrated) await store.ready;
      return read<AuditEntry>(LOCAL_KEYS.audit)
        .filter((a) => a.clientId === clientId && (!options.transactionId || a.transactionId === options.transactionId))
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, options.limit ?? 200);
    },

    async listClientRequests(clientId) {
      if (!hydrated) await store.ready;
      return read<ClientRequest>(LOCAL_KEYS.requests)
        .filter((r) => r.clientId === clientId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async saveClientRequest(request) {
      const all = read<ClientRequest>(LOCAL_KEYS.requests).filter((r) => r.id !== request.id);
      write(LOCAL_KEYS.requests, [...all, stamp(request)]);
    },
    async closeClientRequest(requestId) {
      const all = read<ClientRequest>(LOCAL_KEYS.requests);
      const i = all.findIndex((r) => r.id === requestId);
      if (i < 0) throw new Error('Link não encontrado.');
      all[i] = { ...all[i], status: 'CLOSED' };
      write(LOCAL_KEYS.requests, all);
    },

    async renewClientRequest(requestId, expiresAtMs) {
      const all = read<ClientRequest>(LOCAL_KEYS.requests);
      const i = all.findIndex((r) => r.id === requestId);
      if (i < 0) throw new Error('Link não encontrado.');
      all[i] = { ...all[i], status: 'OPEN', expiresAtMs };
      write(LOCAL_KEYS.requests, all);
    },
    async markClientRequestsSeen(items) {
      if (!items.length) return;
      const seenMap = new Map(items.map((x) => [x.id, x.seenAt] as const));
      const all = read<ClientRequest>(LOCAL_KEYS.requests).map((r) =>
        seenMap.has(r.id) ? { ...r, seenAt: seenMap.get(r.id)! } : r
      );
      write(LOCAL_KEYS.requests, all);
    },
    async listOpenOrgClientRequests() {
      if (!hydrated) await store.ready;
      return read<ClientRequest>(LOCAL_KEYS.requests)
        .filter((r) => r.status === 'OPEN')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    /* ── Lançamentos manuais de fechamento (Diário Avulso) ─────────────── */
    async listJournalEntries(clientId: string, range?: DateRange): Promise<JournalEntry[]> {
      if (!hydrated) await store.ready;
      return read<JournalEntry>(LOCAL_KEYS.journalEntries)
        .filter((j) => j.clientId === clientId && (!range || (j.date >= range.start && j.date <= range.end)))
        .sort((a, b) => b.date.localeCompare(a.date) || b.entryNumber - a.entryNumber);
    },
    async getJournalCounter(clientId: string): Promise<JournalCounter | null> {
      if (!hydrated) await store.ready;
      return read<JournalCounter>(LOCAL_KEYS.journalCounters).find((c) => c.clientId === clientId) ?? null;
    },
    async createJournalEntry(draft: JournalEntryDraft, audit: AuditEntry): Promise<JournalEntry> {
      assertValidJournalEntry(draft);
      const list = read<JournalEntry>(LOCAL_KEYS.journalEntries);
      const counters = read<JournalCounter>(LOCAL_KEYS.journalCounters);
      // Cliente ainda sem contador: a sequência parte do maior número já usado.
      const last =
        counters.find((c) => c.clientId === draft.clientId)?.last ??
        list.filter((j) => j.clientId === draft.clientId).reduce((max, j) => Math.max(max, j.entryNumber || 0), 0);
      const entry: JournalEntry = { ...draft, entryNumber: last + 1 };
      write(LOCAL_KEYS.journalCounters, [
        ...counters.filter((c) => c.clientId !== draft.clientId),
        stamp({ id: draft.clientId, clientId: draft.clientId, last: entry.entryNumber }),
      ]);
      write(LOCAL_KEYS.journalEntries, [...list, stamp(entry)]);
      write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), stamp(audit)]);
      return entry;
    },
    async updateJournalEntry(entry: JournalEntry, audit: AuditEntry): Promise<void> {
      assertValidJournalEntry(entry);
      const list = read<JournalEntry>(LOCAL_KEYS.journalEntries);
      const idx = list.findIndex((j) => j.id === entry.id);
      if (idx < 0) throw new Error(`Lançamento manual ${entry.id} não encontrado.`);
      // O número é imutável, como nas regras do Firestore.
      const stamped = stamp({ ...entry, entryNumber: list[idx].entryNumber });
      write(LOCAL_KEYS.journalEntries, list.map((j, i) => (i === idx ? stamped : j)));
      write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), stamp(audit)]);
    },
    async deleteJournalEntry(entryId: string, audit: AuditEntry): Promise<void> {
      if (!isAdminSession()) {
        throw Object.assign(new Error('Somente administradores podem excluir lançamentos do Diário.'), {
          code: 'permission-denied',
        });
      }
      const list = read<JournalEntry>(LOCAL_KEYS.journalEntries);
      write(LOCAL_KEYS.journalEntries, list.filter((j) => j.id !== entryId));
      write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), stamp(audit)]);
    },

    // Valida tudo antes de escrever: entra o encerramento inteiro ou nada, como no Firestore.
    async closeYear(drafts, audit) {
      if (drafts.length === 0) throw new Error('Nada a encerrar.');
      drafts.forEach(assertValidJournalEntry);
      const clientId = drafts[0].clientId;
      const list = read<JournalEntry>(LOCAL_KEYS.journalEntries);
      const counters = read<JournalCounter>(LOCAL_KEYS.journalCounters);
      const base =
        counters.find((c) => c.clientId === clientId)?.last ??
        list.filter((j) => j.clientId === clientId).reduce((max, j) => Math.max(max, j.entryNumber || 0), 0);
      const entries: JournalEntry[] = drafts.map((d, i) => ({ ...d, entryNumber: base + i + 1, closingAuditId: audit.id }));
      const nextLs = nextLockStateOnYearClose(readLockState(clientId), audit.id);
      write(LOCAL_KEYS.journalCounters, [...counters.filter((c) => c.clientId !== clientId), stamp({ id: clientId, clientId, last: base + entries.length })]);
      replace(LOCAL_KEYS.lockState, stamp(nextLs));
      write(LOCAL_KEYS.journalEntries, [...list, ...entries.map(stamp)]);
      write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), stamp(audit)]);
      return entries;
    },
    async reopenYear(entries, audit) {
      const gone = new Set(entries.map((e) => e.id));
      write(LOCAL_KEYS.journalEntries, read<JournalEntry>(LOCAL_KEYS.journalEntries).filter((j) => !gone.has(j.id)));
      write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), stamp(audit)]);
    },

    async listInvoices(clientId, range) {
      if (!hydrated) await store.ready;
      return read<InvoiceSummary>(LOCAL_KEYS.invoices)
        .filter((i) => i.clientId === clientId && (!range || (i.issueDate >= range.start && i.issueDate <= range.end)))
        .map((i) => ({ ...i, status: i.status ?? 'AUTHORIZED' }))
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number, undefined, { numeric: true }));
    },
    async saveInvoices(invoices) {
      const stored = read<InvoiceSummary>(LOCAL_KEYS.invoices);
      const index = new Map(stored.map((s, i) => [s.id, i] as const));
      for (const inv of invoices) {
        const i = index.get(inv.id);
        if (i === undefined) {
          index.set(inv.id, stored.length);
          stored.push(stamp({ ...inv, links: undefined }));
          continue;
        }
        // Mesmo comportamento do Firestore: vínculos preservados e cancelamento nunca desfeito.
        const prev = stored[i];
        stored[i] = stamp({ ...inv, links: prev.links, status: prev.status === 'CANCELLED' ? 'CANCELLED' : inv.status });
      }
      write(LOCAL_KEYS.invoices, stored);
    },
    async cancelInvoices(clientId, keys) {
      const ids = new Set(keys.map((k) => invoiceId(clientId, k)));
      const stored = read<InvoiceSummary>(LOCAL_KEYS.invoices);
      let count = 0;
      for (const inv of stored) {
        if (!ids.has(inv.id)) continue;
        inv.status = 'CANCELLED';
        count++;
      }
      write(LOCAL_KEYS.invoices, stored);
      return count;
    },
    async linkInvoice(id, link) {
      const stored = read<InvoiceSummary>(LOCAL_KEYS.invoices);
      const inv = stored.find((i) => i.id === id);
      if (!inv) throw new Error('Nota fiscal não encontrada.');
      inv.links = [...(inv.links ?? []).filter((l) => l.transactionId !== link.transactionId), link];
      write(LOCAL_KEYS.invoices, stored);
      return { ...inv, status: inv.status ?? 'AUTHORIZED' };
    },
    async deleteInvoice(id) {
      remove<InvoiceSummary>(LOCAL_KEYS.invoices, id);
    },

    async getFixedAssets(clientId) {
      if (!hydrated) await store.ready;
      return read<FixedAssetRegister>(LOCAL_KEYS.fixedAssets).find((r) => r.clientId === clientId) ?? null;
    },
    async saveFixedAssets(register, audit, journal = {}, options) {
      return saveRegister(LOCAL_KEYS.fixedAssets, register, audit, journal, options);
    },
    async getPrepaidExpenses(clientId) {
      if (!hydrated) await store.ready;
      return read<PrepaidRegister>(LOCAL_KEYS.prepaid).find((r) => r.clientId === clientId) ?? null;
    },
    async savePrepaidExpenses(register, audit, journal = {}, options) {
      return saveRegister(LOCAL_KEYS.prepaid, register, audit, journal, options);
    },
    async getFinancingContracts(clientId) {
      if (!hydrated) await store.ready;
      return read<FinancingRegister>(LOCAL_KEYS.financing).find((r) => r.clientId === clientId) ?? null;
    },
    async saveFinancingContracts(register, audit, journal = {}, options) {
      return saveRegister(LOCAL_KEYS.financing, register, audit, journal, options);
    },
    async getInvestments(clientId) {
      if (!hydrated) await store.ready;
      return read<InvestmentRegister>(LOCAL_KEYS.investments).find((r) => r.clientId === clientId) ?? null;
    },
    async saveInvestments(register, audit, options) {
      return saveRegister(LOCAL_KEYS.investments, register, audit, {}, options);
    },
    async getStockControl(clientId) {
      if (!hydrated) await store.ready;
      return read<StockControl>(LOCAL_KEYS.stock).find((r) => r.clientId === clientId) ?? null;
    },
    async saveStockControl(control, audit, options) {
      return saveRegister(LOCAL_KEYS.stock, control, audit, {}, options);
    },
    async getPayrollRegister(clientId) {
      if (!hydrated) await store.ready;
      return read<PayrollRegister>(LOCAL_KEYS.payroll).find((r) => r.clientId === clientId) ?? null;
    },
    async savePayrollRegister(register, audit, journal = {}, options) {
      return saveRegister(LOCAL_KEYS.payroll, register, audit, journal, options);
    },

    async listClosingChecklists(clientId) {
      if (!hydrated) await store.ready;
      return read<ClosingChecklist>(LOCAL_KEYS.checklists)
        .filter((c) => c.clientId === clientId)
        .sort((a, b) => a.year.localeCompare(b.year));
    },
    async getClosingChecklist(clientId, year) {
      if (!hydrated) await store.ready;
      return read<ClosingChecklist>(LOCAL_KEYS.checklists).find((c) => c.clientId === clientId && c.year === year) ?? null;
    },
    async saveClosingChecklist(checklist) {
      const id = `${checklist.clientId}_${checklist.year}`;
      write(LOCAL_KEYS.checklists, [
        ...read<ClosingChecklist>(LOCAL_KEYS.checklists).filter((c) => c.id !== id),
        stamp(JSON.parse(JSON.stringify({ ...checklist, id })) as ClosingChecklist),
      ]);
    },

    async listExplanatoryNotes(clientId) {
      if (!hydrated) await store.ready;
      return read<ExplanatoryNotes>(LOCAL_KEYS.notes)
        .filter((n) => n.clientId === clientId)
        .sort((a, b) => a.year.localeCompare(b.year));
    },
    async getExplanatoryNotes(clientId, year) {
      if (!hydrated) await store.ready;
      return read<ExplanatoryNotes>(LOCAL_KEYS.notes).find((n) => n.clientId === clientId && n.year === year) ?? null;
    },
    async saveExplanatoryNotes(notes) {
      const id = `${notes.clientId}_${notes.year}`;
      write(LOCAL_KEYS.notes, [...read<ExplanatoryNotes>(LOCAL_KEYS.notes).filter((n) => n.id !== id), stamp({ ...notes, id })]);
    },

    async restoreLocalClientData(payload: LocalClientRestorePayload) {
      if (!hydrated) await store.ready;
      const clientId = payload.client.id;
      const replaceForClient = <T extends { clientId: string }>(key: string, items: readonly T[]) => {
        const others = read<T>(key).filter((x) => x.clientId !== clientId);
        write(key, [...others, ...items.map((x) => stamp(x))]);
      };
      const mergeScopedOrGlobal = <T extends { id: string; clientId: string }>(key: string, items: readonly T[]) => {
        const current = read<T>(key);
        const others = current.filter((x) => x.clientId !== clientId);
        const existingGlobalIds = new Set(others.filter((x) => x.clientId === 'global').map((x) => x.id));
        const clientItems = items.filter((x) => x.clientId === clientId).map((x) => stamp(x));
        const missingGlobals = items.filter((x) => x.clientId === 'global' && !existingGlobalIds.has(x.id)).map((x) => stamp(x));
        write(key, [...others, ...missingGlobals, ...clientItems]);
      };

      replace(LOCAL_KEYS.clients, stamp(payload.client));
      mergeScopedOrGlobal(LOCAL_KEYS.accounts, payload.accounts);
      mergeScopedOrGlobal(LOCAL_KEYS.rules, payload.rules);
      replaceForClient(LOCAL_KEYS.bankAccounts, payload.bankAccounts);
      replaceForClient(LOCAL_KEYS.openings, payload.openingBalances ? [payload.openingBalances] : []);
      replaceForClient(LOCAL_KEYS.batches, payload.importBatches);
      replaceForClient(LOCAL_KEYS.transactions, payload.transactions);
      replaceForClient(LOCAL_KEYS.journalEntries, payload.journalEntries);
      replaceForClient(
        LOCAL_KEYS.journalCounters,
        payload.journalCounter
          ? [payload.journalCounter]
          : payload.journalEntries.length > 0
            ? [
                {
                  id: clientId,
                  clientId,
                  last: payload.journalEntries.reduce((max, e) => Math.max(max, e.entryNumber || 0), 0),
                },
              ]
            : []
      );
      replaceForClient(LOCAL_KEYS.locks, payload.periodLocks);
      const resolvedLockState: LockState =
        payload.lockState ??
        (() => {
          const count = payload.periodLocks.length;
          return { id: clientId, clientId, count, seq: count };
        })();
      replace(LOCAL_KEYS.lockState, stamp(resolvedLockState));
      replaceForClient(LOCAL_KEYS.requests, payload.clientRequests);
      replaceForClient(LOCAL_KEYS.invoices, payload.invoices);
      replaceForClient(LOCAL_KEYS.fixedAssets, payload.fixedAssets ? [payload.fixedAssets] : []);
      replaceForClient(LOCAL_KEYS.prepaid, payload.prepaidExpenses ? [payload.prepaidExpenses] : []);
      replaceForClient(LOCAL_KEYS.financing, payload.financingContracts ? [payload.financingContracts] : []);
      replaceForClient(LOCAL_KEYS.investments, payload.investments ? [payload.investments] : []);
      replaceForClient(LOCAL_KEYS.stock, payload.stockControl ? [payload.stockControl] : []);
      replaceForClient(LOCAL_KEYS.payroll, payload.payrollRegister ? [payload.payrollRegister] : []);
      replaceForClient(LOCAL_KEYS.checklists, payload.closingChecklists);
      replaceForClient(LOCAL_KEYS.notes, payload.explanatoryNotes);

      const existingAudit = read<AuditEntry>(LOCAL_KEYS.audit);
      const seenAuditIds = new Set(existingAudit.map((a) => a.id));
      const importedAudit = payload.audit.filter((a) => !seenAuditIds.has(a.id)).map((a) => stamp(a));
      write(LOCAL_KEYS.audit, [...existingAudit, ...importedAudit, stamp(payload.restoreAudit)]);
    },

    async getPublicClientRequest(token) {
      if (!hydrated) await store.ready;
      return read<ClientRequest>(LOCAL_KEYS.requests).find((r) => r.id === token) ?? null;
    },
    async answerPublicClientRequest(token, answers, respondedAt) {
      const all = read<ClientRequest>(LOCAL_KEYS.requests);
      const i = all.findIndex((r) => r.id === token);
      if (i < 0) throw new Error('Link inválido.');
      const req = all[i];
      if (req.status !== 'OPEN' || Date.now() >= req.expiresAtMs) throw new Error('Este link não aceita mais respostas.');
      if (answers.length !== req.items.length) throw new Error('É preciso uma resposta por pergunta.');
      // Só as respostas mudam; as perguntas ficam como o escritório gravou.
      all[i] = { ...req, answers: [...answers], respondedAt };
      write(LOCAL_KEYS.requests, all);
    },
  };
  return repo;
}
