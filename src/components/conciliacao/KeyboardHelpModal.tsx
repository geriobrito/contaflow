'use client';

import React from 'react';
import { X } from 'lucide-react';
import { BUTTON } from '@/components/ui/primitives';
import { ModalPortal } from '@/components/ui/ModalPortal';

interface KeyboardHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ['↓', 'J'], description: 'Navegar para a próxima linha' },
  { keys: ['↑', 'K'], description: 'Navegar para a linha anterior' },
  { keys: ['Enter', 'C'], description: 'Abrir classificação do lançamento' },
  { keys: ['Espaço', 'X'], description: 'Selecionar / desselecionar lançamento' },
  { keys: ['A'], description: 'Aprovar lançamento auto-classificado focado' },
  { keys: ['/'], description: 'Focar no campo de busca' },
  { keys: ['Esc'], description: 'Limpar busca / seleção em lote ou fechar' },
  { keys: ['?'], description: 'Abrir este painel de atalhos' },
  { keys: ['Ctrl', 'K'], description: 'Busca rápida: telas, empresas e tema (em qualquer tela)' },
];

export function KeyboardHelpModal({ isOpen, onClose }: KeyboardHelpModalProps) {
  if (!isOpen) return null;

  const dialog = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="keyboard-help-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[calc(100vh-2rem)] my-auto overflow-y-auto rounded-[24px] bg-white dark:bg-stone-900 border border-black/[0.08] dark:border-white/[0.10] shadow-[0_20px_50px_rgba(0,0,0,0.2)] p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 id="keyboard-help-title" className="text-[17px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              Atalhos de teclado
            </h2>
            <p className="text-[12px] text-stone-500">Conciliação rápida sem tirar as mãos do teclado</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="p-1.5 rounded-full text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <ul className="divide-y divide-black/[0.05] dark:divide-white/[0.06] text-[13px]">
          {SHORTCUTS.map((s, i) => (
            <li key={i} className="py-2.5 flex items-center justify-between gap-4">
              <span className="text-stone-600 dark:text-stone-300">{s.description}</span>
              <span className="flex items-center gap-1 shrink-0">
                {s.keys.map((k, j) => (
                  <kbd
                    key={j}
                    className="min-w-6 h-6 px-1.5 inline-flex items-center justify-center rounded-md font-mono text-[11px] font-medium bg-black/[0.05] dark:bg-white/[0.10] border border-black/[0.08] dark:border-white/[0.12] text-stone-700 dark:text-stone-200 shadow-sm"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>

        <div className="flex justify-end pt-2">
          <button type="button" onClick={onClose} className={`${BUTTON.primary} h-9 px-5`}>
            Entendi
          </button>
        </div>
      </div>
    </div>
  );

  return <ModalPortal>{dialog}</ModalPortal>;
}
