'use client';

import React, { useMemo, useState } from 'react';
import type { StockControl, StockCountFrequency } from '@/types/firestore';
import type { StockContext } from '@/lib/services/stock-service';
import { COST_DEFAULT_CODE, costAccounts, STOCK_DEFAULT_CODE, STOCK_FREQUENCY_LABEL, stockAccounts } from '@/lib/stock';
import { BUTTON, Field, INPUT, Sheet, INPUT_MONEY } from '@/components/ui/primitives';

/** Configuração do controle de estoque: contas do estoque e do custo, início e frequência do relatório. */
export function StockSetupSheet({
  clientId,
  ctx,
  month,
  busy,
  error,
  onClose,
  onSave,
}: {
  clientId: string;
  ctx: StockContext;
  month: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (control: StockControl) => Promise<boolean>;
}) {
  const current = ctx.control;
  const stocks = useMemo(() => stockAccounts(ctx.accounts), [ctx.accounts]);
  const costs = useMemo(() => costAccounts(ctx.accounts), [ctx.accounts]);
  const [stockAccountId, setStockAccountId] = useState(current?.stockAccountId ?? stocks.find((a) => a.code === STOCK_DEFAULT_CODE)?.id ?? '');
  const [costAccountId, setCostAccountId] = useState(current?.costAccountId ?? costs.find((a) => a.code === COST_DEFAULT_CODE)?.id ?? '');
  const [startMonth, setStartMonth] = useState(current?.startMonth ?? month);
  const [frequency, setFrequency] = useState<StockCountFrequency>(current?.frequency ?? 'MONTHLY');

  const save = async () => {
    const stock = stocks.find((a) => a.id === stockAccountId);
    const cost = costs.find((a) => a.id === costAccountId);
    const control: StockControl = {
      id: clientId,
      clientId,
      stockAccountId,
      stockAccountCode: stock?.code ?? '',
      costAccountId,
      costAccountCode: cost?.code ?? '',
      startMonth,
      frequency,
      counts: current?.counts ?? {},
      ...(current?.notes ? { notes: current.notes } : {}),
      updatedAt: '',
    };
    if (await onSave(control)) onClose();
  };

  return (
    <Sheet
      side="right"
      title="Controle de estoque"
      subtitle="CMV = estoque inicial + compras − estoque final"
      onClose={onClose}
      footer={
        <>
          {error && (
            <p role="alert" className="mb-2 text-center text-[12px] text-rose-600 dark:text-rose-300">
              {error}
            </p>
          )}
          <button type="button" disabled={busy || !stockAccountId || !costAccountId || !startMonth} onClick={() => void save()} className={`${BUTTON.accent} w-full h-12 rounded-2xl text-[15px]`}>
            {busy ? 'Salvando…' : current ? 'Salvar' : 'Configurar'}
          </button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Conta do estoque">
          <select value={stockAccountId} onChange={(e) => setStockAccountId(e.target.value)} className={`${INPUT} ${stockAccountId ? '' : 'text-stone-400'}`}>
            <option value="">Selecione</option>
            {stocks.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Conta do custo">
          <select value={costAccountId} onChange={(e) => setCostAccountId(e.target.value)} className={`${INPUT} ${costAccountId ? '' : 'text-stone-400'}`}>
            <option value="">Selecione</option>
            {costs.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Primeira competência">
            <input type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} className={INPUT_MONEY} />
          </Field>
          <Field label="Relatório do cliente">
            <select value={frequency} onChange={(e) => setFrequency(e.target.value as StockCountFrequency)} className={INPUT}>
              {(Object.keys(STOCK_FREQUENCY_LABEL) as StockCountFrequency[]).map((f) => (
                <option key={f} value={f}>
                  {STOCK_FREQUENCY_LABEL[f]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="rounded-2xl bg-black/3 dark:bg-white/4 px-3.5 py-3 text-[12px] text-stone-600 dark:text-stone-300 space-y-1.5">
          <p>O controle do estoque é do cliente (sistema de vendas ou planilha); o contador recebe o estoque final e calcula o CMV.</p>
          <p>As compras podem estar no estoque ou direto no custo: o lançamento do mês leva o saldo do estoque ao valor informado, e o CMV fica igual a estoque inicial + compras − estoque final.</p>
          <p>Impostos recuperáveis da nota de compra não entram no estoque; frete e impostos não recuperáveis entram.</p>
        </div>
      </div>
    </Sheet>
  );
}
