'use client';

import React, { useState } from 'react';
import {
  BankTransaction,
  ChartAccount,
  ReconciliationStatus,
} from '@/types/firestore';
import {
  Sparkles,
  CheckCircle2,
  Clock,
  Search,
  Filter,
  ArrowUpRight,
  ArrowDownLeft,
  Tag,
  CheckCheck,
} from 'lucide-react';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

interface TransactionTableProps {
  transactions: BankTransaction[];
  accounts: ChartAccount[];
  onOpenClassify: (transaction: BankTransaction) => void;
  onQuickApproveAuto: () => void;
}

export const TransactionTable: React.FC<TransactionTableProps> = ({
  transactions,
  accounts,
  onOpenClassify,
  onQuickApproveAuto,
}) => {
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredTransactions = transactions.filter((t) => {
    if (filterStatus !== 'ALL' && t.status !== filterStatus) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const matchMemo = t.memo.toLowerCase().includes(term);
      const matchFitid = t.fitid.toLowerCase().includes(term);
      const matchAccount = t.accountName?.toLowerCase().includes(term);
      if (!matchMemo && !matchFitid && !matchAccount) return false;
    }
    return true;
  });

  const pendingCount = transactions.filter((t) => t.status === 'PENDING').length;
  const autoCount = transactions.filter((t) => t.status === 'AUTO_CLASSIFIED').length;
  const reconciledCount = transactions.filter((t) => t.status === 'RECONCILED').length;

  return (
    <div className="w-full space-y-4">
      {/* Controls & Filters Header */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search input */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Filtrar por descrição, FITID ou conta..."
            className="w-full pl-9 pr-4 py-2 text-xs rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 shadow-sm"
          />
        </div>

        {/* Filter Badges / Segmented control */}
        <div className="flex items-center gap-1.5 p-1 bg-black/[0.03] dark:bg-white/[0.04] rounded-2xl border border-black/[0.04] dark:border-white/[0.06] overflow-x-auto">
          <button
            onClick={() => setFilterStatus('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              filterStatus === 'ALL'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
            }`}
          >
            Todos ({transactions.length})
          </button>
          <button
            onClick={() => setFilterStatus('AUTO_CLASSIFIED')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              filterStatus === 'AUTO_CLASSIFIED'
                ? 'bg-white dark:bg-zinc-800 text-purple-700 dark:text-purple-300 shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-purple-600'
            }`}
          >
            <Sparkles className="w-3 h-3 text-purple-500" />
            <span>Robô ({autoCount})</span>
          </button>
          <button
            onClick={() => setFilterStatus('PENDING')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              filterStatus === 'PENDING'
                ? 'bg-white dark:bg-zinc-800 text-amber-700 dark:text-amber-300 shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-amber-600'
            }`}
          >
            <Clock className="w-3 h-3 text-amber-500" />
            <span>Pendentes ({pendingCount})</span>
          </button>
          <button
            onClick={() => setFilterStatus('RECONCILED')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              filterStatus === 'RECONCILED'
                ? 'bg-white dark:bg-zinc-800 text-emerald-700 dark:text-emerald-300 shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-emerald-600'
            }`}
          >
            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            <span>Conciliados ({reconciledCount})</span>
          </button>
        </div>

        {/* Quick batch approve button */}
        {autoCount > 0 && (
          <button
            onClick={onQuickApproveAuto}
            className="ios-button flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-2xl text-xs font-medium bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-sm hover:from-purple-700 hover:to-indigo-700 whitespace-nowrap"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            <span>Aprovar Todos do Robô ({autoCount})</span>
          </button>
        )}
      </div>

      {/* Main Table */}
      <div className="ios-card rounded-3xl overflow-hidden border border-black/[0.06] dark:border-white/[0.08] shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-black/[0.06] dark:border-white/[0.08] bg-zinc-50/70 dark:bg-zinc-800/40 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                <th className="py-3 px-4">Data</th>
                <th className="py-3 px-4">Descrição do Extrato</th>
                <th className="py-3 px-4">FITID</th>
                <th className="py-3 px-4 text-right">Valor</th>
                <th className="py-3 px-4">Status & Regra</th>
                <th className="py-3 px-4">Classificação Contábil</th>
                <th className="py-3 px-4 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04] text-xs">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-400">
                    Nenhum lançamento encontrado para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((t) => {
                  const isDebit = t.amount < 0;

                  return (
                    <tr
                      key={t.id}
                      className="hover:bg-black/[0.015] dark:hover:bg-white/[0.02] transition-colors"
                    >
                      {/* Data */}
                      <td className="py-3.5 px-4 font-medium text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                        {formatDateBR(t.date)}
                      </td>

                      {/* Memo / Descrição */}
                      <td className="py-3.5 px-4 font-medium text-zinc-900 dark:text-zinc-100 max-w-xs truncate" title={t.memo}>
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${
                              isDebit
                                ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400'
                                : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'
                            }`}
                          >
                            {isDebit ? (
                              <ArrowDownLeft className="w-3.5 h-3.5" />
                            ) : (
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            )}
                          </span>
                          <span className="truncate">{t.memo}</span>
                        </div>
                      </td>

                      {/* FITID */}
                      <td className="py-3.5 px-4 font-mono text-[11px] text-zinc-400 max-w-[130px] truncate" title={t.fitid}>
                        {t.fitid}
                      </td>

                      {/* Valor */}
                      <td
                        className={`py-3.5 px-4 text-right font-semibold whitespace-nowrap ${
                          isDebit
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {formatCurrency(t.amount)}
                      </td>

                      {/* Status Badge */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {t.status === 'RECONCILED' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/40">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Conciliado</span>
                          </span>
                        )}
                        {t.status === 'AUTO_CLASSIFIED' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200/60 dark:border-purple-800/40">
                            <Sparkles className="w-3 h-3 text-purple-500" />
                            <span>Auto ({t.confidence || 90}%)</span>
                          </span>
                        )}
                        {t.status === 'PENDING' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40">
                            <Clock className="w-3 h-3" />
                            <span>Pendente</span>
                          </span>
                        )}
                      </td>

                      {/* Classificação Contábil */}
                      <td className="py-3.5 px-4 max-w-xs">
                        {t.accountName ? (
                          <div className="truncate">
                            <span className="font-semibold text-zinc-900 dark:text-white">
                              {t.accountCode}
                            </span>{' '}
                            <span className="text-zinc-600 dark:text-zinc-400">
                              - {t.accountName}
                            </span>
                          </div>
                        ) : (
                          <span className="text-zinc-400 italic text-[11px]">
                            Não associada
                          </span>
                        )}
                      </td>

                      {/* Ação */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <button
                          onClick={() => onOpenClassify(t)}
                          className="ios-button inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
                        >
                          <Tag className="w-3 h-3" />
                          <span>{t.accountId ? 'Alterar' : 'Classificar'}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
