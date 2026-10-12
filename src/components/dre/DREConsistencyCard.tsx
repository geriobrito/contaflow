'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, AlertTriangle, ChevronDown, ChevronUp, ExternalLink, ShieldCheck } from 'lucide-react';
import type { ConsistencyCheck } from '@/lib/dre/consistency';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

interface Props {
  consistency: ConsistencyCheck;
  date: string;
}

export function DREConsistencyCard({ consistency, date }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { isConsistent, dreNetResult, balanceCurrentResult, difference, issues } = consistency;

  // Se tudo estiver consistente e não houver avisos de suspense ou desbalanceamento
  if (isConsistent && issues.length === 0) {
    return (
      <aside
        aria-label="Consistência contábil"
        className="print-avoid-break rounded-[20px] border border-emerald-200/60 dark:border-emerald-800/40 bg-emerald-50/50 dark:bg-emerald-950/20 p-4 sm:p-5 transition-all"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 shrink-0 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-semibold text-emerald-900 dark:text-emerald-200">
                  Consistência contábil verificada · Partidas dobradas
                </h3>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300">
                  Alinhado
                </span>
              </div>
              <p className="mt-1 text-[13px] text-emerald-800/80 dark:text-emerald-300/80">
                O Resultado Líquido apurado na DRE (<span className="font-mono tabular-nums font-medium">{formatCurrency(dreNetResult)}</span>) bate
                exatamente com o Resultado do Exercício no Patrimônio Líquido do Balanço Patrimonial em {formatDateBR(date)}.
              </p>
            </div>
          </div>
          <Link
            href="/balanco"
            className="hidden sm:inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700 dark:text-emerald-400 hover:underline shrink-0"
          >
            Ver no Balanço <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      </aside>
    );
  }

  // Quando há avisos (pendências, lançamentos a classificar ou divergência numérica)
  const hasDivergence = !isConsistent;

  return (
    <aside
      aria-label="Conferência de consistência contábil"
      className={`print-avoid-break rounded-[20px] border p-4 sm:p-5 transition-all ${
        hasDivergence
          ? 'border-rose-200/70 dark:border-rose-900/40 bg-rose-50/40 dark:bg-rose-950/20'
          : 'border-amber-200/70 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/20'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-white ${
              hasDivergence ? 'bg-rose-600' : 'bg-amber-600'
            }`}
          >
            {hasDivergence ? <AlertCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3
                className={`text-[14px] font-semibold ${
                  hasDivergence ? 'text-rose-900 dark:text-rose-200' : 'text-amber-900 dark:text-amber-200'
                }`}
              >
                {hasDivergence ? 'Divergência entre DRE e Balanço Patrimonial' : 'Conferência Contábil · Fechamento com Pendências'}
              </h3>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                  hasDivergence
                    ? 'bg-rose-100 dark:bg-rose-900/60 text-rose-800 dark:text-rose-300'
                    : 'bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300'
                }`}
              >
                {hasDivergence ? `Diferença de ${formatCurrency(Math.abs(difference))}` : 'Resultado Provisório'}
              </span>
            </div>
            <p
              className={`mt-1 text-[13px] ${
                hasDivergence ? 'text-rose-800/90 dark:text-rose-300/90' : 'text-amber-800/90 dark:text-amber-300/90'
              }`}
            >
              {hasDivergence
                ? `O resultado apurado na DRE (${formatCurrency(dreNetResult)}) difere do saldo de Resultado do Exercício no Balanço (${formatCurrency(balanceCurrentResult)}). Verifique os motivos abaixo.`
                : `O resultado da DRE bate com as partidas de resultado do Balanço, mas existem lançamentos ainda não conciliados em contas transitórias que podem alterar os números finais.`}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-medium rounded-lg text-stone-600 dark:text-stone-300 hover:bg-black/[0.05] dark:hover:bg-white/[0.05] transition-colors shrink-0"
        >
          {expanded ? 'Ocultar detalhes' : 'Ver detalhes'}
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Painel comparativo de valores */}
      <div className="mt-4 pt-3 border-t border-black/[0.06] dark:border-white/[0.08] grid grid-cols-2 sm:grid-cols-3 gap-3 text-[12px]">
        <div>
          <span className="text-stone-500">DRE do Exercício</span>
          <p className="mt-0.5 font-mono font-semibold tabular-nums text-stone-800 dark:text-stone-100">
            {formatCurrency(dreNetResult)}
          </p>
        </div>
        <div>
          <span className="text-stone-500">Resultado no Balanço (PL)</span>
          <p className="mt-0.5 font-mono font-semibold tabular-nums text-stone-800 dark:text-stone-100">
            {formatCurrency(balanceCurrentResult)}
          </p>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <span className="text-stone-500">Divergência Contábil</span>
          <p
            className={`mt-0.5 font-mono font-semibold tabular-nums ${
              hasDivergence ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {formatCurrency(difference)}
          </p>
        </div>
      </div>

      {/* Detalhamento dos diagnósticos e pendências */}
      {expanded && (
        <div className="mt-4 space-y-2.5 pt-3 border-t border-black/[0.06] dark:border-white/[0.08]">
          <h4 className="text-[12px] font-semibold text-stone-600 dark:text-stone-300 uppercase tracking-wider">
            Motivos e apontamentos identificados ({issues.length})
          </h4>
          <ul className="space-y-2">
            {issues.map((issue) => (
              <li
                key={issue.id}
                className="flex items-start gap-2.5 rounded-xl bg-white/60 dark:bg-stone-900/40 p-3 border border-black/[0.04] text-[12px]"
              >
                <span className="mt-0.5 shrink-0">
                  {issue.severity === 'error' ? (
                    <AlertCircle className="w-4 h-4 text-rose-500" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-stone-800 dark:text-stone-200">{issue.title}</p>
                  <p className="mt-0.5 text-stone-600 dark:text-stone-400 leading-relaxed">{issue.description}</p>
                </div>
                {issue.type === 'SUSPENSE_ENTRIES' && (
                  <Link
                    href="/"
                    className="shrink-0 self-center px-2 py-1 rounded-md text-[11px] font-medium bg-[#0071E3] text-white hover:bg-[#0077ED] transition-colors"
                  >
                    Conciliar
                  </Link>
                )}
                {issue.type === 'UNLINKED_BANKS' && (
                  <Link
                    href="/contas"
                    className="shrink-0 self-center px-2 py-1 rounded-md text-[11px] font-medium bg-[#0071E3] text-white hover:bg-[#0077ED] transition-colors"
                  >
                    Vincular
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
