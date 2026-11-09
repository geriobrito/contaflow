'use client';

import { useMemo } from 'react';
import type { BankAccount, BankTransaction, ChartAccount, ClientCompany, JournalEntry } from '@/types/firestore';
import type { BalanceSheet, Posting, TrialBalance } from '@/lib/ledger';
import type { BalanceSheetStatic } from '@/hooks/balanco/useBalanceSheetData';
import { CAPITAL_GROUP_CODE, equityMovements, invertedBalances, missingShareCapital, openingPostings } from '@/lib/balance-sheet-checks';
import { checkAccountingConsistency } from '@/lib/dre/consistency';
import { porteOf } from '@/lib/accounting-standard';
import { implantationDate, openingStatus, type OpeningStatus } from '@/lib/opening';
import { bankSetupIssues, standardNoteFor, type StatementView } from '@/lib/balance-sheet-view';
import { yearStartOf } from '@/lib/year-closing';
import { activityCheck, balanceSheetChecks, dmplCheck, financingCheck, fixedAssetCheck, openingCheck, prepaidCheck, transitoryCheck, type StatementCheck } from '@/lib/statement-checks';
import { expectedBalancesByAccount } from '@/lib/financing';
import { prepaidBalancesByAccount } from '@/lib/prepaid-expenses';
import { fromCents, round2 } from '@/lib/money';
import { naturalAssetBalances, reconcileWithLedger } from '@/lib/fixed-assets';
import { closedYearsOf, transitoryBalanceAt, transitoryReminder } from '@/lib/opening-transitory';

export interface UseBalanceSheetChecksParams {
  client: ClientCompany | null | undefined;
  range: { start: string; end: string };
  view: StatementView;
  ready: boolean;
  loading: boolean;
  accounts: readonly ChartAccount[];
  banks: readonly BankAccount[];
  postings: readonly Posting[];
  bs: BalanceSheet;
  tb: TrialBalance;
  txs: { list: BankTransaction[]; carry: Posting[] } | null;
  static_: BalanceSheetStatic | null;
  journalEntries: readonly JournalEntry[];
}

export interface UseBalanceSheetChecksResult {
  opening: OpeningStatus | null;
  openLines: ReturnType<typeof openingPostings>;
  transitory: number;
  transitoryDue: ReturnType<typeof transitoryReminder>;
  transitoryIssue: ReturnType<typeof transitoryCheck> | null;
  checks: (StatementCheck | null | undefined | false)[];
}

/**
 * Concentra os cálculos e conferências contábeis da tela de Balanço e Balancete:
 * saldos virados, conciliação do imobilizado, despesas antecipadas, contratos,
 * conta transitória de abertura, consistência contábil e avisos normativos.
 */
