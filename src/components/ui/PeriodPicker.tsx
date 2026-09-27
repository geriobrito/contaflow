'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { periodRange, type DateRange, type PeriodMode } from '@/lib/dre/build';
import { SegmentedControl } from '@/components/ui/primitives';

const MODES: readonly { value: PeriodMode; label: string }[] = [
  { value: 'month', label: 'Mês' },
  { value: 'quarter', label: 'Trimestre' },
  { value: 'year', label: 'Ano' },
];
export const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'] as const;
const QUARTERS = ['T1', 'T2', 'T3', 'T4'] as const;

export interface PeriodState {
  mode: PeriodMode;
  year: number;
  month: number;
  quarter: number;
  range: DateRange;
  label: string;
  setMode: (mode: PeriodMode) => void;
  setYear: (updater: number | ((y: number) => number)) => void;
  setMonth: (m: number) => void;
  setQuarter: (q: number) => void;
  /** Posiciona o período para conter a data (YYYY-MM-DD), mantendo o tipo de período. */
  jumpTo: (date: string) => void;
}

const today = () => new Date();

export function usePeriod(initialMode: PeriodMode): PeriodState {
  const [mode, setMode] = useState<PeriodMode>(initialMode);
  const [year, setYear] = useState(() => today().getFullYear());
  const [month, setMonth] = useState(() => today().getMonth() + 1);
  const [quarter, setQuarter] = useState(() => Math.floor(today().getMonth() / 3) + 1);

  const jumpTo = useCallback((date: string) => {
    const [y, m] = date.split('-').map(Number);
    if (!y || !m) return;
    setYear(y);
    setMonth(m);
    setQuarter(Math.floor((m - 1) / 3) + 1);
  }, []);

  const range = useMemo(() => periodRange(mode, year, mode === 'month' ? month : quarter), [mode, year, month, quarter]);
  const label =
    mode === 'year' ? String(year) : mode === 'quarter' ? `${quarter}º trimestre de ${year}` : `${MONTHS[month - 1]}/${year}`;

  return { mode, year, month, quarter, range, label, setMode, setYear, setMonth, setQuarter, jumpTo };
}

/** Controle de período no estilo iOS: tipo (Mês/Trimestre/Ano), ano e mês/trimestre. */
export function PeriodPicker({ period, className = '' }: { period: PeriodState; className?: string }) {
  const { mode, year, month, quarter, setMode, setYear, setMonth, setQuarter } = period;
  const stepper =
    'w-8 h-8 rounded-full flex items-center justify-center text-stone-500 hover:bg-black/[0.05] active:scale-[0.94] transition-all duration-150';
  return (
    <div className={`flex flex-wrap items-center gap-3 print:hidden ${className}`}>
      <SegmentedControl ariaLabel="Tipo de período" value={mode} onChange={setMode} options={MODES} />
      <div className="inline-flex items-center gap-1">
        <button type="button" onClick={() => setYear((y) => y - 1)} aria-label="Ano anterior" className={stepper}>
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="w-12 text-center font-mono tabular-nums text-[14px] font-medium text-stone-900 dark:text-stone-100">
          {year}
        </span>
        <button type="button" onClick={() => setYear((y) => y + 1)} aria-label="Próximo ano" className={stepper}>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      {mode === 'quarter' && (
        <SegmentedControl
          ariaLabel="Trimestre"
          value={String(quarter)}
          onChange={(v) => setQuarter(Number(v))}
          options={QUARTERS.map((q, i) => ({ value: String(i + 1), label: q }))}
        />
      )}
      {mode === 'month' && (
        <div className="w-full sm:w-auto overflow-x-auto">
          <SegmentedControl
            ariaLabel="Mês"
            value={String(month)}
            onChange={(v) => setMonth(Number(v))}
            options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
          />
        </div>
      )}
    </div>
  );
}
