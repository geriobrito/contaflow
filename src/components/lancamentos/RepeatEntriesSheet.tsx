'use client';

import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { JournalEntry } from '@/types/firestore';
import type { RepeatCandidate } from '@/lib/journal';
import { formatMonth } from '@/lib/periods';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, Sheet } from '@/components/ui/primitives';

interface RepeatEntriesSheetProps {
  /** Competência (YYYY-MM) que recebe as cópias. */
  targetMonth: string;
  candidates: readonly RepeatCandidate[];
  /** Grava as cópias; se falhar, o erro aparece aqui e a lista é mantida. */
  onConfirm: (entries: JournalEntry[]) => Promise<void>;
  onClose: () => void;
}

/**
 * "Repetir do mês anterior": escolhe quais lançamentos manuais da competência anterior
 * copiar para a atual. Os de categoria recorrente (folha, depreciação, tributos, provisões)
 * e os que já vieram de uma repetição chegam marcados.
 */
export function RepeatEntriesSheet({ targetMonth, candidates, onConfirm, onClose }: RepeatEntriesSheetProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(candidates.filter((c) => c.suggested).map((c) => c.entry.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const confirm = async () => {
    const chosen = candidates.filter((c) => !c.problem && selected.has(c.entry.id)).map((c) => c.entry);
    if (!chosen.length) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(chosen);
      onClose();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Não foi possível repetir os lançamentos.');
    } finally {
      setBusy(false);
    }
  };

  const count = candidates.filter((c) => !c.problem && selected.has(c.entry.id)).length;

  return (
    <Sheet
      title="Repetir do mês anterior"
      subtitle={`Copia os lançamentos escolhidos para ${formatMonth(targetMonth)}, com as mesmas contas e valores.`}
      onClose={onClose}
      footer={
        <>
          {error && <p role="alert" className="mb-2 text-center text-[12px] text-rose-600">{error}</p>}
          <button type="button" disabled={busy || count === 0} onClick={() => void confirm()} className={`${BUTTON.accent} w-full h-12 rounded-2xl text-[15px]`}>
            {busy ? 'Gravando…' : `Repetir ${count} lançamento(s)`}
          </button>
        </>
      }
    >
      <div className="space-y-3 pb-2">
        <p className="text-[12px] text-stone-500">
          A data cai no mesmo dia do mês e a competência citada no histórico é atualizada. Depois de gravados, ajuste os valores que mudaram
          editando cada lançamento. O link do comprovante não é copiado.
        </p>
        <ul className="space-y-2">
          {candidates.map(({ entry, problem }) => (
            <li key={entry.id}>
              <label
                className={`flex items-start gap-3 rounded-2xl border px-3.5 py-3 ${
                  problem ? 'border-amber-200/70 bg-amber-50/60 dark:bg-amber-950/20' : 'border-black/[0.06] dark:border-white/[0.08] bg-white/70 dark:bg-stone-800/50 cursor-pointer'
                }`}
              >
                <input type="checkbox" className="mt-1 w-4 h-4 accent-accent" disabled={Boolean(problem) || busy} checked={!problem && selected.has(entry.id)} onChange={() => toggle(entry.id)} />
                <span className="flex-1 min-w-0">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] font-medium text-stone-900 dark:text-stone-100 truncate">{entry.memo}</span>
                    <span className="font-mono tabular-nums text-[13px] font-semibold whitespace-nowrap">{formatCurrency(entry.totalAmount)}</span>
                  </span>
                  <span className="block text-[11px] text-stone-500">
                    #{entry.entryNumber} · {formatDateBR(entry.date)} · {entry.lines.length} partidas
                    {entry.documentRef && <span className="font-mono"> · {entry.documentRef}</span>}
                  </span>
                  {problem && (
                    <span className="mt-1 flex items-start gap-1 text-[11px] text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="w-3 h-3 mt-px shrink-0" />
                      {problem}
                    </span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
