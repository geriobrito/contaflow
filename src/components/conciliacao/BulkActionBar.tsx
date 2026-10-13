'use client';

import React from 'react';
import { CheckSquare, MessageCircleQuestion, ArrowLeftRight, X, Loader2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils/formatters';

interface BulkActionBarProps {
  selectedCount: number;
  totalDebits: number;
  totalCredits: number;
  onClassify: () => void;
  onAskClient: () => void;
  onClearSelection: () => void;
  canMatchTransfer?: boolean;
  onMatchTransfer?: () => void;
  isSaving?: boolean;
}

export function BulkActionBar({
  selectedCount,
  totalDebits,
  totalCredits,
  onClassify,
  onAskClient,
  onClearSelection,
  canMatchTransfer = false,
  onMatchTransfer,
  isSaving = false,
}: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <aside
      aria-label="Ações em massa para lançamentos selecionados"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-[94vw] sm:max-w-2xl w-full px-4 animate-fade-in"
    >
      <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 px-4 py-2.5 rounded-2xl sm:rounded-full bg-stone-900/95 dark:bg-stone-100/95 text-white dark:text-stone-900 shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl border border-white/10 dark:border-black/10 text-[13px]">
        {/* Contagem e totais */}
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-white/20 dark:bg-black/10 font-mono text-[12px] font-semibold tabular-nums shrink-0">
            {selectedCount}
          </span>
          <span className="font-medium truncate">
            {selectedCount === 1 ? 'lançamento selecionado' : 'lançamentos selecionados'}
          </span>
          {(totalDebits > 0 || totalCredits > 0) && (
            <span className="hidden md:inline-flex items-center gap-1.5 font-mono text-[12px] opacity-80 border-l border-white/20 dark:border-black/20 pl-2.5">
              {totalDebits > 0 && <span className="text-rose-300 dark:text-rose-600">-{formatCurrency(totalDebits)}</span>}
              {totalDebits > 0 && totalCredits > 0 && <span>·</span>}
              {totalCredits > 0 && <span className="text-emerald-300 dark:text-emerald-600">+{formatCurrency(totalCredits)}</span>}
            </span>
          )}
        </div>

        {/* Botões de Ação */}
        <div className="flex items-center gap-2 shrink-0">
          {canMatchTransfer && onMatchTransfer && (
            <button
              type="button"
              disabled={isSaving}
              onClick={onMatchTransfer}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-sky-500/20 text-sky-300 dark:text-sky-700 hover:bg-sky-500/30 active:scale-[0.97] transition-all font-medium text-[12px]"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Transferência
            </button>
          )}

          <button
            type="button"
            disabled={isSaving}
            onClick={onAskClient}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-white/10 dark:bg-black/10 hover:bg-white/20 dark:hover:bg-black/20 active:scale-[0.97] transition-all font-medium text-[12px]"
          >
            <MessageCircleQuestion className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Perguntar ao</span> cliente
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={onClassify}
            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full bg-[#0071E3] text-white hover:bg-[#0077ED] active:scale-[0.97] transition-all font-medium text-[12px] shadow-sm"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckSquare className="w-3.5 h-3.5" />}
            Classificar
          </button>

          <button
            type="button"
            onClick={onClearSelection}
            title="Limpar seleção (Esc)"
            aria-label="Limpar seleção"
            className="p-1 rounded-full text-white/60 dark:text-stone-500 hover:text-white dark:hover:text-stone-900 hover:bg-white/10 dark:hover:bg-black/10 transition-colors ml-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
