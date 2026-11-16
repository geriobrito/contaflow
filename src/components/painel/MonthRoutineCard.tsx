'use client';

import Link from 'next/link';
import { ArrowRight, Check, CircleDashed, Flag, Info, Minus } from 'lucide-react';
import { nextStep, type RoutineStep, type StepStatus } from '@/lib/month-steps';
import { shortMonth } from '@/lib/portfolio';
import { formatMonth } from '@/lib/periods';
import { BUTTON, SURFACE } from '@/components/ui/primitives';

const MARK: Record<StepStatus, { box: string; text: string }> = {
  done: { box: 'bg-emerald-500 text-white border-transparent', text: 'text-stone-500 dark:text-stone-400' },
  todo: { box: 'bg-surface text-stone-800 dark:text-stone-100 border-amber-400 dark:border-amber-500/70', text: 'text-amber-800 dark:text-amber-300' },
  hint: { box: 'bg-surface text-sky-700 dark:text-sky-300 border-sky-300 dark:border-sky-500/50', text: 'text-stone-600 dark:text-stone-300' },
  na: { box: 'bg-black/3 dark:bg-white/5 text-stone-400 border-transparent', text: 'text-stone-500 dark:text-stone-400' },
  loading: { box: 'bg-black/3 dark:bg-white/5 text-stone-400 border-transparent', text: 'text-stone-400' },
};

const STATUS_LABEL: Record<StepStatus, string> = { done: 'feito', todo: 'a fazer', hint: 'para conferir', na: 'não se aplica', loading: 'conferindo' };

interface MonthRoutineCardProps {
  /** Competências em que há trabalho, da mais antiga para a mais recente. */
  months: readonly string[];
  month: string;
  onMonthChange: (month: string) => void;
  steps: readonly RoutineStep[];
}

/**
 * Rotina do mês: os passos do menu, na ordem em que são feitos, com a situação de cada um na
 * competência escolhida, e o atalho para o próximo que falta.
 */
export function MonthRoutineCard({ months, month, onMonthChange, steps }: MonthRoutineCardProps) {
  const next = nextStep(steps);
  const applicable = steps.filter((s) => s.status !== 'na' && s.key !== 'close');
  const done = applicable.filter((s) => s.status === 'done').length;

  return (
    <section className={`${SURFACE} rounded-[22px] overflow-hidden`} aria-label="Rotina do mês">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5 border-b border-line">
        <h2 className="text-[15px] font-semibold tracking-tight">Rotina de {formatMonth(month)}</h2>
        <p className="text-[12px] text-stone-500">
          {done} de {applicable.length} passo(s) concluído(s)
        </p>
        {months.length > 1 && (
          <label className="ml-auto flex items-center gap-2 text-[12px] text-stone-500">
            Competência
            <select
              value={month}
              onChange={(e) => onMonthChange(e.target.value)}
              className="h-8 px-2.5 rounded-lg bg-surface border border-line-strong text-[12px] text-stone-800 dark:text-stone-100 outline-none"
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {shortMonth(m)}
                </option>
              ))}
            </select>
          </label>
        )}
        {next && (
          <Link href={next.href} className={`${BUTTON.accent} h-8 ${months.length > 1 ? '' : 'ml-auto'}`}>
            {next.key === 'close' ? 'Fechar o mês' : `Continuar: ${next.label}`}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>

      <ol className="divide-y divide-black/4 dark:divide-white/5">
        {steps.map((s, i) => {
          const mark = MARK[s.status];
          const current = next?.key === s.key;
          return (
            <li key={s.key}>
              <Link
                href={s.href}
                aria-current={current ? 'step' : undefined}
                className={`flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-black/2 dark:hover:bg-white/3 ${current ? 'bg-amber-50/60 dark:bg-amber-950/15' : ''}`}
              >
                <span aria-hidden className={`w-6 h-6 shrink-0 rounded-full border inline-flex items-center justify-center text-[11px] font-semibold font-mono ${mark.box}`}>
                  {s.status === 'done' ? (
                    <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                  ) : s.status === 'loading' ? (
                    <CircleDashed className="w-3.5 h-3.5 animate-spin" />
                  ) : s.status === 'na' && s.key !== 'close' ? (
                    <Minus className="w-3.5 h-3.5" />
                  ) : s.key === 'close' ? (
                    <Flag className="w-3 h-3" />
                  ) : s.status === 'hint' ? (
                    <Info className="w-3.5 h-3.5" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="w-[210px] shrink-0 text-[13.5px] font-medium tracking-tight text-stone-900 dark:text-stone-100">
                  {s.key !== 'close' && <span className="font-mono text-[11px] text-stone-400 mr-1.5">{i + 1}</span>}
                  {s.label}
                </span>
                <span className={`flex-1 min-w-0 truncate text-[12.5px] ${mark.text}`} title={s.detail}>
                  <span className="sr-only">{STATUS_LABEL[s.status]}: </span>
                  {s.detail}
                </span>
                <ArrowRight className="w-4 h-4 shrink-0 text-stone-300 dark:text-stone-600" />
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
