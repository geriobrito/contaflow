'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadMonthRoutines, postMonthRoutines, type MonthRoutines } from '@/lib/services/month-routines';
import { describeError } from '@/lib/utils/errors';
import { reportError } from '@/lib/monitoring';
import { peekActor } from '@/lib/data/scope';

/**
 * Rotinas mensais da competência para a barra de fechamento (depreciação e apropriação das
 * despesas antecipadas): o que falta lançar e o botão que lança tudo. Sem nada cadastrado,
 * `routines` é null e nada aparece.
 */
export function useMonthRoutines(clientId: string | undefined, month: string | null, locked: boolean) {
  const [state, setState] = useState<{ key: string; value: MonthRoutines | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const key = `${clientId}|${month}`;

  useEffect(() => {
    if (!clientId || !month || locked) return;
    let active = true;
    loadMonthRoutines(clientId, month)
      .then((value) => active && setState({ key: `${clientId}|${month}`, value }))
      .catch((e: unknown) => {
        if (!active) return;
        reportError(e, { area: 'rotinas-do-mes', op: 'situação' });
        setState({ key: `${clientId}|${month}`, value: null });
      });
    return () => {
      active = false;
    };
  }, [clientId, month, locked, reloadCount]);

  const post = useCallback(async (): Promise<string | null> => {
    if (!clientId || !month) return null;
    setBusy(true);
    setError(null);
    try {
      const message = await postMonthRoutines(clientId, month, peekActor()?.uid ?? 'local');
      setReloadCount((c) => c + 1);
      return message;
    } catch (e) {
      reportError(e, { area: 'rotinas-do-mes', op: 'lançar' });
      setError(describeError(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [clientId, month]);

  const routines = !locked && state?.key === key ? state.value : null;
  return { routines, busy, error, post, reload: () => setReloadCount((c) => c + 1) };
}
