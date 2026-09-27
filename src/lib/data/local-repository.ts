import type {
  BankTransaction,
  ChartAccount,
  ClassificationRule,
  ClientCompany,
  ImportBatch,
} from '@/types/firestore';
import type { ClassificationCommit, DataRepository } from '@/lib/data/repository';

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
} as const;

/** orgId gravado nos documentos do modo local (um único usuário por navegador). */
export const LOCAL_ORG_ID = 'local';

const byCode = (a: ChartAccount, b: ChartAccount) => a.code.localeCompare(b.code, undefined, { numeric: true });
const byDateDesc = (a: BankTransaction, b: BankTransaction) => b.date.localeCompare(a.date);

/** Remove campos da transação (equivalente local de `deleteField`). */
function omit<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const copy = { ...obj };
  for (const k of keys) delete copy[k];
  return copy;
}

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
  function updateTx(id: string, fn: (t: BankTransaction) => BankTransaction): void {
    const items = read<BankTransaction>(LOCAL_KEYS.transactions);
    const i = items.findIndex((t) => t.id === id);
    if (i < 0) throw new Error(`Lançamento ${id} não encontrado.`);
    items[i] = fn(items[i]);
    write(LOCAL_KEYS.transactions, items);
  }
  const stamp = <T extends object>(x: T): T => ({ ...x, orgId: LOCAL_ORG_ID });
  const inScope = (owner: string, clientId: string) => owner === clientId || owner === 'global';

  return {
    mode: 'local',

    async listClients() {
      return read<ClientCompany>(LOCAL_KEYS.clients);
    },
    async saveClient(client) {
      upsert(LOCAL_KEYS.clients, stamp(client));
    },
    async deleteClient(clientId) {
      if (!clientId || clientId === 'global') throw new Error('Cliente inválido para exclusão.');
      for (const key of [LOCAL_KEYS.accounts, LOCAL_KEYS.rules, LOCAL_KEYS.transactions, LOCAL_KEYS.batches]) {
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

    async commitClassification({ transactionId, account, rule, similarIds, now }: ClassificationCommit) {
      // Monta tudo em memória e grava de uma vez (atomicidade equivalente ao writeBatch).
      const similar = new Set(similarIds);
      const txs = read<BankTransaction>(LOCAL_KEYS.transactions);
      if (!txs.some((t) => t.id === transactionId)) throw new Error(`Lançamento ${transactionId} não encontrado.`);
      const next = txs.map((t) => {
        if (t.id === transactionId) {
          return {
            ...omit(t, ['splits', 'matchedRuleId']),
            ...account,
            status: 'RECONCILED' as const,
            isSplit: false,
            reconciledAt: now,
            ...(rule ? { matchedRuleId: rule.id } : {}),
          };
        }
        if (similar.has(t.id)) {
          return { ...t, ...account, status: 'AUTO_CLASSIFIED' as const, ...(rule ? { matchedRuleId: rule.id } : {}) };
        }
        return t;
      });
      if (rule) upsert(LOCAL_KEYS.rules, stamp(rule));
      write(LOCAL_KEYS.transactions, next);
    },

    async saveSplits(transactionId, splits, now) {
      updateTx(transactionId, (t) => ({
        ...omit(t, ['accountId', 'accountCode', 'accountName', 'matchedRuleId']),
        status: 'RECONCILED',
        isSplit: true,
        splits: [...splits],
        reconciledAt: now,
      }));
    },

    async resetToPending(transactionId) {
      updateTx(transactionId, (t) => ({
        ...omit(t, ['accountId', 'accountCode', 'accountName', 'matchedRuleId', 'splits', 'reconciledAt']),
        status: 'PENDING',
        isSplit: false,
      }));
    },

    async approveTransactions(ids, now) {
      const wanted = new Set(ids);
      write(
        LOCAL_KEYS.transactions,
        read<BankTransaction>(LOCAL_KEYS.transactions).map((t) =>
          wanted.has(t.id) ? { ...t, status: 'RECONCILED' as const, reconciledAt: now } : t
        )
      );
    },
  };
}
