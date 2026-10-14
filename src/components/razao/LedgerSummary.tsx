'use client';

import React from 'react';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import type { DateRange } from '@/lib/data/repository';
import type { AccountLedger } from '@/lib/ledger';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { SURFACE } from '@/components/ui/primitives';

/** Identificação da conta e os quatro totais da ficha: saldo anterior, débitos, créditos e saldo atual. */
export function LedgerSummary({ ledger, range }: { ledger: AccountLedger; range: DateRange }) {
  return (
    <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
      <div className="p-5 border-b border-black/[0.05] dark:border-white/[0.06] flex flex-wrap items-center justify-between gap-3 bg-stone-50/50 dark:bg-stone-900/50">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[13px] font-semibold text-stone-800 dark:text-stone-200 bg-black/[0.04] dark:bg-white/[0.06] px-2 py-0.5 rounded">
              {ledger.code}
            </span>
            <span className="text-[11px] uppercase tracking-wider text-stone-400 bg-stone-100 dark:bg-stone-800 px-2 py-0.5 rounded">
              {ledger.kind === 'ASSET' ? 'Ativo' : ledger.kind === 'LIABILITY' ? 'Passivo' : ledger.kind === 'EQUITY' ? 'Patrimônio Líquido' : 'Resultado'}
            </span>
            {ledger.synthetic && (
              <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                Conta Sintética (Movimentação Agrupada)
              </span>
            )}
          </div>
          <h2 className="text-[20px] font-semibold text-stone-900 dark:text-stone-100">{ledger.name}</h2>
        </div>
        <div className="text-right text-[12px] text-stone-500 font-mono">
          {formatDateBR(range.start)} a {formatDateBR(range.end)}
        </div>
      </div>

      {/* 4 Cards de Resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-black/[0.05] dark:bg-white/[0.06]">
        <div className="bg-white dark:bg-stone-900 p-4">
          <span className="text-[11px] uppercase tracking-wider text-stone-400 font-medium">Saldo Anterior</span>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono tabular-nums text-[17px] font-semibold text-stone-900 dark:text-stone-100">
              {formatCurrency(ledger.openingBalance)}
            </span>
            <span
              className={`text-[12px] font-bold ${
                ledger.openingNature === 'D' ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {ledger.openingNature}
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-stone-900 p-4">
          <span className="text-[11px] uppercase tracking-wider text-stone-400 font-medium flex items-center gap-1">
            <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-600" /> Total Débitos
          </span>
          <div className="mt-1 font-mono tabular-nums text-[17px] font-semibold text-emerald-700 dark:text-emerald-400">
            {formatCurrency(ledger.totals.debits)}
          </div>
        </div>

        <div className="bg-white dark:bg-stone-900 p-4">
          <span className="text-[11px] uppercase tracking-wider text-stone-400 font-medium flex items-center gap-1">
            <ArrowUpRight className="w-3.5 h-3.5 text-rose-600" /> Total Créditos
          </span>
          <div className="mt-1 font-mono tabular-nums text-[17px] font-semibold text-rose-700 dark:text-rose-400">
            {formatCurrency(ledger.totals.credits)}
          </div>
        </div>

        <div className="bg-white dark:bg-stone-900 p-4">
          <span className="text-[11px] uppercase tracking-wider text-stone-400 font-medium">Saldo Atual</span>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono tabular-nums text-[17px] font-semibold text-stone-900 dark:text-stone-100">
              {formatCurrency(ledger.totals.closingBalance)}
            </span>
            <span
              className={`text-[12px] font-bold ${
                ledger.totals.closingNature === 'D' ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {ledger.totals.closingNature}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
