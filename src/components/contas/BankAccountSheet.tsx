'use client';

import React, { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { BankAccount, BankAccountKind } from '@/types/firestore';
import type { ContasData } from '@/hooks/contas/useContasData';
import { getRepository } from '@/lib/services/data-service';
import { bankAccountId, bankLedgerCandidates, newManualAccountKey, suggestOpening } from '@/lib/bank-accounts';
import { BANKS_PARENT_CODE, createBankSubaccounts } from '@/lib/services/accounting-service';
import { describeError } from '@/lib/utils/errors';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, Field, INPUT, SegmentedControl, Sheet } from '@/components/ui/primitives';

const LIABILITY_TYPES = new Set(['LIABILITY', 'PASSIVO']);

/** Cadastro ou edição de uma conta bancária ou cartão de crédito: tipo, nome, conta contábil vinculada e saldo inicial. */
export function BankAccountSheet({
  clientId,
  bank,
  data,
  onClose,
  onSaved,
}: {
  clientId: string;
  bank: BankAccount | null;
  data: ContasData;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<BankAccountKind>(bank?.kind ?? 'BANK');
  const [nickname, setNickname] = useState(bank?.nickname ?? '');
  const [ledgerId, setLedgerId] = useState(bank?.ledgerAccountId ?? '');
  const [opening, setOpening] = useState(bank?.openingBalance !== undefined ? String(bank.openingBalance).replace('.', ',') : '');
  const [openingDate, setOpeningDate] = useState(bank?.openingDate ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(() => bankLedgerCandidates(data.accounts, kind), [data.accounts, kind]);
  const liabilityCandidates = useMemo(
    () => (kind === 'CARD' ? candidates.filter((a) => LIABILITY_TYPES.has(a.type)) : []),
    [candidates, kind]
  );
  const assetCandidates = useMemo(
    () => (kind === 'CARD' ? candidates.filter((a) => !LIABILITY_TYPES.has(a.type)) : candidates),
    [candidates, kind]
  );

  const suggestion = useMemo(
    () => (bank ? suggestOpening(data.batches, bank.accountKey) : null),
    [data.batches, bank]
  );

  const parsedOpening = opening.trim() ? Number(opening.replace(/\./g, '').replace(',', '.')) : undefined;
  const openingError =
    opening.trim() && !Number.isFinite(parsedOpening)
      ? 'Valor inválido.'
      : !opening.trim() !== !openingDate
        ? 'Informe valor e data juntos.'
        : null;
  const sharedLedger = ledgerId && data.banks.some((b) => b.id !== bank?.id && b.ledgerAccountId === ledgerId);
  const parent = data.accounts.find((a) => a.code === BANKS_PARENT_CODE);

  const buildDraftBank = (now: string): BankAccount => {
    const existingKeys = new Set(data.banks.map((b) => b.accountKey));
    const accountKey = bank?.accountKey ?? newManualAccountKey(nickname.trim(), kind, existingKeys);
    const id = bank?.id ?? bankAccountId(clientId, accountKey);
    const ledger = candidates.find((a) => a.id === ledgerId);

    return {
      id,
      clientId,
      accountKey,
      kind,
      ...(bank?.bankId ? { bankId: bank.bankId } : {}),
      ...(bank?.branchId ? { branchId: bank.branchId } : {}),
      ...(bank?.accountNumber ? { accountNumber: bank.accountNumber } : {}),
      ...(bank?.bankName ? { bankName: bank.bankName } : {}),
      ...(bank?.csvPreset ? { csvPreset: bank.csvPreset } : {}),
      nickname: nickname.trim(),
      ...(ledger ? { ledgerAccountId: ledger.id, ledgerAccountCode: ledger.code, ledgerAccountName: ledger.name } : {}),
      ...(parsedOpening !== undefined && openingDate ? { openingBalance: parsedOpening, openingDate } : {}),
      createdAt: bank?.createdAt ?? now,
      updatedAt: now,
    };
  };

  const save = async () => {
    if (openingError || !nickname.trim()) return;
    setBusy(true);
    setError(null);
    const now = new Date().toISOString();
    const next = buildDraftBank(now);
    try {
      await getRepository().saveBankAccount(next);
      await onSaved(
        bank
          ? kind === 'CARD'
            ? 'Cartão atualizado'
            : 'Conta bancária atualizada'
          : kind === 'CARD'
            ? 'Cartão de crédito cadastrado'
            : 'Conta bancária cadastrada'
      );
    } catch (e) {
      setError(`Não foi possível salvar (${describeError(e)}).`);
    } finally {
      setBusy(false);
    }
  };

  const createSubaccount = async () => {
    if (!nickname.trim() && !bank?.nickname) return;
    setBusy(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      const target = buildDraftBank(now);
      const { created } = await createBankSubaccounts({
        clientId,
        targets: [target],
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
      title={bank ? (kind === 'CARD' ? 'Cartão de crédito' : 'Conta bancária') : 'Nova conta ou cartão'}
      subtitle={bank ? bank.accountKey : 'Para extratos CSV, faturas de cartão ou contas sem OFX'}
      onClose={onClose}
      footer={
        <>
          {error && (
            <p role="alert" className="mb-2 text-center text-[12px] text-rose-600">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={busy || Boolean(openingError) || !nickname.trim()}
            onClick={() => void save()}
            className={`${BUTTON.accent} w-full h-12 rounded-2xl text-[15px]`}
          >
            {busy ? 'Salvando…' : bank ? 'Salvar' : 'Cadastrar'}
          </button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Tipo">
          <SegmentedControl
            ariaLabel="Tipo de conta"
            value={kind}
            onChange={(nextKind) => {
              setKind(nextKind);
              if (nextKind === 'BANK' && ledgerId) {
                const chosen = data.accounts.find((a) => a.id === ledgerId);
                if (chosen && LIABILITY_TYPES.has(chosen.type)) setLedgerId('');
              }
            }}
            options={[
              { value: 'BANK', label: 'Conta bancária' },
              { value: 'CARD', label: 'Cartão de crédito' },
            ]}
          />
        </Field>

        <Field label={kind === 'CARD' ? 'Nome do cartão' : 'Nome da conta'}>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            className={INPUT}
            placeholder={kind === 'CARD' ? 'ex.: Cartão Nubank Corporativo' : 'ex.: Itaú movimento'}
          />
        </Field>

        <Field
          label={kind === 'CARD' ? 'Conta contábil (passivo ou ativo)' : 'Conta contábil (ativo)'}
          hint={
            sharedLedger
              ? 'Outra conta usa a mesma conta contábil: os saldos serão somados no balanço.'
              : kind === 'CARD'
                ? 'Vincule a uma conta de Passivo (ex.: Cartões a Pagar 2.1...) para que compras creditem o passivo e pagamentos de fatura o liquidem.'
                : 'Contrapartida bancária de todos os lançamentos deste extrato no balancete e no balanço.'
          }
        >
          <select value={ledgerId} onChange={(e) => setLedgerId(e.target.value)} className={`${INPUT} ${ledgerId ? '' : 'text-stone-400'}`}>
            <option value="">Sem vínculo</option>
            {kind === 'CARD' ? (
              <>
                {liabilityCandidates.length > 0 && (
                  <optgroup label="Passivo (Cartões / Obrigações)">
                    {liabilityCandidates.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {assetCandidates.length > 0 && (
                  <optgroup label="Ativo (Disponibilidades)">
                    {assetCandidates.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </>
            ) : (
              assetCandidates.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))
            )}
          </select>
        </Field>
        {parent && kind === 'BANK' && (
          <button
            type="button"
            disabled={busy || (!nickname.trim() && !bank?.nickname)}
            onClick={() => void createSubaccount()}
            className={`${BUTTON.secondary} w-full`}
          >
            <Plus className="w-4 h-4" />
            Criar subconta própria em {parent.code} {parent.name}
          </button>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Saldo inicial" error={openingError}>
            <input value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0,00" className={`${INPUT} font-mono tabular-nums`} />
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
            className="text-[12px] text-accent-ink hover:underline"
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
