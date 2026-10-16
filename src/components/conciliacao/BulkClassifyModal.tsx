'use client';

import React, { useMemo, useState } from 'react';
import { CheckSquare, Loader2, X } from 'lucide-react';
import type { BankTransaction, ChartAccount, RuleMatchType } from '@/types/firestore';
import type { ClassifyOptions } from '@/hooks/useReconciliation';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { AccountPicker } from '@/components/conciliacao/AccountPicker';
import { RuleLearnPanel } from '@/components/conciliacao/RuleLearnPanel';
import { assessRuleTerm, suggestMemoTerm, suggestRuleTerm } from '@/lib/payee';
import { BUTTON } from '@/components/ui/primitives';
import { ModalPortal } from '@/components/ui/ModalPortal';

interface BulkClassifyModalProps {
  isOpen: boolean;
  transactions: readonly BankTransaction[];
  accounts: readonly ChartAccount[];
  isSaving: boolean;
  onClose: () => void;
  onConfirm: (ids: string[], accountId: string, options: ClassifyOptions) => Promise<void>;
  memoPool?: readonly string[];
}

export function BulkClassifyModal({
  isOpen,
  transactions,
  accounts,
  isSaving,
  onClose,
  onConfirm,
  memoPool = [],
}: BulkClassifyModalProps) {
  // Tenta sugerir um termo caso todos os itens compartilhem algo em comum
  const firstMemo = transactions[0]?.memo ?? '';
  const allSameMemo = transactions.length > 0 && transactions.every((t) => t.memo.trim().toUpperCase() === firstMemo.trim().toUpperCase());
  const initialSuggested = allSameMemo ? (suggestRuleTerm(firstMemo) || suggestMemoTerm(firstMemo)) : '';

  const [accountId, setAccountId] = useState('');
  const [customLearnRule, setCustomLearnRule] = useState<boolean | null>(null);
  const learnRule = customLearnRule ?? (allSameMemo && Boolean(initialSuggested));
  const [customPattern, setCustomPattern] = useState<string | null>(null);
  const pattern = customPattern ?? initialSuggested;
  const [matchType, setMatchType] = useState<RuleMatchType>('CONTAINS');
  const [acknowledged, setAcknowledged] = useState(false);

  const assessment = useMemo(
    () => assessRuleTerm({ pattern, matchType }, memoPool),
    [pattern, matchType, memoPool]
  );

  const ruleBlocked = learnRule && assessment.level === 'generic' && !acknowledged;
  const canSave = Boolean(accountId) && !ruleBlocked && !isSaving;

  const totalDebits = useMemo(
    () => transactions.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0),
    [transactions]
  );
  const totalCredits = useMemo(
    () => transactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0),
    [transactions]
  );

  if (!isOpen || transactions.length === 0) return null;

  const handleSave = async () => {
    if (!canSave) return;
    const ids = transactions.map((t) => t.id);
    await onConfirm(ids, accountId, {
      learnRule,
      customPattern: learnRule && pattern.trim() ? pattern.trim() : undefined,
      matchType,
    });
  };

  const dialog = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-classify-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[calc(100vh-2rem)] my-auto flex flex-col rounded-[24px] bg-white dark:bg-stone-900 border border-black/[0.08] dark:border-white/[0.10] shadow-[0_24px_60px_rgba(0,0,0,0.25)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho (fixo) */}
        <div className="shrink-0 flex items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div>
            <h2 id="bulk-classify-title" className="text-[18px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              Classificar {transactions.length} lançamento(s) em lote
            </h2>
            <p className="text-[12px] text-stone-500 mt-0.5">
              Defina a conta contábil para todos os lançamentos selecionados.
            </p>
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

        {/* Corpo rolável */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 pb-4 space-y-5">
          {/* Resumo dos lançamentos */}
          <div className="rounded-xl p-3.5 bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.05] dark:border-white/[0.06] space-y-2 text-[12px]">
            <div className="flex items-center justify-between text-stone-600 dark:text-stone-400">
              <span>Total selecionado:</span>
              <span className="font-mono tabular-nums font-semibold text-stone-900 dark:text-stone-100">
                {totalDebits > 0 && <span className="text-rose-600 dark:text-rose-400">-{formatCurrency(totalDebits)}</span>}
                {totalDebits > 0 && totalCredits > 0 && <span> · </span>}
                {totalCredits > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{formatCurrency(totalCredits)}</span>}
              </span>
            </div>
            <div className="max-h-28 overflow-y-auto divide-y divide-black/[0.04] dark:divide-white/[0.05] pt-1">
              {transactions.map((t) => (
                <div key={t.id} className="py-1.5 flex items-baseline justify-between gap-3 text-[11px]">
                  <span className="font-mono text-stone-400">{formatDateBR(t.date)}</span>
                  <span className="truncate flex-1 text-stone-700 dark:text-stone-300">{t.memo}</span>
                  <span className={`font-mono tabular-nums shrink-0 ${t.amount < 0 ? 'text-stone-900 dark:text-stone-100' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {formatCurrency(t.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Seleção de Conta */}
          <div className="space-y-1.5">
            <label className="block text-[12px] font-medium text-stone-700 dark:text-stone-300">
              Conta do plano de contas <span className="text-rose-500">*</span>
            </label>
            <AccountPicker
              accounts={accounts}
              value={accountId}
              onChange={setAccountId}
            />
          </div>

          {/* Opção de Regra */}
          <div className="pt-1 border-t border-black/[0.05] dark:border-white/[0.06]">
            <RuleLearnPanel
              checked={learnRule}
              onChecked={setCustomLearnRule}
              title="Lembrar essa classificação"
              subtitle="Cria regra automática para lançamentos semelhantes futuros"
              term={pattern}
              onTerm={setCustomPattern}
              matchType={matchType}
              onMatchType={setMatchType}
              assessment={assessment}
              acknowledged={acknowledged}
              onAcknowledged={setAcknowledged}
              suggestion={initialSuggested}
            />
          </div>
        </div>

        {/* Rodapé com Ações (fixo) */}
        <div className="shrink-0 flex items-center justify-end gap-2.5 px-6 py-4 border-t border-black/[0.05] dark:border-white/[0.06]">
          <button type="button" onClick={onClose} disabled={isSaving} className={`${BUTTON.secondary} h-9 px-4`}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => void handleSave()}
            className={`${BUTTON.primary} h-9 px-5`}
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckSquare className="w-4 h-4" />}
            Classificar {transactions.length}
          </button>
        </div>
      </div>
    </div>
  );

  return <ModalPortal>{dialog}</ModalPortal>;
}
