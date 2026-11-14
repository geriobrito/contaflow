'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BankAccount, BankTransaction, ChartAccount, JournalEntry, PeriodLock } from '@/types/firestore';
import type { BalanceSheet } from '@/lib/ledger';
import { buildDRE, type DREStatement } from '@/lib/dre/build';
import { buildFinancialAnalysis, type FinancialAnalysis } from '@/lib/financial-indicators';
import { loadResultWindow } from '@/lib/services/result-loader';
import { describeError } from '@/lib/utils/errors';
import { reportError } from '@/lib/monitoring';

/**
 * Análise das demonstrações na aba "Análise" do Balanço: índices na data escolhida, com a DRE do
 * exercício até ela, e o fim do exercício anterior ao lado. A DRE anterior só é lida com a aba
 * aberta, e os meses fechados vêm dos resumos (src/lib/dre/summaries.ts).
 */
export function useFinancialAnalysis(args: {
  enabled: boolean;
  clientId: string | undefined;
  date: string;
  accounts: readonly ChartAccount[];
  banks: readonly BankAccount[];
  locks: readonly PeriodLock[];
  journalEntries: readonly JournalEntry[];
  /** Lançamentos do exercício (do Balanço), já carregados. */
  transactions: readonly BankTransaction[] | null;
  balanceSheet: BalanceSheet;
  previousBalanceSheet: BalanceSheet | null;
}): { analysis: FinancialAnalysis | null; loading: boolean; error: string | null } {
  const { enabled, clientId, date, accounts, banks, locks, journalEntries, transactions, balanceSheet, previousBalanceSheet } = args;
  const year = Number(date.slice(0, 4));
  const prevYear = String(year - 1);
  const [prev, setPrev] = useState<{ key: string; dre: DREStatement | null; error: string | null } | null>(null);
  const prevKey = `${clientId}|${prevYear}`;

  useEffect(() => {
    if (!enabled || !clientId || !previousBalanceSheet || prev?.key === prevKey) return;
    let active = true;
    const range = { start: `${prevYear}-01-01`, end: `${prevYear}-12-31` };
    loadResultWindow({ clientId, range, accounts, banks, locks })
      .then((w) => active && setPrev({ key: prevKey, dre: buildDRE(w.transactions, accounts, range, journalEntries, w.summaries), error: null }))
      .catch((e: unknown) => {
        reportError(e, { area: 'balanco', op: 'carregar DRE do exercício anterior' });
        if (active) setPrev({ key: prevKey, dre: null, error: `Falha ao carregar a DRE de ${prevYear} (${describeError(e)}).` });
      });
    return () => {
      active = false;
    };
  }, [enabled, clientId, previousBalanceSheet, prev?.key, prevKey, prevYear, accounts, banks, locks, journalEntries]);

  const currentDre = useMemo(
    () => (transactions ? buildDRE(transactions, accounts, { start: `${year}-01-01`, end: date }, journalEntries) : null),
    [transactions, accounts, year, date, journalEntries]
  );

  const prevReady = !previousBalanceSheet || prev?.key === prevKey;
  const analysis = useMemo(() => {
    if (!enabled || !currentDre || !prevReady) return null;
    return buildFinancialAnalysis({
      balanceSheet,
      dre: currentDre,
      previous: previousBalanceSheet ? { balanceSheet: previousBalanceSheet, dre: prev?.dre ?? null } : null,
      monthsInExercise: Number(date.slice(5, 7)),
    });
  }, [enabled, currentDre, prevReady, balanceSheet, previousBalanceSheet, prev, date]);

  return { analysis, loading: enabled && (!currentDre || !prevReady), error: prev?.key === prevKey ? prev.error : null };
}
