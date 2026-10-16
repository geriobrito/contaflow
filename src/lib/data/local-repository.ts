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
  JournalCounter,
  JournalEntry,
  OpeningBalances,
  OrgSettings,
  PeriodLock,
  PeriodSnapshot,
} from '@/types/firestore';
import type { ChangeSet, DataRepository, DateRange, JournalEntryDraft } from '@/lib/data/repository';
import { assertValidJournalEntry } from '@/lib/journal';
import { periodAuditId } from '@/lib/periods';
import { applyPatch } from '@/lib/transitions';

/** Subconjunto de `Storage` usado — permite injetar um armazenamento em memória nos testes. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const LOCAL_KEYS = {
  clients: 'contaflow_clients',
  accounts: 'contaflow_accounts',
  transactions: 'contaflow_transactions',
  rules: 'contaflow_rules',
  batches: 'contaflow_batches',
  locks: 'contaflow_period_locks',
  audit: 'contaflow_audit_log',
  org: 'contaflow_org',
  bankAccounts: 'contaflow_bank_accounts',
  openings: 'contaflow_opening_balances',
  requests: 'contaflow_client_requests',
  journalEntries: 'contaflow_journal_entries',
  journalCounters: 'contaflow_journal_counters',
  snapshots: 'contaflow_period_snapshots',
  notes: 'contaflow_explanatory_notes',
} as const;

/** orgId gravado nos documentos do modo local (um único usuário por navegador). */
export const LOCAL_ORG_ID = 'local';

const byCode = (a: ChartAccount, b: ChartAccount) => a.code.localeCompare(b.code, undefined, { numeric: true });
const byDateDesc = (a: BankTransaction, b: BankTransaction) => b.date.localeCompare(a.date);

/**
 * Repositório de desenvolvimento/demonstração em localStorage. Usado apenas quando o
 * Firebase não está configurado — nunca em paralelo ao Firestore. Falhas de leitura
 * ou escrita (JSON corrompido, cota excedida) são propagadas.
 */
