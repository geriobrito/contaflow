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
import { pendingAppropriationMonths } from '@/lib/prepaid-expenses';
import { describeError } from '@/lib/utils/errors';
import { reportError } from '@/lib/monitoring';

const currentMonth = () => new Date().toISOString().slice(0, 7);

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
    Promise.all([loadPrepaidContext(clientId), getRepository().listJournalEntries(clientId)])
      .then(([context, entries]) => {
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
