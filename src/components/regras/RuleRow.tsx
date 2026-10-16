'use client';

import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, Pencil, Trash2, Wand2, X } from 'lucide-react';
import type { ChartAccount, ClassificationRule, RuleMatchType } from '@/types/firestore';
import { MATCH_TYPE_LABEL, normalizePattern, ruleKey, type RuleConflict } from '@/lib/reconciliation';
import { assessRuleTerm, type TermAssessment } from '@/lib/payee';
import { formatDateBR } from '@/lib/utils/formatters';
import { ConfirmButton, INPUT } from '@/components/ui/primitives';
import { TermWarning } from '@/components/conciliacao/RuleLearnPanel';

/** Tipos oferecidos na interface (REGEX existente continua funcionando e sendo exibido). */
const MATCH_OPTIONS: readonly RuleMatchType[] = ['CONTAINS', 'STARTS_WITH', 'EXACT'];

export function MatchTypeSelect({ value, onChange, className = '' }: { value: RuleMatchType; onChange: (v: RuleMatchType) => void; className?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as RuleMatchType)}
      aria-label="Tipo de comparação"
      className={`${INPUT} ${className}`}
    >
      {(MATCH_OPTIONS.includes(value) ? MATCH_OPTIONS : [...MATCH_OPTIONS, value]).map((t) => (
        <option key={t} value={t}>
          {MATCH_TYPE_LABEL[t]}
        </option>
      ))}
    </select>
  );
}

/* Linha editável da tabela de regras */

export interface RuleRowProps {
  rule: ClassificationRule;
  account: ChartAccount | undefined;
  affected: number;
  /** Pendentes que esta regra classificaria agora (casa e vence o conflito). */
  pending: number;
  conflicts: readonly RuleConflict[];
  rulesById: ReadonlyMap<string, ClassificationRule>;
  /** Avaliação do termo atual da regra (genérico/amplo) contra os lançamentos do cliente. */
  assessment: TermAssessment;
  /** Descrições dos lançamentos do cliente, para avaliar o termo em edição. */
  memos: readonly string[];
  isDuplicate: (key: string, exceptId: string) => boolean;
  onSave: (rule: ClassificationRule, pattern: string, matchType: RuleMatchType) => Promise<void>;
  onDelete: (rule: ClassificationRule) => Promise<void>;
  onApply: (rule: ClassificationRule) => Promise<void>;
  applying: boolean;
}

