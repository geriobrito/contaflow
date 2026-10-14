'use client';

import React from 'react';
import { Type } from 'lucide-react';
import type { TextRepairPlan } from '@/lib/text-repair';
import { BUTTON, SURFACE } from '@/components/ui/primitives';

/** Aviso de históricos e regras com acentuação quebrada (importações antigas) e o botão que os corrige. */
export function TextRepairCard({ plan, busy, onRepair }: { plan: TextRepairPlan; busy: boolean; onRepair: () => void }) {
  return (
    <section className={`${SURFACE} rounded-[22px] p-5 space-y-3 border-amber-200/70`} aria-label="Correção de acentuação">
      <div className="flex flex-wrap items-start gap-3">
        <span className="w-9 h-9 shrink-0 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 flex items-center justify-center">
          <Type className="w-4 h-4" />
        </span>
        <div className="flex-1 min-w-[260px] space-y-1">
          <h2 className="text-[15px] font-semibold tracking-tight">Acentuação quebrada em importações antigas</h2>
          <p className="text-[13px] text-stone-600 dark:text-stone-300">
            {plan.memos.length + plan.lockedMemos.length} histórico(s) e {plan.rules.length + plan.duplicateRuleIds.length} regra(s) vieram de arquivos
            UTF-8 lidos como Latin-1 (ex.: “transferÃªncia”, “â€¢â€¢â€¢”). Novas importações já saem corretas; esta correção ajusta o que já está salvo,
            mantém as classificações e atualiza o termo das regras para continuarem casando.
          </p>
          {(plan.memos[0] || plan.rules[0]) && (
            <p className="font-mono text-[11px] text-stone-500 break-words">
              {(plan.memos[0] ?? plan.rules[0]!).before.slice(0, 70)} → {(plan.memos[0]?.after ?? plan.rules[0]!.after).slice(0, 70)}
            </p>
          )}
          {plan.lockedMemos.length > 0 && (
            <p className="text-[12px] text-amber-700">
              {plan.lockedMemos.length} histórico(s) estão em competência fechada e só serão corrigidos depois de reabri-la.
            </p>
          )}
          {plan.duplicateRuleIds.length > 0 && (
            <p className="text-[12px] text-stone-500">
              {plan.duplicateRuleIds.length} regra(s) ficarão idênticas a outra (mesmo termo, tipo e conta) e serão removidas, mantendo a mais recente.
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={busy || (!plan.memos.length && !plan.rules.length && !plan.duplicateRuleIds.length)}
          onClick={() => onRepair()}
          className={BUTTON.accent}
        >
          {busy ? 'Corrigindo…' : 'Corrigir acentuação'}
        </button>
      </div>
    </section>
  );
}
