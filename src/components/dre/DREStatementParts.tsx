'use client';

import React, { createContext, useContext } from 'react';
import { ChevronDown } from 'lucide-react';
import type { DREAccountLine } from '@/lib/dre/build';
import { AccountingAmount } from '@/components/ui/Amount';

/* Linhas do demonstrativo da DRE: grupos recolhíveis, subtotais, valores e análise vertical. */

/** Receita bruta do período, base da análise vertical (% s/ receita bruta). */
export const GrossRevenueContext = createContext(0);

export function Pct({ value, strong = false }: { value: number; strong?: boolean }) {
  const base = useContext(GrossRevenueContext);
  const text =
    base > 0 ? `${((value / base) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : '—';
  return (
    <span
      className={`inline w-20 shrink-0 text-right font-mono tabular-nums text-[12px] ${
        strong ? 'text-stone-600 dark:text-stone-300' : 'text-stone-400'
      }`}
    >
      {text}
    </span>
  );
}

/** Valor contábil: negativos entre parênteses, como em demonstrativos impressos. */
export function Amount({ value, strong = false }: { value: number; strong?: boolean }) {
  // Um só tamanho na coluna de valores (a hierarquia fica no peso): as vírgulas alinham entre linhas.
  return <AccountingAmount value={value} className={`text-[13px] ${strong ? 'font-semibold' : ''}`} />;
}

function AccountRows({ lines, sign }: { lines: DREAccountLine[]; sign: 1 | -1 }) {
  return (
    <>
      {lines.map((l) => (
        <div key={l.accountId} className="flex items-baseline gap-3 py-2 pl-8 pr-5 text-[13px] text-stone-600 dark:text-stone-400">
          <span className="w-20 shrink-0 font-mono tabular-nums text-[12px] text-stone-400">{l.code}</span>
          <span className="flex-1 min-w-0 truncate">{l.name}</span>
          <span className="inline font-mono tabular-nums text-[11px] text-stone-400 w-10 text-right">{l.count}×</span>
          <Pct value={sign * l.value} />
          <span className="w-36 xl:w-44 text-right">
            <Amount value={sign * l.value} />
          </span>
        </div>
      ))}
    </>
  );
}

export function Row({ label, value, variant = 'line' }: { label: string; value: number; variant?: 'line' | 'subtotal' }) {
  const subtotal = variant === 'subtotal';
  return (
    <div
      className={`flex items-baseline gap-3 px-5 ${
        subtotal ? 'py-3.5 bg-stone-900/[0.03] dark:bg-white/[0.04]' : 'py-3'
      }`}
    >
      <span
        className={`flex-1 min-w-0 text-[14px] tracking-tight ${
          subtotal ? 'font-semibold text-stone-900 dark:text-stone-50' : 'font-medium text-stone-800 dark:text-stone-200'
        }`}
      >
        {label}
      </span>
      <Pct value={value} strong />
      <span className="w-36 xl:w-44 text-right text-[14px] text-stone-900 dark:text-stone-100">
        <Amount value={value} strong={subtotal} />
      </span>
    </div>
  );
}

interface SectionProps {
  id: string;
  label: string;
  value: number;
  parts: { lines: DREAccountLine[]; sign: 1 | -1 }[];
  open: boolean;
  onToggle: (id: string) => void;
}

/** Linha de grupo da DRE, recolhível, com o detalhamento por conta analítica. */
export function Section({ id, label, value, parts, open, onToggle }: SectionProps) {
  const hasLines = parts.some((p) => p.lines.length > 0);
  return (
    <div className="print-avoid-break">
      <button
        type="button"
        onClick={() => hasLines && onToggle(id)}
        aria-expanded={hasLines ? open : undefined}
        disabled={!hasLines}
        className="w-full flex items-baseline gap-3 pl-3 pr-5 py-3 text-left enabled:hover:bg-black/[0.02] dark:enabled:hover:bg-white/[0.03] transition-colors"
      >
        <ChevronDown
          className={`w-3.5 h-3.5 self-center shrink-0 text-stone-400 transition-transform duration-200 print:invisible ${
            hasLines ? '' : 'invisible'
          } ${open ? '' : '-rotate-90'}`}
        />
        <span className="flex-1 min-w-0 text-[14px] font-medium tracking-tight text-stone-800 dark:text-stone-200">{label}</span>
        <Pct value={value} strong />
        <span className="w-36 xl:w-44 text-right text-[14px] text-stone-900 dark:text-stone-100">
          <Amount value={value} />
        </span>
      </button>
      {hasLines && (
        <div className={open ? '' : 'hidden print:block'}>
          {parts.map((p, i) => (
            <AccountRows key={i} lines={p.lines} sign={p.sign} />
          ))}
        </div>
      )}
    </div>
  );
}
