import React from 'react';
import type { DLPA } from '@/lib/year-closing';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { SURFACE } from '@/components/ui/primitives';

const money = (v: number) => (v < 0 ? `(${formatCurrency(-v)})` : formatCurrency(v));

/** Quadro da Demonstração de Lucros ou Prejuízos Acumulados. */
export function DLPAStatement({ dlpa }: { dlpa: DLPA }) {
  return (
    <section className={`${SURFACE} rounded-[22px] overflow-hidden`} aria-label="Demonstração de lucros ou prejuízos acumulados">
      <div className="px-5 py-3.5 border-b border-black/[0.04] dark:border-white/[0.06]">
        <h2 className="text-[14px] font-semibold tracking-tight">Lucros ou prejuízos acumulados</h2>
        <p className="text-[12px] text-stone-500">
          Exercício de {dlpa.year}, de {formatDateBR(dlpa.start)} a {formatDateBR(dlpa.end)}. Valores negativos (entre parênteses) reduzem o saldo.
        </p>
      </div>
      <table className="w-full text-[13px]">
        <tbody>
          {dlpa.rows.map((r) => (
            <tr
              key={r.label}
              className={r.kind === 'balance' ? 'bg-stone-50/70 dark:bg-stone-800/30 font-semibold' : 'border-t border-black/[0.04] dark:border-white/[0.05]'}
            >
              <td className={`py-2.5 ${r.kind === 'balance' ? 'px-5' : 'pl-8 pr-5 text-stone-700 dark:text-stone-300'}`}>{r.label}</td>
              <td className={`px-5 py-2.5 text-right font-mono tabular-nums whitespace-nowrap ${r.value < 0 ? 'text-rose-700 dark:text-rose-400' : ''}`}>{money(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-5 py-3 border-t border-black/[0.04] dark:border-white/[0.06] text-[12px] text-stone-500">
        Lucros distribuídos são os lançamentos em 2.3.3.03 (-) Lucros Distribuídos: classifique a retirada no extrato ou lance-a em Lançamentos manuais.
      </p>
    </section>
  );
}
