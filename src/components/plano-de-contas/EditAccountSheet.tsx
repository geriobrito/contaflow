'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import type { CashFlowActivity, ChartAccount, DREGroup, LockState } from '@/types/firestore';
import { saveAccount } from '@/lib/services/data-service';
import { frozenMessage, isFrozen } from '@/lib/lock-guard';
import { describeError } from '@/lib/utils/errors';
import { DRE_GROUPS, DRE_LABEL, dreLabel, isCodeTaken, RESULT_TYPES, TYPE_LABEL } from '@/lib/chart/tree';
import { CASH_FLOW_ACTIVITY_LABEL, defaultCashFlowActivity } from '@/lib/cash-flow';

const CASH_FLOW_OPTIONS: readonly CashFlowActivity[] = ['OPERATING', 'INVESTING', 'FINANCING', 'CASH'];
import { BUTTON, Field, INPUT, Sheet, INPUT_MONEY } from '@/components/ui/primitives';

interface EditAccountSheetProps {
  account: ChartAccount;
  accounts: ChartAccount[];
  hasChildren: boolean;
  lockState: LockState | null;
  lockedMonths: readonly string[];
  onClose: () => void;
  onSaved: (updated: ChartAccount) => void;
}

/** Painel lateral "Editar conta". Com competência fechada, só nome e descrição podem mudar. */
export function EditAccountSheet({ account, accounts, hasChildren, lockState, lockedMonths, onClose, onSaved }: EditAccountSheetProps) {
  const [code, setCode] = useState(account.code);
  const [name, setName] = useState(account.name);
  const [description, setDescription] = useState(account.description ?? '');
  const [dreGroup, setDreGroup] = useState<DREGroup | ''>(account.dreGroup ?? '');
  const [isContra, setIsContra] = useState(Boolean(account.isContra));
  const [cashFlowActivity, setCashFlowActivity] = useState<CashFlowActivity | ''>(account.cashFlowActivity ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isGlobal = account.clientId === 'global';
  const structuralFrozen = isFrozen(account, lockState);
  const firstLockedMonth = !isGlobal ? lockedMonths[0] : undefined;
  const synthetic = account.nature === 'SYNTHETIC';
  const parent = account.parentId ? accounts.find((a) => a.id === account.parentId) : undefined;
  const codeDisabled = structuralFrozen || hasChildren;
  const trimmedCode = code.trim();
  const codeError = codeDisabled
    ? null
    : !trimmedCode
      ? 'Informe o código.'
      : trimmedCode !== account.code && isCodeTaken(trimmedCode, accounts, account.id)
        ? 'Código já utilizado.'
        : parent && !trimmedCode.startsWith(`${parent.code}.`)
          ? `Deve começar com ${parent.code}.`
          : null;
  const valid = Boolean(name.trim() && !codeError);

  const hasLegacyGroup = Boolean(account.dreGroup && !DRE_LABEL.has(account.dreGroup));
  const cashFlowDefault = defaultCashFlowActivity(account, accounts);

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    setSaveError(null);
    const now = new Date().toISOString();
    const trimmedDesc = description.trim();
    const next: ChartAccount = structuralFrozen
      ? {
          ...account,
          name: name.trim(),
          description: trimmedDesc || undefined,
          cashFlowActivity: cashFlowActivity || undefined,
          updatedAt: now,
        }
      : {
          ...account,
          code: codeDisabled ? account.code : trimmedCode,
          name: name.trim(),
          description: trimmedDesc || undefined,
          cashFlowActivity: cashFlowActivity || undefined,
          ...(!synthetic && RESULT_TYPES.has(account.type)
            ? { dreGroup: (dreGroup || undefined) as DREGroup | undefined }
            : {}),
          ...(!synthetic ? { isContra: isContra ? true : undefined } : {}),
          updatedAt: now,
        };
    try {
      await saveAccount(next);
      onSaved(next);
    } catch (e: unknown) {
      setSaveError(`Não foi possível salvar a conta (${describeError(e)}).`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      side="right"
      title="Editar conta"
      subtitle={`${account.code} · ${TYPE_LABEL[account.type]} · ${synthetic ? 'Sintética' : 'Analítica'}`}
      onClose={onClose}
      footer={
        <>
          {saveError && <p role="alert" className="mb-2 text-center text-[12px] text-rose-600 dark:text-rose-300">{saveError}</p>}
          <button
            type="button"
            disabled={!valid || saving}
            onClick={() => void submit()}
            className={`${BUTTON.accent} w-full h-12 rounded-2xl text-[15px]`}
          >
            {saving ? 'Salvando…' : 'Salvar alterações'}
          </button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        {structuralFrozen && (
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-2xl border border-amber-200/70 bg-amber-50/80 dark:bg-amber-950/25 dark:border-amber-800/40 px-3.5 py-3 text-[12px] text-amber-900 dark:text-amber-200"
          >
            <Lock className="w-4 h-4 mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" />
            <div className="space-y-1">
              <p>{frozenMessage('chart_of_accounts', { lockState, lockedMonths, isGlobal })}</p>
              {firstLockedMonth && (
                <Link href={`/?mes=${firstLockedMonth}`} onClick={onClose} className="inline-block font-medium text-accent-ink hover:underline">
                  Ir para Conciliação →
                </Link>
              )}
            </div>
          </div>
        )}

        <Field label="Nome">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
        </Field>

        <Field label="Descrição (opcional)">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Nota interna sobre o uso desta conta"
            className={INPUT}
          />
        </Field>

        <Field
          label="Código"
          error={codeError}
          hint={
            hasChildren && !structuralFrozen
              ? 'Contas com subcontas não podem ter o código alterado.'
              : `Tipo: ${TYPE_LABEL[account.type]}`
          }
        >
          <input
            disabled={codeDisabled}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={INPUT_MONEY}
          />
        </Field>

        {!synthetic && RESULT_TYPES.has(account.type) && (
          <Field label="Grupo na DRE">
            <select
              disabled={structuralFrozen}
              value={dreGroup}
              onChange={(e) => setDreGroup(e.target.value as DREGroup | '')}
              className={INPUT}
            >
              <option value="">Não informado</option>
              {hasLegacyGroup && account.dreGroup && (
                <option value={account.dreGroup}>{dreLabel(account) ?? account.dreGroup}</option>
              )}
              {DRE_GROUPS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field
          label="Atividade na DFC"
          hint={
            synthetic
              ? 'Vale para todas as subcontas que não tenham escolha própria. Só muda a apresentação da DFC.'
              : 'Onde os pagamentos e recebimentos desta conta aparecem na Demonstração dos Fluxos de Caixa.'
          }
        >
          <select value={cashFlowActivity} onChange={(e) => setCashFlowActivity(e.target.value as CashFlowActivity | '')} className={INPUT}>
            <option value="">Padrão: {CASH_FLOW_ACTIVITY_LABEL[cashFlowDefault]}</option>
            {CASH_FLOW_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {CASH_FLOW_ACTIVITY_LABEL[a]}
              </option>
            ))}
          </select>
        </Field>

        {!synthetic && (
          <label
            className={`flex items-start gap-2.5 rounded-xl border border-line px-3.5 py-2.5 text-[13px] ${
              structuralFrozen ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
            }`}
          >
            <input
              type="checkbox"
              disabled={structuralFrozen}
              checked={isContra}
              onChange={(e) => setIsContra(e.target.checked)}
              className="mt-0.5 rounded border-stone-300 text-accent focus:ring-accent"
            />
            <span>
              <span className="block font-medium text-stone-800 dark:text-stone-200">Conta redutora (retificadora)</span>
              <span className="block text-[12px] text-stone-500">Inverte o sinal natural do grupo no balanço ou na DRE.</span>
            </span>
          </label>
        )}
      </div>
    </Sheet>
  );
}
