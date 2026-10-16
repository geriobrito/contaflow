'use client';

import { useCallback, useEffect, useState } from 'react';
import { isInputElement } from '@/hooks/useTableKeyboard';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastData {
  message: string;
  /** Ação oferecida no aviso (ex.: "Desfazer"); também atende Ctrl+Z / ⌘Z enquanto o aviso está na tela. */
  action?: ToastAction;
}

type ToastState = ToastData & { key: number };

/**
 * Aviso curto no rodapé; some sozinho depois de `durationMs` (ou `actionDurationMs`, mais
 * longo, quando oferece uma ação). Aceita texto simples ou mensagem com ação.
 */
export function useToast(durationMs = 3200, actionDurationMs = 8000): [ToastState | null, (toast: string | ToastData | null) => void] {
  const [toast, setToast] = useState<ToastState | null>(null);
  const show = useCallback((next: string | ToastData | null) => {
    setToast(next === null ? null : { ...(typeof next === 'string' ? { message: next } : next), key: Date.now() + Math.random() });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.action ? actionDurationMs : durationMs);
    return () => clearTimeout(t);
  }, [toast, durationMs, actionDurationMs]);
  return [toast, show];
}

export function Toast({ toast, onDismiss }: { toast: ToastState | ToastData | null; onDismiss?: () => void }) {
  const action = toast?.action;

  useEffect(() => {
    if (!action) return;
    const onKey = (e: KeyboardEvent) => {
      // Dentro de campo de texto, Ctrl+Z desfaz a digitação, não a ação.
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z' || isInputElement(document.activeElement)) return;
      e.preventDefault();
      onDismiss?.();
      action.onClick();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [action, onDismiss]);

  if (!toast) return null;
  return (
    <div
      key={'key' in toast ? toast.key : undefined}
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 max-w-[calc(100vw-2rem)] rounded-full bg-stone-900/90 dark:bg-stone-100/90 text-white dark:text-stone-900 text-[13px] tracking-tight shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-xl animate-sheet-in ${
        action ? 'pl-4 pr-1.5 py-1.5' : 'px-4 py-2.5'
      }`}
    >
      <span className="min-w-0 truncate">{toast.message}</span>
      {action && (
        <button
          type="button"
          title={`${action.label} (Ctrl+Z)`}
          onClick={() => {
            onDismiss?.();
            action.onClick();
          }}
          className="shrink-0 h-7 px-3 rounded-full font-medium text-[#F0A385] dark:text-accent-hover hover:bg-white/10 dark:hover:bg-black/[0.06] active:scale-[0.96] transition-all duration-150"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
