import type { JournalCounter, JournalEntry } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { isAdminSession } from '@/lib/data/scope';
import { assertValidJournalEntry } from '@/lib/journal';
import { nextLockStateOnYearClose } from '@/lib/lock-guard';
import { LOCAL_KEYS, type LocalContext } from './store';

/** Lançamentos manuais (Diário) e encerramento do exercício. */
export function journalMethods(ctx: LocalContext) {
  const { ready, read, write, replace, stamp, appendAudit, readLockState, lastJournalNumber, assertMonthsOpen } = ctx;
  const setCounter = (counters: readonly JournalCounter[], clientId: string, last: number) =>
    write(LOCAL_KEYS.journalCounters, [...counters.filter((c) => c.clientId !== clientId), stamp({ id: clientId, clientId, last })]);
  return {
    async listJournalEntries(clientId, range) {
      await ready();
      return read<JournalEntry>(LOCAL_KEYS.journalEntries)
        .filter((j) => j.clientId === clientId && (!range || (j.date >= range.start && j.date <= range.end)))
        .sort((a, b) => b.date.localeCompare(a.date) || b.entryNumber - a.entryNumber);
    },
    async getJournalCounter(clientId) {
      await ready();
      return read<JournalCounter>(LOCAL_KEYS.journalCounters).find((c) => c.clientId === clientId) ?? null;
    },
    async createJournalEntry(draft, audit) {
      assertValidJournalEntry(draft);
      assertMonthsOpen([draft]);
      const list = read<JournalEntry>(LOCAL_KEYS.journalEntries);
      const counters = read<JournalCounter>(LOCAL_KEYS.journalCounters);
      // Cliente ainda sem contador: a sequência parte do maior número já usado.
      const entry: JournalEntry = { ...draft, entryNumber: lastJournalNumber(draft.clientId, list, counters) + 1 };
      setCounter(counters, draft.clientId, entry.entryNumber);
      write(LOCAL_KEYS.journalEntries, [...list, stamp(entry)]);
      appendAudit(audit);
      return entry;
    },
    async updateJournalEntry(entry, audit) {
      assertValidJournalEntry(entry);
      const list = read<JournalEntry>(LOCAL_KEYS.journalEntries);
      const idx = list.findIndex((j) => j.id === entry.id);
      if (idx < 0) throw new Error(`Lançamento manual ${entry.id} não encontrado.`);
      assertMonthsOpen([list[idx], entry]);
      // O número é imutável, como nas regras do Firestore.
      const stamped = stamp({ ...entry, entryNumber: list[idx].entryNumber });
      write(
        LOCAL_KEYS.journalEntries,
        list.map((j, i) => (i === idx ? stamped : j))
      );
      appendAudit(audit);
    },
    async deleteJournalEntry(entryId, audit) {
      if (!isAdminSession()) {
        throw Object.assign(new Error('Somente administradores podem excluir lançamentos do Diário.'), { code: 'permission-denied' });
      }
      const all = read<JournalEntry>(LOCAL_KEYS.journalEntries);
      const target = all.find((j) => j.id === entryId);
      if (target) assertMonthsOpen([target]);
      write(
        LOCAL_KEYS.journalEntries,
        all.filter((j) => j.id !== entryId)
      );
      appendAudit(audit);
    },

    // Valida tudo antes de escrever: entra o encerramento inteiro ou nada, como no Firestore.
    async closeYear(drafts, audit) {
      if (drafts.length === 0) throw new Error('Nada a encerrar.');
      drafts.forEach(assertValidJournalEntry);
      const clientId = drafts[0].clientId;
      const list = read<JournalEntry>(LOCAL_KEYS.journalEntries);
      const counters = read<JournalCounter>(LOCAL_KEYS.journalCounters);
      const base = lastJournalNumber(clientId, list, counters);
      const entries: JournalEntry[] = drafts.map((d, i) => ({ ...d, entryNumber: base + i + 1, closingAuditId: audit.id }));
      const nextLs = nextLockStateOnYearClose(readLockState(clientId), audit.id);
      setCounter(counters, clientId, base + entries.length);
      replace(LOCAL_KEYS.lockState, stamp(nextLs));
      write(LOCAL_KEYS.journalEntries, [...list, ...entries.map(stamp)]);
      appendAudit(audit);
      return entries;
    },
    async reopenYear(entries, audit) {
      const gone = new Set(entries.map((e) => e.id));
      write(
        LOCAL_KEYS.journalEntries,
        read<JournalEntry>(LOCAL_KEYS.journalEntries).filter((j) => !gone.has(j.id))
      );
      appendAudit(audit);
    },
  } satisfies Partial<DataRepository>;
}
