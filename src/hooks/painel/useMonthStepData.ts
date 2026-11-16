'use client';

import { useEffect, useState } from 'react';
import type { ChartAccount } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { loadMonthRoutines, type MonthRoutines } from '@/lib/services/month-routines';
import { lastDayOf } from '@/lib/business-days';
import { previousMonthOf } from '@/lib/dashboard';
import { repeatCandidates } from '@/lib/journal';
import { journalOrigin } from '@/lib/journal-origin';
import { reportError } from '@/lib/monitoring';

export interface MonthStepData {
  routines: MonthRoutines | null;
  invoices: { total: number; unlinked: number };
  journal: { manual: number; repeatable: number };
}

/**
 * O que a "Rotina do mês" do Painel lê além do que o painel já tem: as rotinas dos cadastros, as
 * notas fiscais e os lançamentos manuais da competência (e do mês anterior, para o que se repete).
 * Cada leitura que falha vira "nada a mostrar" e é reportada: o passo não trava os demais.
 */
export function useMonthStepData(clientId: string | undefined, month: string | null, accounts: readonly ChartAccount[]): MonthStepData | undefined {
  const [state, setState] = useState<{ key: string; value: MonthStepData } | null>(null);
  const key = `${clientId}|${month}`;

  useEffect(() => {
    if (!clientId || !month) return;
    let active = true;
    const repo = getRepository();
    const range = { start: `${month}-01`, end: lastDayOf(month) };
    const safe = <T,>(op: string, p: Promise<T>, fallback: T): Promise<T> =>
      p.catch((e: unknown) => {
        reportError(e, { area: 'painel', op, level: 'warning' });
        return fallback;
      });
    void Promise.all([
      safe('rotinas do mês', loadMonthRoutines(clientId, month), null),
      safe('notas do mês', repo.listInvoices(clientId, range), []),
      safe('lançamentos manuais do mês', repo.listJournalEntries(clientId, { start: `${previousMonthOf(month)}-01`, end: range.end }), []),
    ]).then(([routines, invoices, entries]) => {
      if (!active) return;
      const valid = invoices.filter((i) => i.status !== 'CANCELLED');
      setState({
        key: `${clientId}|${month}`,
        value: {
          routines,
          invoices: { total: valid.length, unlinked: valid.filter((i) => !i.links?.length).length },
          journal: {
            manual: entries.filter((e) => e.date.startsWith(month) && !journalOrigin(e)).length,
            repeatable: repeatCandidates(entries, month, accounts).filter((c) => !c.problem).length,
          },
        },
      });
    });
    return () => {
      active = false;
    };
  }, [clientId, month, accounts]);

  return state?.key === key ? state.value : undefined;
}
