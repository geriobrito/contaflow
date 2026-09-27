'use client';

import React, { useState, useEffect } from 'react';
import { X, Sparkles, Check, BrainCircuit } from 'lucide-react';
import { BankTransaction, ChartAccount } from '@/types/firestore';
import { suggestRulePattern } from '@/lib/rules/engine';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

interface ClassifyModalProps {
  isOpen: boolean;
  transaction: BankTransaction | null;
  accounts: ChartAccount[];
  onClose: () => void;
  onConfirm: (
    transactionId: string,
    account: ChartAccount,
    learnRule: boolean,
    pattern: string,
    applyToSimilar: boolean
  ) => void;
}

export const ClassifyModal: React.FC<ClassifyModalProps> = ({
  isOpen,
  transaction,
  accounts,
  onClose,
  onConfirm,
}) => {
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [learnRule, setLearnRule] = useState(true);
  const [pattern, setPattern] = useState('');
  const [applyToSimilar, setApplyToSimilar] = useState(true);
  const [searchAccount, setSearchAccount] = useState('');

  // Apenas contas analíticas podem receber lançamentos
  const analyticAccounts = accounts.filter((a) => a.nature === 'ANALYTIC');

  useEffect(() => {
    if (transaction) {
      setSelectedAccountId(transaction.accountId || '');
      const suggested = suggestRulePattern(transaction.memo);
      setPattern(suggested);
      setLearnRule(true);
      setApplyToSimilar(true);
    }
  }, [transaction]);

  if (!isOpen || !transaction) return null;

  const filteredAccounts = analyticAccounts.filter(
    (a) =>
      a.name.toLowerCase().includes(searchAccount.toLowerCase()) ||
      a.code.includes(searchAccount)
  );

  const handleSave = () => {
    const acc = accounts.find((a) => a.id === selectedAccountId);
    if (!acc) return;
    onConfirm(transaction.id, acc, learnRule, pattern, applyToSimilar);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-3xl ios-card p-6 shadow-2xl border border-black/[0.08] dark:border-white/[0.1] bg-white/95 dark:bg-zinc-900/95">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-black/[0.06] dark:border-white/[0.08]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                Classificar Lançamento
              </h3>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Atribua ao Plano de Contas e ensine o robô
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-black/[0.04]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Transaction Info Box */}
        <div className="my-4 p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-black/[0.04] dark:border-white/[0.04] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {formatDateBR(transaction.date)}
            </span>
            <span
              className={`text-sm font-semibold ${
                transaction.amount < 0
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {formatCurrency(transaction.amount)}
            </span>
          </div>
          <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100 font-mono break-all">
            {transaction.memo}
          </p>
          <div className="text-[10px] text-zinc-400 font-mono">
            FITID: {transaction.fitid}
          </div>
        </div>

        {/* Select Account */}
        <div className="space-y-2 mb-4">
          <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            Conta do Plano de Contas (Analítica)
          </label>
          <input
            type="text"
            placeholder="Buscar conta por nome ou código..."
            value={searchAccount}
            onChange={(e) => setSearchAccount(e.target.value)}
            className="w-full text-xs px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 mb-1"
          />
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="w-full text-xs px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="">Selecione uma conta...</option>
            {filteredAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} - {a.name} ({a.type})
              </option>
            ))}
          </select>
        </div>

        {/* Machine Learning Engine Box */}
        <div className="p-3.5 rounded-2xl bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 space-y-3 mb-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BrainCircuit className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span className="text-xs font-semibold text-indigo-950 dark:text-indigo-200">
                Aprendizado Contínuo
              </span>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={learnRule}
                onChange={(e) => setLearnRule(e.target.checked)}
                className="w-4 h-4 rounded text-blue-600 border-zinc-300 focus:ring-blue-500"
              />
              <span className="text-[11px] font-medium text-indigo-900 dark:text-indigo-300">
                Memorizar regra
              </span>
            </label>
          </div>

          {learnRule && (
            <div className="space-y-2 pt-1 border-t border-indigo-100 dark:border-indigo-900/40">
              <div>
                <label className="text-[11px] text-zinc-600 dark:text-zinc-400 block mb-1">
                  Padrão reconhecido no MEMO para próximas importações:
                </label>
                <input
                  type="text"
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value.toUpperCase())}
                  placeholder="Ex: UBER, AWS, DAS"
                  className="w-full text-xs font-mono px-3 py-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 uppercase"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={applyToSimilar}
                  onChange={(e) => setApplyToSimilar(e.target.checked)}
                  className="w-3.5 h-3.5 rounded text-indigo-600 border-zinc-300 focus:ring-indigo-500"
                />
                <span className="text-[11px] text-zinc-600 dark:text-zinc-400">
                  Classificar também outros itens parecidos deste extrato agora
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            className="ios-button px-4 py-2 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={!selectedAccountId}
            className="ios-button px-4 py-2 rounded-xl text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Confirmar e Conciliar</span>
          </button>
        </div>
      </div>
    </div>
  );
};
