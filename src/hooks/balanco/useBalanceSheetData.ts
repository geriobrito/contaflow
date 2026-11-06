'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BankAccount, BankTransaction, ChartAccount, FinancingRegister, FixedAssetRegister, JournalEntry, OpeningBalances, OrgSettings, PeriodLock, PrepaidRegister } from '@/types/firestore';
import type { Posting } from '@/lib/ledger';
import { getLatestTransactionDate, getRepository } from '@/lib/services/data-service';
import { loadLedgerWindow } from '@/lib/services/ledger-loader';

export interface BalanceSheetStatic {
  id: string;
  accounts: ChartAccount[];
  banks: BankAccount[];
  org: OrgSettings | null;
  openings: OpeningBalances | null;
  journalEntries: JournalEntry[];
  locks: PeriodLock[];
  /** Cadastro do imobilizado, para a conferência com o balanço. */
  fixedAssets: FixedAssetRegister | null;
  /** Despesas antecipadas, para a conferência com o balanço. */
  prepaid: PrepaidRegister | null;
  /** Contratos de empréstimo e financiamento, para a conferência com o balanço. */
  financing: FinancingRegister | null;
}

/**
 * Dados da tela do Balanço: plano, bancos, escritório, saldos de abertura, lançamentos manuais e
 * fechamentos (posiciona no mês do lançamento mais recente), e os lançamentos do exercício.
 *
 * O balanço acumula desde o início, mas só os lançamentos do exercício são lidos um a um: o que
 * veio antes entra pelo saldo consolidado das competências fechadas (`carry`). Navegar entre
 * meses do mesmo exercício não refaz a leitura.
 */
export function useBalanceSheetData(clientId: string | undefined, range: { start: string; end: string }, jumpTo: (date: string) => void) {
  const [static_, setStatic] = useState<BalanceSheetStatic | null>(null);
  /** Muda depois de encerrar ou reabrir o exercício: relê plano e lançamentos manuais. */
  const [reloadCount, setReloadCount] = useState(0);
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
      // Sem os lançamentos manuais o balanço sairia com valores errados: a falha bloqueia o relatório.
      repo.listJournalEntries(clientId),
      repo.listPeriodLocks(clientId),
      repo.getFixedAssets(clientId),
      repo.getPrepaidExpenses(clientId),
      repo.getFinancingContracts(clientId),
    ])
      .then(([accounts, banks, org, latest, openings, journalEntries, locks, fixedAssets, prepaid, financing]) => {
        if (!active) return;
        // Recarga depois do encerramento: fica no período escolhido.
        if (latest && reloadCount === 0) jumpTo(latest);
        setStatic({ id: clientId, accounts, banks, org, openings, journalEntries, locks, fixedAssets, prepaid, financing });
        setError(null);
      })
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : 'Falha ao carregar.'));
    return () => {
      active = false;
    };
  }, [clientId, jumpTo, reloadCount]);

  const ready = static_?.id === clientId;
  const accounts = useMemo(() => static_?.accounts ?? [], [static_]);
  const banks = useMemo(() => static_?.banks ?? [], [static_]);
  const journalEntries = useMemo(() => static_?.journalEntries ?? [], [static_]);
  const from = `${range.start.slice(0, 4)}-01-01`;
  const until = `${range.end.slice(0, 4)}-12-31`;
  const key = `${clientId}|${from}|${until}`;
  useEffect(() => {
    if (!clientId || !ready) return;
    let active = true;
    loadLedgerWindow({ clientId, accounts, banks, from, until })
      .then((w) => active && setTxs({ key: `${clientId}|${from}|${until}`, list: w.transactions, carry: w.carry }))
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : 'Falha ao carregar lançamentos.'));
    return () => {
      active = false;
    };
  }, [clientId, ready, accounts, banks, from, until]);

  const reload = useCallback(() => setReloadCount((c) => c + 1), []);
  const loading = !ready || txs?.key !== key;

  return { static_, ready, accounts, banks, journalEntries, txs: loading ? null : txs, loading, error, setError, reload };
}
