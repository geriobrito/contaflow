'use client';

import React, { useMemo } from 'react';
import { AlertCircle, Check, ChevronRight, CircleDashed, Lock, LockOpen, RotateCw } from 'lucide-react';
import type { ClientCompany } from '@/types/firestore';
import type { PortfolioEntry } from '@/hooks/painel/usePortfolio';
import { shortMonth, sortPortfolio, type PortfolioRow, type TaskSeverity } from '@/lib/portfolio';
import { SURFACE } from '@/components/ui/primitives';
import { Skeleton } from '@/components/ui/Skeleton';

const CHIP: Record<TaskSeverity, string> = {
  high: 'bg-rose-50 text-rose-700 border-rose-200/70 hover:bg-rose-100 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900/50 dark:hover:bg-rose-950/50',
  medium: 'bg-amber-50 text-amber-800 border-amber-200/70 hover:bg-amber-100 dark:bg-amber-950/25 dark:text-amber-300 dark:border-amber-900/50 dark:hover:bg-amber-950/45',
  low: 'bg-black/[0.03] text-stone-600 border-black/[0.06] hover:bg-black/[0.06] dark:bg-white/[0.05] dark:text-stone-300 dark:border-white/[0.08] dark:hover:bg-white/[0.08]',
};

function FocusPill({ row }: { row: PortfolioRow }) {
  const month = shortMonth(row.focusMonth);
  const [Icon, text, tone] =
    row.focus === 'closed'
      ? [Lock, `${month} fechado`, 'text-emerald-700 dark:text-emerald-400']
      : row.focus === 'open'
        ? [LockOpen, `${month} aberto`, 'text-amber-700 dark:text-amber-400']
        : [CircleDashed, `sem extrato de ${month}`, 'text-stone-500'];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium whitespace-nowrap ${tone}`}>
      <Icon className="w-3.5 h-3.5" strokeWidth={2} />
      {text}
    </span>
  );
}

interface PortfolioViewProps {
  clients: readonly ClientCompany[];
  entries: Record<string, PortfolioEntry>;
  currentClientId: string | null;
  /** Abre o painel detalhado da empresa. */
  onOpenClient: (client: ClientCompany) => void;
  /** Seleciona a empresa e vai para a tela que resolve a tarefa. */
  onTask: (client: ClientCompany, href: string) => void;
  onRefresh: () => void;
}

/** Carteira: o que falta fazer em cada empresa, mais trabalho primeiro. */
export function PortfolioView({ clients, entries, currentClientId, onOpenClient, onTask, onRefresh }: PortfolioViewProps) {
  const usable = useMemo(() => clients.filter((c) => !c.deletingAt), [clients]);
  const byId = useMemo(() => new Map(usable.map((c) => [c.id, c] as const)), [usable]);
  const ready = useMemo(
    () => sortPortfolio(usable.flatMap((c) => (entries[c.id]?.status === 'ready' ? [(entries[c.id] as { row: PortfolioRow }).row] : []))),
    [usable, entries]
  );
  const waiting = usable.filter((c) => entries[c.id]?.status !== 'ready');
  const upToDate = ready.filter((r) => r.upToDate).length;
  const focus = ready[0]?.focusMonth;

  return (
    <section className={`${SURFACE} rounded-[22px] overflow-hidden`} aria-label="Carteira">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3.5 border-b border-black/[0.04] dark:border-white/[0.06]">
        <h2 className="text-[15px] font-semibold tracking-tight">O que falta fazer</h2>
        <p className="text-[12px] text-stone-500">
          {waiting.length > 0 && ready.length === 0
            ? `Carregando ${usable.length} empresa(s)…`
            : `${upToDate} de ${usable.length} em dia${focus ? ` · competência de ${shortMonth(focus)}` : ''}`}
        </p>
        <button
          type="button"
          onClick={onRefresh}
          className="ml-auto inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
        >
          <RotateCw className="w-3.5 h-3.5" />
          Atualizar
        </button>
      </div>

      <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
        {ready.map((row) => {
          const client = byId.get(row.clientId);
          if (!client) return null;
          const current = row.clientId === currentClientId;
          return (
            <li key={row.clientId} className="group flex items-center gap-x-4 gap-y-2 px-5 py-3.5">
              <div className="min-w-0 w-[28%] flex items-center gap-2.5">
                <span
                  aria-hidden
                  className={`w-2 h-2 rounded-full shrink-0 ${row.upToDate ? 'bg-emerald-500' : row.tasks.some((t) => t.severity === 'high') ? 'bg-rose-500' : 'bg-amber-500'}`}
                />
                <button type="button" onClick={() => onOpenClient(client)} className="min-w-0 text-left">
                  <span className="block truncate text-[14px] font-medium tracking-tight text-stone-900 dark:text-stone-100 hover:underline underline-offset-2">
                    {row.name}
                  </span>
                </button>
                {current && <span className="shrink-0 text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">Atual</span>}
              </div>
              <div className="w-[150px] shrink-0">
                <FocusPill row={row} />
              </div>
              <div className="flex-1 min-w-0 flex flex-wrap gap-1.5">
                {row.tasks.length === 0 ? (
                  <span className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[12px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                    <Check className="w-3.5 h-3.5" /> Em dia
                  </span>
                ) : (
                  row.tasks.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onTask(client, t.href)}
                      className={`inline-flex items-center h-6 px-2.5 rounded-full border text-[12px] font-medium transition-colors active:scale-[0.97] ${CHIP[t.severity]}`}
                    >
                      {t.label}
                    </button>
                  ))
                )}
              </div>
              <button
                type="button"
                onClick={() => onOpenClient(client)}
                aria-label={`Abrir o painel de ${row.name}`}
                className="flex w-8 h-8 shrink-0 items-center justify-center rounded-full text-stone-300 group-hover:text-stone-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </li>
          );
        })}

        {waiting.map((c) => {
          const entry = entries[c.id];
          return entry?.status === 'error' ? (
            <li key={c.id} className="flex items-center gap-3 px-5 py-3.5 text-[13px]">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
              <span className="font-medium truncate">{c.tradeName || c.name}</span>
              <span className="text-rose-600 truncate">Não foi possível carregar ({entry.message}).</span>
            </li>
          ) : (
            <li key={c.id} role="status" aria-busy="true" className="flex items-center gap-4 px-5 py-3.5">
              <span className="sr-only">Carregando {c.tradeName || c.name}…</span>
              <span className="w-[28%] text-[14px] font-medium tracking-tight text-stone-400 truncate">{c.tradeName || c.name}</span>
              <Skeleton className="h-3 w-24 shrink-0" />
              <Skeleton className="h-5 w-40 rounded-full" />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
