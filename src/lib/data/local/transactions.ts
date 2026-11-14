import type { BankTransaction, ImportBatch } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { byDateDesc, LOCAL_KEYS, type LocalContext } from './store';

/** Lançamentos bancários e extratos importados. */
export function transactionMethods(ctx: LocalContext) {
  const { ready, read, write, upsert, remove, stamp, applyChanges, assertMonthsOpen } = ctx;
  const ofClient = (clientId: string) => read<BankTransaction>(LOCAL_KEYS.transactions).filter((t) => t.clientId === clientId);
  return {
    async listTransactions(clientId, range) {
      await ready();
      return ofClient(clientId)
        .filter((t) => !range || (t.date >= range.start && t.date <= range.end))
        .sort(byDateDesc);
    },
    async listPendingTransactions(clientId) {
      await ready();
      return ofClient(clientId).filter((t) => t.status === 'PENDING');
    },
    async latestTransactionDate(clientId) {
      await ready();
      const dates = ofClient(clientId).map((t) => t.date);
      return dates.length ? dates.reduce((max, d) => (d > max ? d : max)) : null;
    },
    async countTransactions(clientId, until) {
      await ready();
      return ofClient(clientId).filter((t) => t.date <= until).length;
    },
    async countTransactionsByStatus(clientId, status) {
      await ready();
      return ofClient(clientId).filter((t) => t.status === status).length;
    },
    async oldestTransactionDate(clientId, status) {
      await ready();
      const dates = ofClient(clientId)
        .filter((t) => t.status === status)
        .map((t) => t.date)
        .sort();
      return dates[0] ?? null;
    },
    async isAccountUsedInTransactions(clientId, accountId) {
      await ready();
      return ofClient(clientId).some((t) => t.accountId === accountId || Boolean(t.isSplit && t.splits?.some((s) => s.accountId === accountId)));
    },
    async findExistingTransactionIds(clientId, ids) {
      await ready();
      const wanted = new Set(ids);
      return new Set(
        ofClient(clientId)
          .filter((t) => wanted.has(t.id))
          .map((t) => t.id)
      );
    },
    async insertTransactions(transactions, batch?: ImportBatch) {
      if (batch) upsert(LOCAL_KEYS.batches, stamp({ ...batch, status: 'PROCESSING' }));
      try {
        write(LOCAL_KEYS.transactions, [...read<BankTransaction>(LOCAL_KEYS.transactions), ...transactions.map(stamp)]);
        if (batch) upsert(LOCAL_KEYS.batches, stamp({ ...batch, status: 'COMPLETED' }));
      } catch (err) {
        if (batch) upsert(LOCAL_KEYS.batches, stamp({ ...batch, status: 'FAILED' }));
        throw err;
      }
    },
    async commitChanges(changes) {
      applyChanges(changes);
    },
    async getTransaction(id) {
      await ready();
      return read<BankTransaction>(LOCAL_KEYS.transactions).find((t) => t.id === id) ?? null;
    },
    async listOpenQueries(clientId) {
      await ready();
      return ofClient(clientId)
        .filter((t) => t.clientQuery?.status === 'OPEN')
        .sort(byDateDesc);
    },

    async listImportBatches(clientId) {
      await ready();
      return read<ImportBatch>(LOCAL_KEYS.batches).filter((b) => b.clientId === clientId);
    },
    async saveImportBatch(batch) {
      upsert(LOCAL_KEYS.batches, stamp(batch));
    },
    async listBatchTransactions(batch) {
      await ready();
      return ofClient(batch.clientId)
        .filter((t) => t.importBatchId === batch.id)
        .sort((a, b) => a.date.localeCompare(b.date));
    },
    async deleteImportBatch(batch, transactions, changes) {
      const gone = new Set(transactions.map((t) => t.id));
      assertMonthsOpen(transactions.map((t) => ({ clientId: batch.clientId, date: t.date })));
      applyChanges(changes);
      write(
        LOCAL_KEYS.transactions,
        read<BankTransaction>(LOCAL_KEYS.transactions).filter((t) => !gone.has(t.id))
      );
      remove<ImportBatch>(LOCAL_KEYS.batches, batch.id);
    },
  } satisfies Partial<DataRepository>;
}
