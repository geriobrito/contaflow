'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FinancingContract, JournalEntry } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import {
  deleteFinancingContract,
  loadFinancingContext,
  postMonthFinancing,
  saveFinancingContract,
  type FinancingContext,
} from '@/lib/services/financing-service';
import { lastDayOf, naturalAssetBalances, type ReconciliationRow } from '@/lib/fixed-assets';
import {
  checkMonthInstallmentPayments,
  pendingFinancingMonths,
  reconcileFinancingWithLedger,
  type MonthInstallmentCheck,
} from '@/lib/financing';
import { buildBalanceSheet, buildPostings } from '@/lib/ledger';
import { toCents } from '@/lib/money';
import { loadLedgerWindow } from '@/lib/services/ledger-loader';
import { describeError, isRegisterConflictError } from '@/lib/utils/errors';
import { reportError } from '@/lib/monitoring';
import { todayISO } from '@/lib/business-days';

const currentMonth = () => todayISO().slice(0, 7);

/**
 * Contratos de empréstimo, financiamento e parcelamento de uma empresa, e as gravações: cadastrar
 * ou alterar (com o lançamento inicial), excluir e lançar juros e reclassificações dos meses
 * abertos que ficaram para trás.
 */
export function useFinancingContracts(clientId: string | undefined, authorUid: string | undefined) {
  const [ctx, setCtx] = useState<(FinancingContext & { id: string; entries: JournalEntry[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    loadFinancingContext(clientId)
      .then(async (context) => {
        const contracts = context.register?.contracts ?? [];
        const start = context.implantationMonth ? `${context.implantationMonth}-01` : '0000-01-01';
        const entries = contracts.length
          ? await getRepository().listJournalEntries(clientId, { start, end: lastDayOf(currentMonth()) })
          : [];
        if (!active) return;
        setCtx({ ...context, id: clientId, entries });
        setError(null);
      })
      .catch((e: unknown) => {
        if (!active) return;
        reportError(e, { area: 'financiamentos', op: 'carregar' });
        setError(`Não foi possível carregar os contratos (${describeError(e)}).`);
      });
    return () => {
      active = false;
    };
  }, [clientId, reloadCount]);

  const current = ctx?.id === clientId ? ctx : null;
  const contracts = useMemo(() => current?.register?.contracts ?? [], [current]);
  const reload = useCallback(() => setReloadCount((c) => c + 1), []);

  const pendingMonths = useMemo(
    () =>
      current
        ? pendingFinancingMonths({
            contracts,
            untilMonth: currentMonth(),
            implantationMonth: current.implantationMonth,
            lockedMonths: current.lockedMonths,
            accounts: current.accounts,
            entries: current.entries,
          })
        : [],
    [current, contracts]
  );

  const run = async (op: string, action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      reload();
      return true;
    } catch (e) {
      reportError(e, { area: 'financiamentos', op });
      setError(describeError(e));
      if (isRegisterConflictError(e)) reload();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const requireCtx = () => {
    if (!clientId || !current) throw new Error('Os dados ainda estão carregando.');
    return current;
  };

  const save = (contract: FinancingContract, alreadyRecognized: boolean) =>
    run('salvar', async () => saveFinancingContract(clientId!, contract, requireCtx(), { alreadyRecognized, authorUid: authorUid ?? 'local' }));
  const remove = (contract: FinancingContract) => run('excluir', async () => deleteFinancingContract(clientId!, contract, requireCtx()));
  const postPending = (months: readonly string[]) =>
    run('lançar juros', async () => {
      let done = 0;
      try {
        for (const month of months) {
          await postMonthFinancing(clientId!, month, authorUid ?? 'local');
          done++;
        }
      } catch (e) {
        throw new Error(`${done} de ${months.length} competência(s) lançada(s); a seguinte falhou (${describeError(e)}).`);
      }
    });

  return { ctx: current, contracts, pendingMonths, error, busy, reload, save, remove, postPending };
}

/**
 * Conferência dos contratos com o balancete sob demanda, incluindo o confronto das parcelas que
 * vencem na competência com os débitos (baixas de pagamento) lançados no passivo de curto prazo.
 */
export function useFinancingReconciliation(clientId: string | undefined, ctx: FinancingContext | null) {
  const [result, setResult] = useState<{
    key: string;
    month: string;
    rows: ReconciliationRow[];
    installments: MonthInstallmentCheck[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async (month: string) => {
    if (!clientId || !ctx?.register) return;
    setLoading(true);
    setError(null);
    try {
      const repo = getRepository();
      const date = lastDayOf(month);
      const monthStart = `${month}-01`;
      const [banks, openings, journalEntries] = await Promise.all([
        repo.listBankAccounts(clientId),
        repo.getOpeningBalances(clientId),
        repo.listJournalEntries(clientId, { start: '0000-01-01', end: date }),
      ]);
      const window = await loadLedgerWindow({ clientId, accounts: ctx.accounts, banks, from: `${month.slice(0, 4)}-01-01`, until: date });
      const postings = buildPostings(window.transactions, banks, ctx.accounts, date, openings, journalEntries, window.carry);
      const bs = buildBalanceSheet(postings, ctx.accounts, date);
      const balances = naturalAssetBalances(bs.liabilities, ctx.accounts);
      const rows = reconcileFinancingWithLedger({
        contracts: ctx.register.contracts,
        month,
        accounts: ctx.accounts,
        ledgerBalance: (id) => balances.get(id) ?? 0,
      });

      const debitsByAccount = new Map<string, number>();
      for (const p of postings) {
        if (p.date >= monthStart && p.date <= date && p.value > 0) {
          debitsByAccount.set(p.accountId, (debitsByAccount.get(p.accountId) ?? 0) + toCents(p.value));
        }
      }
      const installments = checkMonthInstallmentPayments({
        contracts: ctx.register.contracts,
        month,
        monthDebitsCents: (id) => debitsByAccount.get(id) ?? 0,
      });

      setResult({ key: clientId, month, rows, installments });
    } catch (e) {
      reportError(e, { area: 'financiamentos', op: 'conferir com o balancete' });
      setError(`Não foi possível conferir (${describeError(e)}).`);
    } finally {
      setLoading(false);
    }
  };

  return { result: result?.key === clientId ? result : null, loading, error, check, clear: () => setResult(null) };
}
