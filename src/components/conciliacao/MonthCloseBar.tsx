'use client';

import React, { useEffect, useState } from 'react';
import { Lock, LockOpen } from 'lucide-react';
import type { PeriodLock } from '@/types/firestore';
import { formatMonth, monthsBetween } from '@/lib/periods';
import { formatDateTime } from '@/components/conciliacao/AuditTimeline';
import { INPUT } from '@/components/ui/primitives';

interface MonthCloseBarProps {
  /** Competência selecionada (modo Mês) ou null em trimestre/ano. */
  month: string | null;
  range: { start: string; end: string };
  locks: readonly PeriodLock[];
  /** Lançamentos ainda não conciliados na competência (aviso antes de fechar). */
  openItems: number;
  busy: boolean;
  onClose: (month: string) => Promise<void>;
  onReopen: (month: string, reason: string) => Promise<void>;
}

/**
 * Fechamento de competência: trava o mês entregue ao cliente. Fechar exige dois toques
 * (com aviso de pendências); reabrir exige motivo — ambos vão para a trilha de auditoria.
 */
export function MonthCloseBar({ month, range, locks, openItems, busy, onClose, onReopen }: MonthCloseBarProps) {
  const [armed, setArmed] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  // Reseta a interação ao trocar de competência.
  const [lastMonth, setLastMonth] = useState(month);
  if (lastMonth !== month) {
    setLastMonth(month);
    setArmed(false);
    setReopening(false);
    setReason('');
  }

  if (!month) {
    const months = monthsBetween(range.start, range.end);
    const closed = months.filter((m) => locks.some((l) => l.month === m));
    return (
      <p className="text-[12px] text-stone-500 print:hidden">
        <Lock className="inline w-3 h-3 -mt-0.5 mr-1" />
        {closed.length} de {months.length} competência(s) fechada(s) neste período. Selecione <b>Mês</b> para fechar ou reabrir.
      </p>
    );
  }

  const lock = locks.find((l) => l.month === month);

  if (lock) {
    return (
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 text-[12px] font-medium">
          <Lock className="w-3 h-3" /> Competência fechada
        </span>
        <span className="text-[12px] text-stone-500">
          por {lock.lockedByEmail ?? lock.lockedByUid} em <span className="font-mono tabular-nums">{formatDateTime(lock.lockedAt)}</span>
        </span>
        {!reopening ? (
          <button
            type="button"
            onClick={() => setReopening(true)}
            className="rounded-xl px-3 py-1.5 text-[12px] font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 active:scale-[0.97] transition-all duration-150"
          >
            Reabrir competência
          </button>
        ) : (
          <form
            className="flex flex-wrap items-center gap-2 animate-fade-in"
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim()) void onReopen(month, reason.trim()).then(() => setReopening(false), () => undefined);
            }}
          >
            <input
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Motivo da reabertura (fica na auditoria)"
              aria-label="Motivo da reabertura"
              className={`${INPUT} h-9 w-72 max-w-full text-[13px]`}
            />
            <button
              type="submit"
              disabled={!reason.trim() || busy}
              className="h-9 px-3 rounded-xl bg-rose-600 text-white text-[12px] font-medium disabled:opacity-40 active:scale-[0.97] transition-all duration-150"
            >
              Reabrir
            </button>
            <button type="button" onClick={() => setReopening(false)} className="h-9 px-2 text-[12px] text-stone-500">
              Cancelar
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <span className="inline-flex items-center gap-1.5 text-[12px] text-stone-500">
        <LockOpen className="w-3 h-3" /> {formatMonth(month)} aberta
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (armed) {
            setArmed(false);
            void onClose(month).catch(() => undefined);
          } else setArmed(true);
        }}
        className={`rounded-xl px-3 py-1.5 text-[12px] font-medium transition-all duration-150 active:scale-[0.97] disabled:opacity-40 ${
          armed ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 animate-pop-in' : 'text-stone-700 dark:text-stone-200 hover:bg-black/[0.05]'
        }`}
      >
        {armed
          ? openItems > 0
            ? `Fechar mesmo com ${openItems} não conciliado(s)?`
            : 'Toque para confirmar o fechamento'
          : 'Fechar competência'}
      </button>
    </div>
  );
}
