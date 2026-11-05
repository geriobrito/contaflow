'use client';

import React, { useState } from 'react';
import type { FixedAsset, FixedAssetDisposalReason } from '@/types/firestore';
import type { FixedAssetContext } from '@/lib/services/fixed-asset-service';
import { accumulatedAtDisposalCents, assetCostCents, DISPOSAL_REASON_LABEL, disposalLockProblem } from '@/lib/fixed-assets';
import { fromCents } from '@/lib/money';
import { formatCurrency } from '@/lib/utils/formatters';
import { BUTTON, Field, INPUT, Sheet } from '@/components/ui/primitives';

/** Baixa do bem por venda, perda ou sucata: mostra o lançamento antes de gravar. */
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
  onDispose: (disposal: { date: string; reason: FixedAssetDisposalReason; note?: string }) => Promise<boolean>;
}) {
  const [date, setDate] = useState('');
  const [reason, setReason] = useState<FixedAssetDisposalReason>('SALE');
  const [note, setNote] = useState('');

  const valid = Boolean(date) && date >= asset.inUseDate;
  const cost = fromCents(assetCostCents(asset));
  const accumulated = valid ? fromCents(accumulatedAtDisposalCents(asset, date, ctx.implantationMonth)) : 0;
  const lock = valid ? disposalLockProblem(asset, date, ctx.lockedMonths, ctx.implantationMonth) : null;

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
            disabled={busy || !valid || Boolean(lock)}
            onClick={() => void onDispose({ date, reason, note }).then((ok) => ok && onClose())}
            className={`${BUTTON.accent} w-full h-12 rounded-2xl text-[15px]`}
          >
            {busy ? 'Gravando…' : 'Dar baixa'}
          </button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data da baixa" error={date && !valid ? 'Antes do início de uso.' : null}>
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
        <Field label="Observação">
          <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} placeholder="opcional (ex.: vendido a Fulano, nota nº…)" />
        </Field>

        {valid && (
          <div className="rounded-2xl bg-black/3 dark:bg-white/4 px-3.5 py-3 text-[12px] space-y-1.5">
            <p className="font-medium text-stone-700 dark:text-stone-200">Lançamento da baixa em {date.split('-').reverse().join('/')}</p>
            <Row label="D (−) Depreciação acumulada até a data" value={accumulated} />
            <Row label="D 3.3.9.04 Perda na baixa (valor contábil)" value={cost - accumulated} />
            <Row label={`C ${asset.accountCode} ${asset.accountName ?? ''} (custo)`} value={cost} />
            <p className="pt-1 text-stone-500">
              A depreciação do mês da baixa vai até a data, proporcional aos dias. {reason === 'SALE' ? 'O valor recebido entra pelo extrato, classificado em 3.3.9.02 Ganho na Venda de Imobilizado.' : ''}
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
