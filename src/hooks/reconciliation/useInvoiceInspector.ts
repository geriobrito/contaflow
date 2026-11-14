'use client';

import { useMemo, useState } from 'react';
import type { BankTransaction, InvoiceSummary } from '@/types/firestore';
import type { InvoiceMatch } from '@/lib/nfe/match';

export interface InspectedInvoice {
  invoice: InvoiceSummary;
  match?: InvoiceMatch | null;
  transaction?: BankTransaction | null;
}

/**
 * Notas fiscais na lista da Conciliação: a marca de cada lançamento (nota sugerida ou já
 * vinculada) e o painel de detalhe da nota aberto a partir dele.
 */
export function useInvoiceInspector(invoices: { matches: ReadonlyMap<string, InvoiceMatch>; linked: ReadonlyMap<string, InvoiceSummary> }) {
  const [inspecting, setInspecting] = useState<InspectedInvoice | null>(null);
  const hints = useMemo(() => {
    const map = new Map<string, 'match' | 'linked'>();
    for (const id of invoices.linked.keys()) map.set(id, 'linked');
    for (const id of invoices.matches.keys()) map.set(id, 'match');
    return map;
  }, [invoices.matches, invoices.linked]);

  /** Sugestão de nota só vale para lançamento ainda não conciliado. */
  const matchFor = (t: BankTransaction) => (t.status === 'RECONCILED' ? null : invoices.matches.get(t.id));

  /** Abre a nota do lançamento (a sugerida ou a vinculada), se houver. */
  const openFor = (t: BankTransaction) => {
    const match = matchFor(t);
    const inv = match?.invoice ?? invoices.linked.get(t.id) ?? null;
    if (inv) setInspecting({ invoice: inv, match, transaction: t });
  };

  return { hints, inspecting, matchFor, openFor, show: setInspecting, close: () => setInspecting(null) };
}
