'use client';

import { useCallback, useEffect, useState } from 'react';
import { todayISO } from '@/lib/business-days';

export const MONTH_QUERY_EVENT = 'contaflow:month-change';
const MONTH_SHAPE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function readMonthQuery(): string | null {
  if (typeof window === 'undefined') return null;
  const fromUrl = new URLSearchParams(window.location.search).get('mes');
  return fromUrl && MONTH_SHAPE.test(fromUrl) ? fromUrl : null;
}

/**
 * Competência compartilhada pelas abas de Bens e Contratos (`?mes=AAAA-MM`):
 * - inicializa com a competência atual (evitando divergência de hidratação SSR) e sincroniza
 *   com `?mes=` logo na montagem;
 * - ao trocar a competência na tela, atualiza a URL (`replaceState`) e avisa `ControlsTabs`
 *   para manter a mesma competência ao alternar entre as cinco abas.
 */
export function useMonthQueryState(): [string, (next: string) => void] {
  const [month, setMonthState] = useState(() => todayISO().slice(0, 7));

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      const m = readMonthQuery();
      if (active && m) setMonthState(m);
    });
    return () => {
      active = false;
    };
  }, []);

  const setMonth = useCallback((next: string) => {
    if (!MONTH_SHAPE.test(next)) return;
    setMonthState(next);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('mes', next);
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      window.dispatchEvent(new CustomEvent<string>(MONTH_QUERY_EVENT, { detail: next }));
    }
  }, []);

  return [month, setMonth];
}
