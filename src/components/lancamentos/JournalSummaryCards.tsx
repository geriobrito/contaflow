'use client';

import React from 'react';
import { Bookmark, Calculator, CheckCircle2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils/formatters';
import { SURFACE } from '@/components/ui/primitives';

/** Resumo do período: quantidade de lançamentos manuais, volume movimentado e onde eles aparecem. */
export function JournalSummaryCards({ stats }: { stats: { count: number; totalVolume: number } }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className={`${SURFACE} p-5 rounded-2xl flex items-center gap-4`}>
        <div className="w-12 h-12 rounded-xl bg-accent/10 text-accent-ink flex items-center justify-center shrink-0">
          <Calculator className="w-6 h-6" />
        </div>
        <div>
          <p className="text-[12px] font-medium text-stone-500 uppercase tracking-wider">
            Lançamentos no Período
          </p>
          <p className="text-[24px] font-semibold text-stone-900 dark:text-stone-50 mt-0.5">
            {stats.count}
          </p>
        </div>
      </div>

      <div className={`${SURFACE} p-5 rounded-2xl flex items-center gap-4`}>
        <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-6 h-6" />
        </div>
        <div>
          <p className="text-[12px] font-medium text-stone-500 uppercase tracking-wider">
            Volume Movimentado (Σ D = Σ C)
          </p>
          <p className="text-[24px] font-semibold font-mono text-stone-900 dark:text-stone-50 mt-0.5">
            {formatCurrency(stats.totalVolume)}
          </p>
        </div>
      </div>

      <div className={`${SURFACE} p-5 rounded-2xl flex items-center gap-4`}>
        <div className="w-12 h-12 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
          <Bookmark className="w-6 h-6" />
        </div>
        <div>
          <p className="text-[12px] font-medium text-stone-500 uppercase tracking-wider">
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
