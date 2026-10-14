'use client';

import React from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import type { ImportBatch } from '@/types/firestore';
import type { ContasData } from '@/hooks/contas/useContasData';
import { formatDateBR } from '@/lib/utils/formatters';
import { formatDateTime } from '@/components/conciliacao/AuditTimeline';
import { BalanceCheckBadge } from '@/components/conciliacao/StatementPanel';
import { EmptyState, SURFACE } from '@/components/ui/primitives';

/** Extratos importados, do mais recente ao mais antigo, com a conferência de saldo e a exclusão. */
export function ImportHistoryTable({ current, onDelete }: { current: ContasData | null; onDelete: (batch: ImportBatch) => void }) {
  return (
    <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
      <div className="px-5 py-4 border-b border-black/[0.04] dark:border-white/[0.06]">
        <h2 className="text-[15px] font-semibold tracking-tight">Histórico de importações</h2>
        <p className="text-[12px] text-stone-500">Excluir um extrato remove os lançamentos dele. Competências fechadas precisam ser reabertas antes.</p>
      </div>
      {!current ? null : current.batches.length === 0 ? (
        <EmptyState title="Nenhum extrato importado" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-stone-400 border-b border-black/[0.04]">
                <th className="font-medium pl-5 pr-3 py-2.5">Importado em</th>
                <th className="font-medium px-3 py-2.5">Arquivo</th>
                <th className="font-medium px-3 py-2.5">Conta</th>
                <th className="font-medium px-3 py-2.5">Período</th>
                <th className="font-medium px-3 py-2.5 text-right">Lançamentos</th>
                <th className="font-medium px-3 py-2.5">Saldo</th>
                <th className="pl-3 pr-5 py-2.5 w-14"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {[...current.batches]
                .sort((a, b) => b.importedAt.localeCompare(a.importedAt))
                .map((b) => (
                  <tr key={b.id} className="border-b border-black/[0.04] last:border-0 text-[13px]">
                    <td className="pl-5 pr-3 py-2.5 font-mono tabular-nums text-[12px] text-stone-500 whitespace-nowrap">{formatDateTime(b.importedAt)}</td>
                    <td className="px-3 py-2.5 max-w-[240px] truncate" title={b.fileName}>{b.fileName}</td>
                    <td className="px-3 py-2.5 text-[12px] text-stone-500">
                      {current.banks.find((x) => x.accountKey === b.accountKey)?.nickname ?? b.accountKey ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-[12px] text-stone-500 whitespace-nowrap">
                      {b.startDate ? `${formatDateBR(b.startDate)} – ${formatDateBR(b.endDate)}` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                      {b.importedCount}
                      {b.duplicateCount > 0 && <span className="text-stone-400"> · {b.duplicateCount} dup.</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {b.status === 'FAILED' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700 bg-rose-50 dark:bg-rose-950/30 px-2 py-0.5 rounded-full border border-rose-200/60" title="A importação foi interrompida com erro. Exclua o lote para remover os lançamentos parciais.">
                          <AlertTriangle className="w-3 h-3" /> Falha na importação
                        </span>
                      ) : b.status === 'PROCESSING' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 rounded-full border border-amber-200/60">
                          Importando…
                        </span>
                      ) : (
                        <BalanceCheckBadge check={b.balanceCheck} />
                      )}
                    </td>
                    <td className="pl-3 pr-5 py-2.5 text-right">
                      <button type="button" onClick={() => onDelete(b)} aria-label={`Excluir extrato ${b.fileName}`} className="w-8 h-8 rounded-full inline-flex items-center justify-center text-stone-400 hover:text-rose-600 hover:bg-rose-50 active:scale-[0.94] transition-all">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
