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
import type { ChangeSet, DataRepository, DateRange, FixedAssetJournalChange, JournalEntryDraft } from '@/lib/data/repository';
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

/** Subconjunto de `Storage` usado — suporta implementações síncronas (memória/localStorage) e assíncronas (IndexedDB). */
export interface KeyValueStore {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem?(key: string): void | Promise<void>;
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
 * Repositório de desenvolvimento/demonstração em modo local (IndexedDB / localStorage / memória).
 * Usado apenas quando o Firebase não está configurado — nunca em paralelo ao Firestore.
 * Falhas de leitura ou escrita (JSON corrompido, cota excedida) são propagadas.
 */
export function createLocalRepository(store: KeyValueStore): DataRepository {
  async function read<T>(key: string): Promise<T[]> {
    const raw = await store.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error(`Armazenamento local corrompido em "${key}".`);
    return parsed as T[];
  }
  async function write<T>(key: string, items: readonly T[]): Promise<void> {
    await store.setItem(key, JSON.stringify(items));
  }
  async function upsert<T extends { id: string }>(key: string, item: T): Promise<void> {
    const items = await read<T>(key);
    const i = items.findIndex((x) => x.id === item.id);
    if (i >= 0) items[i] = { ...items[i], ...item };
    else items.push(item);
    await write(key, items);
  }
  async function remove<T extends { id: string }>(key: string, id: string): Promise<void> {
    const current = await read<T>(key);
    await write(
      key,
      current.filter((x) => x.id !== id)
    );
  }
  async function replace<T extends { id: string }>(key: string, item: T): Promise<void> {
    const items = await read<T>(key);
    const i = items.findIndex((x) => x.id === item.id);
    if (i >= 0) items[i] = item;
    else items.push(item);
    await write(key, items);
  }
  const stamp = <T extends object>(x: T): T => ({ ...x, orgId: LOCAL_ORG_ID });

  /** Cadastro de um documento por cliente com auditoria e lançamento; valida antes de gravar: tudo ou nada. */
  async function saveRegister<T extends { clientId: string }>(
    key: string,
    register: T,
    audit: AuditEntry,
    journal: FixedAssetJournalChange
  ): Promise<JournalEntry | null> {
    const id = register.clientId;
    if (journal.create) assertValidJournalEntry(journal.create);
    const created = journal.create ? await repo.createJournalEntry(journal.create) : null;
    if (journal.deleteId) await repo.deleteJournalEntry(journal.deleteId);
    const existing = await read<T>(key);
    await write(key, [
      ...existing.filter((r) => r.clientId !== id),
      stamp(JSON.parse(JSON.stringify({ ...register, id })) as T),
    ]);
    const existingAudit = await read<AuditEntry>(LOCAL_KEYS.audit);
    await write(LOCAL_KEYS.audit, [...existingAudit, stamp(audit)]);
    return created;
  }

  async function lockedMonthsOf(clientId: string): Promise<string[]> {
    const locks = await read<PeriodLock>(LOCAL_KEYS.locks);
    return locks.filter((l) => l.clientId === clientId).map((l) => l.month);
  }

  async function readLockState(clientId: string): Promise<LockState> {
    const states = await read<LockState>(LOCAL_KEYS.lockState);
    const stored = states.find((s) => s.clientId === clientId);
    if (stored) return stored;
    const months = await lockedMonthsOf(clientId);
    const count = months.length;
    return { id: clientId, clientId, count, seq: count };
  }

  /** Valida tudo antes de gravar (equivalente à atomicidade do writeBatch). */
  async function applyChanges({ patches, rules = [], deleteRuleIds = [], audits }: ChangeSet): Promise<void> {
    const txs = await read<BankTransaction>(LOCAL_KEYS.transactions);
    const index = new Map(txs.map((t, i) => [t.id, i] as const));
    for (const p of patches) if (!index.has(p.id)) throw new Error(`Lançamento ${p.id} não encontrado.`);
    for (const p of patches) {
      const i = index.get(p.id)!;
      txs[i] = applyPatch(txs[i], p);
    }
    const storedRules = await read<ClassificationRule>(LOCAL_KEYS.rules);
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
    await write(LOCAL_KEYS.rules, storedRules.filter((r) => !dropped.has(r.id)));
    await write(LOCAL_KEYS.transactions, txs);
    const existingAudit = await read<AuditEntry>(LOCAL_KEYS.audit);
    await write(LOCAL_KEYS.audit, [...existingAudit, ...audits.map(stamp)]);
  }

  const inScope = (owner: string, clientId: string) => owner === clientId || owner === 'global';

  const repo: DataRepository = {
    mode: 'local',

    async getOrgSettings() {
      const items = await read<OrgSettings>(LOCAL_KEYS.org);
      return items[0] ?? null;
    },
    async saveOrgSettings(settings) {
      await write(LOCAL_KEYS.org, [stamp(settings)]);
    },

    async listClients() {
      return read<ClientCompany>(LOCAL_KEYS.clients);
    },
    async saveClient(client) {
      const clients = await read<ClientCompany>(LOCAL_KEYS.clients);
      const isNew = !clients.some((c) => c.id === client.id);
      await replace(LOCAL_KEYS.clients, stamp(client));
      if (isNew) {
        const lockStates = await read<LockState>(LOCAL_KEYS.lockState);
        if (!lockStates.some((s) => s.clientId === client.id)) {
          await replace(LOCAL_KEYS.lockState, stamp(initialLockState(client.id)));
        }
      }
    },
    async updateClientDaybook(clientId, daybook) {
      const clients = await read<ClientCompany>(LOCAL_KEYS.clients);
      const client = clients.find((c) => c.id === clientId);
      if (!client) throw new Error('Empresa não encontrada.');
      await replace(LOCAL_KEYS.clients, { ...client, daybook: { ...daybook } });
    },
    async deleteClient(clientId, actor) {
      if (!clientId || clientId === 'global') throw new Error('Cliente inválido para exclusão.');
      if (!isAdminSession()) throw new Error('Somente o administrador do escritório pode excluir empresas.');
      // A trilha de auditoria é preservada, como no Firestore, e registra os fechamentos removidos.
      const now = new Date().toISOString();
      const locks = await read<PeriodLock>(LOCAL_KEYS.locks);
      const reopened = locks
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
      if (reopened.length) {
        const existingAudit = await read<AuditEntry>(LOCAL_KEYS.audit);
        await write(LOCAL_KEYS.audit, [...existingAudit, ...reopened.map(stamp)]);
      }
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
        const current = await read<{ clientId: string }>(key);
        await write(
          key,
          current.filter((x) => x.clientId !== clientId)
        );
      }
      await remove<ClientCompany>(LOCAL_KEYS.clients, clientId);
    },

    async listAccounts(clientId) {
      const all = await read<ChartAccount>(LOCAL_KEYS.accounts);
      return all.filter((a) => inScope(a.clientId, clientId)).sort(byCode);
    },
    async saveAccount(account) {
      const all = await read<ChartAccount>(LOCAL_KEYS.accounts);
      const existing = all.find((a) => a.id === account.id);
      const ls = account.clientId === 'global' ? null : await readLockState(account.clientId);
      const months = account.clientId === 'global' ? undefined : await lockedMonthsOf(account.clientId);
      const prepared = prepareProtectedSave('chart_of_accounts', existing, account, ls, months);
      await replace(LOCAL_KEYS.accounts, stamp(prepared));
    },
    async deleteAccount(accountId, audit) {
      if (!isAdminSession()) throw new Error('Somente o administrador do escritório pode excluir contas do plano.');
      await remove<ChartAccount>(LOCAL_KEYS.accounts, accountId);
      if (audit) {
        const existingAudit = await read<AuditEntry>(LOCAL_KEYS.audit);
        await write(LOCAL_KEYS.audit, [...existingAudit, stamp(audit)]);
      }
    },
    async insertAccounts(accounts) {
      if (!accounts.length) return;
      const prepared = await Promise.all(
        accounts.map(async (acc) => {
          const ls = acc.clientId === 'global' ? null : await readLockState(acc.clientId);
          const months = acc.clientId === 'global' ? undefined : await lockedMonthsOf(acc.clientId);
          return stamp(prepareProtectedSave('chart_of_accounts', null, acc, ls, months));
        })
      );
      const existing = await read<ChartAccount>(LOCAL_KEYS.accounts);
      await write(LOCAL_KEYS.accounts, [...existing, ...prepared]);
    },
    async saveChartSetup({ accounts, bankAccounts }) {
      // Valida e monta as duas listas antes de gravar qualquer uma.
      const storedAccounts = await read<ChartAccount>(LOCAL_KEYS.accounts);
      for (const acc of accounts) {
        const i = storedAccounts.findIndex((a) => a.id === acc.id);
        const existing = i >= 0 ? storedAccounts[i] : null;
        const ls = acc.clientId === 'global' ? null : await readLockState(acc.clientId);
        const months = acc.clientId === 'global' ? undefined : await lockedMonthsOf(acc.clientId);
        const prepared = stamp(prepareProtectedSave('chart_of_accounts', existing, acc, ls, months));
        if (i >= 0) storedAccounts[i] = prepared;
        else storedAccounts.push(prepared);
      }
      const existingBanks = await read<BankAccount>(LOCAL_KEYS.bankAccounts);
      const preparedBanks = await Promise.all(
        bankAccounts.map(async (bank) => {
          const existing = existingBanks.find((b) => b.id === bank.id);
          return stamp(
            prepareProtectedSave(
              'bank_accounts',
              existing,
              bank,
              await readLockState(bank.clientId),
              await lockedMonthsOf(bank.clientId)
            )
          );
        })
      );
      const replaced = new Set(bankAccounts.map((b) => b.id));
      const storedBanks = [...existingBanks.filter((b) => !replaced.has(b.id)), ...preparedBanks];
      await write(LOCAL_KEYS.accounts, storedAccounts);
      await write(LOCAL_KEYS.bankAccounts, storedBanks);
    },

    async listRules(clientId) {
      const all = await read<ClassificationRule>(LOCAL_KEYS.rules);
      return all.filter((r) => inScope(r.clientId, clientId));
    },
    async saveRule(rule) {
      const all = await read<ClassificationRule>(LOCAL_KEYS.rules);
      const existing = all.find((r) => r.id === rule.id);
      if (existing) {
        const prevAuthor = existing.createdByUid ?? '';
        const nextAuthor = rule.createdByUid ?? prevAuthor;
        if (nextAuthor !== prevAuthor) throw new Error('A autoria de uma regra não pode ser alterada.');
      }
      await upsert(LOCAL_KEYS.rules, stamp(rule));
    },
    async deleteRule(ruleId) {
      const all = await read<ClassificationRule>(LOCAL_KEYS.rules);
      const existing = all.find((r) => r.id === ruleId);
      if (existing && !canDeleteRule(existing, peekActor()?.uid, isAdminSession())) {
        throw new Error('Operadores só podem excluir regras criadas por si mesmos.');
      }
      await remove<ClassificationRule>(LOCAL_KEYS.rules, ruleId);
    },

    async listTransactions(clientId, range) {
      const all = await read<BankTransaction>(LOCAL_KEYS.transactions);
      return all
        .filter((t) => t.clientId === clientId && (!range || (t.date >= range.start && t.date <= range.end)))
        .sort(byDateDesc);
    },
    async listPendingTransactions(clientId) {
      const all = await read<BankTransaction>(LOCAL_KEYS.transactions);
      return all.filter((t) => t.clientId === clientId && t.status === 'PENDING');
    },
    async latestTransactionDate(clientId) {
      const all = await read<BankTransaction>(LOCAL_KEYS.transactions);
      const dates = all.filter((t) => t.clientId === clientId).map((t) => t.date);
      return dates.length ? dates.reduce((max, d) => (d > max ? d : max)) : null;
    },
    async countTransactions(clientId, until) {
      const all = await read<BankTransaction>(LOCAL_KEYS.transactions);
      return all.filter((t) => t.clientId === clientId && t.date <= until).length;
    },
    async countTransactionsByStatus(clientId, status) {
      const all = await read<BankTransaction>(LOCAL_KEYS.transactions);
      return all.filter((t) => t.clientId === clientId && t.status === status).length;
    },
    async oldestTransactionDate(clientId, status) {
      const all = await read<BankTransaction>(LOCAL_KEYS.transactions);
      const dates = all
        .filter((t) => t.clientId === clientId && t.status === status)
        .map((t) => t.date)
        .sort();
      return dates[0] ?? null;
    },
    async isAccountUsedInTransactions(clientId, accountId) {
      const all = await read<BankTransaction>(LOCAL_KEYS.transactions);
      return all.some(
        (t) =>
          t.clientId === clientId &&
          (t.accountId === accountId || Boolean(t.isSplit && t.splits?.some((s) => s.accountId === accountId)))
      );
    },
    async findExistingTransactionIds(clientId, ids) {
      const wanted = new Set(ids);
      const all = await read<BankTransaction>(LOCAL_KEYS.transactions);
      return new Set(all.filter((t) => t.clientId === clientId && wanted.has(t.id)).map((t) => t.id));
    },
    async insertTransactions(transactions, batch?: ImportBatch) {
      if (batch) {
        await upsert(LOCAL_KEYS.batches, stamp({ ...batch, status: 'PROCESSING' }));
      }
      try {
        const existing = await read<BankTransaction>(LOCAL_KEYS.transactions);
        await write(LOCAL_KEYS.transactions, [...existing, ...transactions.map(stamp)]);
        if (batch) {
          await upsert(LOCAL_KEYS.batches, stamp({ ...batch, status: 'COMPLETED' }));
        }
      } catch (err) {
        if (batch) {
          await upsert(LOCAL_KEYS.batches, stamp({ ...batch, status: 'FAILED' }));
        }
        throw err;
      }
    },

    async commitChanges(changes: ChangeSet) {
      await applyChanges(changes);
    },
    async getTransaction(id) {
      const all = await read<BankTransaction>(LOCAL_KEYS.transactions);
      return all.find((t) => t.id === id) ?? null;
    },
    async listOpenQueries(clientId) {
      const all = await read<BankTransaction>(LOCAL_KEYS.transactions);
      return all.filter((t) => t.clientId === clientId && t.clientQuery?.status === 'OPEN').sort(byDateDesc);
    },

    async listImportBatches(clientId) {
      const all = await read<ImportBatch>(LOCAL_KEYS.batches);
      return all.filter((b) => b.clientId === clientId);
    },
    async saveImportBatch(batch) {
      await upsert(LOCAL_KEYS.batches, stamp(batch));
    },
    async listBatchTransactions(batch) {
      const all = await read<BankTransaction>(LOCAL_KEYS.transactions);
      return all
        .filter((t) => t.clientId === batch.clientId && t.importBatchId === batch.id)
        .sort((a, b) => a.date.localeCompare(b.date));
    },
    async deleteImportBatch(batch, transactions, changes) {
      const gone = new Set(transactions.map((t) => t.id));
      await applyChanges(changes);
      const current = await read<BankTransaction>(LOCAL_KEYS.transactions);
      await write(
        LOCAL_KEYS.transactions,
        current.filter((t) => !gone.has(t.id))
      );
      await remove<ImportBatch>(LOCAL_KEYS.batches, batch.id);
    },

    async getOpeningBalances(clientId) {
      const all = await read<OpeningBalances>(LOCAL_KEYS.openings);
      return all.find((o) => o.clientId === clientId) ?? null;
    },
    async saveOpeningBalances(balances, audit, related = {}) {
      // Valida e monta todas as listas antes de gravar qualquer uma.
      const clientId = balances.clientId;
      const ls = await readLockState(clientId);
      const months = await lockedMonthsOf(clientId);
      const allOpenings = await read<OpeningBalances>(LOCAL_KEYS.openings);
      const existingOpening = allOpenings.find((o) => o.clientId === clientId);
      const preparedOpening = stamp(
        prepareProtectedSave('opening_balances', existingOpening, { ...balances, id: clientId }, ls, months)
      );
      const others = allOpenings.filter((o) => o.clientId !== clientId);

      const allAccounts = await read<ChartAccount>(LOCAL_KEYS.accounts);
      const newAccounts = related.accounts ?? [];
      const preparedAccounts = newAccounts.map((acc) => {
        const existingAcc = allAccounts.find((a) => a.id === acc.id);
        return stamp(
          prepareProtectedSave('chart_of_accounts', existingAcc, acc, acc.clientId === 'global' ? null : ls, months)
        );
      });
      const knownAccounts = new Set(newAccounts.map((a) => a.id));
      const accounts = [...allAccounts.filter((a) => !knownAccounts.has(a.id)), ...preparedAccounts];

      const allBanks = await read<BankAccount>(LOCAL_KEYS.bankAccounts);
      const nextBanks = related.bankAccounts ?? [];
      const preparedBanks = nextBanks.map((bank) => {
        const existingBank = allBanks.find((b) => b.id === bank.id);
        return stamp(prepareProtectedSave('bank_accounts', existingBank, bank, ls, months));
      });
      const replaced = new Set(nextBanks.map((b) => b.id));
      const banks = [...allBanks.filter((b) => !replaced.has(b.id)), ...preparedBanks];

      if (newAccounts.length) await write(LOCAL_KEYS.accounts, accounts);
      if (replaced.size) await write(LOCAL_KEYS.bankAccounts, banks);
      await write(LOCAL_KEYS.openings, [...others, preparedOpening]);
      const existingAudit = await read<AuditEntry>(LOCAL_KEYS.audit);
      await write(LOCAL_KEYS.audit, [...existingAudit, stamp(audit)]);
    },

    async listBankAccounts(clientId) {
      const all = await read<BankAccount>(LOCAL_KEYS.bankAccounts);
      return all.filter((b) => b.clientId === clientId);
    },
    async saveBankAccount(account) {
      const all = await read<BankAccount>(LOCAL_KEYS.bankAccounts);
      const existing = all.find((b) => b.id === account.id);
      const prepared = prepareProtectedSave(
        'bank_accounts',
        existing,
        account,
        await readLockState(account.clientId),
        await lockedMonthsOf(account.clientId)
      );
      await write(LOCAL_KEYS.bankAccounts, [...all.filter((b) => b.id !== account.id), stamp(prepared)]);
    },

    async listPeriodLocks(clientId) {
      const all = await read<PeriodLock>(LOCAL_KEYS.locks);
      return all.filter((l) => l.clientId === clientId);
    },
    async getLockState(clientId) {
      return readLockState(clientId);
    },
    async closePeriod(lock, audit) {
      const locks = await read<PeriodLock>(LOCAL_KEYS.locks);
      if (locks.some((l) => l.id === lock.id)) throw new Error('Competência já está fechada.');
      const nextLs = nextLockStateOnClose(await readLockState(lock.clientId), lock.id);
      await upsert(LOCAL_KEYS.locks, stamp(lock));
      await replace(LOCAL_KEYS.lockState, stamp(nextLs));
      const existingAudit = await read<AuditEntry>(LOCAL_KEYS.audit);
      await write(LOCAL_KEYS.audit, [...existingAudit, stamp({ ...audit, id: periodAuditId(lock, 'close') })]);
    },
    async reopenPeriod(lock, audit) {
      if (!isAdminSession()) throw new Error('Somente o administrador do escritório pode reabrir competências.');
      const nextLs = nextLockStateOnReopen(await readLockState(lock.clientId), lock.id);
      await remove<PeriodLock>(LOCAL_KEYS.locks, lock.id);
      await replace(LOCAL_KEYS.lockState, stamp(nextLs));
      const existingAudit = await read<AuditEntry>(LOCAL_KEYS.audit);
      await write(LOCAL_KEYS.audit, [...existingAudit, stamp({ ...audit, id: periodAuditId(lock, 'reopen') })]);
    },

    async listPeriodSnapshots(clientId) {
      const all = await read<PeriodSnapshot>(LOCAL_KEYS.snapshots);
      return all.filter((s) => s.clientId === clientId);
    },
    async savePeriodSnapshot(snapshot) {
      const all = await read<PeriodSnapshot>(LOCAL_KEYS.snapshots);
      const others = all.filter((s) => s.id !== snapshot.id);
      await write(LOCAL_KEYS.snapshots, [...others, stamp(snapshot)]);
    },

    async listAudit(clientId, options = {}) {
      const all = await read<AuditEntry>(LOCAL_KEYS.audit);
      return all
        .filter((a) => a.clientId === clientId && (!options.transactionId || a.transactionId === options.transactionId))
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, options.limit ?? 200);
    },

