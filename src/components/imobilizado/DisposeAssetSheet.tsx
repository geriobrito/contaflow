'use client';

import React, { useState } from 'react';
import type { FixedAsset, FixedAssetDisposalReason } from '@/types/firestore';
import type { DisposalInput, FixedAssetContext } from '@/lib/services/fixed-asset-service';
import { accumulatedAtDisposalCents, assetCostCents, DISPOSAL_REASON_LABEL, disposalLockProblem, isIntangibleCode } from '@/lib/fixed-assets';
import { fromCents, toCents } from '@/lib/money';
import { parseMoneyInput } from '@/lib/opening';
import { formatCurrency } from '@/lib/utils/formatters';
import { BUTTON, Field, INPUT, Sheet } from '@/components/ui/primitives';

/**
 * Baixa do bem por venda, perda ou sucata: mostra o lançamento antes de gravar. Na venda, a
 * receita (pelo valor da nota) entra junto, contra o crédito a receber do comprador.
 */
export function DisposeAssetSheet({
  asset,
  ctx,
  busy,
  error,
  onClose,
  onDispose,
}: {
  asset: FixedAsset;
  ctx: FixedAssetContext;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onDispose: (disposal: DisposalInput) => Promise<boolean>;
}) {
  const [date, setDate] = useState('');
  const [reason, setReason] = useState<FixedAssetDisposalReason>('SALE');
  const [note, setNote] = useState('');
  const [saleText, setSaleText] = useState('');
  const [buyer, setBuyer] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');

  const isSale = reason === 'SALE';
  const saleAmount = parseMoneyInput(saleText);
  const saleValid = !isSale || (saleAmount !== null && saleAmount > 0);
  const valid = Boolean(date) && date >= asset.inUseDate;
  const cost = fromCents(assetCostCents(asset));
  const accumulated = valid ? fromCents(accumulatedAtDisposalCents(asset, date, ctx.implantationMonth)) : 0;
  const bookValue = fromCents(toCents(cost) - toCents(accumulated));
  const lock = valid ? disposalLockProblem(asset, date, ctx.lockedMonths, ctx.implantationMonth) : null;
  const contraLabel = isIntangibleCode(asset.accountCode) ? '1.2.4.03 (−) Amortização acumulada' : '1.2.3.07 (−) Depreciação acumulada';
  const result = isSale && saleAmount ? fromCents(toCents(saleAmount) - toCents(bookValue)) : 0;

  const submit = () =>
    onDispose({
      date,
      reason,
      note,
      ...(isSale ? { sale: { amount: saleAmount ?? 0, buyer, invoiceRef } } : {}),
    }).then((ok) => ok && onClose());

  return (
    <Sheet
      side="right"
      title="Baixa do bem"
      subtitle={asset.description}
      onClose={onClose}
      footer={
        <>
          {(lock || error) && (
            <p role="alert" className="mb-2 text-center text-[12px] text-rose-600">
              {lock || error}
            </p>
          )}
          <button
            type="button"
            disabled={busy || !valid || !saleValid || Boolean(lock)}
            onClick={() => void submit()}
            className={`${BUTTON.accent} w-full h-12 rounded-2xl text-[15px]`}
          >
            {busy ? 'Gravando…' : isSale ? 'Lançar a venda e a baixa' : 'Dar baixa'}
          </button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <div className="grid grid-cols-2 gap-3">
          <Field label={isSale ? 'Data da venda' : 'Data da baixa'} error={date && !valid ? 'Antes do início de uso.' : null}>
            <input type="date" value={date} min={asset.inUseDate} onChange={(e) => setDate(e.target.value)} className={`${INPUT} font-mono tabular-nums`} />
          </Field>
          <Field label="Motivo">
            <select value={reason} onChange={(e) => setReason(e.target.value as FixedAssetDisposalReason)} className={INPUT}>
              {(Object.keys(DISPOSAL_REASON_LABEL) as FixedAssetDisposalReason[]).map((r) => (
                <option key={r} value={r}>
                  {DISPOSAL_REASON_LABEL[r][0].toUpperCase() + DISPOSAL_REASON_LABEL[r].slice(1)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {isSale && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Valor da venda" error={saleText && !saleValid ? 'Valor inválido.' : null}>
                <input value={saleText} onChange={(e) => setSaleText(e.target.value)} placeholder="0,00" inputMode="decimal" className={`${INPUT} font-mono tabular-nums`} />
              </Field>
              <Field label="Nota fiscal nº">
                <input value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} placeholder="ou contrato" className={INPUT} />
              </Field>
            </div>
            <Field label="Comprador">
              <input value={buyer} onChange={(e) => setBuyer(e.target.value)} className={INPUT} placeholder="opcional" />
            </Field>
          </>
        )}

        <Field label="Observação">
          <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} placeholder="opcional" />
        </Field>

        {valid && (
          <div className="rounded-2xl bg-black/3 dark:bg-white/4 px-3.5 py-3 text-[12px] space-y-1.5">
            <p className="font-medium text-stone-700 dark:text-stone-200">Lançamento em {date.split('-').reverse().join('/')}</p>
            {isSale && (
              <>
                <Row label="D 1.1.2.11 Créditos pela venda (a receber)" value={saleAmount ?? 0} />
                <Row label="C 3.3.9.02 Receita na venda" value={saleAmount ?? 0} />
              </>
            )}
            <Row label={`D ${contraLabel} até a data`} value={accumulated} />
            <Row label="D 3.3.9.04 Custo do bem baixado (valor contábil)" value={bookValue} />
            <Row label={`C ${asset.accountCode} ${asset.accountName ?? ''} (custo)`} value={cost} />
            {isSale && saleAmount ? (
              <p className={`pt-1 font-medium ${result >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600'}`}>
                {result >= 0 ? 'Ganho' : 'Perda'} na venda: {formatCurrency(Math.abs(result))}. Aparece na DRE em outras receitas e despesas, pela diferença entre receita e custo.
              </p>
            ) : null}
            <p className="pt-1 text-stone-500">
              A depreciação do mês da baixa vai até a data, proporcional aos dias.{' '}
              {isSale
                ? 'O recebimento vem pelo extrato: classifique o depósito em 1.1.2.11 Créditos pela Venda de Imobilizado e Intangível.'
                : reason === 'LOSS'
                  ? 'Se o seguro indenizar, a indenização é outra receita (3.3.9.01 Outras Receitas Operacionais), lançada quando for recebida.'
                  : ''}
            </p>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <p className="flex items-baseline justify-between gap-3 text-stone-600 dark:text-stone-300">
      <span className="min-w-0 truncate">{label}</span>
      <span className="font-mono tabular-nums">{formatCurrency(value)}</span>
    </p>
  );
}
