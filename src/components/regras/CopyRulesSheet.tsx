'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ChartAccount, ClassificationRule, ClientCompany } from '@/types/firestore';
import { getAccounts, getRepository, getRules } from '@/lib/services/data-service';
import { COPY_SKIP_LABEL, planRuleCopy, type CopySkipReason } from '@/lib/rule-copy';
import { MATCH_TYPE_LABEL, conditionLabels } from '@/lib/reconciliation';
import { describeError } from '@/lib/utils/errors';
import { reportError } from '@/lib/monitoring';
import { newRuleId } from '@/lib/utils/id';
import { peekActor } from '@/lib/data/scope';
import { BUTTON, Field, INPUT, Sheet } from '@/components/ui/primitives';

interface CopyRulesSheetProps {
  /** Empresas de onde copiar (a carteira, sem a empresa atual). */
  sources: readonly ClientCompany[];
  targetClientId: string;
  targetName: string;
  targetRules: readonly ClassificationRule[];
  targetAccounts: readonly ChartAccount[];
  onClose: () => void;
  /** Regras gravadas no destino. */
  onCopied: (created: ClassificationRule[]) => void | Promise<void>;
}

const SKIP_ORDER: readonly CopySkipReason[] = ['duplicate', 'no-account', 'bank-condition'];

/**
 * Copia as regras de aprendizado de outra empresa da carteira: escolhe-se a origem, a tela mostra
 * o que entra e o que fica de fora (e por quê), e só então grava. As contas são casadas pelo código.
 */
export function CopyRulesSheet({ sources, targetClientId, targetName, targetRules, targetAccounts, onClose, onCopied }: CopyRulesSheetProps) {
  const [sourceId, setSourceId] = useState('');
  const [loaded, setLoaded] = useState<{ id: string; rules: ClassificationRule[]; accounts: ChartAccount[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!sourceId) return;
    let active = true;
    Promise.all([getRules(sourceId), getAccounts(sourceId)])
      .then(([rules, accounts]) => {
        if (!active) return;
        setLoaded({ id: sourceId, rules, accounts });
        setError(null);
      })
      .catch((e: unknown) => {
        reportError(e, { area: 'regras', op: 'carregar regras de outra empresa' });
        if (active) setError(`Não foi possível ler as regras da empresa (${describeError(e)}).`);
      });
    return () => {
      active = false;
    };
  }, [sourceId]);

  const source = loaded?.id === sourceId ? loaded : null;
  const plan = useMemo(
    () =>
      source
        ? planRuleCopy({
            sourceRules: source.rules,
            sourceClientId: source.id,
            sourceAccounts: source.accounts,
            targetClientId,
            targetRules,
            targetAccounts,
            now: new Date().toISOString(),
            actorUid: peekActor()?.uid,
            newId: newRuleId,
          })
        : null,
    [source, targetClientId, targetRules, targetAccounts]
  );
  const skippedBy = (reason: CopySkipReason) => plan?.skipped.filter((s) => s.reason === reason) ?? [];

  const copy = async () => {
    if (!plan?.create.length) return;
    setSaving(true);
    setError(null);
    try {
      await getRepository().commitChanges({ patches: [], rules: plan.create, audits: [] });
      await onCopied(plan.create);
    } catch (e: unknown) {
      reportError(e, { area: 'regras', op: 'copiar regras' });
      setError(`Não foi possível copiar as regras (${describeError(e)}).`);
      setSaving(false);
    }
  };

  return (
    <Sheet
      title="Copiar regras de outra empresa"
      subtitle={`Para ${targetName}. As contas são casadas pelo código do plano de contas.`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {error && <p role="alert" className="mb-2 text-center text-[12px] text-rose-600 dark:text-rose-300">{error}</p>}
          <button type="button" disabled={!plan?.create.length || saving} onClick={() => void copy()} className={`${BUTTON.accent} w-full h-12 rounded-2xl text-[15px]`}>
            {saving ? 'Copiando…' : plan?.create.length ? `Copiar ${plan.create.length} regra(s)` : 'Copiar regras'}
          </button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Empresa de origem">
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className={INPUT}>
            <option value="">Escolha a empresa…</option>
            {sources.map((c) => (
              <option key={c.id} value={c.id}>
                {c.tradeName || c.name}
              </option>
            ))}
          </select>
        </Field>

        {sourceId && !source && !error && <p role="status" className="text-[13px] text-stone-500">Lendo as regras da empresa…</p>}

        {plan && (
          <>
            <p role="status" className="text-[13px] text-stone-700 dark:text-stone-300">
              <span className="font-mono tabular-nums font-semibold">{plan.create.length}</span> regra(s) a copiar
              {plan.skipped.length > 0 && (
                <>
                  {' · '}
                  <span className="font-mono tabular-nums">{plan.skipped.length}</span> fica(m) de fora
                </>
              )}
              .
            </p>

            {plan.create.length > 0 && (
              <ul className="rounded-2xl border border-line divide-y divide-black/4 dark:divide-white/5 max-h-[280px] overflow-y-auto">
                {plan.create.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                    <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400 w-24">{MATCH_TYPE_LABEL[r.matchType ?? 'CONTAINS']}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-stone-800 dark:text-stone-200">
                      {r.pattern}
                      {conditionLabels(r).length > 0 && <span className="font-sans text-stone-500"> · {conditionLabels(r).join(' · ')}</span>}
                    </span>
                    <span className="shrink-0 max-w-[45%] truncate text-stone-600 dark:text-stone-300">
                      <span className="font-mono tabular-nums text-[12px] text-stone-500 mr-1.5">{r.accountCode}</span>
                      {r.accountName}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {SKIP_ORDER.map((reason) => {
              const list = skippedBy(reason);
              if (!list.length) return null;
              return (
                <p key={reason} className="text-[12px] leading-relaxed text-stone-500 dark:text-stone-400">
                  <span className="font-medium text-stone-700 dark:text-stone-300">
                    {list.length} {COPY_SKIP_LABEL[reason]}:
                  </span>{' '}
                  {list
                    .slice(0, 12)
                    .map((s) => `${s.rule.pattern}${reason === 'no-account' && s.rule.accountCode ? ` (${s.rule.accountCode})` : ''}`)
                    .join(', ')}
                  {list.length > 12 && ` e mais ${list.length - 12}`}
                </p>
              );
            })}

            {plan.create.length === 0 && plan.skipped.length === 0 && <p className="text-[13px] text-stone-500">Essa empresa não tem regras de aprendizado.</p>}
          </>
        )}
      </div>
    </Sheet>
  );
}
