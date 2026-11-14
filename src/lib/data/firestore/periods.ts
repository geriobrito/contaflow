import { doc, limit, orderBy, setDoc, where, writeBatch, type QueryConstraint } from 'firebase/firestore';
import type { PeriodSnapshot, ResultSummary } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { getDocs } from '@/lib/data/counted-reads';
import { nextLockStateOnClose, nextLockStateOnReopen } from '@/lib/lock-guard';
import { periodAuditId } from '@/lib/periods';
import { rethrowPermissionDenied } from '@/lib/utils/errors';
import { COL, single, type FirestoreContext } from './shared';

/** Fechamento de competências, saldos consolidados e resumos da DRE (caches) e auditoria. */
export function periodMethods(ctx: FirestoreContext) {
  const { db, scoped, stamp, run, lockData, lockFrom, auditFrom, auditWrite, readLockState } = ctx;
  return {
    async listPeriodLocks(clientId) {
      const snap = await getDocs(scoped(COL.locks, where('clientId', '==', clientId)));
      return snap.docs.map(lockFrom);
    },
    async getLockState(clientId) {
      return readLockState(clientId);
    },
    // As regras exigem o registro de auditoria e o avanço do lock_state na mesma gravação.
    async closePeriod(lock, audit) {
      const nextLs = nextLockStateOnClose(await readLockState(lock.clientId), lock.id);
      const b = writeBatch(db);
      b.set(doc(db, COL.locks, lock.id), lockData(lock));
      b.set(doc(db, COL.lockState, lock.clientId), stamp(nextLs));
      auditWrite({ ...audit, id: periodAuditId(lock, 'close') })(b);
      await b.commit();
    },
    async reopenPeriod(lock, audit) {
      const nextLs = nextLockStateOnReopen(await readLockState(lock.clientId), lock.id);
      const b = writeBatch(db);
      b.delete(doc(db, COL.locks, lock.id));
      b.set(doc(db, COL.lockState, lock.clientId), stamp(nextLs));
      auditWrite({ ...audit, id: periodAuditId(lock, 'reopen') })(b);
      try {
        await b.commit();
      } catch (e) {
        rethrowPermissionDenied(e, 'Somente o administrador do escritório pode reabrir competências.');
      }
    },

    /* ── Saldos consolidados (cache) ──────────────────────────────────── */
    async listPeriodSnapshots(clientId) {
      const snap = await getDocs(scoped(COL.snapshots, where('clientId', '==', clientId)));
      return snap.docs.map((d) => ({ ...(d.data() as PeriodSnapshot), id: d.id }));
    },
    async savePeriodSnapshot(snapshot) {
      await setDoc(doc(db, COL.snapshots, snapshot.id), stamp(snapshot));
    },

    /* ── Resumos da DRE (cache) ───────────────────────────────────────── */
    async listResultSummaries(clientId, fromMonth, toMonth) {
      // Índice composto: (orgId, clientId, month).
      const snap = await getDocs(
        scoped(COL.resultSummaries, where('clientId', '==', clientId), where('month', '>=', fromMonth), where('month', '<=', toMonth))
      );
      return snap.docs.map((d) => ({ ...(d.data() as ResultSummary), id: d.id })).sort((a, b) => a.month.localeCompare(b.month));
    },
    async saveResultSummaries(summaries) {
      // Listas aninhadas: `undefined` sai pelo JSON.
      await run(summaries.map((s) => single((b) => b.set(doc(db, COL.resultSummaries, s.id), stamp(JSON.parse(JSON.stringify(s)) as ResultSummary)))));
    },

    /* ── Auditoria ────────────────────────────────────────────────────── */
    async listAudit(clientId, options = {}) {
      // Índices compostos: (orgId, clientId, at desc) e (orgId, clientId, transactionId, at desc).
      const constraints: QueryConstraint[] = [where('clientId', '==', clientId)];
      if (options.transactionId) constraints.push(where('transactionId', '==', options.transactionId));
      constraints.push(orderBy('at', 'desc'), limit(options.limit ?? 200));
      const snap = await getDocs(scoped(COL.audit, ...constraints));
      return snap.docs.map(auditFrom);
    },
  } satisfies Partial<DataRepository>;
}
