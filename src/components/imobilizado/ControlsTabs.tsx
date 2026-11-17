'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useClient } from '@/contexts/ClientContext';
import { MONTH_QUERY_EVENT, readMonthQuery } from '@/hooks/imobilizado/useMonthQueryState';
import { useMonthRoutines } from '@/hooks/imobilizado/useMonthRoutines';
import type { MonthRoutines, RoutineKey } from '@/lib/services/month-routines';
import { segmentClass } from '@/components/ui/primitives';

/** Abas de Bens e Contratos: os cadastros que geram lançamentos mensais, e a rotina de cada um. */
const TABS: readonly { href: string; label: string; routine?: RoutineKey }[] = [
  { href: '/bens-e-contratos', label: 'Resumo' },
  { href: '/imobilizado', label: 'Imobilizado', routine: 'depreciation' },
  { href: '/despesas-antecipadas', label: 'Seguros e despesas antecipadas', routine: 'prepaid' },
  { href: '/financiamentos', label: 'Empréstimos e financiamentos', routine: 'financing' },
  { href: '/aplicacoes', label: 'Aplicações financeiras', routine: 'investment' },
  { href: '/estoque', label: 'Estoque e CMV', routine: 'stock' },
];

const competence = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

/**
 * Abas das cinco telas, com a situação da competência em cada uma: o ponto âmbar marca a aba que
 * ainda tem algo a lançar ou informar no mês, sem precisar abrir uma por uma. `busy` é a gravação
 * em andamento na tela: ao terminar, a situação é relida. O Resumo já carrega a situação e a
 * entrega em `routines`: aí as abas não leem de novo.
 */
export function ControlsTabs({ month, busy = false, routines: given }: { month?: string; busy?: boolean; routines?: MonthRoutines | null } = {}) {
  const pathname = usePathname();
  const { currentClient } = useClient();
  const [urlMonth, setUrlMonth] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) setUrlMonth(readMonthQuery());
    });
    const onMonthChange = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail) setUrlMonth(detail);
    };
    window.addEventListener(MONTH_QUERY_EVENT, onMonthChange);
    return () => {
      active = false;
      window.removeEventListener(MONTH_QUERY_EVENT, onMonthChange);
    };
  }, []);

  const queryMonth = month ?? urlMonth;
  const own = useMonthRoutines(currentClient?.id, given === undefined ? queryMonth : null, false, busy);
  const routines = given === undefined ? own.routines : given;

  /** O que falta na aba, na competência: lançar (impede o fechamento) ou informar um dado. */
  const pendingOf = (key: RoutineKey | undefined): string | null =>
    (key && (routines?.problemsByKey[key] ?? routines?.inputs.find((i) => i.key === key)?.label)) || null;
  const pendingCount = TABS.filter((t) => pendingOf(t.routine)).length;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="max-w-full overflow-x-auto">
        <nav aria-label="Bens e contratos" className="inline-flex p-0.5 rounded-xl bg-black/5 dark:bg-white/6">
          {TABS.map((t) => {
            const active = pathname.startsWith(t.href);
            const href = queryMonth ? `${t.href}?mes=${queryMonth}` : t.href;
            const pending = pendingOf(t.routine);
            return (
              <Link
                key={t.href}
                href={href}
                aria-current={active ? 'page' : undefined}
                title={pending ?? undefined}
                className={`${segmentClass(active)} inline-flex items-center gap-1.5 whitespace-nowrap ${active ? 'bg-white dark:bg-stone-700 shadow-[0_1px_3px_rgba(0,0,0,0.08)]' : ''}`}
              >
                {t.label}
                {pending && (
                  <>
                    <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    <span className="sr-only"> (pendente)</span>
                  </>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
      {routines && queryMonth && (
        <p role="status" className={`flex items-center gap-1.5 text-[12px] ${pendingCount ? 'text-amber-800 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-400'}`}>
          {pendingCount ? (
            <>
              <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              {pendingCount === 1 ? '1 aba com pendência' : `${pendingCount} abas com pendência`} em {competence(queryMonth)}
            </>
          ) : (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              Rotinas de {competence(queryMonth)} em dia
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** Alerta de erro padronizado das telas de Bens e Contratos. */
export function ControlsErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-2xl border border-rose-200/70 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-[13px] text-rose-700 dark:text-rose-300"
    >
      <AlertTriangle className="w-4 h-4 mt-px shrink-0" />
      <span>{message}</span>
    </div>
  );
}
