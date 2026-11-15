'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, ArrowUpRight, CheckCircle2, Clock, Landmark, Sparkles } from 'lucide-react';
import type { BankTransaction } from '@/types/firestore';
import { nextMonthOf, type PayrollCandidateTransaction, type PayrollObligationMatch } from '@/lib/payroll';
import { formatMonth } from '@/lib/periods';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, OVERLINE, SURFACE } from '@/components/ui/primitives';

interface PayrollReconciliationPanelProps {
  month: string;
  obligations: readonly PayrollObligationMatch[];
  onReconcile: (tx: BankTransaction, obligation: PayrollObligationMatch) => Promise<void>;
}

const REASON: Record<PayrollCandidateTransaction['matchReason'], { label: string; cls: string }> = {
  EXACT_AND_MEMO: { label: 'valor e histórico conferem', cls: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400' },
  EXACT_AMOUNT: { label: 'valor confere', cls: 'bg-amber-500/14 text-amber-700 dark:text-amber-400' },
  MEMO_KEYWORD: { label: 'histórico parecido', cls: 'bg-stone-900/6 dark:bg-white/8 text-stone-600 dark:text-stone-300' },
};

/** Sugestões mostradas de início em cada obrigação; o resto abre sob pedido. */
const VISIBLE_CANDIDATES = 3;

function statusOf(ob: PayrollObligationMatch): { icon: typeof Clock; tone: string; label: string; chip: string } {
  if (ob.status === 'SETTLED') {
    return { icon: CheckCircle2, tone: 'text-emerald-600 dark:text-emerald-400', label: 'Quitado', chip: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400' };
  }
  if (ob.overdue) {
    return { icon: AlertTriangle, tone: 'text-rose-600 dark:text-rose-400', label: 'Vencido', chip: 'bg-rose-500/12 text-rose-600 dark:text-rose-400' };
  }
  return {
    icon: Clock,
    tone: 'text-amber-600 dark:text-amber-400',
    label: ob.status === 'PARTIAL' ? 'Pago em parte' : 'Em aberto',
    chip: 'bg-amber-500/14 text-amber-700 dark:text-amber-400',
  };
}

function Obligation({ ob, busyTxId, onReconcile }: { ob: PayrollObligationMatch; busyTxId: string | null; onReconcile: (tx: BankTransaction, ob: PayrollObligationMatch) => void }) {
  const [showAll, setShowAll] = useState(false);
  const status = statusOf(ob);
  const Icon = status.icon;
  const progress = ob.provisioned > 0 ? Math.min(100, (ob.paid / ob.provisioned) * 100) : 0;
  const candidates = showAll ? ob.candidates : ob.candidates.slice(0, VISIBLE_CANDIDATES);

  return (
    <li className="px-5 md:px-6 py-4 space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Icon className={`w-[18px] h-[18px] shrink-0 ${status.tone}`} strokeWidth={1.9} />
        <div className="flex-1 min-w-[220px]">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[14px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">{ob.label}</span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${status.chip}`}>{status.label}</span>
          </p>
          <p className="mt-0.5 text-[12px] text-stone-500 dark:text-stone-400">
            <span className="font-mono">{ob.accountCode}</span> {ob.accountName}
            {' · '}
            {ob.dueDate ? (
              <span className={ob.overdue ? 'font-medium text-rose-600 dark:text-rose-400' : ''}>
                {ob.overdue ? 'venceu' : ob.status === 'SETTLED' ? 'vencimento' : 'vence'} em {formatDateBR(ob.dueDate)}
              </span>
            ) : (
              'sem prazo em lei'
            )}
          </p>
        </div>

        <div className="w-full sm:w-[300px] space-y-1.5">
          <div className="flex items-baseline justify-between gap-3 font-mono tabular-nums text-[12.5px]">
            <span className="text-stone-600 dark:text-stone-300">
              {formatCurrency(ob.paid)} <span className="font-sans text-stone-400">de</span> {formatCurrency(ob.provisioned)}
            </span>
            <span className={ob.remaining > 0 ? `font-semibold ${ob.overdue ? 'text-rose-600 dark:text-rose-400' : 'text-amber-700 dark:text-amber-400'}` : 'text-stone-400'}>
              {ob.remaining > 0 ? `falta ${formatCurrency(ob.remaining)}` : 'pago'}
            </span>
          </div>
          <div className="h-1 rounded-full bg-stone-900/6 dark:bg-white/8 overflow-hidden" role="presentation">
            <div className={`h-full rounded-full transition-[width] duration-500 ease-out ${ob.status === 'SETTLED' ? 'bg-emerald-500' : 'bg-accent'}`} style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      {/* Saldo de competências anteriores: os pagamentos baixam primeiro o mais antigo */}
      {ob.priorRemaining > 0 && (
        <p className="ml-[34px] flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-50/70 dark:bg-amber-500/10 border border-amber-200/70 dark:border-amber-500/25 text-[12.5px] text-amber-900 dark:text-amber-200">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            A conta ainda deve <strong className="font-mono tabular-nums font-semibold">{formatCurrency(ob.priorRemaining)}</strong> de competências anteriores. O próximo pagamento classificado nela quita primeiro esse saldo.
          </span>
        </p>
      )}
      {ob.priorRemaining === 0 && ob.priorTransactions.length > 0 && (
        <p className="ml-[34px] text-[12px] text-stone-500 dark:text-stone-400">
          {ob.priorTransactions.length === 1 ? 'Um pagamento da janela quitou' : `${ob.priorTransactions.length} pagamentos da janela quitaram`} o saldo de competências anteriores ({formatCurrency(ob.priorBalance)}) e não {ob.priorTransactions.length === 1 ? 'conta' : 'contam'} para esta.
        </p>
      )}

      {ob.reconciledTransactions.length > 0 && (
        <ul className="ml-[34px] rounded-xl border border-line divide-y divide-line overflow-hidden">
          {ob.reconciledTransactions.map((tx) => (
            <li key={tx.id} className="flex items-center gap-3 px-3 py-1.5 text-[12.5px]">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="font-mono tabular-nums text-[12px] text-stone-500 dark:text-stone-400 shrink-0">{formatDateBR(tx.date)}</span>
              <span className="flex-1 min-w-0 truncate text-stone-800 dark:text-stone-100">{tx.memo}</span>
              <span className="font-mono tabular-nums font-medium text-stone-800 dark:text-stone-100 shrink-0">{formatCurrency(Math.abs(tx.amount))}</span>
            </li>
          ))}
        </ul>
      )}

      {ob.candidates.length > 0 && (
        <div className="ml-[34px] space-y-1.5">
          <p className={`${OVERLINE} flex items-center gap-1.5`}>
            <Sparkles className="w-3 h-3 text-accent-ink" />
            {ob.candidates.length === 1 ? 'Débito do extrato que parece ser este pagamento' : `${ob.candidates.length} débitos do extrato que parecem ser este pagamento`}
          </p>
          <ul className="rounded-xl border border-line bg-surface-2 divide-y divide-line overflow-hidden">
            {candidates.map(({ transaction: tx, matchReason }) => {
              const reason = REASON[matchReason];
              const busy = busyTxId === tx.id;
              return (
                <li key={tx.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-[12.5px]">
                  <span className="font-mono tabular-nums text-[12px] text-stone-500 dark:text-stone-400 shrink-0">{formatDateBR(tx.date)}</span>
                  <span className="flex-1 min-w-[160px] truncate font-medium text-stone-900 dark:text-stone-100" title={tx.memo}>
                    {tx.memo}
                  </span>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium ${reason.cls}`}>{reason.label}</span>
                  <span className="w-[104px] text-right font-mono tabular-nums font-semibold text-stone-900 dark:text-stone-100 shrink-0">{formatCurrency(Math.abs(tx.amount))}</span>
                  <button
                    type="button"
                    disabled={busyTxId !== null}
                    onClick={() => onReconcile(tx, ob)}
                    title={`Classificar este débito em ${ob.accountCode} ${ob.accountName}`}
                    className={`${BUTTON.secondary} h-8 px-3 text-[12px]`}
                  >
                    {busy ? 'Conciliando…' : 'Conciliar'}
                    {!busy && <ArrowRight className="w-3.5 h-3.5" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {ob.candidates.length > VISIBLE_CANDIDATES && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="text-[12px] font-medium text-accent-ink hover:underline underline-offset-4">
              {showAll ? 'Mostrar menos' : `Ver os outros ${ob.candidates.length - VISIBLE_CANDIDATES}`}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Pagamentos da folha no extrato: cada obrigação gerada pela provisão (líquidos, INSS, FGTS,
 * IRRF) com o vencimento, o que já foi pago e os débitos do extrato que parecem ser o pagamento.
 */
export function PayrollReconciliationPanel({ month, obligations, onReconcile }: PayrollReconciliationPanelProps) {
  const [busyTxId, setBusyTxId] = useState<string | null>(null);
  const nextMonth = nextMonthOf(month);

  if (obligations.length === 0) return null;

  const totalProvisioned = obligations.reduce((s, o) => s + o.provisioned, 0);
  const totalPaid = obligations.reduce((s, o) => s + o.paid, 0);
  const totalRemaining = obligations.reduce((s, o) => s + o.remaining, 0);

  const reconcile = async (tx: BankTransaction, ob: PayrollObligationMatch) => {
    setBusyTxId(tx.id);
    try {
      await onReconcile(tx, ob);
    } finally {
      setBusyTxId(null);
    }
  };

  return (
    <section className={`${SURFACE} rounded-[22px] overflow-hidden`} aria-label="Pagamentos no extrato">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 md:px-6 py-4 border-b border-line">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
            <Landmark className="w-4 h-4 text-stone-400" strokeWidth={1.9} />
            Pagamentos no extrato
          </h2>
          <p className="mt-0.5 text-[12.5px] text-stone-500 dark:text-stone-400">
            Débitos de {formatMonth(month)} e {formatMonth(nextMonth)} classificados nas contas a pagar da folha. Cada pagamento quita primeiro o saldo mais antigo da conta.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <dl className="flex items-center gap-5 font-mono tabular-nums text-[12.5px]">
            {[
              ['Provisionado', totalProvisioned, 'text-stone-800 dark:text-stone-100'],
              ['Pago', totalPaid, 'text-emerald-700 dark:text-emerald-400'],
              ['Em aberto', totalRemaining, totalRemaining > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-stone-400'],
            ].map(([label, value, cls]) => (
              <div key={label as string}>
                <dt className="font-sans text-[10.5px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">{label}</dt>
                <dd className={`font-semibold ${cls}`}>{formatCurrency(value as number)}</dd>
              </div>
            ))}
          </dl>
          <Link href={`/?mes=${nextMonth}`} className={BUTTON.secondary} title={`Abrir o extrato de ${formatMonth(nextMonth)} na Conciliação`}>
            Conciliação de {formatMonth(nextMonth).split(' de ')[0]}
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      <ul className="divide-y divide-line">
        {obligations.map((ob) => (
          <Obligation key={ob.key} ob={ob} busyTxId={busyTxId} onReconcile={(tx, o) => void reconcile(tx, o)} />
        ))}
      </ul>
    </section>
  );
}
