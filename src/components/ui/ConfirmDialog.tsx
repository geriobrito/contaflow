'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import { BUTTON } from '@/components/ui/primitives';

interface ConfirmDialogProps {
  title: string;
  /** O que vai acontecer, em uma ou duas frases. */
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Ação destrutiva (excluir): botão de confirmar em vermelho. */
  destructive?: boolean;
  /**
   * Executa a ação. Enquanto roda, o diálogo fica ocupado; se falhar, a mensagem aparece
   * nele mesmo e o usuário decide tentar de novo ou cancelar. Fechar é de quem chama.
   */
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

const describe = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Não foi possível concluir a ação.');

/**
 * Confirmação de uma ação que não dá para desfazer, no padrão visual do sistema — substitui
 * o `confirm()`/`alert()` do navegador. Renderize só enquanto houver algo a confirmar.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // O foco começa em "Cancelar": Enter por engano não confirma uma exclusão.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onCancel, busy]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };

  // Portal no <body>: fica acima de qualquer contexto de empilhamento da página.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-900/30 backdrop-blur-sm animate-fade-in" onClick={() => !busy && onCancel()} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        aria-busy={busy}
        className="relative w-full max-w-md rounded-3xl p-6 backdrop-blur-xl bg-white/90 dark:bg-stone-900/90 border border-black/10 dark:border-white/10 shadow-2xl animate-pop-in"
      >
        <div className="flex flex-col items-center text-center">
          <span
            className={`w-12 h-12 rounded-full flex items-center justify-center ${
              destructive ? 'bg-rose-100/80 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400' : 'bg-amber-100/80 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400'
            }`}
          >
            <AlertTriangle className="w-6 h-6" strokeWidth={1.75} />
          </span>
          <h2 id={titleId} className="mt-4 text-[19px] font-semibold tracking-tight text-stone-900 dark:text-stone-50">
            {title}
          </h2>
          <div id={descId} className="mt-2 text-[14px] leading-relaxed text-stone-600 dark:text-stone-300">
            {description}
          </div>
          {error && (
            <p role="alert" className="mt-4 w-full px-4 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-800/40 text-[13px] text-rose-700 dark:text-rose-300">
              {error}
            </p>
          )}
        </div>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className={BUTTON.ghost}>
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className={
              destructive
                ? 'inline-flex items-center justify-center gap-2 h-9 px-4 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-[13px] font-medium tracking-tight disabled:opacity-50 active:scale-[0.98] transition-all duration-150'
                : BUTTON.primary
            }
          >
            {busy ? 'Aguarde…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