    async listClientRequests(clientId) {
      const all = await read<ClientRequest>(LOCAL_KEYS.requests);
      return all.filter((r) => r.clientId === clientId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async saveClientRequest(request) {
      const all = (await read<ClientRequest>(LOCAL_KEYS.requests)).filter((r) => r.id !== request.id);
      await write(LOCAL_KEYS.requests, [...all, stamp(request)]);
    },
    async closeClientRequest(requestId) {
      const all = await read<ClientRequest>(LOCAL_KEYS.requests);
      const i = all.findIndex((r) => r.id === requestId);
      if (i < 0) throw new Error('Link não encontrado.');
      all[i] = { ...all[i], status: 'CLOSED' };
      await write(LOCAL_KEYS.requests, all);
    },

    async renewClientRequest(requestId, expiresAtMs) {
      const all = await read<ClientRequest>(LOCAL_KEYS.requests);
      const i = all.findIndex((r) => r.id === requestId);
      if (i < 0) throw new Error('Link não encontrado.');
      all[i] = { ...all[i], status: 'OPEN', expiresAtMs };
      await write(LOCAL_KEYS.requests, all);
    },
    async markClientRequestsSeen(items) {
      if (!items.length) return;
      const seenMap = new Map(items.map((x) => [x.id, x.seenAt] as const));
      const all = (await read<ClientRequest>(LOCAL_KEYS.requests)).map((r) =>
        seenMap.has(r.id) ? { ...r, seenAt: seenMap.get(r.id)! } : r
      );
      await write(LOCAL_KEYS.requests, all);
    },
    async listOpenOrgClientRequests() {
      const all = await read<ClientRequest>(LOCAL_KEYS.requests);
      return all.filter((r) => r.status === 'OPEN').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    /* ── Lançamentos manuais de fechamento (Diário Avulso) ─────────────── */
    async listJournalEntries(clientId: string, range?: DateRange): Promise<JournalEntry[]> {
      const all = await read<JournalEntry>(LOCAL_KEYS.journalEntries);
      return all
        .filter((j) => j.clientId === clientId && (!range || (j.date >= range.start && j.date <= range.end)))
        .sort((a, b) => b.date.localeCompare(a.date) || b.entryNumber - a.entryNumber);
    },
    async createJournalEntry(draft: JournalEntryDraft, audit?: AuditEntry): Promise<JournalEntry> {
      assertValidJournalEntry(draft);
      const list = await read<JournalEntry>(LOCAL_KEYS.journalEntries);
      const counters = await read<JournalCounter>(LOCAL_KEYS.journalCounters);
      // Cliente ainda sem contador: a sequência parte do maior número já usado.
      const last =
        counters.find((c) => c.clientId === draft.clientId)?.last ??
        list.filter((j) => j.clientId === draft.clientId).reduce((max, j) => Math.max(max, j.entryNumber || 0), 0);
      const entry: JournalEntry = { ...draft, entryNumber: last + 1 };
      await write(LOCAL_KEYS.journalCounters, [
        ...counters.filter((c) => c.clientId !== draft.clientId),
        stamp({ id: draft.clientId, clientId: draft.clientId, last: entry.entryNumber }),
      ]);
      await write(LOCAL_KEYS.journalEntries, [...list, stamp(entry)]);
      if (audit) {
        const existingAudit = await read<AuditEntry>(LOCAL_KEYS.audit);
        await write(LOCAL_KEYS.audit, [...existingAudit, stamp(audit)]);
      }
      return entry;
    },
    async updateJournalEntry(entry: JournalEntry, audit?: AuditEntry): Promise<void> {
      assertValidJournalEntry(entry);
      const list = await read<JournalEntry>(LOCAL_KEYS.journalEntries);
      const idx = list.findIndex((j) => j.id === entry.id);
      if (idx < 0) throw new Error(`Lançamento manual ${entry.id} não encontrado.`);
      // O número é imutável, como nas regras do Firestore.
      const stamped = stamp({ ...entry, entryNumber: list[idx].entryNumber });
      await write(
        LOCAL_KEYS.journalEntries,
        list.map((j, i) => (i === idx ? stamped : j))
      );
      if (audit) {
        const existingAudit = await read<AuditEntry>(LOCAL_KEYS.audit);
        await write(LOCAL_KEYS.audit, [...existingAudit, stamp(audit)]);
      }
    },
    async deleteJournalEntry(entryId: string, audit?: AuditEntry): Promise<void> {
      const list = await read<JournalEntry>(LOCAL_KEYS.journalEntries);
      await write(
        LOCAL_KEYS.journalEntries,
        list.filter((j) => j.id !== entryId)
      );
      if (audit) {
        const existingAudit = await read<AuditEntry>(LOCAL_KEYS.audit);
        await write(LOCAL_KEYS.audit, [...existingAudit, stamp(audit)]);
      }
    },

    // Valida tudo antes de escrever: entra o encerramento inteiro ou nada, como no Firestore.
    async closeYear(drafts, audit) {
      if (drafts.length === 0) throw new Error('Nada a encerrar.');
      drafts.forEach(assertValidJournalEntry);
      const clientId = drafts[0].clientId;
      const list = await read<JournalEntry>(LOCAL_KEYS.journalEntries);
      const counters = await read<JournalCounter>(LOCAL_KEYS.journalCounters);
      const base =
        counters.find((c) => c.clientId === clientId)?.last ??
        list.filter((j) => j.clientId === clientId).reduce((max, j) => Math.max(max, j.entryNumber || 0), 0);
      const entries: JournalEntry[] = drafts.map((d, i) => ({
        ...d,
        entryNumber: base + i + 1,
        closingAuditId: audit.id,
      }));
      const nextLs = nextLockStateOnYearClose(await readLockState(clientId), audit.id);
      await write(LOCAL_KEYS.journalCounters, [
        ...counters.filter((c) => c.clientId !== clientId),
        stamp({ id: clientId, clientId, last: base + entries.length }),
      ]);
      await replace(LOCAL_KEYS.lockState, stamp(nextLs));
      await write(LOCAL_KEYS.journalEntries, [...list, ...entries.map(stamp)]);
      const existingAudit = await read<AuditEntry>(LOCAL_KEYS.audit);
      await write(LOCAL_KEYS.audit, [...existingAudit, stamp(audit)]);
      return entries;
    },
    async reopenYear(entries, audit) {
      const gone = new Set(entries.map((e) => e.id));
      const current = await read<JournalEntry>(LOCAL_KEYS.journalEntries);
      await write(
        LOCAL_KEYS.journalEntries,
        current.filter((j) => !gone.has(j.id))
      );
      const existingAudit = await read<AuditEntry>(LOCAL_KEYS.audit);
      await write(LOCAL_KEYS.audit, [...existingAudit, stamp(audit)]);
    },

    async listInvoices(clientId, range) {
      const all = await read<InvoiceSummary>(LOCAL_KEYS.invoices);
      return all
        .filter((i) => i.clientId === clientId && (!range || (i.issueDate >= range.start && i.issueDate <= range.end)))
        .map((i) => ({ ...i, status: i.status ?? 'AUTHORIZED' }))
        .sort(
          (a, b) =>
            b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number, undefined, { numeric: true })
        );
    },
    async saveInvoices(invoices) {
      const stored = await read<InvoiceSummary>(LOCAL_KEYS.invoices);
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
        stored[i] = stamp({
          ...inv,
          links: prev.links,
          status: prev.status === 'CANCELLED' ? 'CANCELLED' : inv.status,
        });
      }
      await write(LOCAL_KEYS.invoices, stored);
    },
    async cancelInvoices(clientId, keys) {
      const ids = new Set(keys.map((k) => invoiceId(clientId, k)));
      const stored = await read<InvoiceSummary>(LOCAL_KEYS.invoices);
      let count = 0;
      for (const inv of stored) {
        if (!ids.has(inv.id)) continue;
        inv.status = 'CANCELLED';
        count++;
      }
      await write(LOCAL_KEYS.invoices, stored);
      return count;
    },
    async linkInvoice(id, link) {
      const stored = await read<InvoiceSummary>(LOCAL_KEYS.invoices);
      const inv = stored.find((i) => i.id === id);
      if (!inv) throw new Error('Nota fiscal não encontrada.');
      inv.links = [...(inv.links ?? []).filter((l) => l.transactionId !== link.transactionId), link];
      await write(LOCAL_KEYS.invoices, stored);
      return { ...inv, status: inv.status ?? 'AUTHORIZED' };
    },
    async deleteInvoice(id) {
      await remove<InvoiceSummary>(LOCAL_KEYS.invoices, id);
    },

    async getFixedAssets(clientId) {
      const all = await read<FixedAssetRegister>(LOCAL_KEYS.fixedAssets);
      return all.find((r) => r.clientId === clientId) ?? null;
    },
    async saveFixedAssets(register, audit, journal = {}) {
      return saveRegister(LOCAL_KEYS.fixedAssets, register, audit, journal);
    },
    async getPrepaidExpenses(clientId) {
      const all = await read<PrepaidRegister>(LOCAL_KEYS.prepaid);
      return all.find((r) => r.clientId === clientId) ?? null;
    },
    async savePrepaidExpenses(register, audit, journal = {}) {
      return saveRegister(LOCAL_KEYS.prepaid, register, audit, journal);
    },
    async getFinancingContracts(clientId) {
      const all = await read<FinancingRegister>(LOCAL_KEYS.financing);
      return all.find((r) => r.clientId === clientId) ?? null;
    },
    async saveFinancingContracts(register, audit, journal = {}) {
      return saveRegister(LOCAL_KEYS.financing, register, audit, journal);
    },
    async getInvestments(clientId) {
      const all = await read<InvestmentRegister>(LOCAL_KEYS.investments);
      return all.find((r) => r.clientId === clientId) ?? null;
    },
    async saveInvestments(register, audit) {
      return saveRegister(LOCAL_KEYS.investments, register, audit, {});
    },
    async getStockControl(clientId) {
      const all = await read<StockControl>(LOCAL_KEYS.stock);
      return all.find((r) => r.clientId === clientId) ?? null;
    },
    async saveStockControl(control, audit) {
      return saveRegister(LOCAL_KEYS.stock, control, audit, {});
    },
    async getPayrollRegister(clientId) {
      const all = await read<PayrollRegister>(LOCAL_KEYS.payroll);
      return all.find((r) => r.clientId === clientId) ?? null;
    },
    async savePayrollRegister(register, audit, journal = {}) {
      return saveRegister(LOCAL_KEYS.payroll, register, audit, journal);
    },

    async getClosingChecklist(clientId, year) {
      const all = await read<ClosingChecklist>(LOCAL_KEYS.checklists);
      return all.find((c) => c.clientId === clientId && c.year === year) ?? null;
    },
    async saveClosingChecklist(checklist) {
      const id = `${checklist.clientId}_${checklist.year}`;
      const existing = await read<ClosingChecklist>(LOCAL_KEYS.checklists);
      await write(LOCAL_KEYS.checklists, [
        ...existing.filter((c) => c.id !== id),
        stamp(JSON.parse(JSON.stringify({ ...checklist, id })) as ClosingChecklist),
      ]);
    },

    async getExplanatoryNotes(clientId, year) {
      const all = await read<ExplanatoryNotes>(LOCAL_KEYS.notes);
      return all.find((n) => n.clientId === clientId && n.year === year) ?? null;
    },
    async saveExplanatoryNotes(notes) {
      const id = `${notes.clientId}_${notes.year}`;
      const existing = await read<ExplanatoryNotes>(LOCAL_KEYS.notes);
      await write(LOCAL_KEYS.notes, [...existing.filter((n) => n.id !== id), stamp({ ...notes, id })]);
    },

    async getPublicClientRequest(token) {
      const all = await read<ClientRequest>(LOCAL_KEYS.requests);
      return all.find((r) => r.id === token) ?? null;
    },
    async answerPublicClientRequest(token, answers, respondedAt) {
      const all = await read<ClientRequest>(LOCAL_KEYS.requests);
      const i = all.findIndex((r) => r.id === token);
      if (i < 0) throw new Error('Link inválido.');
      const req = all[i];
      if (req.status !== 'OPEN' || Date.now() >= req.expiresAtMs) throw new Error('Este link não aceita mais respostas.');
      if (answers.length !== req.items.length) throw new Error('É preciso uma resposta por pergunta.');
      // Só as respostas mudam; as perguntas ficam como o escritório gravou.
      all[i] = { ...req, answers: [...answers], respondedAt };
      await write(LOCAL_KEYS.requests, all);
    },
  };
  return repo;
}
