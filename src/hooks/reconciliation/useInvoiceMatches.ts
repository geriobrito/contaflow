'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BankTransaction, ChartAccount, InvoiceSummary } from '@/types/firestore';
import type { DateRange } from '@/lib/data/repository';
import { getRepository } from '@/lib/services/data-service';
import { linkedInvoices, matchInvoices, type InvoiceMatch } from '@/lib/nfe/match';
import { addDays } from '@/lib/statement';
import { reportError } from '@/lib/monitoring';

/**
 * Notas emitidas até este número de dias antes do período ainda podem ser pagas nele (boletos
 * parcelados). Lê só essa janela, não o histórico inteiro de notas.
 */
const LOOKBACK_DAYS = 180;
/** Pagamento adiantado: nota emitida logo depois do período. */
const LOOKAHEAD_DAYS = 7;

export interface InvoiceMatchesState {
  /** Nota casada com cada lançamento ainda não conciliado. */
  matches: ReadonlyMap<string, InvoiceMatch>;
  /** Nota vinculada a cada lançamento já confirmado. */
  linked: ReadonlyMap<string, InvoiceSummary>;
  /** Marca a nota como quitada (em parte) pelo lançamento, com a conta usada. Falha não interrompe a conciliação. */
  link: (transactionId: string, invoiceId: string, accountId: string) => Promise<void>;
}

/**
 * Casamento dos lançamentos da Conciliação com as notas fiscais importadas. Falha na leitura das
 * notas não impede a conciliação: só não há sugestão.
 */
export function useInvoiceMatches(params: {
  clientId: string | null;
  range: DateRange | null;
  transactions: readonly BankTransaction[];
  accounts: readonly ChartAccount[];
}): InvoiceMatchesState {
  const { clientId, range, transactions, accounts } = params;
  const window = range ? { start: addDays(range.start, -LOOKBACK_DAYS), end: addDays(range.end, LOOKAHEAD_DAYS) } : null;
  const key = clientId && window ? `${clientId}|${window.start}|${window.end}` : null;
  const [data, setData] = useState<{ key: string; invoices: InvoiceSummary[] } | null>(null);

  useEffect(() => {
    if (!key || !clientId || !window) return;
    let active = true;
    getRepository()
      .listInvoices(clientId, window)
      .then((invoices) => active && setData({ key, invoices }))
      .catch((e: unknown) => reportError(e, { area: 'conciliacao', op: 'carregar notas fiscais', level: 'warning' }));
    return () => {
      active = false;
    };
    // `window` muda junto com `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, clientId]);

  const invoices = useMemo(() => (data && data.key === key ? data.invoices : []), [data, key]);
  const matches = useMemo(() => matchInvoices(transactions, invoices, accounts), [transactions, invoices, accounts]);
  const linked = useMemo(() => linkedInvoices(invoices), [invoices]);

  const link = useCallback(
    async (transactionId: string, invoiceId: string, accountId: string) => {
      const match = matches.get(transactionId);
      const amount = match?.invoice.id === invoiceId ? match.amount : Math.abs(transactions.find((t) => t.id === transactionId)?.amount ?? 0);
      try {
        const updated = await getRepository().linkInvoice(invoiceId, { transactionId, amount, accountId, linkedAt: new Date().toISOString() });
        setData((prev) => (prev ? { ...prev, invoices: prev.invoices.map((i) => (i.id === updated.id ? updated : i)) } : prev));
      } catch (e) {
        // A classificação já foi gravada; sem o vínculo, a nota só continua "sem lançamento".
        reportError(e, { area: 'conciliacao', op: 'vincular nota fiscal', level: 'warning' });
      }
    },
    [matches, transactions]
  );

  return { matches, linked, link };
}
