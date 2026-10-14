'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BankAccount, BankTransaction, ChartAccount, JournalEntry, OpeningBalances, OrgSettings, PeriodLock } from '@/types/firestore';
import type { DateRange } from '@/lib/data/repository';
import type { Posting } from '@/lib/ledger';
import { getLatestTransactionDate, getRepository } from '@/lib/services/data-service';
import { loadLedgerWindow } from '@/lib/services/ledger-loader';
import { describeError } from '@/lib/utils/errors';

/** O que não muda com o período: plano, bancos, escritório, abertura, lançamentos manuais e fechamentos. */
export interface LedgerStatic {
  id: string;
  accounts: ChartAccount[];
  banks: BankAccount[];
  org: OrgSettings | null;
  openings: OpeningBalances | null;
  journalEntries: JournalEntry[];
  locks: PeriodLock[];
}

/**
 * Dados dos livros (Razão e Diário) de uma empresa. Ao trocar de empresa, posiciona o período
 * no lançamento mais recente (`jumpTo`). Só os lançamentos do exercício são lidos um a um; o
 * que veio antes chega consolidado das competências fechadas (`carry`). Navegar entre meses
 * do mesmo exercício não refaz a leitura.
 */
export function useLedgerData(clientId: string | undefined, range: DateRange, jumpTo: (date: string) => void) {
  const [static_, setStatic] = useState<LedgerStatic | null>(null);
  const [txs, setTxs] = useState<{ key: string; list: BankTransaction[]; carry: Posting[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    const repo = getRepository();
    Promise.all([
      repo.listAccounts(clientId),
      repo.listBankAccounts(clientId),
      repo.getOrgSettings(),
      getLatestTransactionDate(clientId),
      repo.getOpeningBalances(clientId),
      // Sem os lançamentos manuais os livros sairiam com valores errados: a falha bloqueia o relatório.
      repo.listJournalEntries(clientId),
      repo.listPeriodLocks(clientId),
    ])
      .then(([accounts, banks, org, latest, openings, journalEntries, locks]) => {
        if (!active) return;
        if (latest) jumpTo(latest);
        setStatic({ id: clientId, accounts, banks, org, openings, journalEntries, locks });
        setError(null);
      })
      .catch((e: unknown) => active && setError(`Não foi possível carregar os dados contábeis (${describeError(e)}).`));
    return () => {
      active = false;
    };
  }, [clientId, jumpTo]);

  const ready = static_?.id === clientId;
  const accounts = useMemo(() => static_?.accounts ?? [], [static_]);
  const banks = useMemo(() => static_?.banks ?? [], [static_]);
  const from = `${range.start.slice(0, 4)}-01-01`;
  const until = `${range.end.slice(0, 4)}-12-31`;
  const key = `${clientId}|${from}|${until}`;
  useEffect(() => {
    if (!clientId || !ready) return;
    let active = true;
    loadLedgerWindow({ clientId, accounts, banks, from, until })
      .then((w) => active && setTxs({ key: `${clientId}|${from}|${until}`, list: w.transactions, carry: w.carry }))
      .catch((e: unknown) => active && setError(`Não foi possível carregar os lançamentos (${describeError(e)}).`));
    return () => {
      active = false;
    };
  }, [clientId, ready, accounts, banks, from, until]);

  const loading = !ready || txs?.key !== key;
  return {
    /** Dados fixos da empresa atual (null enquanto carregam). */
    data: ready ? static_ : null,
    accounts,
    banks,
    /** Lançamentos bancários do exercício e o saldo consolidado anterior a ele. */
    transactions: loading ? null : (txs?.list ?? null),
    carry: loading ? null : (txs?.carry ?? null),
    /** Primeiro dia do exercício: início da numeração e da leitura. */
    from,
    loading,
    error,
    setError,
  };
}
