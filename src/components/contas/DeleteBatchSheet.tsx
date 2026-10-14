'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { ImportBatch } from '@/types/firestore';
import { deleteImportBatch, previewBatchDeletion, type BatchDeletionPreview } from '@/lib/services/accounting-service';
import { formatMonth } from '@/lib/periods';
import { describeError } from '@/lib/utils/errors';
import { formatDateBR } from '@/lib/utils/formatters';
import { formatDateTime } from '@/components/conciliacao/AuditTimeline';
import { Field, INPUT, Sheet } from '@/components/ui/primitives';

/** Exclusão de um extrato importado: mostra o que será removido e pede confirmação em dois toques. */
export function DeleteBatchSheet({
  batch,
  lockedMonths,
  onClose,
  onDeleted,
}: {
  batch: ImportBatch;
  lockedMonths: ReadonlySet<string>;
  onClose: () => void;
  onDeleted: (message: string) => Promise<void>;
}) {
  const [preview, setPreview] = useState<BatchDeletionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    previewBatchDeletion(batch, lockedMonths)
      .then((p) => active && setPreview(p))
      .catch((e: unknown) => active && setError(describeError(e)));
    return () => {
      active = false;
    };
  }, [batch, lockedMonths]);

  const blocked = Boolean(preview?.lockedMonths.length);

  const confirm = async () => {
    if (!preview) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteImportBatch(batch, preview, lockedMonths, reason.trim() || undefined);
      await onDeleted(`Extrato ${batch.fileName} excluído · ${preview.transactions.length} lançamento(s) removido(s)`);
    } catch (e) {
      setError(`Não foi possível excluir (${describeError(e)}).`);
      setArmed(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Excluir extrato importado"
      subtitle={batch.fileName}
      onClose={onClose}
      footer={
        <>
          {error && <p role="alert" className="mb-2 text-center text-[12px] text-rose-600">{error}</p>}
          <button
            type="button"
            disabled={!preview || blocked || busy}
            onClick={() => void confirm()}
            className={`w-full h-12 rounded-2xl text-[15px] font-medium text-white transition-all active:scale-[0.98] disabled:opacity-40 ${armed ? 'bg-rose-700' : 'bg-rose-600 hover:bg-rose-700'}`}
          >
            {busy ? 'Excluindo…' : armed ? 'Toque de novo para excluir definitivamente' : 'Excluir extrato e lançamentos'}
          </button>
        </>
      }
    >
      {!preview ? (
        <p className="py-8 text-center text-[13px] text-stone-400">{error ? '' : 'Verificando lançamentos…'}</p>
      ) : (
        <div className="space-y-4 pb-2 text-[13px] text-stone-600 dark:text-stone-300">
          <dl className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.05] px-4 py-3 space-y-1.5 font-mono text-[12px]">
            <div className="flex justify-between gap-4"><dt className="text-stone-400">Período</dt><dd>{batch.startDate ? `${formatDateBR(batch.startDate)} – ${formatDateBR(batch.endDate)}` : '—'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-stone-400">Lançamentos</dt><dd>{preview.transactions.length}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-stone-400">Já conciliados</dt><dd>{preview.reconciled}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-stone-400">Importado em</dt><dd>{formatDateTime(batch.importedAt)}</dd></div>
          </dl>
          {blocked ? (
            <p role="alert" className="flex gap-2 rounded-2xl px-4 py-3 bg-rose-50 dark:bg-rose-950/30 text-rose-700 border border-rose-200/60">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Há lançamentos em competência fechada ({preview.lockedMonths.map((m) => formatMonth(m)).join(', ')}). Reabra a competência na
                Conciliação para excluir este extrato.
              </span>
            </p>
          ) : (
            <>
              <p>
                Os lançamentos deste arquivo serão removidos, inclusive as classificações já feitas. Reimportar o mesmo OFX depois os traz de
                volta como novos.
                {preview.partners > 0 && ` ${preview.partners} transferência(s) com perna em outro extrato voltarão para pendente.`}
              </p>
              <Field label="Motivo" hint="Opcional · fica registrado na auditoria">
                <input value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT} placeholder="ex.: importado no cliente errado" />
              </Field>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