export function RuleRow({ rule, account, affected, pending, conflicts, rulesById, assessment, memos, isDuplicate, onSave, onDelete, onApply, applying }: RuleRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rule.pattern);
  const [draftType, setDraftType] = useState<RuleMatchType>(rule.matchType ?? 'CONTAINS');

  const normalized = draftType === 'REGEX' ? draft.trim() : normalizePattern(draft);
  const draftAssessment = useMemo(
    () => (editing ? assessRuleTerm({ pattern: normalized, matchType: draftType }, memos) : assessment),
    [editing, normalized, draftType, memos, assessment]
  );
  const [ackKey, setAckKey] = useState('');
  const draftKey = `${draftType}|${normalized}`;
  const acknowledged = ackKey === draftKey;
  // Editar para um termo genérico exige "Criar mesmo assim"; manter o termo atual não.
  const needsAck = draftAssessment.level === 'generic' && draftKey !== `${rule.matchType ?? 'CONTAINS'}|${rule.pattern}` && !acknowledged;
  const error = !normalized
    ? 'Informe um termo.'
    : isDuplicate(ruleKey(normalized, draftType), rule.id)
      ? 'Já existe regra com esse termo e tipo.'
      : needsAck
        ? 'Termo genérico: marque “Criar mesmo assim” para salvar.'
        : null;

  const cancel = () => {
    setDraft(rule.pattern);
    setDraftType(rule.matchType ?? 'CONTAINS');
    setEditing(false);
  };

  const commit = async () => {
    if (error) return;
    try {
      await onSave(rule, normalized, draftType);
      setEditing(false);
    } catch {
      /* mensagem exibida pela página; mantém a edição aberta para nova tentativa */
    }
  };

  return (
    <tr className="group border-b border-black/[0.04] dark:border-white/[0.05] last:border-0">
      <td className="pl-5 pr-3 py-3 align-middle">
        {editing ? (
          <div className="space-y-1">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commit();
                if (e.key === 'Escape') cancel();
              }}
              aria-invalid={Boolean(error)}
              className={`${INPUT} h-9 font-mono text-[13px]`}
            />
            <MatchTypeSelect value={draftType} onChange={setDraftType} className="h-9 text-[12px]" />
            <TermWarning
              assessment={draftAssessment}
              acknowledged={acknowledged}
              onAcknowledged={(v) => setAckKey(v ? draftKey : '')}
              className="mt-1"
            />
            {error && !needsAck && <p className="text-[11px] text-rose-600">{error}</p>}
          </div>
        ) : (
          <div className="min-w-0 space-y-1">
            <span className="block text-[10px] uppercase tracking-wider text-stone-400">{MATCH_TYPE_LABEL[rule.matchType ?? 'CONTAINS']}</span>
            <span title={rule.pattern} className="inline-block max-w-full px-2.5 py-1 rounded-full bg-stone-900/[0.05] dark:bg-white/[0.08] border border-black/[0.04] font-mono text-[12px] text-stone-800 dark:text-stone-200 truncate">
              {rule.pattern}
            </span>
            {assessment.level !== 'ok' && (
              <p
                title={assessment.reasons.join('\n')}
                className={`flex items-start gap-1 text-[11px] leading-snug ${
                  assessment.level === 'generic' ? 'text-rose-700 dark:text-rose-400' : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                <AlertTriangle className="w-3 h-3 mt-px shrink-0" />
                <span>
                  {assessment.level === 'generic' ? 'Termo genérico' : 'Termo amplo'}
                  {assessment.matchCount > 0 && ` · casa com ${assessment.matchCount} lançamento(s) de ${assessment.payeeCount} favorecido(s)`}
                </span>
              </p>
            )}
            {conflicts.map((c) => {
              const winner = rulesById.get(c.winnerId);
              return (
                <p
                  key={c.winnerId}
                  title={`Históricos em disputa:\n${c.memos.join('\n')}`}
                  className="flex items-start gap-1 text-[11px] leading-snug text-amber-700 dark:text-amber-400"
                >
                  <AlertTriangle className="w-3 h-3 mt-px shrink-0" />
                  <span>
                    Perde para “{winner?.pattern ?? c.winnerId}” ({winner?.accountName ?? 'outra conta'}) em {c.count} histórico(s)
                  </span>
                </p>
              );
            })}
          </div>
        )}
      </td>
      <td className="px-3 py-3 max-w-0 w-full">
        <p className="text-[13px] text-stone-800 dark:text-stone-200 truncate">
          <span className="font-mono tabular-nums text-[12px] text-stone-400 mr-1.5">{account?.code ?? rule.accountCode ?? '—'}</span>
          {account?.name ?? rule.accountName ?? 'Conta removida'}
        </p>
      </td>
      <td className="px-3 py-3 font-mono tabular-nums text-[12px] text-stone-400 whitespace-nowrap">
        {rule.createdAt ? formatDateBR(rule.createdAt.slice(0, 10)) : '—'}
      </td>
      <td className="px-3 py-3 text-right font-mono tabular-nums text-[13px] text-stone-600 dark:text-stone-400 whitespace-nowrap">
        {affected}
        {pending > 0 && !editing && (
          <button
            type="button"
            disabled={applying}
            onClick={() => void onApply(rule)}
            title="Classificar agora os lançamentos pendentes que esta regra vence (todos os períodos abertos)"
            className="ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-sans text-[11px] font-medium text-accent-ink bg-accent/[0.07] dark:bg-accent/[0.14] hover:bg-accent/[0.12] disabled:opacity-40 active:scale-[0.96] transition-all duration-150"
          >
            <Wand2 className="w-3 h-3" />
            {applying ? 'Aplicando…' : `Aplicar a ${pending}`}
          </button>
        )}
      </td>
      <td className="pl-3 pr-4 py-3">
        <div className="flex items-center justify-end gap-1">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => void commit()}
                disabled={Boolean(error)}
                aria-label="Salvar termo"
                className="w-8 h-8 rounded-full flex items-center justify-center bg-accent text-white disabled:opacity-40 active:scale-[0.94] transition-all duration-150"
              >
                <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
              </button>
              <button
                type="button"
                onClick={cancel}
                aria-label="Cancelar edição"
                className="w-8 h-8 rounded-full flex items-center justify-center text-stone-400 hover:bg-black/[0.05] active:scale-[0.94] transition-all duration-150"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label={`Editar termo ${rule.pattern}`}
                className="w-8 h-8 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-800 hover:bg-black/[0.05] opacity-0 group-hover:opacity-100 focus:opacity-100 active:scale-[0.94] transition-all duration-150"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <ConfirmButton
                ariaLabel={`Excluir regra ${rule.pattern}`}
                label={<Trash2 className="w-3.5 h-3.5" />}
                confirmLabel="Excluir"
                onConfirm={() => onDelete(rule)}
              />
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
