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
  OpeningBalances,
  OrgSettings,
  PeriodLock,
} from '@/types/firestore';
import type { ChangeSet, DataRepository } from '@/lib/data/repository';
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
  requestFiles: 'contaflow_client_request_files',
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
    async deleteClient(clientId) {
      if (!clientId || clientId === 'global') throw new Error('Cliente inválido para exclusão.');
      // A trilha de auditoria é preservada, como no Firestore.
      for (const key of [
        LOCAL_KEYS.accounts,
        LOCAL_KEYS.rules,
        LOCAL_KEYS.transactions,
        LOCAL_KEYS.batches,
        LOCAL_KEYS.locks,
        LOCAL_KEYS.bankAccounts,
        LOCAL_KEYS.openings,
        LOCAL_KEYS.requests,
        LOCAL_KEYS.requestFiles,
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
    async deleteAccount(accountId) {
      remove<ChartAccount>(LOCAL_KEYS.accounts, accountId);
    },
    async insertAccounts(accounts) {
      write(LOCAL_KEYS.accounts, [...read<ChartAccount>(LOCAL_KEYS.accounts), ...accounts.map(stamp)]);
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
    async findExistingTransactionIds(clientId, ids) {
      const wanted = new Set(ids);
      return new Set(
        read<BankTransaction>(LOCAL_KEYS.transactions)
          .filter((t) => t.clientId === clientId && wanted.has(t.id))
          .map((t) => t.id)
      );
    },
    async insertTransactions(transactions, batch?: ImportBatch) {
      write(LOCAL_KEYS.transactions, [...read<BankTransaction>(LOCAL_KEYS.transactions), ...transactions.map(stamp)]);
      if (batch) write(LOCAL_KEYS.batches, [stamp(batch), ...read<ImportBatch>(LOCAL_KEYS.batches)]);
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
    async saveOpeningBalances(balances, audit) {
      const others = read<OpeningBalances>(LOCAL_KEYS.openings).filter((o) => o.clientId !== balances.clientId);
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
      write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), stamp(audit)]);
    },
    async reopenPeriod(lock, audit) {
      remove<PeriodLock>(LOCAL_KEYS.locks, lock.id);
      write(LOCAL_KEYS.audit, [...read<AuditEntry>(LOCAL_KEYS.audit), stamp(audit)]);
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
    async getClientRequestFile(fileId) {
      return read<ClientRequestFile>(LOCAL_KEYS.requestFiles).find((f) => f.id === fileId) ?? null;
    },

    async getPublicClientRequest(token) {
      return read<ClientRequest>(LOCAL_KEYS.requests).find((r) => r.id === token) ?? null;
    },
    async answerPublicClientRequest(token, items, respondedAt) {
      const all = read<ClientRequest>(LOCAL_KEYS.requests);
      const i = all.findIndex((r) => r.id === token);
      if (i < 0) throw new Error('Link inválido.');
      const req = all[i];
      if (req.status !== 'OPEN' || Date.now() >= req.expiresAtMs) throw new Error('Este link não aceita mais respostas.');
      if (items.length !== req.items.length) throw new Error('Lista de perguntas alterada.');
      all[i] = { ...req, items: [...items], respondedAt };
      write(LOCAL_KEYS.requests, all);
    },
    async uploadPublicClientRequestFile(file) {
      const req = read<ClientRequest>(LOCAL_KEYS.requests).find((r) => r.id === file.requestId);
      if (!req || req.status !== 'OPEN' || Date.now() >= req.expiresAtMs) throw new Error('Este link não aceita mais arquivos.');
      write(LOCAL_KEYS.requestFiles, [...read<ClientRequestFile>(LOCAL_KEYS.requestFiles), file]);
    },
  };
}
