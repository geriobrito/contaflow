import { doc, runTransaction, where, writeBatch, type QueryConstraint } from 'firebase/firestore';
import type { JournalCounter, JournalEntry, LockState } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { getDoc, getDocs } from '@/lib/data/counted-reads';
import { addReads } from '@/lib/data/read-meter';
import { assertValidJournalEntry } from '@/lib/journal';
import { nextLockStateOnYearClose } from '@/lib/lock-guard';
import { rethrowPermissionDenied } from '@/lib/utils/errors';
import { createJournalWith, journalSeed } from './journal-writes';
import { BATCH_LIMIT, COL, type FirestoreContext } from './shared';

/** Lançamentos manuais (Diário) e encerramento do exercício. */
export function journalMethods(ctx: FirestoreContext) {
  const { db, scoped, stamp, auditData, auditWrite } = ctx;
  return {
    async listJournalEntries(clientId, range) {
      // Com `range`, índice composto: (orgId, clientId, date).
      const constraints: QueryConstraint[] = [where('clientId', '==', clientId)];
      if (range) constraints.push(where('date', '>=', range.start), where('date', '<=', range.end));
      const snap = await getDocs(scoped(COL.journalEntries, ...constraints));
      return snap.docs
        .map((d) => ({ ...(d.data() as JournalEntry), id: d.id }))
        .sort((a, b) => b.date.localeCompare(a.date) || b.entryNumber - a.entryNumber);
    },
    async getJournalCounter(clientId) {
      return ctx.getById<JournalCounter>(COL.journalCounters, clientId);
    },
    async createJournalEntry(draft, audit) {
      return createJournalWith(ctx, draft, audit);
    },
    async updateJournalEntry(entry, audit) {
      assertValidJournalEntry(entry);
      const b = writeBatch(db);
      b.set(doc(db, COL.journalEntries, entry.id), stamp(entry));
      auditWrite(audit)(b);
      await b.commit();
    },
    async deleteJournalEntry(entryId, audit) {
      const b = writeBatch(db);
      b.delete(doc(db, COL.journalEntries, entryId));
      auditWrite(audit)(b);
      try {
        await b.commit();
      } catch (err) {
        rethrowPermissionDenied(err, 'Somente administradores podem excluir lançamentos do Diário.');
      }
    },

    /* ── Encerramento do exercício ────────────────────────────────────── */
    // Transação (não um lote simples) porque os números saem do contador lido nela. As regras
    // aceitam o contador saltar o bloco inteiro quando o YEAR_CLOSE nasce na mesma gravação.
    async closeYear(drafts, audit) {
      if (drafts.length === 0) throw new Error('Nada a encerrar.');
      if (drafts.length + 3 > BATCH_LIMIT) throw new Error('Encerramento maior que o limite de uma gravação.');
      drafts.forEach(assertValidJournalEntry);
      const clientId = drafts[0].clientId;
      const counterRef = doc(db, COL.journalCounters, clientId);
      const lockStateRef = doc(db, COL.lockState, clientId);
      let seed = 0;
      if (!(await getDoc(counterRef)).exists()) seed = await journalSeed(ctx, clientId);
      return runTransaction(db, async (t) => {
        const [counter, lockStateSnap] = await Promise.all([t.get(counterRef), t.get(lockStateRef)]);
        addReads(2);
        const currentLs = lockStateSnap.exists() ? { ...(lockStateSnap.data() as LockState), id: lockStateSnap.id } : null;
        const nextLs = nextLockStateOnYearClose(currentLs, audit.id);
        const base = counter.exists() ? Number(counter.data().last) || 0 : seed;
        const entries: JournalEntry[] = drafts.map((d, i) => ({ ...d, entryNumber: base + i + 1, closingAuditId: audit.id }));
        t.set(counterRef, stamp({ id: clientId, clientId, last: base + entries.length, closingAudit: audit.id }));
        t.set(lockStateRef, stamp(nextLs));
        for (const e of entries) t.set(doc(db, COL.journalEntries, e.id), stamp(e));
        t.set(doc(db, COL.audit, audit.id), auditData(audit));
        return entries;
      });
    },
    async reopenYear(entries, audit) {
      if (entries.length + 1 > BATCH_LIMIT) throw new Error('Encerramento maior que o limite de uma gravação.');
      const b = writeBatch(db);
      for (const e of entries) b.delete(doc(db, COL.journalEntries, e.id));
      auditWrite(audit)(b);
      await b.commit();
    },
  } satisfies Partial<DataRepository>;
}
