'use client';

import React, { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Copy, Edit2, ExternalLink, Loader2, Trash2 } from 'lucide-react';
import type { ChartAccount, JournalEntry } from '@/types/firestore';
import { parseAttachmentUrl } from '@/lib/journal';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { SURFACE } from '@/components/ui/primitives';
import { CATEGORY_CONFIG } from '@/components/lancamentos/categories';

interface JournalEntriesTableProps {
  entries: readonly JournalEntry[];
  accountMap: ReadonlyMap<string, ChartAccount>;
  /** Competência selecionada fechada: editar, duplicar e excluir ficam desabilitados. */
  monthLocked: boolean;
  /** Lançamento sendo excluído agora. */
  deletingId: string | null;
  onEdit: (entry: JournalEntry) => void;
  onDuplicate: (entry: JournalEntry) => void;
  onDelete: (entry: JournalEntry) => void;
}

/** Lançamentos manuais do período; cada linha expande para mostrar as partidas e o comprovante. */
export function JournalEntriesTable({ entries, accountMap, monthLocked, deletingId, onEdit, onDuplicate, onDelete }: JournalEntriesTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <div className={`${SURFACE} rounded-2xl overflow-hidden border border-black/[0.08] dark:border-white/[0.1]`}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px] border-collapse">
          <thead>
            <tr className="border-b border-black/[0.06] dark:border-white/[0.08] bg-stone-100/60 dark:bg-stone-800/60 text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
              <th className="py-3 px-4 w-12 text-center"></th>
              <th className="py-3 px-4 w-28">Data</th>
              <th className="py-3 px-4 w-44">Categoria</th>
              <th className="py-3 px-4">Histórico Contábil</th>
              <th className="py-3 px-4 w-36">Documento</th>
              <th className="py-3 px-4 w-36 text-right">Valor Total</th>
              <th className="py-3 px-4 w-36 text-center">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
            {entries.map((entry) => {
              const isExpanded = expandedId === entry.id;
              const catCfg = CATEGORY_CONFIG[entry.category] ?? CATEGORY_CONFIG.OTHER;
              // Só links http/https viram link clicável (dados antigos podem ter qualquer texto).
              const attachment = entry.attachmentUrl ? parseAttachmentUrl(entry.attachmentUrl) : null;
              const entryTotal = entry.totalAmount || entry.lines
                .filter((l) => l.type === 'DEBIT')
                .reduce((sum, l) => sum + (Number(l.amount) || 0), 0);

              return (
                <React.Fragment key={entry.id}>
                  <tr className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                        aria-label={isExpanded ? 'Recolher partidas' : 'Expandir partidas'}
                        className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-stone-400 hover:text-stone-700 hover:bg-black/[0.05] transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>
                    </td>

                    <td className="py-3 px-4 font-mono text-stone-700 dark:text-stone-300">
                      {formatDateBR(entry.date)}
                    </td>

                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium ${catCfg.badge}`}
                      >
                        {catCfg.label}
                      </span>
                    </td>

                    <td className="py-3 px-4 font-medium text-stone-900 dark:text-stone-100">
                      {entry.memo}
                      <span className="text-[11px] text-stone-400 font-normal ml-2">
                        ({entry.lines.length} partidas)
                      </span>
                    </td>

                    <td className="py-3 px-4 font-mono text-stone-500 text-[12px]">
                      {entry.documentRef || '—'}
                    </td>

                    <td className="py-3 px-4 font-mono text-right font-semibold text-stone-900 dark:text-stone-100">
                      {formatCurrency(entryTotal)}
                    </td>

                    <td className="py-3 px-4 text-center">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onEdit(entry)}
                          disabled={monthLocked}
                          title={monthLocked ? 'Mês bloqueado' : 'Editar lançamento'}
                          className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-stone-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => onDuplicate(entry)}
                          disabled={monthLocked}
                          title={monthLocked ? 'Mês bloqueado' : 'Duplicar lançamento'}
                          className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-stone-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => onDelete(entry)}
                          disabled={monthLocked || deletingId === entry.id}
                          title={monthLocked ? 'Mês bloqueado' : 'Excluir lançamento'}
                          className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-stone-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                        >
                          {deletingId === entry.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Partidas Expandidas */}
                  {isExpanded && (
                    <tr className="bg-stone-50/70 dark:bg-stone-950/40">
                      <td colSpan={7} className="p-4 pl-14">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between text-[12px] font-semibold text-stone-600 dark:text-stone-300">
                            <span>Detalhamento das Partidas Dobradas:</span>
                            {attachment &&
                              ('url' in attachment ? (
                                <a
                                  href={attachment.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={attachment.url}
                                  className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                                >
                                  <ExternalLink className="w-3 h-3" /> Ver comprovante ({attachment.host})
                                </a>
                              ) : (
                                <span className="inline-flex items-center gap-1 font-normal text-amber-700 dark:text-amber-400" title={entry.attachmentUrl}>
                                  <AlertCircle className="w-3 h-3" /> Comprovante com link inválido: edite o lançamento
                                </span>
                              ))}
                          </div>

                          <div className="border border-black/[0.06] dark:border-white/[0.08] rounded-xl overflow-hidden bg-white dark:bg-stone-900">
                            <table className="w-full text-left text-[12px]">
                              <thead>
                                <tr className="border-b border-black/[0.04] bg-stone-100/50 dark:bg-stone-800/50 text-[11px] font-medium text-stone-500 uppercase">
                                  <th className="py-2 px-3 w-16 text-center">Tipo</th>
                                  <th className="py-2 px-3 w-36">Código</th>
                                  <th className="py-2 px-3">Conta Contábil</th>
                                  <th className="py-2 px-3">Memo / Histórico Complementar</th>
                                  <th className="py-2 px-3 w-36 text-right">Valor</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-black/[0.03] dark:divide-white/[0.04]">
                                {entry.lines.map((l) => {
                                  const acc = accountMap.get(l.accountId);
                                  return (
                                    <tr key={l.id}>
                                      <td className="py-2 px-3 text-center">
                                        <span
                                          className={`inline-block w-6 py-0.5 rounded text-center font-mono font-bold text-[10px] ${
                                            l.type === 'DEBIT'
                                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                                              : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                          }`}
                                        >
                                          {l.type === 'DEBIT' ? 'D' : 'C'}
                                        </span>
                                      </td>
                                      <td className="py-2 px-3 font-mono text-stone-500">
                                        {acc?.code || '—'}
                                      </td>
                                      <td className="py-2 px-3 font-medium text-stone-800 dark:text-stone-200">
                                        {acc?.name || 'Conta não localizada'}
                                      </td>
                                      <td className="py-2 px-3 text-stone-500">
                                        {l.memo || entry.memo}
                                      </td>
                                      <td
                                        className={`py-2 px-3 font-mono text-right font-medium ${
                                          l.type === 'DEBIT'
                                            ? 'text-blue-600 dark:text-blue-400'
                                            : 'text-amber-600 dark:text-amber-400'
                                        }`}
                                      >
                                        {formatCurrency(l.amount)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
