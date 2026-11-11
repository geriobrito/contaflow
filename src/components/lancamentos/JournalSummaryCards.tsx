'use client';

import React from 'react';
import { Bookmark, Calculator, CheckCircle2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils/formatters';
import { SURFACE } from '@/components/ui/primitives';

/** Resumo do período: quantidade de lançamentos manuais, volume movimentado e onde eles aparecem. */
export function JournalSummaryCards({ stats }: { stats: { count: number; totalVolume: number } }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className={`${SURFACE} px-5 py-4 rounded-[20px] flex items-center gap-4`}>
        <div className="w-10 h-10 rounded-xl bg-accent/12 text-accent-ink flex items-center justify-center shrink-0">
          <Calculator className="w-5 h-5" strokeWidth={1.8} />
        </div>
        <div>
          <p className="text-[10.5px] font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-[0.1em]">
            Lançamentos no Período
          </p>
          <p className="text-[24px] leading-tight font-semibold font-mono tabular-nums tracking-tight text-stone-900 dark:text-stone-50 mt-1">
            {stats.count}
          </p>
        </div>
      </div>

      <div className={`${SURFACE} px-5 py-4 rounded-[20px] flex items-center gap-4`}>
        <div className="w-10 h-10 rounded-xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-5 h-5" strokeWidth={1.8} />
        </div>
        <div>
          <p className="text-[10.5px] font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-[0.1em]">
            Volume Movimentado (Σ D = Σ C)
          </p>
          <p className="text-[24px] leading-tight font-semibold font-mono tabular-nums tracking-tight text-stone-900 dark:text-stone-50 mt-1">
            {formatCurrency(stats.totalVolume)}
          </p>
        </div>
      </div>

      <div className={`${SURFACE} px-5 py-4 rounded-[20px] flex items-center gap-4`}>
        <div className="w-10 h-10 rounded-xl bg-stone-900/6 dark:bg-white/8 text-stone-600 dark:text-stone-300 flex items-center justify-center shrink-0">
          <Bookmark className="w-5 h-5" strokeWidth={1.8} />
        </div>
        <div>
          <p className="text-[10.5px] font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-[0.1em]">
            Impacto nos Demonstrativos
          </p>
          <p className="text-[13px] text-stone-600 dark:text-stone-300 mt-1">
            Refletido automaticamente no <strong>Balanço</strong>, <strong>Balancete</strong>, <strong>DRE</strong> e <strong>Razão</strong>.
          </p>
        </div>
      </div>
    </div>
  );
}
