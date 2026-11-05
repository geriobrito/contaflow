'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useClient } from '@/contexts/ClientContext';

/** Saída segurada, esperando a confirmação do usuário. */
export type PendingLeave = { kind: 'link'; href: string } | { kind: 'client'; proceed: () => void };

/**
 * Avisa antes de perder alterações não salvas (`dirty`):
 * - fechar ou recarregar a aba: aviso do navegador (`beforeunload`);
 * - clicar num link interno (menu lateral, atalhos da tela): a navegação espera a confirmação;
 * - trocar de empresa no seletor: a troca espera a confirmação.
 * Quem usa mostra um diálogo enquanto `pending` não é null e chama `confirm` ou `cancel`.
 * Não cobre o botão voltar do navegador nem a navegação pela busca rápida (Ctrl+K).
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const router = useRouter();
  const { currentClient, setSwitchGuard } = useClient();
  const currentId = currentClient?.id;
  const [pending, setPending] = useState<PendingLeave | null>(null);
  const dirtyRef = useRef(dirty);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Navegadores mais antigos só mostram o aviso com returnValue preenchido.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    // Na captura, no document: roda antes do onClick do <Link> do Next, que fica na raiz do React.
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      // Link externo: o beforeunload avisa. Mesma página (âncora): não sai da tela.
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPending({ kind: 'link', href: `${url.pathname}${url.search}${url.hash}` });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  useEffect(() => {
    if (!dirty) {
      setSwitchGuard(null);
      return;
    }
    setSwitchGuard((next, proceed) => {
      // Escolher a própria empresa ativa não troca nada.
      if (next.id === currentId) return false;
      setPending({ kind: 'client', proceed });
      return true;
    });
    return () => setSwitchGuard(null);
  }, [dirty, currentId, setSwitchGuard]);

  const confirm = useCallback(() => {
    const leave = pending;
    setPending(null);
    if (!leave) return;
    // A saída foi confirmada: nada mais a segurar até a próxima alteração.
    dirtyRef.current = false;
    setSwitchGuard(null);
    if (leave.kind === 'link') router.push(leave.href);
    else leave.proceed();
  }, [pending, router, setSwitchGuard]);

  const cancel = useCallback(() => setPending(null), []);

  return { pending, confirm, cancel };
}
