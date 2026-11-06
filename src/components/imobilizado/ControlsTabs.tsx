'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { segmentClass } from '@/components/ui/primitives';

/** Abas de Bens e Contratos: os cadastros que geram lançamentos mensais. */
const TABS = [
  { href: '/imobilizado', label: 'Imobilizado' },
  { href: '/despesas-antecipadas', label: 'Seguros e despesas antecipadas' },
  { href: '/financiamentos', label: 'Empréstimos e financiamentos' },
  { href: '/aplicacoes', label: 'Aplicações financeiras' },
  { href: '/estoque', label: 'Estoque e CMV' },
] as const;

export function ControlsTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Bens e contratos" className="inline-flex p-0.5 rounded-xl bg-black/5 dark:bg-white/6">
      {TABS.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={`${segmentClass(active)} ${active ? 'bg-white dark:bg-stone-700 shadow-[0_1px_3px_rgba(0,0,0,0.08)]' : ''}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
