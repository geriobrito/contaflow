'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2, Scale } from 'lucide-react';
import type { ReconciliationRow } from '@/lib/fixed-assets';
import { formatMonth } from '@/lib/periods';
import { formatCurrency } from '@/lib/utils/formatters';
import { BUTTON, SURFACE } from '@/components/ui/primitives';
import { TABLE_HEAD, Th } from '@/components/ui/Table';

export interface LedgerReconciliationCardProps {
  description: string;
  divergenceNote: string;
  loading: boolean;
  error: string | null;
  result: { month: string; rows: readonly ReconciliationRow[] } | null;
  onCheck: () => void;
  children?: React.ReactNode;
}

/**
 * Painel sob demanda "Conferência com o balancete" compartilhado entre Imobilizado,
 * Seguros e despesas antecipadas e Empréstimos e financiamentos.
 */
export function LedgerReconciliationCard({
  description,
  divergenceNote,
  loading,
  error,
  result,
  onCheck,
  children,
}: LedgerReconciliationCardProps) {
  const diverging = result?.rows.filter((r) => Math.abs(r.difference) >= 0.005) ?? [];

  return (
    <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-black/4 dark:border-white/6">
        <Scale className="w-4 h-4 text-stone-400" />
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight">Conferência com o balancete</h2>
          <p className="text-[12px] text-stone-500">{description}</p>
        </div>
        <button type="button" disabled={loading} onClick={onCheck} className={`${BUTTON.secondary} h-8`}>
          {loading ? 'Conferindo…' : result ? 'Conferir de novo' : 'Conferir'}
        </button>
      </div>
      {error && <p className="px-5 py-3 text-[13px] text-rose-600 dark:text-rose-300">{error}</p>}
      {result && (
        <>
          <p className={`flex items-center gap-2 px-5 py-3 text-[13px] ${diverging.length ? 'text-amber-800 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-400'}`}>
            {diverging.length ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
            {diverging.length
              ? `${diverging.length} conta(s) com diferença em ${formatMonth(result.month)}: ${divergenceNote}`
              : `Cadastro e balancete conferem em ${formatMonth(result.month)}.`}
          </p>
          {result.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className={`${TABLE_HEAD} border-t`}>
                    <Th edge="start">Conta</Th>
                    <Th align="right">Cadastro</Th>
                    <Th align="right">Balancete</Th>
                    <Th align="right" edge="end">Diferença</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.accountId} className="border-b border-black/4 dark:border-white/6 last:border-0 text-[13px]">
                      <td className="pl-5 pr-3 py-2.5">
                        <span className="font-mono text-[12px] text-stone-500 dark:text-stone-400">{r.accountCode}</span> {r.accountName}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{formatCurrency(r.register)}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{formatCurrency(r.ledger)}</td>
                      <td className={`pl-3 pr-5 py-2.5 text-right font-mono tabular-nums ${Math.abs(r.difference) >= 0.005 ? 'text-rose-600 dark:text-rose-300' : 'text-stone-400'}`}>
                        {formatCurrency(r.difference)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {children}
        </>
      )}
    </section>
  );
}
