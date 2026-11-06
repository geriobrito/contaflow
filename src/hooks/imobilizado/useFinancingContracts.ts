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
import { pendingFinancingMonths } from '@/lib/financing';
import { describeError } from '@/lib/utils/errors';
import { reportError } from '@/lib/monitoring';

const currentMonth = () => new Date().toISOString().slice(0, 7);

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
    Promise.all([loadFinancingContext(clientId), getRepository().listJournalEntries(clientId)])
      .then(([context, entries]) => {
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
