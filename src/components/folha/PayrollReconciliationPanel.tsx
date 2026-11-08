'use client';

import React, { useState } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  Clock,
  Sparkles,
} from 'lucide-react';
import type { BankTransaction } from '@/types/firestore';
import { nextMonthOf, type PayrollObligationMatch } from '@/lib/payroll';
import { formatMonth } from '@/lib/periods';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, SURFACE } from '@/components/ui/primitives';

interface PayrollReconciliationPanelProps {
  month: string;
  obligations: readonly PayrollObligationMatch[];
  onReconcile: (tx: BankTransaction, obligation: PayrollObligationMatch) => Promise<void>;
}

const REASON_BADGE: Record<'EXACT_AND_MEMO' | 'EXACT_AMOUNT' | 'MEMO_KEYWORD', { label: string; cls: string }> = {
  EXACT_AND_MEMO: {
    label: 'Valor exato + histórico',
    cls: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  },
  EXACT_AMOUNT: {
    label: 'Valor exato',
    cls: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  MEMO_KEYWORD: {
    label: 'Palavra-chave no extrato',
    cls: 'bg-stone-100 text-stone-700 border-stone-200',
  },
};

export function PayrollReconciliationPanel({
  month,
  obligations,
  onReconcile,
}: PayrollReconciliationPanelProps) {
  const [busyTxId, setBusyTxId] = useState<string | null>(null);
  const nextMonth = nextMonthOf(month);

  if (obligations.length === 0) return null;

  const totalProvisioned = obligations.reduce((s, o) => s + o.provisioned, 0);
  const totalPaid = obligations.reduce((s, o) => s + o.paid, 0);
  const totalRemaining = obligations.reduce((s, o) => s + o.remaining, 0);

  const handleClickReconcile = async (tx: BankTransaction, ob: PayrollObligationMatch) => {
    setBusyTxId(tx.id);
    try {
      await onReconcile(tx, ob);
    } finally {
      setBusyTxId(null);
    }
  };

  return (
    <section className={`${SURFACE} rounded-[22px] p-5 md:p-6 space-y-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200/70 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4 text-amber-700" />
            <h2 className="text-[15px] font-semibold text-stone-900">
              Cruzamento Automático com o Extrato Bancário ({formatMonth(month)} e {formatMonth(nextMonth)})
            </h2>
          </div>
          <p className="text-[12.5px] text-stone-500 mt-0.5">
            O sistema varre os débitos bancários da competência e do mês seguinte para identificar pagamentos de salários líquidos, pró-labore, FGTS, GPS/DCTFWeb e IRRF.
          </p>
        </div>
        <div className="flex items-center gap-4 text-[12px] font-mono tabular-nums">
          <span className="text-stone-600">
            Provisionado: <strong>{formatCurrency(totalProvisioned)}</strong>
          </span>
          <span className="text-emerald-700">
            Quitado: <strong>{formatCurrency(totalPaid)}</strong>
          </span>
          <span className={totalRemaining > 0 ? 'text-amber-700' : 'text-stone-500'}>
            Em aberto: <strong>{formatCurrency(totalRemaining)}</strong>
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {obligations.map((ob) => {
          const isSettled = ob.status === 'SETTLED';
          const isPartial = ob.status === 'PARTIAL';

          return (
            <div
              key={ob.key}
              className="rounded-2xl border border-stone-200/80 bg-white/80 p-4 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  {isSettled ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11.5px] text-stone-500">{ob.accountCode}</span>
                      <span className="text-[13.5px] font-semibold text-stone-900">{ob.label}</span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          isSettled
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : isPartial
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-stone-100 text-stone-600 border border-stone-200'
                        }`}
                      >
                        {isSettled ? 'Quitado no extrato' : isPartial ? 'Pago parcialmente' : 'Aguardando conciliação'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-[12.5px] font-mono tabular-nums">
                  <div>
                    <span className="text-stone-400 mr-1">Provisão:</span>
                    <strong className="text-stone-800">{formatCurrency(ob.provisioned)}</strong>
                  </div>
                  <div>
                    <span className="text-stone-400 mr-1">Pago:</span>
                    <strong className="text-emerald-700">{formatCurrency(ob.paid)}</strong>
                  </div>
                  <div>
                    <span className="text-stone-400 mr-1">Saldo:</span>
                    <strong className={ob.remaining > 0 ? 'text-amber-700' : 'text-stone-500'}>
                      {formatCurrency(ob.remaining)}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Pagamentos já conciliados nesta conta */}
              {ob.reconciledTransactions.length > 0 && (
                <div className="rounded-xl bg-emerald-50/50 border border-emerald-200/60 px-3.5 py-2.5 space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800">
                    Baixas já conciliadas na conta {ob.accountCode}
                  </p>
                  <div className="divide-y divide-emerald-200/40">
                    {ob.reconciledTransactions.map((tx) => (
                      <div key={tx.id} className="py-1 flex items-center justify-between gap-2 text-[12px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-stone-500 shrink-0">{formatDateBR(tx.date)}</span>
                          <span className="text-stone-800 truncate">{tx.memo}</span>
                        </div>
                        <span className="font-mono tabular-nums font-medium text-emerald-800 shrink-0">
                          {formatCurrency(Math.abs(tx.amount))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sugestões de débitos encontrados no extrato */}
              {ob.candidates.length > 0 && (
                <div className="rounded-xl bg-amber-50/50 border border-amber-200/70 px-3.5 py-2.5 space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-900">
                    <Sparkles className="w-3.5 h-3.5" />
                    Débitos correspondentes encontrados no extrato bancário ({ob.candidates.length})
                  </div>
                  <div className="divide-y divide-amber-200/50">
                    {ob.candidates.slice(0, 5).map(({ transaction: tx, matchReason }) => {
                      const badge = REASON_BADGE[matchReason];
                      const isBusy = busyTxId === tx.id;
                      return (
                        <div key={tx.id} className="py-2 flex flex-wrap items-center justify-between gap-3 text-[12.5px]">
                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <span className="font-mono text-stone-600 shrink-0">{formatDateBR(tx.date)}</span>
                            <span className="font-medium text-stone-900 truncate max-w-md">{tx.memo}</span>
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${badge.cls}`}>
                              {badge.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="font-mono tabular-nums font-semibold text-stone-900">
                              {formatCurrency(Math.abs(tx.amount))}
                            </span>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleClickReconcile(tx, ob)}
                              className={`${BUTTON.accent} h-7 px-2.5 text-[11.5px]`}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {isBusy ? 'Conciliando…' : `Conciliar em ${ob.accountCode}`}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

