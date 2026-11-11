import React from 'react';
import type { DMPL } from '@/lib/dmpl';
import { formatDateBR } from '@/lib/utils/formatters';
import { SURFACE } from '@/components/ui/primitives';
import { AccountingAmount } from '@/components/ui/Amount';

/** Quadro matricial da Demonstração das Mutações do Patrimônio Líquido (DMPL). */
export function DMPLStatement({ dmpl }: { dmpl: DMPL }) {
  return (
    <section className={`${SURFACE} rounded-[22px] overflow-hidden`} aria-label="Demonstração das mutações do patrimônio líquido">
      <div className="px-5 py-3.5 border-b border-black/4 dark:border-white/6">
        <h2 className="text-[14px] font-semibold tracking-tight">Mutações do patrimônio líquido</h2>
        <p className="text-[12px] text-stone-500">
          Exercício de {dmpl.year}, de {formatDateBR(dmpl.start)} a {formatDateBR(dmpl.end)}. Valores negativos (entre parênteses) reduzem o saldo do grupo.
        </p>
      </div>
      <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full text-[13px] print-fit-table">
          <thead>
            <tr className="text-[11px] uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400 border-b border-line bg-black/2 dark:bg-white/2">
              <th className="py-2.5 pl-5 pr-4 text-left font-medium min-w-[220px]">Descrição</th>
              {dmpl.columns.map((col) => (
                <th key={col.key} className="py-2.5 px-4 text-right font-medium min-w-[130px]">
                  <span className="block text-stone-700 dark:text-stone-200">{col.label}</span>
                  <span className="block font-mono tabular-nums text-[10px] text-stone-400 font-normal">{col.code}</span>
                </th>
              ))}
              <th className="py-2.5 pl-4 pr-5 text-right font-semibold text-stone-800 dark:text-stone-100 min-w-[130px] bg-black/2 dark:bg-white/3">
                Total do PL
              </th>
            </tr>
          </thead>
          <tbody>
            {dmpl.rows.map((r) => {
              const isBalance = r.kind === 'balance';
              return (
                <tr
                  key={r.label}
                  className={
                    isBalance
                      ? 'bg-stone-50/70 dark:bg-stone-800/30 font-semibold border-t border-line'
                      : 'border-t border-black/4 dark:border-white/5'
                  }
                >
                  <td className={`py-2.5 ${isBalance ? 'pl-5 pr-4' : 'pl-8 pr-4 text-stone-700 dark:text-stone-300'}`}>{r.label}</td>
                  {dmpl.columns.map((col) => {
                    const val = r.values[col.key] ?? 0;
                    const emptyMovement = !isBalance && Math.abs(val) < 0.005;
                    return (
                      <td
                        key={col.key}
                        className={`px-4 py-2.5 text-right font-mono tabular-nums whitespace-nowrap ${
                          val < 0 ? 'text-rose-700 dark:text-rose-400' : ''
                        }`}
                      >
                        {emptyMovement ? <span className="text-stone-300 dark:text-stone-600">—</span> : <AccountingAmount value={val} />}
                      </td>
                    );
                  })}
                  <td
                    className={`pl-4 pr-5 py-2.5 text-right font-mono tabular-nums whitespace-nowrap font-semibold bg-black/2 dark:bg-white/3 ${
                      r.total < 0 ? 'text-rose-700 dark:text-rose-400' : ''
                    }`}
                  >
                    <AccountingAmount value={r.total} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-5 py-3 border-t border-black/4 dark:border-white/6 text-[12px] text-stone-500">
        Cada coluna concilia o saldo inicial e final do respectivo subgrupo do Patrimônio Líquido (2.3) no Balanço Patrimonial. Transferências internas (constituição de reservas ou aumento de capital com reservas) permutam saldos entre colunas sem alterar o Total do PL.
      </p>
    </section>
  );
}

