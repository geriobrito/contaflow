'use client';

import React, { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { ChartAccount, ClassificationRule, RuleMatchType } from '@/types/firestore';
import { normalizePattern, ruleKey } from '@/lib/reconciliation';
import { assessRuleTerm } from '@/lib/payee';
import { describeError } from '@/lib/utils/errors';
import { newRuleId } from '@/lib/utils/id';
import { BUTTON, INPUT, SURFACE } from '@/components/ui/primitives';
import { TermWarning } from '@/components/conciliacao/RuleLearnPanel';
import { MatchTypeSelect } from '@/components/regras/RuleRow';

interface NewRuleFormProps {
  clientId: string | undefined;
  /** Contas analíticas, que podem receber lançamentos. */
  analytic: readonly ChartAccount[];
  /** Descrições dos lançamentos do cliente, para avaliar o termo. */
  memos: readonly string[];
  isDuplicate: (key: string, exceptId: string) => boolean;
  /** Grava a regra e a aplica aos pendentes. Se falhar, o erro aparece aqui. */
  onCreate: (rule: ClassificationRule) => Promise<void>;
  /** Resultado da última criação ou aplicação de regra. */
  notice: string | null;
}

/** Adição rápida de regra: tipo de comparação, termo e conta de destino. */
export function NewRuleForm({ clientId, analytic, memos, isDuplicate, onCreate, notice }: NewRuleFormProps) {
  const [newPattern, setNewPattern] = useState('');
  const [newAccountId, setNewAccountId] = useState('');
  const [newType, setNewType] = useState<RuleMatchType>('CONTAINS');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Termo da nova regra: avisa se é genérico ("enviado") ou casa com muitos favorecidos.
  const newTerm = newType === 'REGEX' ? newPattern.trim() : normalizePattern(newPattern);
  const newAssessment = useMemo(
    () => (newTerm ? assessRuleTerm({ pattern: newTerm, matchType: newType }, memos) : null),
    [newTerm, newType, memos]
  );
  const [newAckKey, setNewAckKey] = useState('');
  const newKey = `${newType}|${newTerm}`;
  const newBlocked = newAssessment?.level === 'generic' && newAckKey !== newKey;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId) return;
    const pattern = normalizePattern(newPattern);
    const account = analytic.find((a) => a.id === newAccountId);
    if (!pattern || !account) {
      setAddError('Informe o termo e a conta de destino.');
      return;
    }
    if (newBlocked) {
      setAddError('Termo genérico: marque “Criar mesmo assim” para salvar.');
      return;
    }
    if (isDuplicate(ruleKey(pattern, newType), '')) {
      setAddError('Já existe uma regra com esse termo e tipo.');
      return;
    }
    setAdding(true);
    setAddError(null);
    const now = new Date().toISOString();
    try {
      await onCreate({
        id: newRuleId(),
        clientId,
        pattern,
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        matchType: newType,
        createdAt: now,
        updatedAt: now,
      });
      setNewPattern('');
    } catch (err: unknown) {
      setAddError(`Não foi possível salvar a regra (${describeError(err)}).`);
    } finally {
      setAdding(false);
    }
  };

  return (
    <form onSubmit={handleAdd} className={`${SURFACE} rounded-[22px] p-5 space-y-3`}>
      <p className="text-[13px] font-medium text-stone-700 dark:text-stone-300">Nova regra</p>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,3fr)_auto] gap-2.5">
        <MatchTypeSelect value={newType} onChange={setNewType} />
        <input
          value={newPattern}
          onChange={(e) => setNewPattern(e.target.value)}
          placeholder="Termo, ex.: uber"
          aria-label="Termo"
          className={`${INPUT} font-mono text-[13px]`}
        />
        <select
          value={newAccountId}
          onChange={(e) => setNewAccountId(e.target.value)}
          aria-label="Conta de destino"
          className={`${INPUT} min-w-0 ${newAccountId ? '' : 'text-stone-400'}`}
        >
          <option value="">Conta de destino…</option>
          {analytic.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} · {a.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={adding || !clientId} className={`${BUTTON.primary} h-11 px-5`}>
          <Plus className="w-4 h-4" strokeWidth={2} />
          {adding ? 'Adicionando…' : 'Adicionar'}
        </button>
      </div>
      {newAssessment && (
        <TermWarning
          assessment={newAssessment}
          acknowledged={newAckKey === newKey}
          onAcknowledged={(v) => setNewAckKey(v ? newKey : '')}
          className="mt-0"
        />
      )}
      {addError && <p className="text-[12px] text-rose-600 animate-fade-in">{addError}</p>}
      {notice && (
        <p role="status" className="text-[12px] text-emerald-700 animate-fade-in">
          {notice}
        </p>
      )}
    </form>
  );
}
