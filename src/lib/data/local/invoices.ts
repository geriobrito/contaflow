import type { InvoiceSummary } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { invoiceId } from '@/lib/nfe/import';
import { LOCAL_KEYS, type LocalContext } from './store';

/** Notas fiscais: só o resumo do XML. */
export function invoiceMethods(ctx: LocalContext) {
  const { ready, read, write, remove, stamp } = ctx;
  return {
    async listInvoices(clientId, range) {
      await ready();
      return read<InvoiceSummary>(LOCAL_KEYS.invoices)
        .filter((i) => i.clientId === clientId && (!range || (i.issueDate >= range.start && i.issueDate <= range.end)))
        .map((i) => ({ ...i, status: i.status ?? 'AUTHORIZED' }))
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number, undefined, { numeric: true }));
    },
    async saveInvoices(invoices) {
      const stored = read<InvoiceSummary>(LOCAL_KEYS.invoices);
      const index = new Map(stored.map((s, i) => [s.id, i] as const));
      for (const inv of invoices) {
        const i = index.get(inv.id);
        if (i === undefined) {
          index.set(inv.id, stored.length);
          stored.push(stamp({ ...inv, links: undefined }));
          continue;
        }
        // Mesmo comportamento do Firestore: vínculos preservados e cancelamento nunca desfeito.
        const prev = stored[i];
        stored[i] = stamp({ ...inv, links: prev.links, status: prev.status === 'CANCELLED' ? 'CANCELLED' : inv.status });
      }
      write(LOCAL_KEYS.invoices, stored);
    },
    async cancelInvoices(clientId, keys) {
      const ids = new Set(keys.map((k) => invoiceId(clientId, k)));
      const stored = read<InvoiceSummary>(LOCAL_KEYS.invoices);
      let count = 0;
      for (const inv of stored) {
        if (!ids.has(inv.id)) continue;
        inv.status = 'CANCELLED';
        count++;
      }
      write(LOCAL_KEYS.invoices, stored);
      return count;
    },
    async linkInvoice(id, link) {
      const stored = read<InvoiceSummary>(LOCAL_KEYS.invoices);
      const inv = stored.find((i) => i.id === id);
      if (!inv) throw new Error('Nota fiscal não encontrada.');
      inv.links = [...(inv.links ?? []).filter((l) => l.transactionId !== link.transactionId), link];
      write(LOCAL_KEYS.invoices, stored);
      return { ...inv, status: inv.status ?? 'AUTHORIZED' };
    },
    async deleteInvoice(id) {
      remove<InvoiceSummary>(LOCAL_KEYS.invoices, id);
    },
  } satisfies Partial<DataRepository>;
}
