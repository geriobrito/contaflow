'use client';

import React from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import type { DREStatement } from '@/lib/dre/build';
import { formatCurrency } from '@/lib/utils/formatters';

export type DRETone = 'neutral' | 'profit' | 'loss';

const TONES: Record<DRETone, { card: string; label: string; value: string; icon: string }> = {
  neutral: {
    card: 'bg-white/70 dark:bg-stone-900/60 border-black/[0.06] dark:border-white/[0.08]',
    label: 'text-stone-500',
    value: 'text-stone-400 dark:text-stone-500',
    icon: 'bg-stone-200 dark:bg-stone-700 text-stone-500',
  },
  profit: {
    card: 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-900/40',
    label: 'text-emerald-700 dark:text-emerald-400',
    value: 'text-emerald-700 dark:text-emerald-300',
    icon: 'bg-emerald-600 text-white',
  },
  loss: {
    card: 'bg-rose-50/70 dark:bg-rose-950/20 border-rose-200/60 dark:border-rose-900/40',
    label: 'text-rose-700 dark:text-rose-400',
    value: 'text-rose-700 dark:text-rose-300',
    icon: 'bg-rose-600 text-white',
  },
};

interface DREResultCardProps {
  dre: DREStatement;
  tone: DRETone;
  profit: boolean;
  isLoading: boolean;
  failed: boolean;
  periodLabel: string;
}

/** Resultado líquido do período em destaque, na cor do lucro ou do prejuízo. */
export function DREResultCard({ dre, tone, profit, isLoading, failed, periodLabel }: DREResultCardProps) {
  const TONE = TONES[tone];
  return (
    <section
      className={`print-avoid-break rounded-[22px] p-7 border ${TONE.card}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className={`text-[13px] font-medium ${TONE.label}`}>
            Resultado líquido do exercício · {periodLabel}
          </p>
          <p
            className={`mt-2 text-[40px] leading-none font-semibold tracking-tight font-mono tabular-nums ${TONE.value}`}
          >
            {isLoading || failed ? '—' : formatCurrency(dre.netResult)}
          </p>
          <p className="mt-3 text-[13px] text-stone-600 dark:text-stone-400">
            {failed ? 'DRE indisponível' : tone === 'neutral' ? 'Sem movimentação conciliada' : profit ? 'Lucro' : 'Prejuízo'}
            {!failed && dre.netMargin !== null && (
              <>
                {' · margem líquida '}
                <span className="font-mono tabular-nums">{dre.netMargin.toFixed(1).replace('.', ',')}%</span>
              </>
            )}
          </p>
        </div>
        <span
          className={`w-11 h-11 shrink-0 rounded-2xl flex items-center justify-center ${TONE.icon}`}
        >
          {profit ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
        </span>
      </div>
    </section>
  );
}
