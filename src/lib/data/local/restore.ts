import type { AuditEntry, LockState } from '@/types/firestore';
import type { DataRepository, LocalClientRestorePayload } from '@/lib/data/repository';
import { LOCAL_KEYS, type LocalContext } from './store';

/** Restauração fiel de uma empresa a partir do backup (só no modo local). */
export function restoreMethods(ctx: LocalContext) {
  const { ready, read, write, replace, stamp } = ctx;
  return {
    async restoreLocalClientData(payload: LocalClientRestorePayload) {
      await ready();
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
      const one = <T,>(item: T | null | undefined): T[] => (item ? [item] : []);

      replace(LOCAL_KEYS.clients, stamp(payload.client));
      mergeScopedOrGlobal(LOCAL_KEYS.accounts, payload.accounts);
      mergeScopedOrGlobal(LOCAL_KEYS.rules, payload.rules);
      replaceForClient(LOCAL_KEYS.bankAccounts, payload.bankAccounts);
      replaceForClient(LOCAL_KEYS.openings, one(payload.openingBalances));
      replaceForClient(LOCAL_KEYS.batches, payload.importBatches);
      replaceForClient(LOCAL_KEYS.transactions, payload.transactions);
      replaceForClient(LOCAL_KEYS.journalEntries, payload.journalEntries);
      replaceForClient(
        LOCAL_KEYS.journalCounters,
        payload.journalCounter
          ? [payload.journalCounter]
          : payload.journalEntries.length > 0
            ? [{ id: clientId, clientId, last: payload.journalEntries.reduce((max, e) => Math.max(max, e.entryNumber || 0), 0) }]
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
      replaceForClient(LOCAL_KEYS.fixedAssets, one(payload.fixedAssets));
      replaceForClient(LOCAL_KEYS.prepaid, one(payload.prepaidExpenses));
      replaceForClient(LOCAL_KEYS.financing, one(payload.financingContracts));
      replaceForClient(LOCAL_KEYS.investments, one(payload.investments));
      replaceForClient(LOCAL_KEYS.stock, one(payload.stockControl));
      replaceForClient(LOCAL_KEYS.payroll, one(payload.payrollRegister));
      replaceForClient(LOCAL_KEYS.checklists, payload.closingChecklists);
      replaceForClient(LOCAL_KEYS.notes, payload.explanatoryNotes);
      // Backups anteriores aos honorários e à agenda não trazem esses campos: o que existe fica.
      if (payload.feeRegister !== undefined) replaceForClient(LOCAL_KEYS.fees, one(payload.feeRegister));
      if (payload.obligationChecks !== undefined) replaceForClient(LOCAL_KEYS.obligations, one(payload.obligationChecks));
      // Os caches (saldos consolidados e resumos da DRE) são refeitos a partir dos dados restaurados.
      replaceForClient(LOCAL_KEYS.snapshots, []);
      replaceForClient(LOCAL_KEYS.resultSummaries, []);

      const existingAudit = read<AuditEntry>(LOCAL_KEYS.audit);
      const seenAuditIds = new Set(existingAudit.map((a) => a.id));
      const importedAudit = payload.audit.filter((a) => !seenAuditIds.has(a.id)).map((a) => stamp(a));
      write(LOCAL_KEYS.audit, [...existingAudit, ...importedAudit, stamp(payload.restoreAudit)]);
    },
  } satisfies Partial<DataRepository>;
}
