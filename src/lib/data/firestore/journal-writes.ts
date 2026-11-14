import { doc, runTransaction, where, type Transaction } from 'firebase/firestore';
import type { AuditEntry, JournalEntry } from '@/types/firestore';
import { type FixedAssetJournalChange, type JournalEntryDraft, type RegisterSaveOptions, resolveNextRegisterVersion } from '@/lib/data/repository';
import { getDoc, getDocs } from '@/lib/data/counted-reads';
import { addReads } from '@/lib/data/read-meter';
import { assertValidJournalEntry } from '@/lib/journal';
import { isRegisterConflictError, rethrowPermissionDenied } from '@/lib/utils/errors';
import { COL, JOURNAL_NUMBER_ATTEMPTS, type FirestoreContext } from './shared';

/** Maior número de lançamento já usado pelo cliente (sequência ainda sem contador). */
export async function journalSeed(ctx: FirestoreContext, clientId: string): Promise<number> {
  const snap = await getDocs(ctx.scoped(COL.journalEntries, where('clientId', '==', clientId)));
  return snap.docs.reduce((max, d) => Math.max(max, Number(d.data().entryNumber) || 0), 0);
}

/**
 * Cadastro de um documento por cliente gravado dentro de transação com:
 * - validação otimista da versão/updatedAt (evita lost update entre abas/usuários);
 * - registro de auditoria obrigatório;
 * - criação (com próximo número), substituição in-place (`replace`) e/ou exclusão de lançamentos.
 */
export async function saveRegister(
  ctx: FirestoreContext,
  name: string,
  register: { clientId: string; version?: number },
  audit: AuditEntry,
  journal: FixedAssetJournalChange,
  options?: RegisterSaveOptions
): Promise<JournalEntry | null> {
  const { db, stamp, auditData } = ctx;
  const ref = doc(db, name, register.clientId);
  const deleteIds = Array.from(new Set([...(journal.deleteId ? [journal.deleteId] : []), ...(journal.deleteIds ?? [])]));
  // Itens aninhados: campos `undefined` saem pelo JSON (o Firestore os recusa).
  const rawBase = JSON.parse(JSON.stringify({ ...register, id: register.clientId })) as Record<string, unknown>;
  if (journal.create) assertValidJournalEntry(journal.create);
  if (journal.replace) assertValidJournalEntry(journal.replace.draft);

  const counterRef = journal.create || journal.replace ? doc(db, COL.journalCounters, register.clientId) : null;
  const replaceRef = journal.replace ? doc(db, COL.journalEntries, journal.replace.id) : null;

  let seed = 0;
  if (counterRef && !(await getDoc(counterRef)).exists()) seed = await journalSeed(ctx, register.clientId);

  try {
    for (let attempt = 1; ; attempt++) {
      let seenCounter: number | null = null;
      try {
        return await runTransaction(db, async (t) => {
          // Todas as leituras antes de qualquer escrita (exigência do Firestore).
          const regSnap = await t.get(ref);
          addReads(1);
          const replaceSnap = replaceRef ? await t.get(replaceRef) : null;
          if (replaceRef) addReads(1);
          const needCounter = Boolean(journal.create) || Boolean(journal.replace && !replaceSnap?.exists());
          const counterSnap = needCounter && counterRef ? await t.get(counterRef) : null;
          if (counterSnap) addReads(1);

          const nextVersion = resolveNextRegisterVersion(register, regSnap.exists() ? regSnap.data() : null, options);
          const data = stamp({ ...rawBase, version: nextVersion });

          let nextNumber: number | null = null;
          if (needCounter && counterRef) {
            seenCounter = counterSnap?.exists() ? Number(counterSnap.data().last) || 0 : null;
            nextNumber = (seenCounter ?? seed) + 1;
            t.set(counterRef, stamp({ id: register.clientId, clientId: register.clientId, last: nextNumber }));
          }

          let createdOrReplaced: JournalEntry | null = null;
          if (journal.create && nextNumber !== null) {
            const entry: JournalEntry = { ...journal.create, entryNumber: nextNumber };
            t.set(doc(db, COL.journalEntries, entry.id), stamp(entry));
            createdOrReplaced = entry;
          }
          if (journal.replace && replaceRef) {
            if (replaceSnap?.exists()) {
              const prev = replaceSnap.data() as JournalEntry;
              const updated: JournalEntry = {
                ...journal.replace.draft,
                id: journal.replace.id,
                entryNumber: Number(prev.entryNumber),
                ...(prev.createdAt ? { createdAt: prev.createdAt } : {}),
                ...(prev.createdByUid ? { createdByUid: prev.createdByUid } : {}),
              };
              t.set(replaceRef, stamp(updated));
              createdOrReplaced = updated;
            } else if (nextNumber !== null) {
              const created: JournalEntry = { ...journal.replace.draft, id: journal.replace.id, entryNumber: nextNumber };
              t.set(replaceRef, stamp(created));
              createdOrReplaced = created;
            }
          }

          t.set(ref, data);
          for (const id of deleteIds) t.delete(doc(db, COL.journalEntries, id));
          t.set(doc(db, COL.audit, audit.id), auditData(audit));
          return createdOrReplaced;
        });
      } catch (err) {
        if (isRegisterConflictError(err) || !counterRef) throw err;
        const current = await getDoc(counterRef);
        const now = current.exists() ? Number(current.data().last) || 0 : null;
        if (now === seenCounter || attempt >= JOURNAL_NUMBER_ATTEMPTS) throw err;
      }
    }
  } catch (err) {
    if (deleteIds.length > 0) {
      rethrowPermissionDenied(err, 'Somente administradores podem excluir lançamentos do Diário.');
    }
    throw err;
  }
}