export function createLocalRepository(store: KeyValueStore): DataRepository {
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
  const stamp = <T extends object>(x: T): T => ({ ...x, orgId: LOCAL_ORG_ID });

  /** Valida tudo antes de gravar (equivalente à atomicidade do writeBatch). */
  function applyChanges({ patches, rules = [], audits }: ChangeSet): void {
    const txs = read<BankTransaction>(LOCAL_KEYS.transactions);
    const index = new Map(txs.map((t, i) => [t.id, i] as const));
    for (const p of patches) if (!index.has(p.id)) throw new Error(`Lançamento ${p.id} não encontrado.`);
    for (const p of patches) {
      const i = index.get(p.id)!;
      txs[i] = applyPatch(txs[i], p);
    }
    const storedRules = read<ClassificationRule>(LOCAL_KEYS.rules);
    for (const rule of rules) {
      const i = storedRules.findIndex((r) => r.id === rule.id);
      if (i >= 0) storedRules[i] = { ...storedRules[i], ...stamp(rule) };
      else storedRules.push(stamp(rule));
    }
    write(LOCAL_KEYS.rules, storedRules);
    write(LOCAL_KEYS.transactions, txs);
    write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), ...audits.map(stamp)]);
  }

  const inScope = (owner: string, clientId: string) => owner === clientId || owner === 'global';

  return {
    mode: 'local',

    async getOrgSettings() {
      return read<OrgSettings>(LOCAL_KEYS.org)[0] ?? null;
    },
    async saveOrgSettings(settings) {
      write(LOCAL_KEYS.org, [stamp(settings)]);
    },

    async listClients() {
      return read<ClientCompany>(LOCAL_KEYS.clients);
    },
    async saveClient(client) {
      upsert(LOCAL_KEYS.clients, stamp(client));
    },
    async deleteClient(clientId, actor) {
      if (!clientId || clientId === 'global') throw new Error('Cliente inválido para exclusão.');
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
        LOCAL_KEYS.bankAccounts,
        LOCAL_KEYS.openings,
        LOCAL_KEYS.requests,
        LOCAL_KEYS.journalEntries,
        LOCAL_KEYS.journalCounters,
        LOCAL_KEYS.snapshots,
        LOCAL_KEYS.notes,
      ]) {
        write(
          key,
          read<{ clientId: string }>(key).filter((x) => x.clientId !== clientId)
        );
      }
      remove<ClientCompany>(LOCAL_KEYS.clients, clientId);
    },

    async listAccounts(clientId) {
      return read<ChartAccount>(LOCAL_KEYS.accounts).filter((a) => inScope(a.clientId, clientId)).sort(byCode);
    },
    async saveAccount(account) {
      upsert(LOCAL_KEYS.accounts, stamp(account));
    },
    async deleteAccount(accountId, audit) {
      remove<ChartAccount>(LOCAL_KEYS.accounts, accountId);
      if (audit) write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), stamp(audit)]);
    },
    async insertAccounts(accounts) {
      write(LOCAL_KEYS.accounts, [...read<ChartAccount>(LOCAL_KEYS.accounts), ...accounts.map(stamp)]);
    },
    async saveChartSetup({ accounts, bankAccounts }) {
      // Monta as duas listas antes de gravar qualquer uma.
      const storedAccounts = read<ChartAccount>(LOCAL_KEYS.accounts);
      for (const acc of accounts) {
        const i = storedAccounts.findIndex((a) => a.id === acc.id);
        if (i >= 0) storedAccounts[i] = { ...storedAccounts[i], ...stamp(acc) };
        else storedAccounts.push(stamp(acc));
      }
      const replaced = new Set(bankAccounts.map((b) => b.id));
      const storedBanks = [...read<BankAccount>(LOCAL_KEYS.bankAccounts).filter((b) => !replaced.has(b.id)), ...bankAccounts.map(stamp)];
      write(LOCAL_KEYS.accounts, storedAccounts);
      write(LOCAL_KEYS.bankAccounts, storedBanks);
    },

    async listRules(clientId) {
      return read<ClassificationRule>(LOCAL_KEYS.rules).filter((r) => inScope(r.clientId, clientId));
    },
    async saveRule(rule) {
      upsert(LOCAL_KEYS.rules, stamp(rule));
    },
    async deleteRule(ruleId) {
      remove<ClassificationRule>(LOCAL_KEYS.rules, ruleId);
    },

    async listTransactions(clientId, range) {
      return read<BankTransaction>(LOCAL_KEYS.transactions)
        .filter((t) => t.clientId === clientId && (!range || (t.date >= range.start && t.date <= range.end)))
        .sort(byDateDesc);
    },
    async listPendingTransactions(clientId) {
      return read<BankTransaction>(LOCAL_KEYS.transactions).filter((t) => t.clientId === clientId && t.status === 'PENDING');
    },
    async latestTransactionDate(clientId) {
      const dates = read<BankTransaction>(LOCAL_KEYS.transactions)
        .filter((t) => t.clientId === clientId)
        .map((t) => t.date);
      return dates.length ? dates.reduce((max, d) => (d > max ? d : max)) : null;
    },
    async countTransactions(clientId, until) {
      return read<BankTransaction>(LOCAL_KEYS.transactions).filter((t) => t.clientId === clientId && t.date <= until).length;
    },
    async countTransactionsByStatus(clientId, status) {
      return read<BankTransaction>(LOCAL_KEYS.transactions).filter((t) => t.clientId === clientId && t.status === status).length;
    },
    async oldestTransactionDate(clientId, status) {
      const dates = read<BankTransaction>(LOCAL_KEYS.transactions)
        .filter((t) => t.clientId === clientId && t.status === status)
        .map((t) => t.date)
        .sort();
      return dates[0] ?? null;
    },
    async isAccountUsedInTransactions(clientId, accountId) {
      return read<BankTransaction>(LOCAL_KEYS.transactions).some(
        (t) => t.clientId === clientId && (t.accountId === accountId || Boolean(t.isSplit && t.splits?.some((s) => s.accountId === accountId)))
      );
    },
    async findExistingTransactionIds(clientId, ids) {
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
      return read<BankTransaction>(LOCAL_KEYS.transactions).find((t) => t.id === id) ?? null;
    },
    async listOpenQueries(clientId) {
      return read<BankTransaction>(LOCAL_KEYS.transactions)
        .filter((t) => t.clientId === clientId && t.clientQuery?.status === 'OPEN')
        .sort(byDateDesc);
    },

    async listImportBatches(clientId) {
      return read<ImportBatch>(LOCAL_KEYS.batches).filter((b) => b.clientId === clientId);
    },
    async saveImportBatch(batch) {
      upsert(LOCAL_KEYS.batches, stamp(batch));
    },
    async listBatchTransactions(batch) {
      return read<BankTransaction>(LOCAL_KEYS.transactions)
        .filter(
          (t) =>
            t.clientId === batch.clientId &&
            (t.importBatchId === batch.id || (!t.importBatchId && t.createdAt === batch.importedAt))
        )
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
      return read<OpeningBalances>(LOCAL_KEYS.openings).find((o) => o.clientId === clientId) ?? null;
    },
    async saveOpeningBalances(balances, audit, related = {}) {
      // Monta todas as listas antes de gravar qualquer uma.
      const others = read<OpeningBalances>(LOCAL_KEYS.openings).filter((o) => o.clientId !== balances.clientId);
      const newAccounts = related.accounts ?? [];
      const knownAccounts = new Set(newAccounts.map((a) => a.id));
      const accounts = [...read<ChartAccount>(LOCAL_KEYS.accounts).filter((a) => !knownAccounts.has(a.id)), ...newAccounts.map(stamp)];
      const replaced = new Set((related.bankAccounts ?? []).map((b) => b.id));
      const banks = [...read<BankAccount>(LOCAL_KEYS.bankAccounts).filter((b) => !replaced.has(b.id)), ...(related.bankAccounts ?? []).map(stamp)];
      if (newAccounts.length) write(LOCAL_KEYS.accounts, accounts);
      if (replaced.size) write(LOCAL_KEYS.bankAccounts, banks);
      write(LOCAL_KEYS.openings, [...others, stamp({ ...balances, id: balances.clientId })]);
      write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), stamp(audit)]);
    },

    async listBankAccounts(clientId) {
      return read<BankAccount>(LOCAL_KEYS.bankAccounts).filter((b) => b.clientId === clientId);
    },
    async saveBankAccount(account) {
      const all = read<BankAccount>(LOCAL_KEYS.bankAccounts).filter((b) => b.id !== account.id);
      write(LOCAL_KEYS.bankAccounts, [...all, stamp(account)]);
    },

    async listPeriodLocks(clientId) {
      return read<PeriodLock>(LOCAL_KEYS.locks).filter((l) => l.clientId === clientId);
    },
    async closePeriod(lock, audit) {
      if (read<PeriodLock>(LOCAL_KEYS.locks).some((l) => l.id === lock.id)) throw new Error('Competência já está fechada.');
      upsert(LOCAL_KEYS.locks, stamp(lock));
      write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), stamp({ ...audit, id: periodAuditId(lock, 'close') })]);
    },
    async reopenPeriod(lock, audit) {
      remove<PeriodLock>(LOCAL_KEYS.locks, lock.id);
      write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), stamp({ ...audit, id: periodAuditId(lock, 'reopen') })]);
    },

    async listPeriodSnapshots(clientId) {
      return read<PeriodSnapshot>(LOCAL_KEYS.snapshots).filter((s) => s.clientId === clientId);
    },
    async savePeriodSnapshot(snapshot) {
      const others = read<PeriodSnapshot>(LOCAL_KEYS.snapshots).filter((s) => s.id !== snapshot.id);
      write(LOCAL_KEYS.snapshots, [...others, stamp(snapshot)]);
    },

    async listAudit(clientId, options = {}) {
      return read<AuditEntry>(LOCAL_KEYS.audit)
        .filter((a) => a.clientId === clientId && (!options.transactionId || a.transactionId === options.transactionId))
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, options.limit ?? 200);
    },

    async listClientRequests(clientId) {
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

    /* ── Lançamentos manuais de fechamento (Diário Avulso) ─────────────── */
    async listJournalEntries(clientId: string, range?: DateRange): Promise<JournalEntry[]> {
      return read<JournalEntry>(LOCAL_KEYS.journalEntries)
        .filter((j) => j.clientId === clientId && (!range || (j.date >= range.start && j.date <= range.end)))
        .sort((a, b) => b.date.localeCompare(a.date) || b.entryNumber - a.entryNumber);
    },
    async createJournalEntry(draft: JournalEntryDraft, audit?: AuditEntry): Promise<JournalEntry> {
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
      if (audit) {
        write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), stamp(audit)]);
      }
      return entry;
    },
    async updateJournalEntry(entry: JournalEntry, audit?: AuditEntry): Promise<void> {
      assertValidJournalEntry(entry);
      const list = read<JournalEntry>(LOCAL_KEYS.journalEntries);
      const idx = list.findIndex((j) => j.id === entry.id);
      if (idx < 0) throw new Error(`Lançamento manual ${entry.id} não encontrado.`);
      // O número é imutável, como nas regras do Firestore.
      const stamped = stamp({ ...entry, entryNumber: list[idx].entryNumber });
      write(LOCAL_KEYS.journalEntries, list.map((j, i) => (i === idx ? stamped : j)));
      if (audit) {
        write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), stamp(audit)]);
      }
    },
    async deleteJournalEntry(entryId: string, audit?: AuditEntry): Promise<void> {
      const list = read<JournalEntry>(LOCAL_KEYS.journalEntries);
      write(LOCAL_KEYS.journalEntries, list.filter((j) => j.id !== entryId));
      if (audit) {
        write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), stamp(audit)]);
      }
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
      write(LOCAL_KEYS.journalCounters, [...counters.filter((c) => c.clientId !== clientId), stamp({ id: clientId, clientId, last: base + entries.length })]);
      write(LOCAL_KEYS.journalEntries, [...list, ...entries.map(stamp)]);
      write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), stamp(audit)]);
      return entries;
    },
    async reopenYear(entries, audit) {
      const gone = new Set(entries.map((e) => e.id));
      write(LOCAL_KEYS.journalEntries, read<JournalEntry>(LOCAL_KEYS.journalEntries).filter((j) => !gone.has(j.id)));
      write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), stamp(audit)]);
    },

    async getExplanatoryNotes(clientId, year) {
      return read<ExplanatoryNotes>(LOCAL_KEYS.notes).find((n) => n.clientId === clientId && n.year === year) ?? null;
    },
    async saveExplanatoryNotes(notes) {
      const id = `${notes.clientId}_${notes.year}`;
      write(LOCAL_KEYS.notes, [...read<ExplanatoryNotes>(LOCAL_KEYS.notes).filter((n) => n.id !== id), stamp({ ...notes, id })]);
    },

    async getPublicClientRequest(token) {
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
}
