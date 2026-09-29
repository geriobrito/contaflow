'use client';

import React, { useMemo } from 'react';
import type { DREStatement } from '@/lib/dre/build';
import { compareRows, variation, type CompareRow } from '@/lib/dre/compare';
import { formatCurrency } from '@/lib/utils/formatters';

export type CompareMode = 'monthly' | 'yoy';

interface DRECompareTableProps {
  mode: CompareMode;
  /** Colunas na ordem de exibição. Em `yoy`: [atual, ano anterior]. */
  columns: readonly { label: string; statement: DREStatement }[];
  /** Coluna de total (mês a mês). */
  total?: { label: string; statement: DREStatement };
  withAccounts: boolean;
}

const amount = (v: number) => (Math.abs(v) < 0.005 ? '—' : v < 0 ? `(${formatCurrency(-v)})` : formatCurrency(v));

function Delta({ current, previous, favorable, small = false }: { current: number; previous: number; favorable: CompareRow['favorable']; small?: boolean }) {
  const pct = variation(current, previous);
  if (pct === null || Math.abs(current - previous) < 0.005) {
    // Sem base de comparação: na coluna mensal não polui a célula; no comparativo anual mostra traço.
    return small ? null : <span className="text-[12px] text-stone-400">—</span>;
  }
  const good = favorable === 'up' ? current > previous : current < previous;
  return (
    <span className={`${small ? 'text-[10px]' : 'text-[12px]'} font-mono tabular-nums ${good ? 'text-emerald-600' : 'text-rose-600'}`}>
      {pct > 0 ? '+' : ''}
      {pct.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%
    </span>
  );
}

/**
 * Tabela da DRE comparativa. Mês a mês: uma coluna por mês (com variação sobre o mês
 * anterior) e o total. Ano anterior: período atual, mesmo período do ano anterior,
 * variação em R$ e em %. Cores seguem o efeito no resultado (receita subir é bom,
 * despesa subir é ruim).
 */
export function DRECompareTable({ mode, columns, total, withAccounts }: DRECompareTableProps) {
  const statements = useMemo(() => [...columns.map((c) => c.statement), ...(total ? [total.statement] : [])], [columns, total]);
  const rows = useMemo(() => compareRows(statements, withAccounts), [statements, withAccounts]);
  const n = columns.length;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-stone-400 border-b border-black/[0.05] dark:border-white/[0.06]">
            <th className="font-medium pl-5 pr-3 py-2.5 min-w-[220px]">Demonstrativo</th>
            {columns.map((c) => (
              <th key={c.label} className="font-medium px-3 py-2.5 text-right whitespace-nowrap">{c.label}</th>
            ))}
            {mode === 'monthly' && total && <th className="font-medium pl-3 pr-5 py-2.5 text-right whitespace-nowrap">{total.label}</th>}
            {mode === 'yoy' && (
              <>
                <th className="font-medium px-3 py-2.5 text-right whitespace-nowrap">Variação R$</th>
                <th className="font-medium pl-3 pr-5 py-2.5 text-right whitespace-nowrap">Variação %</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const strong = r.kind !== 'account';
            const total_ = r.kind === 'total';
            return (
              <tr
                key={r.id}
                className={`border-b border-black/[0.03] dark:border-white/[0.04] last:border-0 text-[13px] ${
                  total_ ? 'bg-black/[0.025] dark:bg-white/[0.03] font-semibold text-stone-900 dark:text-stone-50' : strong ? 'font-medium text-stone-800 dark:text-stone-200' : 'text-stone-500'
                }`}
              >
                <td className={`pr-3 py-2 ${r.kind === 'account' ? 'pl-9' : 'pl-5'}`}>
                  {r.code && <span className="font-mono text-[11px] text-stone-400 mr-2">{r.code}</span>}
                  {r.label}
                </td>
                {r.values.slice(0, n).map((v, i) => (
                  <td key={i} className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap align-top">
                    {amount(v)}
                    {mode === 'monthly' && i > 0 && strong && (
                      <span className="block leading-tight">
                        <Delta current={v} previous={r.values[i - 1]} favorable={r.favorable} small />
                      </span>
                    )}
                  </td>
                ))}
                {mode === 'monthly' && total && (
                  <td className="pl-3 pr-5 py-2 text-right font-mono tabular-nums whitespace-nowrap align-top font-semibold">{amount(r.values[n])}</td>
                )}
                {mode === 'yoy' && (
                  <>
                    <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">{amount(r.values[0] - r.values[1])}</td>
                    <td className="pl-3 pr-5 py-2 text-right whitespace-nowrap">
                      <Delta current={r.values[0]} previous={r.values[1]} favorable={r.favorable} />
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
