import { doc, limit, orderBy, setDoc, where, type QueryConstraint } from 'firebase/firestore';
import type { BankTransaction, ImportBatch } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { getCountFromServer, getDoc, getDocs } from '@/lib/data/counted-reads';
import { monthOf } from '@/lib/periods';
import { reportError } from '@/lib/monitoring';
import { chunk, COL, IN_LIMIT, single, type FirestoreContext } from './shared';

/** Lançamentos bancários e extratos importados. */
export function transactionMethods(ctx: FirestoreContext) {
  const { db, scoped, stamp, run, changeGroups, txFrom } = ctx;
  return {
    async listTransactions(clientId, range) {
      // Índice composto: orgId ASC, clientId ASC, date DESC.
      const constraints: QueryConstraint[] = [where('clientId', '==', clientId)];
      if (range) constraints.push(where('date', '>=', range.start), where('date', '<=', range.end));
      constraints.push(orderBy('date', 'desc'));
      const snap = await getDocs(scoped(COL.transactions, ...constraints));
      return snap.docs.map(txFrom);
    },
    async listPendingTransactions(clientId) {
      const snap = await getDocs(scoped(COL.transactions, where('clientId', '==', clientId), where('status', '==', 'PENDING')));
      return snap.docs.map(txFrom);
    },
    async latestTransactionDate(clientId) {
      const snap = await getDocs(scoped(COL.transactions, where('clientId', '==', clientId), orderBy('date', 'desc'), limit(1)));
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
      const snap = await getDocs(
        scoped(COL.transactions, where('clientId', '==', clientId), where('status', '==', status), orderBy('date', 'asc'), limit(1))
      );
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
    async commitChanges(changes) {
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
  } satisfies Partial<DataRepository>;
}
