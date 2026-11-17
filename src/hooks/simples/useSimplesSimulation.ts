'use client';

import { useEffect, useState } from 'react';
import type { InvoiceSummary, OrgSettings } from '@/types/firestore';
import type { DateRange } from '@/lib/data/repository';
import { getRepository } from '@/lib/services/data-service';
import { describeError } from '@/lib/utils/errors';
import { reportError } from '@/lib/monitoring';

interface Loaded {
  key: string;
  invoices: InvoiceSummary[];
  org: OrgSettings | null;
}

/** Notas do período e o escritório (para as assinaturas do relatório) da simulação do Simples. */
export function useSimplesSimulation(clientId: string | undefined, range: DateRange | null) {
  const key = clientId && range ? `${clientId}|${range.start}|${range.end}` : null;
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    if (!clientId || !range || !key) return;
    let active = true;
    const repo = getRepository();
    Promise.all([repo.listInvoices(clientId, range), repo.getOrgSettings()])
      .then(([invoices, org]) => {
        if (active) setState({ key, invoices, org });
      })
      .catch((e: unknown) => {
        reportError(e, { area: 'simples-ibs-cbs', op: 'carregar notas' });
        if (active) setError({ key, message: describeError(e) });
      });
    return () => {
      active = false;
    };
  }, [clientId, range, key]);

  const ready = state && state.key === key ? state : null;
  return {
    invoices: ready?.invoices ?? null,
    org: ready?.org ?? null,
    error: error && error.key === key ? error.message : null,
    loading: Boolean(key) && !ready && !(error && error.key === key),
  };
}
