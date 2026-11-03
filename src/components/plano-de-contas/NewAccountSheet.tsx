'use client';

import { useMemo, useState } from 'react';
import type { ChartAccount, DREGroup } from '@/types/firestore';
import { saveAccount } from '@/lib/services/data-service';
import { newAccountId } from '@/lib/utils/id';
import { describeError } from '@/lib/utils/errors';
import { codeError as validateCode, defaultParent, DRE_GROUPS, inheritedDREGroup, RESULT_TYPES, suggestCode, TYPE_LABEL } from '@/lib/chart/tree';
import { BUTTON, Field, INPUT, Sheet } from '@/components/ui/primitives';

interface NewAccountSheetProps {
  accounts: ChartAccount[];
  clientId: string;
  onClose: () => void;
  onCreated: () => void;
}

/** Painel lateral "Nova conta analítica". */
export function NewAccountSheet({ accounts, clientId, onClose, onCreated }: NewAccountSheetProps) {
  const parents = useMemo(() => accounts.filter((a) => a.nature === 'SYNTHETIC'), [accounts]);
  const [initialParent] = useState(() => defaultParent(accounts));

  const [parentId, setParentId] = useState<string>(initialParent?.id ?? '');
  const [code, setCode] = useState(() => suggestCode(initialParent, accounts));
  const [name, setName] = useState('');
  const [dreGroup, setDreGroup] = useState<DREGroup | ''>(() => inheritedDREGroup(initialParent, accounts));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const parent = parents.find((p) => p.id === parentId);
  const trimmed = code.trim();
  const codeError = trimmed ? validateCode(trimmed, accounts, parent) : null;
  const valid = Boolean(parent && name.trim() && trimmed && !codeError);

  const handleParent = (id: string) => {
    const p = parents.find((x) => x.id === id);
    setParentId(id);
    setCode(suggestCode(p, accounts));
    setDreGroup(inheritedDREGroup(p, accounts));
  };

  const submit = async () => {
    if (!parent || !valid) return;
    setSaving(true);
    setSaveError(null);
    const now = new Date().toISOString();
    try {
      await saveAccount({
        id: newAccountId(),
        clientId,
        code: trimmed,
        name: name.trim(),
        type: parent.type,
        nature: 'ANALYTIC',
        parentId: parent.id,
        level: parent.level + 1,
        dreGroup: dreGroup || undefined,
        createdAt: now,
        updatedAt: now,
      });
      onCreated();
    } catch (e: unknown) {
      setSaveError(`Não foi possível criar a conta (${describeError(e)}).`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      side="right"
      title="Nova conta analítica"
      subtitle="Contas analíticas recebem lançamentos na conciliação."
      onClose={onClose}
      footer={
        <>
          {saveError && <p role="alert" className="mb-2 text-center text-[12px] text-rose-600">{saveError}</p>}
          <button
            type="button"
            disabled={!valid || saving}
            onClick={() => void submit()}
            className={`${BUTTON.accent} w-full h-12 rounded-2xl text-[15px]`}
          >
            {saving ? 'Salvando…' : 'Criar conta'}
          </button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Conta superior">
          <select value={parentId} onChange={(e) => handleParent(e.target.value)} className={INPUT}>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {'  '.repeat(p.code.split('.').length - 1)}
                {p.code} · {p.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Código" error={codeError} hint={parent ? `Tipo herdado: ${TYPE_LABEL[parent.type]}` : undefined}>
          <input value={code} onChange={(e) => setCode(e.target.value)} className={`${INPUT} font-mono tabular-nums`} />
        </Field>

        <Field label="Nome">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: Energia elétrica" className={INPUT} />
        </Field>

        {parent && RESULT_TYPES.has(parent.type) && (
          <Field label="Grupo na DRE">
            <select value={dreGroup} onChange={(e) => setDreGroup(e.target.value as DREGroup | '')} className={INPUT}>
              <option value="">Não informado</option>
              {DRE_GROUPS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
    </Sheet>
  );
}
