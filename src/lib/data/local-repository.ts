import type {
  AuditEntry,
  BankTransaction,
  ChartAccount,
  ClassificationRule,
  ClientCompany,
  ImportBatch,
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
      for (const key of [LOCAL_KEYS.accounts, LOCAL_KEYS.rules, LOCAL_KEYS.transactions, LOCAL_KEYS.batches, LOCAL_KEYS.locks]) {
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

    async commitChanges({ patches, rules = [], audits }: ChangeSet) {
      // Valida tudo antes de gravar (equivalente à atomicidade do writeBatch).
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
    },

    async listImportBatches(clientId) {
      return read<ImportBatch>(LOCAL_KEYS.batches).filter((b) => b.clientId === clientId);
    },
    async saveImportBatch(batch) {
      upsert(LOCAL_KEYS.batches, stamp(batch));
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
  };
}
