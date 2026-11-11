'use client';

import React, { useMemo, useState } from 'react';
import type { InvestmentAccount } from '@/types/firestore';
import type { InvestmentContext } from '@/lib/services/investment-service';
import { INVESTMENT_DEFAULT_CODE, investmentLedgerAccounts } from '@/lib/investments';
import { BUTTON, Field, INPUT, Sheet } from '@/components/ui/primitives';

const newInvestmentId = () => `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

/** Cadastro ou edição de uma aplicação: nome, conta do plano, primeira competência e encerramento. */
export function InvestmentSheet({
  investment,
  ctx,
  month,
  busy,
  error,
  onClose,
  onSave,
}: {
  investment: InvestmentAccount | null;
  ctx: InvestmentContext;
  /** Competência em tela: a sugestão de início para uma aplicação nova. */
  month: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (investment: InvestmentAccount) => Promise<boolean>;
}) {
  const accounts = useMemo(() => investmentLedgerAccounts(ctx.accounts), [ctx.accounts]);
  const [description, setDescription] = useState(investment?.description ?? '');
  const [ledgerAccountId, setLedgerAccountId] = useState(investment?.ledgerAccountId ?? accounts.find((a) => a.code === INVESTMENT_DEFAULT_CODE)?.id ?? '');
  const [startMonth, setStartMonth] = useState(investment?.startMonth ?? month);
  const [closedMonth, setClosedMonth] = useState(investment?.closedMonth ?? '');
  const ledger = accounts.find((a) => a.id === ledgerAccountId);

  const save = async () => {
    const now = new Date().toISOString();
    const next: InvestmentAccount = {
      id: investment?.id ?? newInvestmentId(),
      description: description.trim(),
      ledgerAccountId,
      ledgerAccountCode: ledger?.code ?? '',
      ...(ledger ? { ledgerAccountName: ledger.name } : {}),
      startMonth,
      ...(closedMonth ? { closedMonth } : {}),
      balances: investment?.balances ?? {},
      createdAt: investment?.createdAt ?? now,
      updatedAt: now,
    };
    if (await onSave(next)) onClose();
  };

  return (
    <Sheet
      side="right"
      title={investment ? 'Aplicação financeira' : 'Nova aplicação'}
      subtitle={investment?.description ?? 'Caixinha, CDB, fundo ou poupança da empresa'}
      onClose={onClose}
      footer={
        <>
          {error && (
            <p role="alert" className="mb-2 text-center text-[12px] text-rose-600 dark:text-rose-300">
              {error}
            </p>
          )}
          <button type="button" disabled={busy || !description.trim() || !ledgerAccountId || !startMonth} onClick={() => void save()} className={`${BUTTON.accent} w-full h-12 rounded-2xl text-[15px]`}>
            {busy ? 'Salvando…' : investment ? 'Salvar' : 'Cadastrar'}
          </button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Nome">
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={INPUT} placeholder="ex.: Caixinha Nubank" />
        </Field>
        <Field label="Conta do plano" hint="Aplicação de resgate imediato: 1.1.1.03. Com várias aplicações, uma subconta para cada facilita a conferência.">
          <select value={ledgerAccountId} onChange={(e) => setLedgerAccountId(e.target.value)} className={`${INPUT} ${ledgerAccountId ? '' : 'text-stone-400'}`}>
            <option value="">Selecione</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Primeira competência" hint="Desde quando o saldo do extrato é informado.">
            <input type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} className={`${INPUT} font-mono tabular-nums`} />
          </Field>
          <Field label="Encerrada em" hint="Opcional: resgatada por inteiro.">
            <input type="month" value={closedMonth} onChange={(e) => setClosedMonth(e.target.value)} className={`${INPUT} font-mono tabular-nums`} />
          </Field>
        </div>
        <div className="rounded-2xl bg-black/3 dark:bg-white/4 px-3.5 py-3 text-[12px] text-stone-600 dark:text-stone-300 space-y-1.5">
          <p>
            <b>Aplicar</b>: no extrato da conta corrente, classifique a saída na conta da aplicação.
          </p>
          <p>
            <b>Resgatar</b>: classifique a entrada na conta da aplicação e use “Resgate com IR”: sai da aplicação o bruto, e o IR e o IOF vão para as contas deles.
          </p>
          <p>
            <b>Rendimento</b>: todo mês, informe o saldo bruto do extrato da aplicação; o sistema lança a diferença em 3.4.1.02.001 no último dia.
          </p>
        </div>
      </div>
    </Sheet>
  );
}