/**
 * Grava um lançamento manual novo com o próximo número da sequência do cliente e, na mesma
 * transação, o registro de auditoria e as escritas de `extra`.
 */
export async function createJournalWith(
  ctx: FirestoreContext,
  draft: JournalEntryDraft,
  audit: AuditEntry,
  extra?: (t: Transaction) => void
): Promise<JournalEntry> {
  const { db, stamp, auditData } = ctx;
  assertValidJournalEntry(draft);
  const counterRef = doc(db, COL.journalCounters, draft.clientId);
  // Cliente ainda sem contador: a sequência parte do maior número já usado. A consulta
  // fica fora da transação, que só lê documentos por referência.
  let seed = 0;
  if (!(await getDoc(counterRef)).exists()) seed = await journalSeed(ctx, draft.clientId);
  // Número e lançamento gravados juntos: dois usuários simultâneos nunca recebem o mesmo número.
  for (let attempt = 1; ; attempt++) {
    let seen: number | null = null;
    try {
      return await runTransaction(db, async (t) => {
        const counter = await t.get(counterRef);
        addReads(1);
        seen = counter.exists() ? Number(counter.data().last) || 0 : null;
        const entry: JournalEntry = { ...draft, entryNumber: (seen ?? seed) + 1 };
        t.set(counterRef, stamp({ id: draft.clientId, clientId: draft.clientId, last: entry.entryNumber }));
        t.set(doc(db, COL.journalEntries, entry.id), stamp(entry));
        t.set(doc(db, COL.audit, audit.id), auditData(audit));
        extra?.(t);
        return entry;
      });
    } catch (err) {
      // Se outro usuário avançou o contador entre a leitura e a gravação, as regras recusam
      // o número repetido (em vez de a transação repetir sozinha). Só nesse caso tenta de
      // novo; qualquer outra recusa (ex.: competência fechada) sobe ao chamador.
      const current = await getDoc(counterRef);
      const now = current.exists() ? Number(current.data().last) || 0 : null;
      if (now === seen || attempt >= JOURNAL_NUMBER_ATTEMPTS) throw err;
    }
  }
}
