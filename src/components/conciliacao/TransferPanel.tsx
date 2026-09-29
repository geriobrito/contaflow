'use client';

import React, { useState } from 'react';
import { ArrowLeftRight, ArrowRight, ChevronDown } from 'lucide-react';
import type { BankAccount } from '@/types/firestore';
import type { TransferPair } from '@/lib/transfers';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { SURFACE } from '@/components/ui/primitives';

interface TransferPanelProps {
  pairs: readonly TransferPair[];
  banks: readonly BankAccount[];
  busy: boolean;
  onReconcile: (pairs: readonly TransferPair[]) => Promise<void>;
}

/**
 * Transferências entre contas próprias detectadas no período: saída numa conta e
 * entrada de mesmo valor em outra. Conciliar leva as duas pernas à conta transitória,
 * fora da DRE.
 */
export function TransferPanel({ pairs, banks, busy, onReconcile }: TransferPanelProps) {
  const [open, setOpen] = useState(true);
  if (!pairs.length) return null;
  const name = (key?: string) => banks.find((b) => b.accountKey === key)?.nickname ?? key ?? '—';

  return (
    <section className={`${SURFACE} rounded-[22px] overflow-hidden border-sky-200/60`} aria-label="Transferências entre contas próprias">
      <div className="flex flex-wrap items-center gap-3 px-5 py-3.5">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex flex-1 min-w-0 items-center gap-3 text-left">
          <span className="w-8 h-8 shrink-0 rounded-full bg-sky-100 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 flex items-center justify-center">
            <ArrowLeftRight className="w-4 h-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-medium tracking-tight text-stone-900 dark:text-stone-100">
              {pairs.length} transferência(s) entre contas próprias
            </span>
            <span className="block text-[12px] text-stone-500">
              Saída e entrada de mesmo valor em contas diferentes do cliente. Conciliadas juntas, não passam pela DRE.
            </span>
          </span>
          <ChevronDown className={`w-4 h-4 shrink-0 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onReconcile(pairs)}
          className="h-9 px-4 rounded-full bg-sky-600 hover:bg-sky-700 text-white text-[13px] font-medium disabled:opacity-40 active:scale-[0.98] transition-all"
        >
          Conciliar todas
        </button>
      </div>
      {open && (
        <ul className="border-t border-black/[0.04] dark:border-white/[0.06] divide-y divide-black/[0.04] dark:divide-white/[0.05] animate-fade-in">
          {pairs.map((p) => (
            <li key={`${p.out.id}-${p.in.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-[13px]">
              <span className="font-mono tabular-nums text-[12px] text-stone-400 w-40 shrink-0">
                {formatDateBR(p.out.date)}
                {p.days > 0 && ` → ${formatDateBR(p.in.date)}`}
              </span>
              <span className="flex-1 min-w-0 flex items-center gap-2">
                <span className="truncate" title={p.out.memo}>
                  <b className="font-medium">{name(p.out.accountKey)}</b> <span className="text-stone-400">{p.out.memo}</span>
                </span>
                <ArrowRight className="w-3.5 h-3.5 shrink-0 text-stone-400" />
                <span className="truncate" title={p.in.memo}>
                  <b className="font-medium">{name(p.in.accountKey)}</b> <span className="text-stone-400">{p.in.memo}</span>
                </span>
              </span>
              <span className="font-mono tabular-nums">{formatCurrency(p.in.amount)}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onReconcile([p])}
                className="h-8 px-3 rounded-full text-[12px] font-medium text-sky-700 hover:bg-sky-50 dark:hover:bg-sky-950/40 disabled:opacity-40"
              >
                Conciliar
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
