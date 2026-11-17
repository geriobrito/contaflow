'use client';

import type { BankAccount } from '@/types/firestore';
import type { RuleConditions } from '@/lib/reconciliation';
import { INPUT_COMPACT } from '@/components/ui/primitives';
import { MoneyInput } from '@/components/ui/MoneyInput';

interface RuleConditionFieldsProps {
  value: RuleConditions;
  onChange: (next: RuleConditions) => void;
  /** Contas bancárias da empresa, para a condição "só desta conta". */
  bankAccounts: readonly BankAccount[];
  /** Mostra também conta bancária e faixa de valor (o sentido aparece sempre). */
  expanded: boolean;
  className?: string;
}

/** Faixa informada ao contrário (mínimo maior que o máximo): nenhuma regra casaria. */
export const rangeProblem = (c: RuleConditions): string | null =>
  c.minCents !== undefined && c.maxCents !== undefined && c.minCents > c.maxCents ? 'O valor mínimo é maior que o máximo.' : null;

/**
 * Condições da regra além do termo: sentido do lançamento e, em "mais condições", a conta
 * bancária e a faixa do valor. Campo vazio não é condição.
 */
export function RuleConditionFields({ value, onChange, bankAccounts, expanded, className = '' }: RuleConditionFieldsProps) {
  const set = (patch: Partial<RuleConditions>) => {
    const next = { ...value, ...patch };
    for (const k of Object.keys(next) as (keyof RuleConditions)[]) if (next[k] === undefined) delete next[k];
    onChange(next);
  };
  // Conta da condição que saiu do cadastro continua aparecendo, para não sumir da regra em silêncio.
  const unknownBank = value.bankAccountKey && !bankAccounts.some((b) => b.accountKey === value.bankAccountKey) ? value.bankAccountKey : null;
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <select
        aria-label="Sentido do lançamento"
        value={value.direction ?? ''}
        onChange={(e) => set({ direction: (e.target.value || undefined) as RuleConditions['direction'] })}
        className={INPUT_COMPACT}
      >
        <option value="">Entradas e saídas</option>
        <option value="IN">Só entradas</option>
        <option value="OUT">Só saídas</option>
      </select>
      {expanded && (
        <>
          <select
            aria-label="Conta bancária"
            value={value.bankAccountKey ?? ''}
            onChange={(e) => set({ bankAccountKey: e.target.value || undefined })}
            className={`${INPUT_COMPACT} max-w-[220px]`}
          >
            <option value="">Qualquer conta bancária</option>
            {bankAccounts.map((b) => (
              <option key={b.accountKey} value={b.accountKey}>
                Só {b.nickname || b.bankName || b.accountKey}
              </option>
            ))}
            {unknownBank && <option value={unknownBank}>Só {unknownBank} (fora do cadastro)</option>}
          </select>
          <span className="inline-flex items-center gap-1.5 text-[12px] text-stone-500 dark:text-stone-400">
            Valor de
            <span className="w-28">
              <MoneyInput
                label="Valor mínimo"
                cents={value.minCents ?? 0}
                onChange={(cents) => set({ minCents: cents || undefined })}
                placeholder="sem mínimo"
                className={INPUT_COMPACT}
              />
            </span>
            a
            <span className="w-28">
              <MoneyInput
                label="Valor máximo"
                cents={value.maxCents ?? 0}
                onChange={(cents) => set({ maxCents: cents || undefined })}
                placeholder="sem máximo"
                className={INPUT_COMPACT}
              />
            </span>
          </span>
        </>
      )}
    </div>
  );
}
