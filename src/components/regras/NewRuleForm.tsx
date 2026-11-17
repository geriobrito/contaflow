'use client';

import React, { useMemo, useState } from 'react';
import { Plus, SlidersHorizontal } from 'lucide-react';
import type { BankAccount, ChartAccount, ClassificationRule, RuleMatchType } from '@/types/firestore';
import { activeConditionFields, normalizePattern, ruleKey, type RuleConditions } from '@/lib/reconciliation';
import { assessRuleTerm } from '@/lib/payee';
import { describeError } from '@/lib/utils/errors';
import { newRuleId } from '@/lib/utils/id';
import { peekActor } from '@/lib/data/scope';
import { BUTTON, INPUT, SURFACE } from '@/components/ui/primitives';
import { AccountSelectField } from '@/components/ui/AccountCombobox';
import { TermWarning } from '@/components/conciliacao/RuleLearnPanel';
import { MatchTypeSelect } from '@/components/regras/RuleRow';
import { RuleConditionFields, rangeProblem } from '@/components/regras/RuleConditionFields';

interface NewRuleFormProps {
  clientId: string | undefined;
  /** Contas analíticas, que podem receber lançamentos. */
  analytic: readonly ChartAccount[];
  /** Contas bancárias da empresa, para a condição por conta. */
  bankAccounts: readonly BankAccount[];
  /** Descrições dos lançamentos do cliente, para avaliar o termo. */
  memos: readonly string[];
  isDuplicate: (key: string, exceptId: string) => boolean;
  /** Grava a regra e a aplica aos pendentes. Se falhar, o erro aparece aqui. */
  onCreate: (rule: ClassificationRule) => Promise<void>;
  /** Resultado da última criação ou aplicação de regra. */
  notice: string | null;
}

/** Adição rápida de regra: tipo de comparação, termo, conta de destino e condições. */
export function NewRuleForm({ clientId, analytic, bankAccounts, memos, isDuplicate, onCreate, notice }: NewRuleFormProps) {
  const [newPattern, setNewPattern] = useState('');
  const [newAccountId, setNewAccountId] = useState('');
  const [newType, setNewType] = useState<RuleMatchType>('CONTAINS');
  const [conditions, setConditions] = useState<RuleConditions>({});
  const [expanded, setExpanded] = useState(false);
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

  const handleAdd = async (e: React.SubmitEvent) => {
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
    const range = rangeProblem(conditions);
    if (range) {
      setAddError(range);
      return;
    }
    const fields = activeConditionFields(conditions);
    if (isDuplicate(ruleKey(pattern, newType, fields), '')) {
      setAddError('Já existe uma regra com esse termo, tipo e condições.');
      return;
    }
    setAdding(true);
    setAddError(null);
    const now = new Date().toISOString();
    const actorUid = peekActor()?.uid;
    try {
      await onCreate({
        id: newRuleId(),
        clientId,
        pattern,
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        matchType: newType,
        ...fields,
        ...(actorUid ? { createdByUid: actorUid } : {}),
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
        <AccountSelectField
          accounts={analytic}
          value={newAccountId}
          onChange={setNewAccountId}
          label="Conta de destino"
          placeholder="Conta de destino…"
          triggerClassName="h-11"
        />
        <button type="submit" disabled={adding || !clientId} className={`${BUTTON.primary} h-11 px-5`}>
          <Plus className="w-4 h-4" strokeWidth={2} />
          {adding ? 'Adicionando…' : 'Adicionar'}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-stone-500 dark:text-stone-400">Vale para</span>
        <RuleConditionFields value={conditions} onChange={setConditions} bankAccounts={bankAccounts} expanded={expanded} />
        {!expanded && (
          <button type="button" onClick={() => setExpanded(true)} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent-ink hover:underline">
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Mais condições (conta bancária, valor)
          </button>
        )}
      </div>
      {newAssessment && (
        <TermWarning
          assessment={newAssessment}
          acknowledged={newAckKey === newKey}
          onAcknowledged={(v) => setNewAckKey(v ? newKey : '')}
          className="mt-0"
        />
      )}
      {addError && <p className="text-[12px] text-rose-600 dark:text-rose-300 animate-fade-in">{addError}</p>}
      {notice && (
        <p role="status" className="text-[12px] text-emerald-700 dark:text-emerald-300 animate-fade-in">
          {notice}
        </p>
      )}
    </form>
  );
}
