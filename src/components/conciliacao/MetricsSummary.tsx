import type { ReconciliationMetrics } from '@/hooks/useReconciliation';
import { formatCurrency } from '@/lib/utils/formatters';

interface MetricProps {
  label: string;
  value: string;
  caption?: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'accent';
  progress?: number;
}

const DOT: Record<NonNullable<MetricProps['tone']>, string> = {
  neutral: 'bg-stone-300 dark:bg-stone-600',
  positive: 'bg-emerald-500',
  negative: 'bg-rose-500',
  accent: 'bg-accent',
};

const TONE: Record<NonNullable<MetricProps['tone']>, string> = {
  neutral: 'text-stone-900 dark:text-stone-100',
  positive: 'text-emerald-600 dark:text-emerald-400',
  negative: 'text-rose-600 dark:text-rose-400',
  accent: 'text-accent-ink',
};

function Metric({ label, value, caption, tone = 'neutral', progress }: MetricProps) {
  return (
    <div className="px-4 py-3 min-w-0 flex items-center justify-between gap-3 bg-surface">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-stone-500 dark:text-stone-400">
          <span aria-hidden className={`w-1.5 h-1.5 shrink-0 rounded-full ${DOT[tone]}`} />
          <span className="truncate">{label}</span>
        </p>
        {caption && <p className="pl-3 text-[11px] text-stone-500 dark:text-stone-400 truncate">{caption}</p>}
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1">
        <p className={`text-[17px] leading-none font-semibold tracking-tight font-mono tabular-nums ${TONE[tone]}`}>{value}</p>
        {progress !== undefined && (
          <div className="w-16 h-1 rounded-full bg-black/5 dark:bg-white/8 overflow-hidden">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Resumo do período na conciliação, numa faixa baixa: quantidade, percentual conciliado, entradas e saídas. */
export function MetricsSummary({ metrics, periodLabel }: { metrics: ReconciliationMetrics; periodLabel: string }) {
  return (
    <section
      aria-label="Resumo"
      className="rounded-[18px] overflow-hidden grid grid-cols-2 lg:grid-cols-4 gap-px bg-black/5 dark:bg-white/6 border border-line shadow-card"
    >
      <Metric label={`Lançamentos · ${periodLabel}`} value={String(metrics.total)} caption={`${metrics.pending} pendente(s)`} />
      <Metric label="Conciliado" value={`${metrics.reconciledPercent}%`} tone="accent" progress={metrics.reconciledPercent} />
      <Metric label="Entradas" value={formatCurrency(metrics.credits)} tone="positive" />
      <Metric label="Saídas" value={formatCurrency(metrics.debits)} tone="negative" />
    </section>
  );
}
