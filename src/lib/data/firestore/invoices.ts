import { deleteDoc, doc, updateDoc, where, type QueryConstraint } from 'firebase/firestore';
import type { InvoiceSummary } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { getDoc, getDocs } from '@/lib/data/counted-reads';
import { invoiceId } from '@/lib/nfe/import';
import { chunk, clean, COL, IN_LIMIT, single, type FirestoreContext } from './shared';

/** Notas fiscais: só o resumo do XML. */
export function invoiceMethods(ctx: FirestoreContext) {
  const { db, scoped, stamp, run, invoiceFrom } = ctx;
  return {
    async listInvoices(clientId, range) {
      // Índice composto: (orgId, clientId, issueDate).
      const constraints: QueryConstraint[] = [where('clientId', '==', clientId)];
      if (range) constraints.push(where('issueDate', '>=', range.start), where('issueDate', '<=', range.end));
      const snap = await getDocs(scoped(COL.invoices, ...constraints));
      return snap.docs
        .map(invoiceFrom)
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number, undefined, { numeric: true }));
    },
    async findExistingInvoiceKeys(clientId, keys) {
      const unique = [...new Set(keys.filter(Boolean))];
      const existing = new Set<string>();
      for (const group of chunk(unique, IN_LIMIT)) {
        const snap = await getDocs(scoped(COL.invoices, where('clientId', '==', clientId), where('key', 'in', group)));
        snap.docs.forEach((d) => {
          const key = (d.data() as InvoiceSummary).key;
          if (key) existing.add(key);
        });
      }
      return existing;
    },
    async saveInvoices(invoices) {
      // Mescla, sem ler antes: os vínculos ficam como estão, e a situação só é gravada quando
      // é cancelamento (sem o campo, a nota é autorizada) — reimportar não "descancela".
      await run(
        invoices.map((inv) => {
          const { links: _links, status, ...rest } = inv;
          void _links;
          const data = stamp(status === 'CANCELLED' ? { ...rest, status } : rest);
          return single((b) => b.set(doc(db, COL.invoices, inv.id), data, { merge: true }));
        })
      );
    },
    async cancelInvoices(clientId, keys) {
      const refs = keys.map((k) => doc(db, COL.invoices, invoiceId(clientId, k)));
      const snaps = await Promise.all(
        refs.map(async (ref) => {
          try {
            return await getDoc(ref);
          } catch {
            return null; // nota de outro escritório ou inexistente com outra dona: ignora
          }
        })
      );
      const existing = refs.filter((_, i) => snaps[i]?.exists());
      await run(existing.map((ref) => single((b) => b.update(ref, { status: 'CANCELLED' }))));
      return existing.length;
    },
    async linkInvoice(id, link) {
      const ref = doc(db, COL.invoices, id);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error('Nota fiscal não encontrada.');
      const current = invoiceFrom(snap);
      const links = [...(current.links ?? []).filter((l) => l.transactionId !== link.transactionId), clean(link) as typeof link];
      await updateDoc(ref, { links });
      return { ...current, links };
    },
    async deleteInvoice(id) {
      await deleteDoc(doc(db, COL.invoices, id));
    },
  } satisfies Partial<DataRepository>;
}
