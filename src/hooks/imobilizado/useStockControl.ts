'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StockControl } from '@/types/firestore';
import { loadMonthStock, loadStockContext, postMonthStock, saveStockControl, saveStockCount, type MonthStock, type StockContext } from '@/lib/services/stock-service';
import { missingCountMonths } from '@/lib/stock';
import { describeError, isRegisterConflictError } from '@/lib/utils/errors';
import { reportError } from '@/lib/monitoring';

const currentMonth = () => new Date().toISOString().slice(0, 7);

/**
 * Controle de estoque de uma empresa e a situação do CMV na competência escolhida: configurar,
 * informar o estoque final e lançar o CMV. Toda gravação recarrega.
 */
export function useStockControl(clientId: string | undefined, authorUid: string | undefined, month: string) {
  const [ctx, setCtx] = useState<(StockContext & { id: string }) | null>(null);
  const [monthState, setMonthState] = useState<{ key: string; value: MonthStock | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);
  const monthKey = `${clientId}|${month}|${reloadCount}`;

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    loadStockContext(clientId)
      .then((context) => {
        if (!active) return;
        setCtx({ ...context, id: clientId });
        setError(null);
      })
      .catch((e: unknown) => {
        if (!active) return;
        reportError(e, { area: 'estoque', op: 'carregar' });
        setError(`Não foi possível carregar o controle de estoque (${describeError(e)}).`);
      });
    return () => {
      active = false;
    };
  }, [clientId, reloadCount]);

  // Situação do mês: lê o razão até o fim da competência, só com o controle configurado.
  const configured = Boolean(ctx?.id === clientId && ctx?.control);
  useEffect(() => {
    if (!clientId || !configured) return;
    let active = true;
    const key = `${clientId}|${month}|${reloadCount}`;
    loadMonthStock(clientId, month)
      .then((value) => active && setMonthState({ key, value }))
      .catch((e: unknown) => {
        if (!active) return;
        reportError(e, { area: 'estoque', op: 'situação do mês' });
        setMonthState({ key, value: null });
      });
    return () => {
      active = false;
    };
  }, [clientId, month, reloadCount, configured]);

  const current = ctx?.id === clientId ? ctx : null;
  const reload = useCallback(() => setReloadCount((c) => c + 1), []);
  const missingMonths = useMemo(() => (current?.control ? missingCountMonths(current.control, currentMonth(), current.lockedMonths) : []), [current]);

  const run = async (op: string, action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      reload();
      return true;
    } catch (e) {
      reportError(e, { area: 'estoque', op });
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
    control: current?.control ?? null,
    missingMonths,
    month: monthState?.key === monthKey ? monthState.value : undefined,
    error,
    busy,
    save: (control: StockControl) => run('configurar', async () => saveStockControl(clientId!, control, requireCtx())),
    saveCount: (amount: number | null, source: string) => run('informar estoque', async () => saveStockCount(clientId!, month, amount, source, requireCtx())),
    postMonth: () => run('lançar CMV', async () => postMonthStock(clientId!, month, authorUid ?? 'local')),
  };
}
