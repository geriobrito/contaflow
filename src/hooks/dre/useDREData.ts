'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BankAccount, BankTransaction, ChartAccount, JournalEntry, OpeningBalances, OrgSettings, PeriodLock } from '@/types/firestore';
import type { DateRange } from '@/lib/data/repository';
import { getAccounts, getLatestTransactionDate, getRepository, getTransactions } from '@/lib/services/data-service';
import { buildDRE } from '@/lib/dre/build';
import { monthlyColumns, previousYearRange } from '@/lib/dre/compare';
import { checkAccountingConsistency } from '@/lib/dre/consistency';
import { monthsBetween } from '@/lib/periods';
import { describeError } from '@/lib/utils/errors';
import type { DRETone } from '@/components/dre/DREResultCard';

export type DREView = 'simple' | 'monthly' | 'yoy';

/**
 * DRE de uma empresa no período: lançamentos do exercício até o fim do período, lançamentos
 * manuais, e o necessário para a conferência contábil e as comparações (mês a mês, ano
 * anterior). Qualquer falha de carga torna a DRE indisponível: nunca se exibe um resultado
 * calculado sobre dados incompletos.
 */
export function useDREData(clientId: string | undefined, range: DateRange, jumpTo: (date: string) => void, view: DREView) {
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 1) Ao trocar de cliente: plano de contas + posiciona o período no lançamento mais recente.
  const [positionedFor, setPositionedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    Promise.all([getAccounts(clientId), getLatestTransactionDate(clientId)])
      .then(([accs, latest]) => {
        if (!active) return;
        setAccounts(accs);
        if (latest) jumpTo(latest);
        setPositionedFor(clientId);
      })
      .catch((e: unknown) => {
        console.error('Erro ao carregar dados da DRE:', e);
        if (active) setLoadError(e instanceof Error ? e.message : 'Falha ao carregar a DRE.');
      });
    return () => {
      active = false;
    };
  }, [clientId, jumpTo]);

  // Competências fechadas (selo de DRE definitiva), dados do escritório e contas bancárias/abertura (consistência contábil).
  const [locks, setLocks] = useState<PeriodLock[]>([]);
  const [org, setOrg] = useState<OrgSettings | null>(null);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [openings, setOpenings] = useState<OpeningBalances | null>(null);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  /** Carga dos dados auxiliares por cliente: enquanto não conclui (ou se falha), a DRE não é exibida. */
  const [auxState, setAuxState] = useState<{ id: string; error: string | null } | null>(null);
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    const repo = getRepository();
    Promise.all([
      repo.listPeriodLocks(clientId),
      repo.getOrgSettings(),
      repo.listBankAccounts(clientId),
      repo.getOpeningBalances(clientId),
      // Sem os lançamentos manuais a DRE sairia com valores errados: a falha bloqueia o relatório.
      repo.listJournalEntries(clientId),
    ])
      .then(([l, o, b, op, je]) => {
        if (!active) return;
        setLocks(l);
        setOrg(o);
        setBanks(b);
        setOpenings(op);
        setJournalEntries(je);
        setAuxState({ id: clientId, error: null });
      })
      .catch((e: unknown) => {
        console.error('Erro ao carregar dados auxiliares da DRE:', e);
        if (active) setAuxState({ id: clientId, error: e instanceof Error ? e.message : 'Falha ao carregar os lançamentos manuais.' });
      });
    return () => {
      active = false;
    };
  }, [clientId]);
  const lockStatus = useMemo(() => {
    const months = monthsBetween(range.start, range.end);
    const closed = months.filter((m) => locks.some((l) => l.month === m)).length;
    return { total: months.length, closed };
  }, [locks, range]);

  // 2) Busca no banco os lançamentos do exercício até a data final selecionada.
  const ready = Boolean(clientId) && positionedFor === clientId;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const periodKey = `${clientId}|${range.start}|${range.end}`;
  useEffect(() => {
    if (!clientId || !ready) return;
    let active = true;
    const exerciseStart = `${range.end.slice(0, 4)}-01-01`;
    const fetchStart = range.start < exerciseStart ? range.start : exerciseStart;
    getTransactions(clientId, { start: fetchStart, end: range.end })
      .then((txs) => {
        if (!active) return;
        setTransactions(txs);
        setLoadError(null);
        setLoadedKey(`${clientId}|${range.start}|${range.end}`);
      })
      .catch((e: unknown) => {
        console.error('Erro ao carregar lançamentos da DRE:', e);
        if (active) setLoadError(e instanceof Error ? e.message : 'Falha ao carregar a DRE.');
      });
    return () => {
      active = false;
    };
  }, [clientId, ready, range]);

  // 3) DRE comparativa: contra o mesmo período do ano anterior (só lido quando pedido).
  const prevRange = useMemo(() => previousYearRange(range), [range]);
  const [prevTxs, setPrevTxs] = useState<{ key: string; list: BankTransaction[] } | null>(null);
  const prevKey = `${clientId}|${prevRange.start}|${prevRange.end}`;
  useEffect(() => {
    if (!clientId || !ready || view !== 'yoy') return;
    let active = true;
    getTransactions(clientId, prevRange)
      .then((list) => active && setPrevTxs({ key: `${clientId}|${prevRange.start}|${prevRange.end}`, list }))
      .catch((e: unknown) => active && setLoadError(`Falha ao carregar o ano anterior (${describeError(e)}).`));
    return () => {
      active = false;
    };
  }, [clientId, ready, view, prevRange]);

  const dre = useMemo(() => buildDRE(transactions, accounts, range, journalEntries), [transactions, accounts, range, journalEntries]);
  const months = useMemo(
    () => (view === 'monthly' ? monthlyColumns(transactions, accounts, range, journalEntries) : []),
    [view, transactions, accounts, range, journalEntries]
  );
  const prevDre = useMemo(
    () => (prevTxs?.key === prevKey ? buildDRE(prevTxs.list, accounts, prevRange, journalEntries) : null),
    [prevTxs, prevKey, accounts, prevRange, journalEntries]
  );

  const consistency = useMemo(() => {
    if (!clientId || accounts.length === 0 || !ready) return null;
    return checkAccountingConsistency({ transactions, accounts, banks, date: range.end, openings, journalEntries });
  }, [clientId, accounts, ready, transactions, banks, range.end, openings, journalEntries]);

  const aux = auxState && auxState.id === clientId ? auxState : null;
  const auxReady = Boolean(aux) && !aux?.error;
  const blockingError = loadError ?? aux?.error ?? null;
  const failed = Boolean(blockingError);
  const isLoading = Boolean(clientId) && !failed && (loadedKey !== periodKey || !auxReady);
  const profit = dre.netResult >= 0;
  const hasData = !failed && dre.reconciledCount > 0;
  const tone: DRETone = !hasData || isLoading ? 'neutral' : profit ? 'profit' : 'loss';

  return { dre, months, prevDre, prevRange, consistency, lockStatus, org, blockingError, failed, isLoading, hasData, profit, tone };
}
