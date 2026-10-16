'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const noopSubscribe = () => () => {};

/**
 * Renderiza modais, sheets e drawers direto no <body>. Um `fixed inset-0` dentro da página fica
 * preso ao primeiro ancestral com `transform`, `filter` ou `backdrop-filter` (a animação de entrada
 * das telas, as superfícies com desfoque); no <body> ele sempre cobre a janela inteira, sidebar inclusive.
 * No servidor e na hidratação não renderiza nada: o portal só existe com `document` disponível.
 */
export function ModalPortal({ children }: { children: ReactNode }) {
  const isClient = useSyncExternalStore(
    noopSubscribe,
    () => typeof document !== 'undefined',
    () => false
  );
  return isClient ? createPortal(children, document.body) : null;
}
