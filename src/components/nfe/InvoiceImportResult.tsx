'use client';

import Link from 'next/link';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import type { InvoiceImportOutcome } from '@/hooks/nfe/useInvoices';

/** Resumo da última importação: quantas notas entraram, canceladas e arquivos recusados. */
export function InvoiceImportResult({ outcome, onClose }: { outcome: InvoiceImportOutcome; onClose: () => void }) {
  const parts = [
    outcome.purchases ? `${outcome.purchases} de compra` : null,
    outcome.sales ? `${outcome.sales} de venda` : null,
  ].filter(Boolean);

  return (
    <section role="status" aria-label="Resultado da importação" className="rounded-2xl border border-black/6 dark:border-white/8 bg-white/70 dark:bg-stone-900/60 px-4 py-3 text-[13px] space-y-2 animate-fade-in">
      <div className="flex items-start gap-2">
        {outcome.imported > 0 ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />}
        <p className="flex-1 text-stone-700 dark:text-stone-200">
          {outcome.imported > 0 ? `${outcome.imported} nota(s) importada(s)${parts.length ? ` · ${parts.join(', ')}` : ''}.` : 'Nenhuma nota importada.'}
          {outcome.cancelled > 0 && ` ${outcome.cancelled} marcada(s) como cancelada(s).`}
          {outcome.imported > 0 && (
            <>
              {' '}
              Os pagamentos e recebimentos que casam com elas aparecem com a conta sugerida na{' '}
              <Link href="/" className="font-medium text-accent-ink hover:underline">
                Conciliação
              </Link>
              .
            </>
          )}
        </p>
        <button type="button" onClick={onClose} aria-label="Fechar resultado" className="w-6 h-6 rounded-full flex items-center justify-center text-stone-400 hover:bg-black/5">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {outcome.cancellationsWithoutInvoice > 0 && (
        <p className="pl-6 text-[12px] text-stone-500">
          {outcome.cancellationsWithoutInvoice} cancelamento(s) de nota ainda não importada: importe o XML da nota para registrá-la como cancelada.
        </p>
      )}
      {outcome.warnings.length > 0 && (
        <ul className="pl-6 space-y-0.5 text-[12px] text-amber-700">
          {outcome.warnings.map((w) => (
            <li key={`${w.file}-${w.message}`}>
              {w.file}: {w.message}
            </li>
          ))}
        </ul>
      )}
      {outcome.rejected.length > 0 && (
        <div className="pl-6 text-[12px]">
          <p className="font-medium text-rose-700">{outcome.rejected.length} arquivo(s) não importado(s):</p>
          <ul className="space-y-0.5 text-stone-600 dark:text-stone-300">
            {outcome.rejected.slice(0, 20).map((r) => (
              <li key={`${r.file}-${r.reason}`}>
                <span className="font-mono text-[11px]">{r.file}</span> — {r.reason}
              </li>
            ))}
            {outcome.rejected.length > 20 && <li>… e mais {outcome.rejected.length - 20}.</li>}
          </ul>
        </div>
      )}
    </section>
  );
}
