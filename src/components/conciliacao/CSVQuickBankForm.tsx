'use client';

import React from 'react';
import type { BankAccountKind, ChartAccount } from '@/types/firestore';
import { BUTTON, INPUT } from '@/components/ui/primitives';

interface CSVQuickBankFormProps {
  kind: BankAccountKind;
  onKindChange: (kind: BankAccountKind) => void;
  nickname: string;
  onNicknameChange: (nickname: string) => void;
  ledgerId: string;
  onLedgerIdChange: (accountId: string) => void;
  ledgerCandidates: readonly ChartAccount[];
  creating: boolean;
  onCreate: () => void;
}

const kindButton = (selected: boolean) =>
  `px-2.5 py-1 rounded-md font-medium transition-colors ${
    selected ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-sm' : 'text-stone-500'
  }`;

/** Formulário rápido para cadastrar conta ou cartão sem OFX prévio, dentro da importação de CSV. */
export function CSVQuickBankForm({
  kind,
  onKindChange,
  nickname,
  onNicknameChange,
  ledgerId,
  onLedgerIdChange,
  ledgerCandidates,
  creating,
  onCreate,
}: CSVQuickBankFormProps) {
  return (
    <div className="p-4 rounded-xl border border-accent/25 bg-accent/4 dark:bg-accent/8 space-y-3 animate-fade-in">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-stone-900 dark:text-stone-100">
          Cadastrar nova conta bancária ou cartão de crédito
        </span>
        <div className="inline-flex rounded-lg p-0.5 bg-black/5 dark:bg-white/8 text-[12px]">
          <button type="button" onClick={() => onKindChange('CARD')} className={kindButton(kind === 'CARD')}>
            Cartão de crédito
          </button>
          <button type="button" onClick={() => onKindChange('BANK')} className={kindButton(kind === 'BANK')}>
            Conta bancária
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
        <div className="md:col-span-5">
          <label className="block text-[11px] font-medium text-stone-500 mb-1">
            {kind === 'CARD' ? 'Nome do cartão *' : 'Nome da conta *'}
          </label>
          <input
            value={nickname}
            onChange={(e) => onNicknameChange(e.target.value)}
            placeholder={kind === 'CARD' ? 'ex.: Cartão Nubank Corporativo' : 'ex.: Banco Inter PJ'}
            className={INPUT}
          />
        </div>
        <div className="md:col-span-5">
          <label className="block text-[11px] font-medium text-stone-500 mb-1">Conta contábil vinculada (opcional)</label>
          <select value={ledgerId} onChange={(e) => onLedgerIdChange(e.target.value)} className={INPUT}>
            <option value="">Definir depois em Contas e Extratos</option>
            {ledgerCandidates.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <button type="button" disabled={creating || !nickname.trim()} onClick={onCreate} className={`${BUTTON.primary} w-full h-10`}>
            {creating ? 'Salvando…' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  );
}

