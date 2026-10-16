'use client';

import React, { useState } from 'react';
import { Loader2, MessageCircleQuestion, X } from 'lucide-react';
import type { BankTransaction } from '@/types/firestore';
import { BUTTON, INPUT } from '@/components/ui/primitives';
import { ModalPortal } from '@/components/ui/ModalPortal';

interface BulkAskClientModalProps {
  isOpen: boolean;
  transactions: readonly BankTransaction[];
  isSaving: boolean;
  onClose: () => void;
  onConfirm: (question: string) => Promise<void>;
}

export function BulkAskClientModal({
  isOpen,
  transactions,
  isSaving,
  onClose,
  onConfirm,
}: BulkAskClientModalProps) {
  const defaultQuestion =
    transactions.length > 0
      ? `Favor esclarecer do que se tratam estes ${transactions.length} lançamentos (ex.: fornecedor, serviço, número da nota).`
      : '';
  const [customQuestion, setCustomQuestion] = useState<string | null>(null);
  const question = customQuestion ?? defaultQuestion;

  if (!isOpen || transactions.length === 0) return null;

  const canSave = Boolean(question.trim()) && !isSaving;

  const dialog = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-ask-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[calc(100vh-2rem)] my-auto overflow-y-auto rounded-[24px] bg-white dark:bg-stone-900 border border-black/[0.08] dark:border-white/[0.10] shadow-[0_24px_60px_rgba(0,0,0,0.25)] p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="bulk-ask-title" className="text-[18px] font-semibold tracking-tight text-stone-900 dark:text-stone-100 flex items-center gap-2">
              <MessageCircleQuestion className="w-5 h-5 text-amber-500" />
              Perguntar ao cliente em lote
            </h2>
            <p className="text-[12px] text-stone-500 mt-0.5">
              Criará pendências para {transactions.length} lançamento(s) que poderão ser respondidas no link público.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="p-1.5 rounded-full text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="block text-[12px] font-medium text-stone-700 dark:text-stone-300">
            Mensagem para o cliente
          </label>
          <textarea
            rows={3}
            value={question}
            onChange={(e) => setCustomQuestion(e.target.value)}
            placeholder="Descreva o que o cliente precisa responder..."
            className={`${INPUT} h-auto py-2 text-[13px]`}
          />
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-black/[0.05] dark:border-white/[0.06]">
          <button type="button" onClick={onClose} disabled={isSaving} className={`${BUTTON.secondary} h-9 px-4`}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => void onConfirm(question)}
            className={`${BUTTON.primary} h-9 px-5 bg-amber-600 hover:bg-amber-700 text-white`}
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircleQuestion className="w-4 h-4" />}
            Enviar {transactions.length} pendência(s)
          </button>
        </div>
      </div>
    </div>
  );

  return <ModalPortal>{dialog}</ModalPortal>;
}
