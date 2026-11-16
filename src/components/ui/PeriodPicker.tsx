'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { periodRange, type DateRange, type PeriodMode } from '@/lib/dre/build';
import { SegmentedControl } from '@/components/ui/primitives';
import { periodOfDate, readSharedPeriod, SHARED_PERIOD_RESET_EVENT, writeSharedPeriod, type SharedPeriod } from '@/lib/shared-period';

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
  /** Posiciona o período para conter a data (YYYY-MM-DD), mantendo o tipo de período. Conta como escolha. */
  jumpTo: (date: string) => void;
  /**
   * Período sugerido pelos dados (o do movimento mais recente da empresa): só vale enquanto o
   * usuário não escolheu um período, aqui ou em outra demonstração.
   */
  suggest: (date: string) => void;
}

const today = () => new Date();

/**
 * Período de uma tela. Com `shared`, é o período das Demonstrações: a escolha feita numa tela é
 * guardada na sessão e vale nas outras (ver src/lib/shared-period.ts). Enquanto não houver
 * escolha, a tela aceita o período sugerido pelos dados (`suggest`); depois dela, não mais.
 */
export function usePeriod(initialMode: PeriodMode, shared = false): PeriodState {
  const [mode, setModeState] = useState<PeriodMode>(initialMode);
  const [year, setYearState] = useState(() => today().getFullYear());
  const [month, setMonthState] = useState(() => today().getMonth() + 1);
  const [quarter, setQuarterState] = useState(() => Math.floor(today().getMonth() / 3) + 1);
  /** Já houve escolha (nesta tela ou guardada de outra): o período sugerido não a desfaz. */
  const chosen = useRef(false);

  useEffect(() => {
    if (!shared) return;
    let active = true;
    // Depois da montagem (o servidor não tem a sessão): aplica o período escolhido em outra tela.
    void Promise.resolve().then(() => {
      const saved = active ? readSharedPeriod() : null;
      if (!saved) return;
      chosen.current = true;
      if (saved.mode) setModeState(saved.mode);
      if (saved.year) setYearState(saved.year);
      if (saved.month) setMonthState(saved.month);
      if (saved.quarter) setQuarterState(saved.quarter);
    });
    const onReset = () => {
      chosen.current = false;
    };
    window.addEventListener(SHARED_PERIOD_RESET_EVENT, onReset);
    return () => {
      active = false;
      window.removeEventListener(SHARED_PERIOD_RESET_EVENT, onReset);
    };
  }, [shared]);

  /** Escolha do usuário: vale aqui e, no período compartilhado, nas outras demonstrações. */
  const choose = (patch: SharedPeriod) => {
    chosen.current = true;
    if (shared) writeSharedPeriod({ mode, year, month, quarter, ...patch });
  };
  const setMode = (next: PeriodMode) => {
    setModeState(next);
    choose({ mode: next });
  };
  const setYear = (updater: number | ((y: number) => number)) => {
    const next = typeof updater === 'function' ? updater(year) : updater;
    setYearState(next);
    choose({ year: next });
  };
  const setMonth = (next: number) => {
    setMonthState(next);
    choose({ month: next });
  };
  const setQuarter = (next: number) => {
    setQuarterState(next);
    choose({ quarter: next });
  };

  const apply = useCallback((date: string) => {
    const at = periodOfDate(date);
    if (!at) return null;
    setYearState(at.year);
    setMonthState(at.month);
    setQuarterState(at.quarter);
    return at;
  }, []);

  const jumpTo = useCallback(
    (date: string) => {
      const at = apply(date);
      if (!at) return;
      chosen.current = true;
      if (shared) writeSharedPeriod(at);
    },
    [apply, shared]
  );

  const suggest = useCallback(
    (date: string) => {
      if (!chosen.current) apply(date);
    },
    [apply]
  );

  const range = useMemo(() => periodRange(mode, year, mode === 'month' ? month : quarter), [mode, year, month, quarter]);
  const label =
    mode === 'year' ? String(year) : mode === 'quarter' ? `${quarter}º trimestre de ${year}` : `${MONTHS[month - 1]}/${year}`;

  return { mode, year, month, quarter, range, label, setMode, setYear, setMonth, setQuarter, jumpTo, suggest };
}

/**
 * Exercício (ano) das telas anuais das Demonstrações (Notas Explicativas, Fechamento do
 * Exercício), ligado ao período compartilhado: abre no ano escolhido em outra tela, se estiver
 * entre os oferecidos, e a troca feita aqui vale nas outras.
 */
export function useSharedYear(defaultYear: string, allowed: readonly string[]): [string, (year: string) => void] {
  const [year, setYearState] = useState(defaultYear);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      const saved = active ? readSharedPeriod()?.year : undefined;
      if (saved && allowed.includes(String(saved))) setYearState(String(saved));
    });
    return () => {
      active = false;
    };
  }, [allowed]);

  const setYear = useCallback((next: string) => {
    setYearState(next);
    if (/^\d{4}$/.test(next)) writeSharedPeriod({ year: Number(next) });
  }, []);

  return [year, setYear];
}

const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'] as const;

/**
 * Controle de período no estilo iOS: tipo (Mês/Trimestre/Ano), ano e mês/trimestre. Com
 * `lockedMonths` (competências AAAA-MM fechadas), os meses fechados do ano levam um cadeado:
 * dá para ver de relance até onde o ano está entregue e qual é o próximo mês a trabalhar.
 */
export function PeriodPicker({ period, className = '', lockedMonths }: { period: PeriodState; className?: string; lockedMonths?: ReadonlySet<string> }) {
  const { mode, year, month, quarter, setMode, setYear, setMonth, setQuarter } = period;
  const stepper =
    'w-8 h-8 rounded-full flex items-center justify-center text-stone-500 hover:bg-black/5 dark:hover:bg-white/8 active:scale-[0.94] transition-all duration-150';
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
        <div className="w-auto overflow-x-auto">
          <SegmentedControl
            ariaLabel="Mês"
            value={String(month)}
            onChange={(v) => setMonth(Number(v))}
            options={MONTHS.map((m, i) => {
              const closed = lockedMonths?.has(`${year}-${String(i + 1).padStart(2, '0')}`) ?? false;
              return {
                value: String(i + 1),
                title: closed ? `${MONTH_NAMES[i]} de ${year}: competência fechada` : undefined,
                label: closed ? (
                  <span className="inline-flex items-center gap-1">
                    {m}
                    <Lock aria-hidden className="w-2.5 h-2.5 opacity-60" strokeWidth={2.25} />
                  </span>
                ) : (
                  m
                ),
              };
            })}
          />
        </div>
      )}
    </div>
  );
}
