'use client';

import React, { useMemo, useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import type { DateRange } from '@/lib/data/repository';
import type { AccountLedger } from '@/lib/ledger';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { SURFACE } from '@/components/ui/primitives';

/** Partidas da ficha do Razão, com saldo progressivo e busca por histórico, documento ou contrapartida. */
export function LedgerEntriesTable({ ledger, range }: { ledger: AccountLedger; range: DateRange }) {
  const [tableSearch, setTableSearch] = useState('');
  const visibleEntries = useMemo(() => {
    if (!tableSearch.trim()) return ledger.entries;
    const term = tableSearch.toLowerCase();
    return ledger.entries.filter(
      (e) =>
        e.memo.toLowerCase().includes(term) ||
        (e.documentId && e.documentId.toLowerCase().includes(term)) ||
        (e.contraAccountCode && e.contraAccountCode.toLowerCase().includes(term)) ||
        (e.contraAccountName && e.contraAccountName.toLowerCase().includes(term))
    );
  }, [ledger, tableSearch]);

  return (
    <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
      <div className="p-3 bg-stone-50/50 dark:bg-stone-900/50 border-b border-black/[0.04] dark:border-white/[0.06] flex items-center justify-between gap-3 print:hidden">
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Filtrar por histórico, documento ou contrapartida..."
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-[12px] bg-white dark:bg-stone-800 border border-black/[0.08] dark:border-white/[0.1] rounded-lg focus:outline-none focus:ring-1 focus:ring-stone-400 placeholder:text-stone-400"
          />
        </div>
        <span className="text-[11px] text-stone-400 tabular-nums font-mono whitespace-nowrap">
          {visibleEntries.length} {visibleEntries.length === 1 ? 'partida' : 'partidas'} no período
        </span>
      </div>

      <div className="overflow-x-auto print:overflow-visible">
        {ledger.entries.length === 0 ? (
          <div className="py-20 text-center text-stone-400 space-y-2">
            <BookOpen className="w-8 h-8 mx-auto opacity-30" />
            <p className="text-[13px] font-medium">Sem movimentação no período</p>
            <p className="text-[12px]">Esta conta não teve débitos nem créditos entre as datas selecionadas.</p>
          </div>
        ) : visibleEntries.length === 0 ? (
          <div className="py-16 text-center text-stone-400 text-[13px]">
            Nenhum lançamento corresponde ao filtro de busca.
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-[12px] print-fit-table">
            <thead>
              <tr className="bg-stone-100/70 dark:bg-stone-800/80 text-stone-500 uppercase tracking-wider text-[10px] font-semibold border-b border-black/[0.05] dark:border-white/[0.06]">
                <th className="pl-5 pr-3 py-2.5 w-24">Data</th>
                <th className="px-3 py-2.5 w-28">Doc / FITID</th>
                <th className="px-3 py-2.5">Histórico</th>
                <th className="px-3 py-2.5 w-48">Contrapartida</th>
                <th className="px-3 py-2.5 text-right w-28">Débito</th>
                <th className="px-3 py-2.5 text-right w-28">Crédito</th>
                <th className="pl-3 pr-5 py-2.5 text-right w-36">Saldo Atual</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.03] dark:divide-white/[0.03]">
              {/* Linha inicial: Saldo Anterior Transportado */}
              <tr className="bg-stone-50/60 dark:bg-stone-800/40 text-stone-500 italic font-medium">
                <td className="pl-5 pr-3 py-2 font-mono text-[11px]">{formatDateBR(range.start)}</td>
                <td className="px-3 py-2 font-mono text-[11px]">—</td>
                <td className="px-3 py-2" colSpan={2}>
                  SALDO ANTERIOR TRANSPORTADO
                </td>
                <td className="px-3 py-2 text-right font-mono">—</td>
                <td className="px-3 py-2 text-right font-mono">—</td>
                <td className="pl-3 pr-5 py-2 text-right font-mono font-semibold tabular-nums text-stone-700 dark:text-stone-300">
                  {formatCurrency(ledger.openingBalance)}{' '}
                  <span
                    className={`text-[10px] font-bold ${
                      ledger.openingNature === 'D' ? 'text-blue-600' : 'text-amber-600'
                    }`}
                  >
                    {ledger.openingNature}
                  </span>
                </td>
              </tr>

              {/* Linhas de movimentação cronológica */}
              {visibleEntries.map((e) => (
                <tr key={e.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                  <td className="pl-5 pr-3 py-2 font-mono tabular-nums text-stone-600 dark:text-stone-400 whitespace-nowrap">
                    {formatDateBR(e.date)}
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums text-[11px] text-stone-400 truncate max-w-[120px]" title={e.documentId}>
                    {e.documentId || '—'}
                  </td>
                  <td className="px-3 py-2 text-stone-800 dark:text-stone-200 font-medium">
                    <div className="max-w-md truncate" title={e.memo}>
                      {e.memo}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-stone-600 dark:text-stone-400">
                    <div className="truncate max-w-[200px]" title={`${e.contraAccountCode ? `${e.contraAccountCode} - ` : ''}${e.contraAccountName || ''}`}>
                      {e.contraAccountCode && (
                        <span className="font-mono text-[10px] bg-stone-100 dark:bg-stone-800 px-1 py-0.5 rounded mr-1 text-stone-500">
                          {e.contraAccountCode}
                        </span>
                      )}
                      <span className="text-[11px]">{e.contraAccountName || '—'}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                    {e.debit > 0 ? formatCurrency(e.debit) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums font-medium text-rose-700 dark:text-rose-400 whitespace-nowrap">
                    {e.credit > 0 ? formatCurrency(e.credit) : '—'}
                  </td>
                  <td className="pl-3 pr-5 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                    <span className="font-semibold text-stone-900 dark:text-stone-100">
                      {formatCurrency(e.balance)}
                    </span>{' '}
                    <span
                      className={`text-[10px] font-bold ${
                        e.balanceNature === 'D' ? 'text-blue-600' : 'text-amber-600'
                      }`}
                    >
                      {e.balanceNature}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-black/[0.08] dark:border-white/[0.08] font-semibold text-stone-900 dark:text-stone-100 bg-stone-50 dark:bg-stone-800/95">
              <tr>
                <td className="pl-5 pr-3 py-2.5" colSpan={4}>
                  Totais do período ({visibleEntries.length} partidas)
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                  {formatCurrency(ledger.totals.debits)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-rose-700 dark:text-rose-400">
                  {formatCurrency(ledger.totals.credits)}
                </td>
                <td className="pl-3 pr-5 py-2.5 text-right font-mono tabular-nums">
                  {formatCurrency(ledger.totals.closingBalance)}{' '}
                  <span
                    className={`text-[10px] font-bold ${
                      ledger.totals.closingNature === 'D' ? 'text-blue-600' : 'text-amber-600'
                    }`}
                  >
                    {ledger.totals.closingNature}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </section>
  );
}
