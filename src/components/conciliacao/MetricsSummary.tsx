import type { ReconciliationMetrics } from '@/hooks/useReconciliation';
import { formatCurrency } from '@/lib/utils/formatters';

interface MetricProps {
  label: string;
  value: string;
  caption?: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'accent';
  progress?: number;
}

const TONE: Record<NonNullable<MetricProps['tone']>, string> = {
  neutral: 'text-stone-900 dark:text-stone-100',
  positive: 'text-emerald-600 dark:text-emerald-400',
  negative: 'text-rose-600 dark:text-rose-400',
  accent: 'text-accent-ink',
};

function Metric({ label, value, caption, tone = 'neutral', progress }: MetricProps) {
  return (
    <div className="px-5 py-4 min-w-0 backdrop-blur-xl bg-white/80 dark:bg-stone-900/80">
      <p className="text-[12px] font-medium text-stone-500">{label}</p>
      <p className={`mt-1.5 text-[22px] leading-none font-semibold tracking-tight font-mono tabular-nums truncate ${TONE[tone]}`}>
        {value}
      </p>
      {progress !== undefined ? (
        <div className="mt-3 h-1 rounded-full bg-black/[0.05] dark:bg-white/[0.08] overflow-hidden">
          <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${progress}%` }} />
        </div>
      ) : (
        caption && <p className="mt-2 text-[11px] text-stone-400 truncate">{caption}</p>
      )}
    </div>
  );
}

/** Resumo do período na conciliação: quantidade, percentual conciliado, entradas e saídas. */
export function MetricsSummary({ metrics, periodLabel }: { metrics: ReconciliationMetrics; periodLabel: string }) {
  return (
    <section
      aria-label="Resumo"
      className="rounded-[22px] overflow-hidden grid grid-cols-2 lg:grid-cols-4 gap-px bg-black/[0.05] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.04)]"
    >
      <Metric label={`Lançamentos · ${periodLabel}`} value={String(metrics.total)} caption={`${metrics.pending} pendente(s)`} />
      <Metric label="Conciliado" value={`${metrics.reconciledPercent}%`} tone="accent" progress={metrics.reconciledPercent} />
      <Metric label="Entradas" value={formatCurrency(metrics.credits)} tone="positive" caption="Créditos" />
      <Metric label="Saídas" value={formatCurrency(metrics.debits)} tone="negative" caption="Débitos" />
    </section>
  );
}
