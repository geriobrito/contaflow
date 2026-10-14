'use client';

import React, { useMemo, useState } from 'react';
import type { ChartAccount } from '@/types/firestore';
import { withMissingParents } from '@/lib/chart/itg1000';
import { BUTTON, Sheet } from '@/components/ui/primitives';

interface TemplateCompletionSheetProps {
  /** Contas do modelo que faltam no plano (sem as ignoradas). */
  missing: readonly ChartAccount[];
  /** Quantas contas do modelo estão ignoradas para este cliente. */
  ignoredCount: number;
  busy: boolean;
  onAdd: (codes: string[]) => Promise<void>;
  /** Deixa de oferecer estas contas (excluídas de propósito). */
  onIgnore: (codes: string[]) => Promise<void>;
  onRestoreIgnored: () => Promise<void>;
  onClose: () => void;
}

/** Escolha das contas do modelo a incluir no plano em uso, e das que não devem mais ser oferecidas. */
export function TemplateCompletionSheet({ missing, ignoredCount, busy, onAdd, onIgnore, onRestoreIgnored, onClose }: TemplateCompletionSheetProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(missing.map((a) => a.code)));
  // Grupo desmarcado com filha marcada entra mesmo assim: conta não fica sem o pai.
  const effective = useMemo(() => withMissingParents(selected, missing), [selected, missing]);
  const unchecked = missing.filter((a) => !selected.has(a.code)).map((a) => a.code);
  const toggle = (code: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  return (
    <Sheet
      title="Completar com o modelo"
      subtitle="Contas do modelo de plano de contas (CFC) que não estão no plano deste cliente."
      onClose={onClose}
      footer={
        <div className="space-y-2">
          <button type="button" disabled={busy || effective.size === 0} onClick={() => void onAdd([...effective])} className={`${BUTTON.accent} w-full h-11 rounded-2xl`}>
            {busy ? 'Gravando…' : `Adicionar ${effective.size} conta(s)`}
          </button>
          <button
            type="button"
            disabled={busy || unchecked.length === 0}
            onClick={() => void onIgnore(unchecked)}
            className={`${BUTTON.secondary} w-full h-10`}
            title="Para contas excluídas de propósito: o aviso não volta a oferecê-las"
          >
            Não oferecer mais as {unchecked.length} desmarcada(s)
          </button>
          {ignoredCount > 0 && (
            <button type="button" disabled={busy} onClick={() => void onRestoreIgnored()} className="w-full text-[12px] text-[#0071E3] hover:underline">
              Voltar a oferecer {ignoredCount} conta(s) ignorada(s)
            </button>
          )}
        </div>
      }
    >
      <div className="flex items-center justify-between pb-2 text-[12px] text-stone-500">
        <span>{selected.size} de {missing.length} marcada(s)</span>
        <button type="button" onClick={() => setSelected(selected.size === missing.length ? new Set() : new Set(missing.map((a) => a.code)))} className="text-[#0071E3] hover:underline">
          {selected.size === missing.length ? 'Desmarcar todas' : 'Marcar todas'}
        </button>
      </div>
      <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
        {missing.map((a) => {
          const forced = !selected.has(a.code) && effective.has(a.code);
          return (
            <li key={a.code}>
              <label className="flex items-center gap-3 py-2 text-[13px]">
                <input type="checkbox" checked={selected.has(a.code)} onChange={() => toggle(a.code)} />
                <span className="w-24 shrink-0 font-mono tabular-nums text-[12px] text-stone-400">{a.code}</span>
                <span className={`flex-1 min-w-0 truncate ${a.nature === 'SYNTHETIC' ? 'font-medium' : ''}`}>{a.name}</span>
                {forced && <span className="text-[11px] text-amber-700">entra como grupo</span>}
              </label>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