export function useBalanceSheetChecks({
  client,
  range,
  view,
  ready,
  loading,
  accounts,
  banks,
  postings,
  bs,
  tb,
  txs,
  static_,
  journalEntries,
}: UseBalanceSheetChecksParams): UseBalanceSheetChecksResult {
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const inverted = useMemo(() => invertedBalances(bs), [bs]);

  // Cadastro do imobilizado × balanço, no fim do período (só com bens cadastrados).
  const fixedAssetRows = useMemo(() => {
    const assets = static_?.fixedAssets?.assets;
    if (!assets?.length || !txs) return null;
    const implantation = implantationDate(static_?.openings, banks);
    const balances = naturalAssetBalances(bs.assets, accounts);
    return reconcileWithLedger({
      assets,
      month: range.end.slice(0, 7),
      implantationMonth: implantation ? implantation.slice(0, 7) : null,
      accounts,
      ledgerBalance: (id) => balances.get(id) ?? 0,
    });
  }, [static_?.fixedAssets, static_?.openings, txs, banks, bs, accounts, range.end]);

  // Despesas antecipadas × balanço: saldo a apropriar por conta do ativo.
  const prepaidRows = useMemo(() => {
    const items = static_?.prepaid?.items;
    if (!items?.length || !txs) return null;
    const implantation = implantationDate(static_?.openings, banks);
    const register = prepaidBalancesByAccount(items, range.end.slice(0, 7), implantation ? implantation.slice(0, 7) : null);
    const balances = naturalAssetBalances(bs.assets, accounts);
    return [...register].map(([accountId, cents]) => {
      const acc = accountMap.get(accountId);
      const ledger = balances.get(accountId) ?? 0;
      return {
        accountCode: acc?.code ?? '',
        accountName: acc?.name ?? '',
        register: fromCents(cents),
        ledger,
        difference: round2(ledger - fromCents(cents)),
      };
    });
  }, [static_?.prepaid, static_?.openings, txs, banks, bs, accounts, accountMap, range.end]);

  // Contratos de empréstimo e financiamento × balanço: obrigações e encargos a transcorrer por conta.
  const financingRows = useMemo(() => {
    const contracts = static_?.financing?.contracts;
    if (!contracts?.length || !txs) return null;
    const expected = expectedBalancesByAccount(contracts, range.end.slice(0, 7));
    const balances = naturalAssetBalances(bs.liabilities, accounts);
    return [...expected].map(([accountId, cents]) => {
      const acc = accountMap.get(accountId);
      const ledger = balances.get(accountId) ?? 0;
      return {
        accountCode: acc?.code ?? '',
        accountName: acc?.name ?? '',
        register: fromCents(cents),
        ledger,
        difference: round2(ledger - fromCents(cents)),
      };
    });
  }, [static_?.financing, txs, bs, accounts, accountMap, range.end]);

  const missingCapital = useMemo(() => missingShareCapital(bs), [bs]);

  // Conta transitória 2.3.3.04 com saldo: lembra de zerar; em 31/12, impede o balanço de encerramento.
  const transitory = useMemo(() => transitoryBalanceAt(postings, accounts, range.end), [postings, accounts, range.end]);
  const transitoryDue = useMemo(
    () =>
      transitoryReminder({
        balance: transitory,
        implantation: static_?.openings?.date ?? null,
        closedYears: closedYearsOf(journalEntries),
        today: range.end,
      }),
    [transitory, static_?.openings?.date, journalEntries, range.end]
  );
  const transitoryIssue = transitoryDue ? transitoryCheck(transitory, range.end, transitoryDue.year) : null;

  const consistency = useMemo(() => {
    if (!txs) return null;
    return checkAccountingConsistency({
      transactions: txs.list,
      accounts,
      banks,
      date: range.end,
      openings: static_?.openings,
      journalEntries,
      carry: txs.carry,
    });
  }, [txs, accounts, banks, range.end, static_?.openings, journalEntries]);

  const opening = useMemo(
    () => (ready && accounts.length > 0 ? openingStatus(static_?.openings, accounts, banks) : null),
    [ready, static_?.openings, accounts, banks]
  );

  const year = range.end.slice(0, 4);
  const openLines = useMemo(() => openingPostings(static_?.openings, banks, accounts), [static_?.openings, banks, accounts]);

  // Pequena empresa: movimento em Capital ou Reservas no exercício exige a DMPL (NBC TG 1001).
  const porte = porteOf(client);
  const equityMoves = useMemo(
    () =>
      porte === 'PEQUENA_EMPRESA'
        ? equityMovements(postings, openLines, accounts, { start: yearStartOf(year), end: range.end })
        : [],
    [porte, postings, openLines, accounts, year, range.end]
  );

  const standardNote = standardNoteFor(view, porteOf(client));
  const { missingOpening, unlinked } = bankSetupIssues(banks);
  const hasData = postings.length > 0;

  const checks = useMemo(
    () => [
      openingCheck(opening),
      !loading && hasData && view !== 'dfc' && transitoryIssue,
      !loading && hasData && view !== 'tb' && activityCheck(client),
      !loading && hasData && (view === 'bs' || view === 'dlpa') && dmplCheck(porte, equityMoves, year),
      !loading && hasData && view === 'bs' && fixedAssetCheck(fixedAssetRows, range.end),
      !loading && hasData && view === 'bs' && prepaidCheck(prepaidRows, range.end),
      !loading && hasData && view === 'bs' && financingCheck(financingRows, range.end),
      ...(!loading && hasData
        ? balanceSheetChecks({
            trialBalance: view === 'tb',
            date: range.end,
            suspense: bs.suspense,
            unlinkedBanks: unlinked.map((b) => b.nickname),
            missingOpeningBanks: missingOpening.map((b) => b.nickname),
            inverted: view === 'bs' ? inverted.map(({ line, side }) => ({ code: line.code, name: line.name, value: line.value, side })) : [],
            missingCapitalCode: view === 'bs' && missingCapital ? CAPITAL_GROUP_CODE : null,
            difference: bs.difference,
            trialBalanced: tb.balanced,
            consistency,
            standardNote,
          })
        : standardNote
          ? [{ id: 'standard', level: 'info' as const, title: standardNote }]
          : []),
    ],
    [
      opening,
      loading,
      hasData,
      view,
      transitoryIssue,
      client,
      porte,
      equityMoves,
      year,
      fixedAssetRows,
      range.end,
      prepaidRows,
      financingRows,
      bs.suspense,
      bs.difference,
      unlinked,
      missingOpening,
      inverted,
      missingCapital,
      tb.balanced,
      consistency,
      standardNote,
    ]
  );

  return {
    opening,
    openLines,
    transitory,
    transitoryDue,
    transitoryIssue,
    checks,
  };
}

