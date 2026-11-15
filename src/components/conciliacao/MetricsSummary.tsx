import type { ReconciliationMetrics } from '@/hooks/useReconciliation';
import type { StatusFilter } from '@/lib/reconciliation-list';
import { fromCents, toCents } from '@/lib/money';
import { formatCurrency } from '@/lib/utils/formatters';

type Tone = 'neutral' | 'positive' | 'negative';

const DOT: Record<Tone, string> = {
  neutral: 'bg-stone-300 dark:bg-stone-600',
  positive: 'bg-emerald-500',
  negative: 'bg-rose-500',
};

const TONE: Record<Tone, string> = {
  neutral: 'text-stone-900 dark:text-stone-100',
  positive: 'text-emerald-600 dark:text-emerald-400',
  negative: 'text-rose-600 dark:text-rose-400',
};

function Metric({ label, value, caption, tone = 'neutral' }: { label: string; value: string; caption?: string; tone?: Tone }) {
  return (
    <div className="px-4 py-3 min-w-0 flex flex-col justify-center gap-1 bg-surface">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-stone-500 dark:text-stone-400">
        <span aria-hidden className={`w-1.5 h-1.5 shrink-0 rounded-full ${DOT[tone]}`} />
        <span className="truncate">{label}</span>
      </p>
      <p className={`text-[17px] leading-none font-semibold tracking-tight font-mono tabular-nums ${TONE[tone]}`}>{value}</p>
      {caption && <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate">{caption}</p>}
    </div>
  );
}

/** As três situações da fila, na ordem em que o trabalho anda: pendente, para aprovar, conciliado. */
const QUEUE: readonly { filter: Exclude<StatusFilter, 'ALL'>; key: 'pending' | 'autoClassified' | 'reconciled'; one: string; many: string; bar: string; dot: string }[] = [
  { filter: 'PENDING', key: 'pending', one: 'pendente', many: 'pendentes', bar: 'bg-amber-400', dot: 'bg-amber-500' },
  { filter: 'AUTO_CLASSIFIED', key: 'autoClassified', one: 'para aprovar', many: 'para aprovar', bar: 'bg-accent', dot: 'bg-accent' },
  { filter: 'RECONCILED', key: 'reconciled', one: 'conciliado', many: 'conciliados', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
];

/**
 * Resumo do período na conciliação. O primeiro bloco é a fila de trabalho: quanto do período
 * está conciliado e quantos lançamentos há em cada situação; clicar numa situação filtra a
 * lista (clicar de novo volta a todos). Ao lado, entradas, saídas e a variação do período.
 */
export function MetricsSummary({
  metrics,
  periodLabel,
  filter,
  onFilter,
}: {
  metrics: ReconciliationMetrics;
  periodLabel: string;
  /** Situação filtrada na lista, para marcar a que está em uso. */
  filter?: StatusFilter;
  onFilter?: (filter: StatusFilter) => void;
}) {
  const net = fromCents(toCents(metrics.credits) - toCents(metrics.debits));
  const done = metrics.total > 0 && metrics.reconciled === metrics.total;
  return (
    <section
      aria-label="Resumo"
      className="rounded-[18px] overflow-hidden grid grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] gap-px bg-black/5 dark:bg-white/6 border border-line shadow-card"
    >
      <div className="col-span-2 lg:col-span-1 px-4 py-3 min-w-0 bg-surface space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[12px] font-medium text-stone-500 dark:text-stone-400 truncate">
            {metrics.total} lançamento(s) · {periodLabel}
          </p>
          <p className={`text-[17px] leading-none font-semibold tracking-tight font-mono tabular-nums ${done ? 'text-emerald-600 dark:text-emerald-400' : 'text-accent-ink'}`}>
            {metrics.reconciledPercent}% <span className="font-sans text-[12px] font-medium text-stone-500 dark:text-stone-400">Conciliado</span>
          </p>
        </div>

        {/* Barra da fila: conciliado, para aprovar e pendente, na proporção de cada um */}
        <div className="flex h-1.5 rounded-full overflow-hidden bg-black/5 dark:bg-white/8" role="presentation">
          {metrics.total > 0 &&
            [QUEUE[2], QUEUE[1], QUEUE[0]].map((q) => (
              <div key={q.key} className={`h-full ${q.bar} transition-[width] duration-500 ease-out`} style={{ width: `${(metrics[q.key] / metrics.total) * 100}%` }} />
            ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {QUEUE.map((q) => {
            const count = metrics[q.key];
            const active = filter === q.filter;
            const text = `${count} ${count === 1 ? q.one : q.many}`;
            const content = (
              <>
                <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${q.dot} ${count === 0 ? 'opacity-40' : ''}`} />
                <span className="font-mono tabular-nums">{count}</span> {count === 1 ? q.one : q.many}
              </>
            );
            const base = 'inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[11.5px] font-medium whitespace-nowrap';
            if (!onFilter) {
              return (
                <span key={q.key} className={`${base} text-stone-600 dark:text-stone-300`}>
                  {content}
                </span>
              );
            }
            return (
              <button
                key={q.key}
                type="button"
                aria-pressed={active}
                title={active ? 'Voltar a mostrar todos os lançamentos' : `Mostrar só: ${text}`}
                onClick={() => onFilter(active ? 'ALL' : q.filter)}
                className={`${base} transition-colors duration-150 active:scale-[0.97] ${
                  active
                    ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                    : `text-stone-600 dark:text-stone-300 hover:bg-black/5 dark:hover:bg-white/8 ${count === 0 ? 'opacity-60' : ''}`
                }`}
              >
                {content}
              </button>
            );
          })}
        </div>
      </div>

      <Metric label="Entradas" value={formatCurrency(metrics.credits)} tone="positive" />
      <Metric label="Saídas" value={formatCurrency(metrics.debits)} tone="negative" />
      <Metric label="Variação no período" value={formatCurrency(net)} tone={net < 0 ? 'negative' : 'neutral'} caption="entradas menos saídas" />
    </section>
  );
}
