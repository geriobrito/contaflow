'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Info } from 'lucide-react';
import { summarizeChecks, type CheckLevel, type StatementCheck } from '@/lib/statement-checks';

const ICON: Record<Exclude<CheckLevel, 'ok'>, React.ReactNode> = {
  block: <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />,
  warn: <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />,
  info: <Info className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" />,
};

function CheckItem({ check }: { check: StatementCheck }) {
  return (
    <li className="flex items-start gap-2.5 px-4 py-2.5">
      {ICON[check.level as Exclude<CheckLevel, 'ok'>]}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-stone-800 dark:text-stone-100">{check.title}</p>
        {check.items && check.items.length > 0 && (
          <ul className="mt-0.5 space-y-0.5 text-[12px] text-stone-600 dark:text-stone-400">
            {check.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </div>
      {check.href && check.linkLabel && (
        <Link href={check.href} className="shrink-0 self-center text-[12px] font-medium text-accent-ink hover:underline">
          {check.linkLabel}
        </Link>
      )}
    </li>
  );
}

/**
 * Bloco único de avisos das demonstrações: recolhido numa linha ("Pendências desta demonstração
 * (3)"), aberto sozinho quando algo impede a emissão; o que confere fica numa linha verde curta.
 */
export function StatementChecks({ checks, ariaLabel = 'Pendências desta demonstração' }: { checks: readonly (StatementCheck | null | undefined | false)[]; ariaLabel?: string }) {
  const { issues, infos, oks, pending, blocking } = summarizeChecks(checks);
  // null: segue o automático (aberto se algo impede); depois do clique, vale a escolha.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? blocking;
  const listed = [...issues, ...infos];
  if (listed.length === 0 && oks.length === 0) return null;

  const tone = blocking
    ? 'border-rose-200/70 dark:border-rose-900/40 bg-rose-50/50 dark:bg-rose-950/20'
    : pending > 0
      ? 'border-amber-200/70 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20'
      : 'border-black/6 dark:border-white/8 bg-white/60 dark:bg-stone-900/40';
  const title = pending > 0 ? `Pendências desta demonstração (${pending})` : `Observações (${infos.length})`;

  return (
    <div className="space-y-2 print:hidden">
      {listed.length > 0 && (
        <section aria-label={ariaLabel} className={`rounded-2xl border overflow-hidden ${tone}`}>
          <button
            type="button"
            onClick={() => setChosen(!open)}
            aria-expanded={open}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-black/2 dark:hover:bg-white/3 transition-colors"
          >
            {blocking ? ICON.block : pending > 0 ? ICON.warn : ICON.info}
            <span className="min-w-0 flex-1 truncate text-[13px]">
              <span className="font-medium text-stone-900 dark:text-stone-100">{title}</span>
              {!open && <span className="text-stone-500"> · {listed.map((c) => c.title).join(' · ')}</span>}
            </span>
            <span className="shrink-0 text-[12px] font-medium text-stone-500">{open ? 'Ocultar' : 'Ver'}</span>
            <ChevronDown className={`w-4 h-4 text-stone-400 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && (
            <ul className="border-t border-black/5 dark:border-white/6 divide-y divide-black/4 dark:divide-white/5 bg-white/50 dark:bg-stone-900/30 animate-fade-in">
              {listed.map((c) => (
                <CheckItem key={c.id} check={c} />
              ))}
            </ul>
          )}
        </section>
      )}
      {oks.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[12px] text-emerald-700 dark:text-emerald-400">
          {oks.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              {c.title}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
