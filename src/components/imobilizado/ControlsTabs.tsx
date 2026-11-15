'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { MONTH_QUERY_EVENT, readMonthQuery } from '@/hooks/imobilizado/useMonthQueryState';
import { segmentClass } from '@/components/ui/primitives';

/** Abas de Bens e Contratos: os cadastros que geram lançamentos mensais. */
const TABS = [
  { href: '/imobilizado', label: 'Imobilizado' },
  { href: '/despesas-antecipadas', label: 'Seguros e despesas antecipadas' },
  { href: '/financiamentos', label: 'Empréstimos e financiamentos' },
  { href: '/aplicacoes', label: 'Aplicações financeiras' },
  { href: '/estoque', label: 'Estoque e CMV' },
] as const;

export function ControlsTabs({ month }: { month?: string } = {}) {
  const pathname = usePathname();
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

  return (
    <div className="max-w-full overflow-x-auto">
      <nav aria-label="Bens e contratos" className="inline-flex p-0.5 rounded-xl bg-black/5 dark:bg-white/6">
        {TABS.map((t) => {
          const active = pathname.startsWith(t.href);
          const href = queryMonth ? `${t.href}?mes=${queryMonth}` : t.href;
          return (
            <Link
              key={t.href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`${segmentClass(active)} whitespace-nowrap ${active ? 'bg-white dark:bg-stone-700 shadow-[0_1px_3px_rgba(0,0,0,0.08)]' : ''}`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
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
