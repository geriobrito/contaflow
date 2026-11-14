'use client';

import { useState } from 'react';
import type { ClientCompany, ObligationChecks } from '@/types/firestore';
import { activeObligations, isAvailable, isSuggested, OBLIGATIONS, setObligationActive, type PayrollProfile } from '@/lib/obligations';
import { regimeLabel } from '@/components/clientes/options';
import { describeError } from '@/lib/utils/errors';
import { INPUT_COMPACT, IOSSwitch, Sheet } from '@/components/ui/primitives';

/** Quais obrigações valem para a empresa: as sugeridas pelo regime e pela folha, com ajustes. */
export function ObligationSettingsSheet({
  clients,
  client,
  onClientChange,
  profile,
  checks,
  onSave,
  onClose,
}: {
  clients: readonly ClientCompany[];
  client: ClientCompany;
  onClientChange: (c: ClientCompany) => void;
  profile: PayrollProfile;
  checks: ObligationChecks;
  onSave: (next: ObligationChecks) => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const active = new Set(activeObligations(client.regime, profile, checks).map((d) => d.code));
  const available = OBLIGATIONS.filter((d) => isAvailable(d, client.regime));

  const change = async (code: string, on: boolean) => {
    const def = OBLIGATIONS.find((d) => d.code === code)!;
    setError(null);
    try {
      await onSave(setObligationActive(checks, def, on, isSuggested(def, client.regime, profile)));
    } catch (e) {
      setError(`Não foi possível gravar (${describeError(e)}).`);
    }
  };

  return (
    <Sheet title="Obrigações da empresa" subtitle={`${regimeLabel(client.regime)}${profile.hasPayroll ? ' · com folha' : ''}`} onClose={onClose} side="right">
      <div className="space-y-4">
        <select
          value={client.id}
          onChange={(e) => {
            const next = clients.find((c) => c.id === e.target.value);
            if (next) onClientChange(next);
          }}
          className={`${INPUT_COMPACT} w-full`}
          aria-label="Empresa"
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.tradeName || c.name}
            </option>
          ))}
        </select>
        <p className="text-[12.5px] text-stone-500">
          As sugeridas saem do regime e da folha (pró-labore ou empregados lançados em Folha de Pagamento). Ligue as opcionais que valem para esta empresa.
        </p>
        {error && (
          <p role="alert" className="text-[13px] text-rose-600 dark:text-rose-300">
            {error}
          </p>
        )}
        <ul className="divide-y divide-line">
          {available.map((def) => {
            const suggested = isSuggested(def, client.regime, profile);
            return (
              <li key={def.code} className="flex items-start gap-3 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-medium text-stone-900 dark:text-stone-100">
                    {def.label}
                    <span className="ml-2 text-[10.5px] uppercase tracking-[0.08em] text-stone-400">{suggested ? 'sugerida' : def.optional ? 'opcional' : 'sem folha'}</span>
                  </p>
                  <p className="text-[12px] text-stone-500">{def.description}</p>
                </div>
                <IOSSwitch checked={active.has(def.code)} onChange={(on) => void change(def.code, on)} />
              </li>
            );
          })}
        </ul>
      </div>
    </Sheet>
  );
}
