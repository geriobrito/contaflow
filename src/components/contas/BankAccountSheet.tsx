'use client';

import React, { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { BankAccount } from '@/types/firestore';
import type { ContasData } from '@/hooks/contas/useContasData';
import { getRepository } from '@/lib/services/data-service';
import { bankLedgerCandidates, suggestOpening } from '@/lib/bank-accounts';
import { BANKS_PARENT_CODE, createBankSubaccounts } from '@/lib/services/accounting-service';
import { describeError } from '@/lib/utils/errors';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, Field, INPUT, Sheet } from '@/components/ui/primitives';

/** Edição de uma conta bancária: nome, conta contábil vinculada e saldo inicial. */
export function BankAccountSheet({
  bank,
  data,
  onClose,
  onSaved,
}: {
  bank: BankAccount;
  data: ContasData;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const candidates = useMemo(() => bankLedgerCandidates(data.accounts), [data.accounts]);
  const suggestion = useMemo(() => suggestOpening(data.batches, bank.accountKey), [data.batches, bank.accountKey]);
  const [nickname, setNickname] = useState(bank.nickname);
  const [ledgerId, setLedgerId] = useState(bank.ledgerAccountId ?? '');
  const [opening, setOpening] = useState(bank.openingBalance !== undefined ? String(bank.openingBalance).replace('.', ',') : '');
  const [openingDate, setOpeningDate] = useState(bank.openingDate ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedOpening = opening.trim() ? Number(opening.replace(/\./g, '').replace(',', '.')) : undefined;
  const openingError = opening.trim() && !Number.isFinite(parsedOpening) ? 'Valor inválido.' : !opening.trim() !== !openingDate ? 'Informe valor e data juntos.' : null;
  const sharedLedger = ledgerId && data.banks.some((b) => b.id !== bank.id && b.ledgerAccountId === ledgerId);
  const parent = data.accounts.find((a) => a.code === BANKS_PARENT_CODE);

  const save = async () => {
    if (openingError || !nickname.trim()) return;
    setBusy(true);
    setError(null);
    const ledger = data.accounts.find((a) => a.id === ledgerId);
    const next: BankAccount = {
      id: bank.id,
      clientId: bank.clientId,
      accountKey: bank.accountKey,
      ...(bank.bankId ? { bankId: bank.bankId } : {}),
      ...(bank.branchId ? { branchId: bank.branchId } : {}),
      ...(bank.accountNumber ? { accountNumber: bank.accountNumber } : {}),
      ...(bank.bankName ? { bankName: bank.bankName } : {}),
      nickname: nickname.trim(),
      ...(ledger ? { ledgerAccountId: ledger.id, ledgerAccountCode: ledger.code, ledgerAccountName: ledger.name } : {}),
      ...(parsedOpening !== undefined && openingDate ? { openingBalance: parsedOpening, openingDate } : {}),
      createdAt: bank.createdAt,
      updatedAt: new Date().toISOString(),
    };
    try {
      await getRepository().saveBankAccount(next);
      await onSaved('Conta bancária atualizada');
    } catch (e) {
      setError(`Não foi possível salvar (${describeError(e)}).`);
    } finally {
      setBusy(false);
    }
  };

  const createSubaccount = async () => {
    setBusy(true);
    setError(null);
    try {
      const { created } = await createBankSubaccounts({
        clientId: bank.clientId,
        targets: [{ ...bank, nickname: nickname.trim() || bank.nickname }],
        allBankAccounts: data.banks,
        accounts: data.accounts,
      });
      await onSaved(`Criada(s) ${created.map((a) => `${a.code} ${a.name}`).join(', ')}`);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Conta bancária"
      subtitle={bank.accountKey}
      onClose={onClose}
      footer={
        <>
          {error && <p role="alert" className="mb-2 text-center text-[12px] text-rose-600">{error}</p>}
          <button type="button" disabled={busy || Boolean(openingError) || !nickname.trim()} onClick={() => void save()} className={`${BUTTON.accent} w-full h-12 rounded-2xl text-[15px]`}>
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Nome da conta">
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} className={INPUT} placeholder="ex.: Itaú movimento" />
        </Field>

        <Field
          label="Conta contábil (ativo)"
          hint={sharedLedger ? 'Outra conta bancária usa a mesma conta contábil: os saldos serão somados no balanço.' : 'Contrapartida bancária de todos os lançamentos deste extrato no balancete e no balanço.'}
        >
          <select value={ledgerId} onChange={(e) => setLedgerId(e.target.value)} className={`${INPUT} ${ledgerId ? '' : 'text-stone-400'}`}>
            <option value="">Sem vínculo</option>
            {candidates.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </Field>
        {parent && (
          <button type="button" disabled={busy} onClick={() => void createSubaccount()} className={`${BUTTON.secondary} w-full`}>
            <Plus className="w-4 h-4" />
            Criar subconta própria em {parent.code} {parent.name}
          </button>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Saldo inicial" error={openingError}>
            <input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0,00" className={`${INPUT} font-mono tabular-nums`} />
          </Field>
          <Field label="No início do dia">
            <input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} className={`${INPUT} font-mono tabular-nums`} />
          </Field>
        </div>
        {suggestion && (
          <button
            type="button"
            onClick={() => {
              setOpening(String(suggestion.openingBalance).replace('.', ','));
              setOpeningDate(suggestion.openingDate);
            }}
            className="text-[12px] text-[#0071E3] hover:underline"
          >
            Usar o saldo do primeiro extrato: {formatCurrency(suggestion.openingBalance)} em {formatDateBR(suggestion.openingDate)}
          </button>
        )}
        <p className="text-[12px] text-stone-400">
          Lançamentos até a data do saldo inicial já estão contidos nele e não são somados de novo.
        </p>
      </div>
    </Sheet>
  );
}
