'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadMonthDepreciation, postMonthDepreciation, type MonthDepreciation } from '@/lib/services/fixed-asset-service';
import { describeError } from '@/lib/utils/errors';
import { reportError } from '@/lib/monitoring';
import { peekActor } from '@/lib/data/scope';

/**
 * Depreciação da competência para a barra de fechamento: se falta lançar ou atualizar, e o
 * botão que lança. Sem bens cadastrados, `state` é null e nada aparece.
 */
export function useMonthDepreciation(clientId: string | undefined, month: string | null, locked: boolean) {
  const [state, setState] = useState<{ key: string; value: MonthDepreciation | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const key = `${clientId}|${month}`;

  useEffect(() => {
    if (!clientId || !month || locked) return;
    let active = true;
    loadMonthDepreciation(clientId, month)
      .then((value) => active && setState({ key: `${clientId}|${month}`, value }))
      .catch((e: unknown) => {
        if (!active) return;
        reportError(e, { area: 'imobilizado', op: 'situação da depreciação' });
        setState({ key: `${clientId}|${month}`, value: null });
      });
    return () => {
      active = false;
    };
  }, [clientId, month, locked, reloadCount]);

  const post = useCallback(
    async (): Promise<string | null> => {
      if (!clientId || !month) return null;
      setBusy(true);
      setError(null);
      try {
        const done = await postMonthDepreciation(clientId, month, peekActor()?.uid ?? 'local');
        setReloadCount((c) => c + 1);
        return done === 'created' ? 'Depreciação do mês lançada' : done === 'updated' ? 'Depreciação do mês atualizada' : done === 'removed' ? 'Depreciação do mês excluída' : null;
      } catch (e) {
        reportError(e, { area: 'imobilizado', op: 'lançar depreciação' });
        setError(describeError(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [clientId, month]
  );

  const current = !locked && state?.key === key ? state.value : null;
  return { depreciation: current, busy, error, post, reload: () => setReloadCount((c) => c + 1) };
}
