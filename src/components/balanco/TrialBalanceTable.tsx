'use client';

import { TABLE_HEAD, Th } from '@/components/ui/Table';
import React from 'react';
import { BookOpen } from 'lucide-react';
import type { TrialBalance } from '@/lib/ledger';
import { formatCurrency } from '@/lib/utils/formatters';
import { formatDC as dc } from '@/lib/balance-sheet-view';
import { SURFACE } from '@/components/ui/primitives';

interface TrialBalanceTableProps {
  tb: TrialBalance;
  tbStage?: string;
  showSynthetic: boolean;
  onShowSyntheticChange: (show: boolean) => void;
  ignoreClosing: boolean;
  onIgnoreClosingChange: (ignore: boolean) => void;
  closingInRange: boolean;
  onSelectAccount: (accountId: string) => void;
}

/** Tabela do Balancete de Verificação, com alternância de sintéticas e opção de ignorar ARE. */
export function TrialBalanceTable({
  tb,
  tbStage,
  showSynthetic,
  onShowSyntheticChange,
  ignoreClosing,
  onIgnoreClosingChange,
  closingInRange,
  onSelectAccount,
}: TrialBalanceTableProps) {
  const rows = showSynthetic ? tb.rows : tb.rows.filter((r) => !r.synthetic);

  return (
    <section className={`${SURFACE} rounded-[22px] overflow-hidden print:rounded-none print:border-0 print:shadow-none print:bg-transparent print:p-0`}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 border-b border-black/4 print:hidden">
        <span className="text-[12px] text-stone-500 dark:text-stone-400 flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5 text-stone-400" />
          Clique em qualquer conta para abrir a ficha do Livro Razão
        </span>
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
          <label className="flex items-center gap-2 text-[12px] text-stone-500">
            <input type="checkbox" checked={showSynthetic} onChange={(e) => onShowSyntheticChange(e.target.checked)} /> Mostrar contas sintéticas
          </label>
          <label
            className="flex items-center gap-2 text-[12px] text-stone-500"
            title="Desmarcado, o balancete sai depois do encerramento: contas de resultado zeradas contra a ARE"
          >
            <input type="checkbox" checked={ignoreClosing} onChange={(e) => onIgnoreClosingChange(e.target.checked)} /> Ignorar lançamentos de encerramento (ARE)
            {!closingInRange && <span className="text-stone-400">(nenhum no período)</span>}
          </label>
        </div>
      </div>
      {tbStage && (
        <p className="px-5 py-2 border-b border-black/4 text-[12px] text-stone-600 dark:text-stone-300 print:px-1.5 print:text-[9px]">
          Balancete {tbStage.toLowerCase()}.
        </p>
      )}
      <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full text-left print-fit-table">
          <thead>
            <tr className={`${TABLE_HEAD} print:text-[9.5px] print:text-stone-700 print:bg-transparent print:border-b-2 print:border-black/40`}>
              <Th edge="start" className="w-32 print:w-[15%] print:pl-1.5 print:pr-1 print:py-1.5">Código</Th>
              <Th className="print:w-[33%] print:px-1.5 print:py-1.5">Conta</Th>
              <Th align="right" className="print:w-[13%] print:px-1 print:py-1.5">Saldo anterior</Th>
              <Th align="right" className="print:w-[13%] print:px-1 print:py-1.5">Débitos</Th>
              <Th align="right" className="print:w-[13%] print:px-1 print:py-1.5">Créditos</Th>
              <Th align="right" edge="end" className="print:w-[13%] print:pl-1 print:pr-1.5 print:py-1.5">Saldo atual</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.accountId}
                onClick={() => onSelectAccount(r.accountId)}
                className={`border-b border-black/3 print:border-black/6 last:border-0 text-[13px] print:text-[9.5px] print:leading-tight print:break-inside-avoid cursor-pointer hover:bg-black/3 dark:hover:bg-white/4 transition-colors group ${
                  r.synthetic
                    ? 'font-medium text-stone-900 dark:text-stone-100 print:font-semibold print:text-black'
                    : 'text-stone-600 dark:text-stone-400 print:text-stone-800'
                }`}
                title="Clique para abrir o Livro Razão desta conta"
              >
                <td className="pl-5 pr-3 py-1.5 print:pl-1.5 print:pr-1 print:py-1 font-mono tabular-nums text-[12px] print:text-[9px] text-stone-500 dark:text-stone-400 group-hover:text-stone-700 dark:group-hover:text-stone-200 print:text-stone-600 whitespace-nowrap">
                  {r.code}
                </td>
                <td className="px-3 py-1.5 print:px-1.5 print:py-1 leading-snug">
                  <span className="inline-block" style={{ paddingLeft: `${Math.max(0, r.level - 1) * 7}px` }}>
                    {r.name}
                  </span>
                </td>
                <td className="px-3 py-1.5 print:px-1 print:py-1 text-right font-mono tabular-nums text-[13px] print:text-[9.5px] whitespace-nowrap">
                  {dc(r.previous)}
                </td>
                <td className="px-3 py-1.5 print:px-1 print:py-1 text-right font-mono tabular-nums text-[13px] print:text-[9.5px] whitespace-nowrap">
                  {r.debits ? formatCurrency(r.debits) : '—'}
                </td>
                <td className="px-3 py-1.5 print:px-1 print:py-1 text-right font-mono tabular-nums text-[13px] print:text-[9.5px] whitespace-nowrap">
                  {r.credits ? formatCurrency(r.credits) : '—'}
                </td>
                <td className="pl-3 pr-5 py-1.5 print:pl-1 print:pr-1.5 print:py-1 text-right font-mono tabular-nums text-[13px] print:text-[9.5px] whitespace-nowrap">
                  {dc(r.final)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-black/8 print:border-t-2 print:border-b-2 print:border-black text-[13px] print:text-[10px] font-semibold print:break-inside-avoid">
              <td className="pl-5 pr-3 py-2.5 print:pl-1.5 print:pr-1 print:py-1.5" />
              <td className="px-3 py-2.5 print:px-1.5 print:py-1.5">Totais (contas analíticas)</td>
              <td className="px-3 py-2.5 print:px-1 print:py-1.5 text-right font-mono tabular-nums">{dc(tb.totals.previous)}</td>
              <td className="px-3 py-2.5 print:px-1 print:py-1.5 text-right font-mono tabular-nums">{formatCurrency(tb.totals.debits)}</td>
              <td className="px-3 py-2.5 print:px-1 print:py-1.5 text-right font-mono tabular-nums">{formatCurrency(tb.totals.credits)}</td>
              <td className="pl-3 pr-5 py-2.5 print:pl-1 print:pr-1.5 print:py-1.5 text-right font-mono tabular-nums">{dc(tb.totals.final)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
