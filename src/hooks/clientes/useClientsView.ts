'use client';

import { useCallback, useSyncExternalStore } from 'react';

export type ClientsView = 'cards' | 'list';

const KEY = 'contaflow_clients_view';
const listeners = new Set<() => void>();
/** Vale quando o armazenamento do navegador está indisponível. */
let memory: ClientsView | null = null;

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

function read(): ClientsView {
  if (memory) return memory;
  try {
    return localStorage.getItem(KEY) === 'list' ? 'list' : 'cards';
  } catch {
    return 'cards';
  }
}

/** Visão da tela de Clientes (cartões ou lista), lembrada neste navegador. */
export function useClientsView(): [ClientsView, (view: ClientsView) => void] {
  const view = useSyncExternalStore(subscribe, read, () => 'cards' as const);
  const setView = useCallback((next: ClientsView) => {
    memory = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* armazenamento indisponível */
    }
    listeners.forEach((fn) => fn());
  }, []);
  return [view, setView];
}
