import type { AuditEntry, PeriodLock, PeriodSnapshot, ResultSummary } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { isAdminSession } from '@/lib/data/scope';
import { nextLockStateOnClose, nextLockStateOnReopen } from '@/lib/lock-guard';
import { periodAuditId } from '@/lib/periods';
import { LOCAL_KEYS, type LocalContext } from './store';

/** Fechamento de competências, saldos consolidados e resumos da DRE (caches) e auditoria. */
export function periodMethods(ctx: LocalContext) {
  const { ready, read, write, upsert, remove, replace, stamp, appendAudit, readLockState } = ctx;
  return {
    async listPeriodLocks(clientId) {
      await ready();
      return read<PeriodLock>(LOCAL_KEYS.locks).filter((l) => l.clientId === clientId);
    },
    async getLockState(clientId) {
      await ready();
      return readLockState(clientId);
    },
    async closePeriod(lock, audit) {
      if (read<PeriodLock>(LOCAL_KEYS.locks).some((l) => l.id === lock.id)) throw new Error('Competência já está fechada.');
      const nextLs = nextLockStateOnClose(readLockState(lock.clientId), lock.id);
      upsert(LOCAL_KEYS.locks, stamp(lock));
      replace(LOCAL_KEYS.lockState, stamp(nextLs));
      appendAudit({ ...audit, id: periodAuditId(lock, 'close') });
    },
    async reopenPeriod(lock, audit) {
      if (!isAdminSession()) throw new Error('Somente o administrador do escritório pode reabrir competências.');
      const nextLs = nextLockStateOnReopen(readLockState(lock.clientId), lock.id);
      remove<PeriodLock>(LOCAL_KEYS.locks, lock.id);
      replace(LOCAL_KEYS.lockState, stamp(nextLs));
      appendAudit({ ...audit, id: periodAuditId(lock, 'reopen') });
    },

    async listPeriodSnapshots(clientId) {
      await ready();
      return read<PeriodSnapshot>(LOCAL_KEYS.snapshots).filter((s) => s.clientId === clientId);
    },
    async savePeriodSnapshot(snapshot) {
      const others = read<PeriodSnapshot>(LOCAL_KEYS.snapshots).filter((s) => s.id !== snapshot.id);
      write(LOCAL_KEYS.snapshots, [...others, stamp(snapshot)]);
    },

    async listResultSummaries(clientId, fromMonth, toMonth) {
      await ready();
      return read<ResultSummary>(LOCAL_KEYS.resultSummaries)
        .filter((s) => s.clientId === clientId && s.month >= fromMonth && s.month <= toMonth)
        .sort((a, b) => a.month.localeCompare(b.month));
    },
    async saveResultSummaries(summaries) {
      if (!summaries.length) return;
      const ids = new Set(summaries.map((s) => s.id));
      const others = read<ResultSummary>(LOCAL_KEYS.resultSummaries).filter((s) => !ids.has(s.id));
      write(LOCAL_KEYS.resultSummaries, [...others, ...summaries.map(stamp)]);
    },

    async listAudit(clientId, options = {}) {
      await ready();
      return read<AuditEntry>(LOCAL_KEYS.audit)
        .filter((a) => a.clientId === clientId && (!options.transactionId || a.transactionId === options.transactionId))
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, options.limit ?? 200);
    },
  } satisfies Partial<DataRepository>;
}
