'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JournalEntry, PrepaidExpense } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import {
  deletePrepaidExpense,
  loadPrepaidContext,
  postMonthAppropriation,
  savePrepaidExpense,
  type PrepaidContext,
} from '@/lib/services/prepaid-service';
import { lastDayOf, naturalAssetBalances, type ReconciliationRow } from '@/lib/fixed-assets';
import { pendingAppropriationMonths, reconcilePrepaidWithLedger } from '@/lib/prepaid-expenses';
import { buildBalanceSheet, buildPostings } from '@/lib/ledger';
import { loadLedgerWindow } from '@/lib/services/ledger-loader';
import { describeError, isRegisterConflictError } from '@/lib/utils/errors';
import { reportError } from '@/lib/monitoring';
import { todayISO } from '@/lib/business-days';

const currentMonth = () => todayISO().slice(0, 7);

/**
 * Despesas antecipadas de uma empresa (seguros, assinaturas…), com o plano, os fechamentos, a
 * implantação e os bens do imobilizado, e as gravações: cadastrar ou alterar (com o lançamento
 * inicial), excluir e lançar a apropriação dos meses abertos que ficaram para trás.
 */
export function usePrepaidExpenses(clientId: string | undefined, authorUid: string | undefined) {
  const [ctx, setCtx] = useState<(PrepaidContext & { id: string; entries: JournalEntry[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    loadPrepaidContext(clientId)
      .then(async (context) => {
        const items = context.register?.items ?? [];
        const start = context.implantationMonth ? `${context.implantationMonth}-01` : '0000-01-01';
        const entries = items.length
          ? await getRepository().listJournalEntries(clientId, { start, end: lastDayOf(currentMonth()) })
          : [];
        if (!active) return;
        setCtx({ ...context, id: clientId, entries });
        setError(null);
      })
      .catch((e: unknown) => {
        if (!active) return;
        reportError(e, { area: 'despesas-antecipadas', op: 'carregar' });
        setError(`Não foi possível carregar as despesas antecipadas (${describeError(e)}).`);
      });
    return () => {
      active = false;
    };
  }, [clientId, reloadCount]);

  const current = ctx?.id === clientId ? ctx : null;
  const items = useMemo(() => current?.register?.items ?? [], [current]);
  const reload = useCallback(() => setReloadCount((c) => c + 1), []);

  const pendingMonths = useMemo(
    () =>
      current
        ? pendingAppropriationMonths({
            items,
            untilMonth: currentMonth(),
            implantationMonth: current.implantationMonth,
            lockedMonths: current.lockedMonths,
            accounts: current.accounts,
            entries: current.entries,
          })
        : [],
    [current, items]
  );

  const run = async (op: string, action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      reload();
      return true;
    } catch (e) {
      reportError(e, { area: 'despesas-antecipadas', op });
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

  const save = (item: PrepaidExpense, alreadyRecognized: boolean) =>
    run('salvar', async () => savePrepaidExpense(clientId!, item, requireCtx(), { alreadyRecognized, authorUid: authorUid ?? 'local' }));
  const remove = (item: PrepaidExpense) => run('excluir', async () => deletePrepaidExpense(clientId!, item, requireCtx()));
  const postPending = (months: readonly string[]) =>
    run('lançar apropriação', async () => {
      let done = 0;
      try {
        for (const month of months) {
          await postMonthAppropriation(clientId!, month, authorUid ?? 'local');
          done++;
        }
      } catch (e) {
        throw new Error(`${done} de ${months.length} competência(s) lançada(s); a seguinte falhou (${describeError(e)}).`);
      }
    });

  return { ctx: current, items, pendingMonths, error, busy, reload, save, remove, postPending };
}

/**
 * Conferência das despesas antecipadas com o balancete sob demanda.
 */
export function usePrepaidReconciliation(clientId: string | undefined, ctx: PrepaidContext | null) {
  const [result, setResult] = useState<{ key: string; month: string; rows: ReconciliationRow[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async (month: string) => {
    if (!clientId || !ctx?.register) return;
    setLoading(true);
    setError(null);
    try {
      const repo = getRepository();
      const date = lastDayOf(month);
      const [banks, openings, journalEntries] = await Promise.all([
        repo.listBankAccounts(clientId),
        repo.getOpeningBalances(clientId),
        repo.listJournalEntries(clientId, { start: '0000-01-01', end: date }),
      ]);
      const window = await loadLedgerWindow({ clientId, accounts: ctx.accounts, banks, from: `${month.slice(0, 4)}-01-01`, until: date });
      const postings = buildPostings(window.transactions, banks, ctx.accounts, date, openings, journalEntries, window.carry);
      const bs = buildBalanceSheet(postings, ctx.accounts, date);
      const balances = naturalAssetBalances(bs.assets, ctx.accounts);
      const rows = reconcilePrepaidWithLedger({
        items: ctx.register.items,
        month,
        implantationMonth: ctx.implantationMonth,
        accounts: ctx.accounts,
        ledgerBalance: (id) => balances.get(id) ?? 0,
      });
      setResult({ key: clientId, month, rows });
    } catch (e) {
      reportError(e, { area: 'despesas-antecipadas', op: 'conferir com o balancete' });
      setError(`Não foi possível conferir (${describeError(e)}).`);
    } finally {
      setLoading(false);
    }
  };

  return { result: result?.key === clientId ? result : null, loading, error, check, clear: () => setResult(null) };
}
