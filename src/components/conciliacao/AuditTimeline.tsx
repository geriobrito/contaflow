'use client';

import React from 'react';
import { ArrowRight, Lock, LockOpen } from 'lucide-react';
import type { AuditEntry } from '@/types/firestore';
import { AUDIT_LABEL, describeSnapshot } from '@/lib/audit';
import { formatMonth } from '@/lib/periods';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

/** Data e hora locais: "27/09/2026 14:05". */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface AuditTimelineProps {
  entries: readonly AuditEntry[];
  /** Mostra histórico, data e valor do lançamento em cada item (visão geral do cliente). */
  showTransaction?: boolean;
  emptyText?: string;
}

/** Linha do tempo da trilha de auditoria: quem fez o quê, quando, e de → para. */
export function AuditTimeline({ entries, showTransaction = false, emptyText = 'Nenhuma alteração registrada.' }: AuditTimelineProps) {
  if (entries.length === 0) return <p className="px-1 py-6 text-center text-[13px] text-stone-400">{emptyText}</p>;
  return (
    <ol className="relative space-y-3 before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-px before:bg-black/[0.08] dark:before:bg-white/[0.10]">
      {entries.map((e) => {
        const period = e.action === 'PERIOD_CLOSE' || e.action === 'PERIOD_REOPEN';
        return (
          <li key={e.id} className="relative pl-6">
            <span
              className={`absolute left-0 top-1.5 w-[15px] h-[15px] rounded-full border-2 border-[#F9F9F8] dark:border-stone-900 ${
                e.action === 'UNRECONCILE' || e.action === 'PERIOD_REOPEN'
                  ? 'bg-rose-400'
                  : e.action === 'AUTO_CLASSIFY'
                    ? 'bg-blue-400'
                    : period
                      ? 'bg-stone-700 dark:bg-stone-300'
                      : 'bg-emerald-500'
              }`}
            />
            <p className="text-[13px] text-stone-900 dark:text-stone-100">
              <span className="font-medium">{AUDIT_LABEL[e.action]}</span>
              {period && e.month && <span className="text-stone-500"> · {formatMonth(e.month)}</span>}
              {e.action === 'PERIOD_CLOSE' && <Lock className="inline w-3 h-3 ml-1 -mt-0.5 text-stone-400" />}
              {e.action === 'PERIOD_REOPEN' && <LockOpen className="inline w-3 h-3 ml-1 -mt-0.5 text-stone-400" />}
            </p>
            <p className="text-[11px] text-stone-500">
              {e.actorEmail ?? e.actorUid} · <span className="font-mono tabular-nums">{formatDateTime(e.at)}</span>
            </p>
            {showTransaction && e.transactionId && (
              <p className="mt-0.5 text-[12px] text-stone-600 dark:text-stone-400 truncate">
                <span className="font-mono tabular-nums text-stone-400">{e.transactionDate ? formatDateBR(e.transactionDate) : ''}</span>{' '}
                {e.transactionMemo}
                {e.transactionAmount !== undefined && (
                  <span className="font-mono tabular-nums"> · {formatCurrency(e.transactionAmount)}</span>
                )}
              </p>
            )}
            {(e.before || e.after) && (
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px]">
                <span className="px-2 py-0.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] text-stone-600 dark:text-stone-300">
                  {describeSnapshot(e.before)}
                </span>
                <ArrowRight className="w-3 h-3 text-stone-400 shrink-0" />
                <span className="px-2 py-0.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] text-stone-800 dark:text-stone-100">
                  {describeSnapshot(e.after)}
                </span>
              </p>
            )}
            {e.note && <p className="mt-1 text-[12px] italic text-stone-500">“{e.note}”</p>}
          </li>
        );
      })}
    </ol>
  );
}
