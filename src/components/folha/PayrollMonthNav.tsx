'use client';

import { ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import type { PayrollMonthState, PayrollMonthStatus } from '@/lib/payroll';
import { formatMonth } from '@/lib/periods';
import { formatCurrency } from '@/lib/utils/formatters';
import { MONTHS } from '@/components/ui/PeriodPicker';
import { SEGMENT_PILL, SEGMENT_TRACK, segmentClass } from '@/components/ui/primitives';
import { useSlidingIndicator } from '@/components/ui/useSlidingIndicator';

const STATE_LABEL: Record<PayrollMonthState, string> = {
  LOCKED: 'folha lançada, competência fechada',
  POSTED: 'folha lançada',
  MISSING: 'falta lançar a folha',
  EMPTY: 'sem folha',
};

const STEPPER =
  'w-8 h-8 rounded-full flex items-center justify-center text-stone-500 hover:bg-black/5 dark:hover:bg-white/8 hover:text-stone-900 dark:hover:text-stone-100 active:scale-[0.94] transition-all duration-150';

/** Marca da situação da folha ao lado do nome do mês. */
function StateMark({ state }: { state: PayrollMonthState }) {
  if (state === 'LOCKED') return <Lock aria-hidden className="w-2.5 h-2.5 text-stone-400" strokeWidth={2.25} />;
  if (state === 'POSTED') return <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-emerald-500" />;
  if (state === 'MISSING') return <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-amber-500" />;
  return null;
}

/**
 * Competência da folha: o ano e os 12 meses, cada um com a situação (lançada, fechada ou
 * faltando). No lugar do campo de data do navegador e da lista de competências lançadas: o ano
 * inteiro fica à vista, e o mês que ficou sem folha aparece marcado.
 */
export function PayrollMonthNav({ month, overview, onChange }: { month: string; overview: readonly PayrollMonthStatus[]; onChange: (month: string) => void }) {
  const year = Number(month.slice(0, 4));
  const { containerRef, indicatorRef } = useSlidingIndicator<HTMLDivElement>(month);
  const stepYear = (delta: number) => onChange(`${year + delta}-${month.slice(5)}`);
  const missing = overview.filter((m) => m.state === 'MISSING').length;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 print:hidden">
      <div className="inline-flex items-center gap-1">
        <button type="button" onClick={() => stepYear(-1)} aria-label="Ano anterior" className={STEPPER}>
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="w-12 text-center font-mono tabular-nums text-[14px] font-medium text-stone-900 dark:text-stone-100">{year}</span>
        <button type="button" onClick={() => stepYear(1)} aria-label="Próximo ano" className={STEPPER}>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="max-w-full overflow-x-auto">
        <div ref={containerRef} role="radiogroup" aria-label="Competência da folha" className={SEGMENT_TRACK}>
          <span ref={indicatorRef} aria-hidden className={SEGMENT_PILL} />
          {overview.map((m, i) => {
            const active = m.month === month;
            const detail = m.totalExpense > 0 ? ` · custo total ${formatCurrency(m.totalExpense)}` : '';
            return (
              <button
                key={m.month}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={`${formatMonth(m.month)}: ${STATE_LABEL[m.state]}`}
                title={`${formatMonth(m.month)}: ${STATE_LABEL[m.state]}${detail}`}
                data-active={active}
                onClick={() => !active && onChange(m.month)}
                className={`${segmentClass(active)} inline-flex items-center gap-1.5`}
              >
                {MONTHS[i]}
                <StateMark state={m.state} />
              </button>
            );
          })}
        </div>
      </div>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-stone-500 dark:text-stone-400">
        <span className="inline-flex items-center gap-1.5">
          <StateMark state="POSTED" /> lançada
        </span>
        <span className="inline-flex items-center gap-1.5">
          <StateMark state="LOCKED" /> fechada
        </span>
        <span className={`inline-flex items-center gap-1.5 ${missing > 0 ? 'font-medium text-amber-700 dark:text-amber-400' : ''}`}>
          <StateMark state="MISSING" /> {missing > 0 ? `${missing} sem folha em ${year}` : 'falta lançar'}
        </span>
      </p>
    </div>
  );
}
