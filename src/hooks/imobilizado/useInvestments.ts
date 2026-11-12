'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InvestmentAccount } from '@/types/firestore';
import {
  deleteInvestment,
  loadInvestmentContext,
  loadMonthInvestment,
  postMonthInvestment,
  saveInvestment,
  saveInvestmentBalance,
  type InvestmentContext,
  type MonthInvestment,
} from '@/lib/services/investment-service';
import { missingBalanceMonths } from '@/lib/investments';
import { describeError, isRegisterConflictError } from '@/lib/utils/errors';
import { reportError } from '@/lib/monitoring';

const currentMonth = () => new Date().toISOString().slice(0, 7);

/**
 * Aplicações financeiras de uma empresa e a situação do rendimento na competência escolhida:
 * cadastrar, informar o saldo do extrato, excluir e lançar o rendimento. Toda gravação recarrega.
 */
export function useInvestments(clientId: string | undefined, authorUid: string | undefined, month: string) {
  const [ctx, setCtx] = useState<(InvestmentContext & { id: string }) | null>(null);
  const [monthState, setMonthState] = useState<{ key: string; value: MonthInvestment | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);
  const monthKey = `${clientId}|${month}|${reloadCount}`;

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    loadInvestmentContext(clientId)
      .then((context) => {
        if (!active) return;
        setCtx({ ...context, id: clientId });
        setError(null);
      })
      .catch((e: unknown) => {
        if (!active) return;
        reportError(e, { area: 'aplicacoes', op: 'carregar' });
        setError(`Não foi possível carregar as aplicações (${describeError(e)}).`);
      });
    return () => {
      active = false;
    };
  }, [clientId, reloadCount]);

  // Situação do mês: lê o razão até o fim da competência, só quando há aplicações.
  const hasInvestments = Boolean(ctx?.id === clientId && ctx?.register?.accounts.length);
  useEffect(() => {
    if (!clientId || !hasInvestments) return;
    let active = true;
    const key = `${clientId}|${month}|${reloadCount}`;
    loadMonthInvestment(clientId, month)
      .then((value) => active && setMonthState({ key, value }))
      .catch((e: unknown) => {
        if (!active) return;
        reportError(e, { area: 'aplicacoes', op: 'situação do mês' });
        setMonthState({ key, value: null });
      });
    return () => {
      active = false;
    };
  }, [clientId, month, reloadCount, hasInvestments]);

  const current = ctx?.id === clientId ? ctx : null;
  const investments = useMemo(() => current?.register?.accounts ?? [], [current]);
  const reload = useCallback(() => setReloadCount((c) => c + 1), []);
  const missingMonths = useMemo(() => (current ? missingBalanceMonths(investments, currentMonth(), current.lockedMonths) : []), [current, investments]);

  const run = async (op: string, action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      reload();
      return true;
    } catch (e) {
      reportError(e, { area: 'aplicacoes', op });
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

  return {
    ctx: current,
    investments,
    missingMonths,
    month: monthState?.key === monthKey ? monthState.value : undefined,
    error,
    busy,
    save: (inv: InvestmentAccount) => run('salvar', async () => saveInvestment(clientId!, inv, requireCtx())),
    remove: (inv: InvestmentAccount) => run('excluir', async () => deleteInvestment(clientId!, inv, requireCtx())),
    saveBalance: (inv: InvestmentAccount, amount: number | null) => run('informar saldo', async () => saveInvestmentBalance(clientId!, inv, month, amount, requireCtx())),
    postMonth: () => run('lançar rendimento', async () => postMonthInvestment(clientId!, month, authorUid ?? 'local')),
  };
}
