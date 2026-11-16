'use client';

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { BridgeStep, CostComposition, ExecutiveMonthlyBreakdown, TopExpense } from '@/lib/executive-metrics';
import { formatCurrency } from '@/lib/utils/formatters';

/**
 * Gráficos da Visão Executiva (Recharts). As cores vêm das variáveis `--viz-*` de globals.css,
 * uma por entidade: a receita é sempre azul, os gastos laranja e o resultado verde-água, em
 * qualquer gráfico e nos dois temas. Cada medida tem o seu eixo: valores em R$ e margem em %
 * nunca dividem um gráfico.
 */

const C = {
  revenue: 'var(--viz-revenue)',
  outflows: 'var(--viz-outflows)',
  result: 'var(--viz-result)',
  costs: 'var(--viz-costs)',
  opex: 'var(--viz-opex)',
  financial: 'var(--viz-financial)',
  taxes: 'var(--viz-taxes)',
  previous: 'var(--viz-previous)',
  negative: 'var(--viz-negative)',
  grid: 'var(--viz-grid)',
  axis: 'var(--viz-axis)',
  surface: 'var(--color-surface)',
} as const;

export const compactBRL = (value: number): string => {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}R$ ${(abs / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${sign}R$ ${(abs / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `${sign}R$ ${abs.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
};

const pct = (value: number, digits = 1) => `${value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;

const AXIS_TICK = { fill: C.axis, fontSize: 11, fontFamily: 'var(--font-mono)' } as const;
const axisProps = { tickLine: false, axisLine: false, tick: AXIS_TICK } as const;

/** Rótulo do eixo de valores numa linha só (o texto padrão quebra "R$ 500 mil" em duas). */
function valueTick(format: (value: number) => string) {
  return function ValueTick(props: unknown) {
    const { x, y, payload } = props as { x: number; y: number; payload: { value: number } };
    return (
      <text x={x} y={y} dy={4} textAnchor="end" fill={C.axis} fontSize={11} fontFamily="var(--font-mono)">
        {format(payload.value)}
      </text>
    );
  };
}
const MoneyTick = valueTick(compactBRL);
const PercentTick = valueTick((v) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`);
const moneyAxis = { tickLine: false, axisLine: false, width: 84, tick: MoneyTick } as const;

/** Rótulo direto de uma barra, numa linha: acima dela (`top`) ou à direita (`right`). */
function barLabel(position: 'top' | 'right') {
  return function BarLabel(props: unknown) {
    const { x = 0, y = 0, width = 0, height = 0, value } = props as { x?: number; y?: number; width?: number; height?: number; value?: string };
    const at = position === 'top' ? { x: x + width / 2, y: Math.min(y, y + height) - 7, anchor: 'middle' as const } : { x: x + width + 8, y: y + height / 2 + 4, anchor: 'start' as const };
    return (
      <text x={at.x} y={at.y} textAnchor={at.anchor} fill="var(--viz-ink)" fontSize={11} fontFamily="var(--font-mono)">
        {value}
      </text>
    );
  };
}
const TopLabel = barLabel('top');
const RightLabel = barLabel('right');

/* =========================================================================
   Legenda e dica (tooltip) comuns
   ========================================================================= */

export interface LegendItem {
  label: string;
  color: string;
  /** `line`: série em linha; `bar`: barra ou área. */
  mark?: 'bar' | 'line';
  value?: string;
}

/** Legenda em HTML, acima do gráfico: o texto fica na cor do texto, a marca carrega a cor da série. */
export function ChartLegend({ items }: { items: readonly LegendItem[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-stone-600 dark:text-stone-300">
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={item.mark === 'line' ? 'w-3.5 h-0.5 rounded-full' : 'w-2.5 h-2.5 rounded-[3px]'} style={{ background: item.color }} />
          {item.label}
          {item.value && <span className="font-mono tabular-nums text-stone-500 dark:text-stone-400">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}

interface TipRow {
  label: string;
  value: string;
  color?: string;
  strong?: boolean;
}

/** Caixa da dica: título (o mês ou a conta) e uma linha por medida. */
function TipBox({ title, rows }: { title: string; rows: readonly TipRow[] }) {
  return (
    <div className="rounded-xl border border-line-strong bg-surface px-3 py-2.5 shadow-raised text-[12px] min-w-[190px]">
      <p className="mb-1.5 font-medium uppercase tracking-[0.06em] text-[10.5px] text-stone-500 dark:text-stone-400">{title}</p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 text-stone-600 dark:text-stone-300">
              {r.color && <span aria-hidden className="w-2 h-2 rounded-[2px]" style={{ background: r.color }} />}
              {r.label}
            </span>
            <span className={`font-mono tabular-nums text-stone-900 dark:text-stone-100 ${r.strong ? 'font-semibold' : ''}`}>{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** O que o Recharts entrega ao conteúdo da dica (só o que é usado aqui). */
interface TipProps<T> {
  active?: boolean;
  payload?: readonly { payload?: T }[];
}

/** Dica de um gráfico: monta as linhas a partir do ponto sob o cursor. */
function tipContent<T>(build: (datum: T) => { title: string; rows: TipRow[] }) {
  return function Content(props: unknown) {
    const { active, payload } = props as TipProps<T>;
    const datum = active ? payload?.[0]?.payload : undefined;
    if (!datum) return null;
    const { title, rows } = build(datum);
    return <TipBox title={title} rows={rows} />;
  };
}

const CURSOR_BAND = { fill: 'var(--viz-cursor)' } as const;
const CURSOR_LINE = { stroke: C.axis, strokeWidth: 1 } as const;

function Empty({ text }: { text: string }) {
  return <p className="py-10 text-center text-[13px] text-stone-400">{text}</p>;
}

/* =========================================================================
   1. Faturamento, gastos e resultado, mês a mês
   ========================================================================= */

export function RevenueAndResultChart({ monthly }: { monthly: readonly ExecutiveMonthlyBreakdown[] }) {
  return (
    <div className="space-y-3">
      <ChartLegend
        items={[
          { label: 'Receita bruta', color: C.revenue },
          { label: 'Custos, despesas e tributos', color: C.outflows },
          { label: 'Resultado líquido', color: C.result, mark: 'line' },
        ]}
      />
      <div role="img" aria-label="Receita bruta, gastos e resultado líquido de cada mês dos últimos 12 meses" className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={[...monthly]} margin={{ top: 8, right: 8, bottom: 0, left: 4 }} barGap={2} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={C.grid} />
            <XAxis dataKey="label" {...axisProps} interval={0} />
            <YAxis {...moneyAxis} />
            <ReferenceLine y={0} stroke={C.axis} strokeWidth={1} />
            <Tooltip
              cursor={CURSOR_BAND}
              content={tipContent<ExecutiveMonthlyBreakdown>((m) => ({
                title: m.label,
                rows: [
                  { label: 'Receita bruta', value: formatCurrency(m.grossRevenue), color: C.revenue },
                  { label: 'Gastos', value: formatCurrency(m.outflows), color: C.outflows },
                  { label: 'Resultado líquido', value: formatCurrency(m.netResult), color: C.result, strong: true },
                  { label: 'Margem líquida', value: pct(m.netMargin) },
                ],
              }))}
            />
            <Bar dataKey="grossRevenue" name="Receita bruta" fill={C.revenue} radius={[4, 4, 0, 0]} maxBarSize={20} />
            <Bar dataKey="outflows" name="Gastos" fill={C.outflows} radius={[4, 4, 0, 0]} maxBarSize={20} />
            <Line
              dataKey="netResult"
              name="Resultado líquido"
              type="monotone"
              stroke={C.result}
              strokeWidth={2}
              dot={{ r: 3.5, fill: C.result, stroke: C.surface, strokeWidth: 2 }}
              activeDot={{ r: 5, fill: C.result, stroke: C.surface, strokeWidth: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* =========================================================================
   2. Ponte do resultado (cascata): da receita bruta ao resultado líquido
   ========================================================================= */

const bridgeColor = (s: BridgeStep): string => {
  if (s.key === 'gross') return C.revenue;
  if (s.key === 'net') return s.value >= 0 ? C.result : C.negative;
  return s.value >= 0 ? C.result : C.outflows;
};

/** Rótulo do eixo em até duas linhas (os nomes dos degraus são longos). */
function BridgeTick(props: unknown) {
  const { x, y, payload } = props as { x: number; y: number; payload: { value: string } };
  const words = payload.value.split(' ');
  const half = Math.ceil(words.length / 2);
  const lines = words.length > 1 ? [words.slice(0, half).join(' '), words.slice(half).join(' ')] : [payload.value];
  return (
    <text x={x} y={y + 12} textAnchor="middle" fill={C.axis} fontSize={11}>
      {lines.map((line, i) => (
        <tspan key={line} x={x} dy={i === 0 ? 0 : 13}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

export function ResultBridgeChart({ steps }: { steps: readonly BridgeStep[] }) {
  if (steps.every((s) => Math.abs(s.value) < 0.005)) return <Empty text="Sem receita nem gastos conciliados no período." />;
  const data = steps.map((s) => ({ ...s, range: [Math.min(s.start, s.end), Math.max(s.start, s.end)] as [number, number], text: `${s.kind === 'delta' && s.value > 0 ? '+' : ''}${compactBRL(s.value).replace('R$ ', '')}` }));
  return (
    <div className="space-y-3">
      <ChartLegend
        items={[
          { label: 'Receita', color: C.revenue },
          { label: 'O que sai', color: C.outflows },
          { label: 'Resultado (ou o que entra)', color: C.result },
        ]}
      />
      <div role="img" aria-label="Ponte do resultado: da receita bruta ao resultado líquido dos últimos 12 meses" className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 26, right: 8, bottom: 16, left: 4 }} barCategoryGap="24%">
            <CartesianGrid vertical={false} stroke={C.grid} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} tick={BridgeTick} height={40} />
            <YAxis {...moneyAxis} />
            <ReferenceLine y={0} stroke={C.axis} strokeWidth={1} />
            <Tooltip
              cursor={CURSOR_BAND}
              content={tipContent<BridgeStep>((s) => ({
                title: s.label,
                rows:
                  s.kind === 'total'
                    ? [{ label: 'Total em 12 meses', value: formatCurrency(s.value), color: bridgeColor(s), strong: true }]
                    : [
                        { label: s.value < 0 ? 'Sai' : 'Entra', value: formatCurrency(Math.abs(s.value)), color: bridgeColor(s), strong: true },
                        { label: 'Sobra depois', value: formatCurrency(s.end) },
                      ],
              }))}
            />
            <Bar dataKey="range" radius={4} maxBarSize={56} isAnimationActive={false}>
              {data.map((s) => (
                <Cell key={s.key} fill={bridgeColor(s)} />
              ))}
              <LabelList dataKey="text" content={TopLabel} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* =========================================================================
   3. Faturamento: 12 meses × os 12 anteriores
   ========================================================================= */

export function RevenueComparisonChart({ monthly, currentLabel, previousLabel }: { monthly: readonly ExecutiveMonthlyBreakdown[]; currentLabel: string; previousLabel: string }) {
  const hasPrevious = monthly.some((m) => Math.abs(m.previousGrossRevenue) > 0.005);
  return (
    <div className="space-y-3">
      <ChartLegend
        items={[
          { label: currentLabel, color: C.revenue, mark: 'line' },
          ...(hasPrevious ? [{ label: `${previousLabel} (ano anterior)`, color: C.previous, mark: 'line' as const }] : []),
        ]}
      />
      <div role="img" aria-label="Receita bruta mês a mês comparada com o mesmo mês do ano anterior" className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={[...monthly]} margin={{ top: 8, right: 22, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="viz-revenue-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.revenue} stopOpacity={0.22} />
                <stop offset="100%" stopColor={C.revenue} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={C.grid} />
            <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={18} />
            <YAxis {...moneyAxis} />
            <Tooltip
              cursor={CURSOR_LINE}
              content={tipContent<ExecutiveMonthlyBreakdown>((m) => {
                const change = Math.abs(m.previousGrossRevenue) > 0.005 ? ((m.grossRevenue - m.previousGrossRevenue) / Math.abs(m.previousGrossRevenue)) * 100 : null;
                return {
                  title: m.label,
                  rows: [
                    { label: m.label, value: formatCurrency(m.grossRevenue), color: C.revenue, strong: true },
                    ...(hasPrevious ? [{ label: m.previousLabel, value: formatCurrency(m.previousGrossRevenue), color: C.previous }] : []),
                    ...(change !== null ? [{ label: 'Variação', value: `${change > 0 ? '+' : ''}${pct(change)}` }] : []),
                  ],
                };
              })}
            />
            {hasPrevious && <Line dataKey="previousGrossRevenue" type="monotone" stroke={C.previous} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: C.previous, stroke: C.surface, strokeWidth: 2 }} />}
            <Area dataKey="grossRevenue" type="monotone" stroke={C.revenue} strokeWidth={2} fill="url(#viz-revenue-fill)" dot={false} activeDot={{ r: 5, fill: C.revenue, stroke: C.surface, strokeWidth: 2 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* =========================================================================
   4. Composição dos gastos, mês a mês (barras empilhadas)
   ========================================================================= */

const OUTFLOW_SERIES = [
  { key: 'costs', label: 'Custos (CMV/CSP)', color: C.costs },
  { key: 'operatingExpenses', label: 'Despesas operacionais', color: C.opex },
  { key: 'financialExpenses', label: 'Despesas financeiras', color: C.financial },
  { key: 'taxes', label: 'Tributos e deduções', color: C.taxes },
] as const;

export function OutflowCompositionChart({ monthly, composition }: { monthly: readonly ExecutiveMonthlyBreakdown[]; composition: CostComposition }) {
  if (composition.total <= 0) return <Empty text="Sem custos ou despesas conciliados no período." />;
  const totals: Record<(typeof OUTFLOW_SERIES)[number]['key'], [number, number]> = {
    costs: [composition.costs, composition.costsPct],
    operatingExpenses: [composition.operatingExpenses, composition.operatingExpensesPct],
    financialExpenses: [composition.financialExpenses, composition.financialExpensesPct],
    taxes: [composition.taxes, composition.taxesPct],
  };
  // Estornos podem deixar um grupo negativo no mês: a pilha só mostra o que é gasto.
  const data = monthly.map((m) => ({ ...m, costs: Math.max(0, m.costs), operatingExpenses: Math.max(0, m.operatingExpenses), financialExpenses: Math.max(0, m.financialExpenses), taxes: Math.max(0, m.taxes) }));
  return (
    <div className="space-y-4">
      <div role="img" aria-label="Custos, despesas operacionais, despesas financeiras e tributos de cada mês, empilhados" className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 18, bottom: 0, left: 4 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke={C.grid} />
            <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={14} />
            <YAxis {...moneyAxis} />
            <Tooltip
              cursor={CURSOR_BAND}
              content={tipContent<ExecutiveMonthlyBreakdown>((m) => ({
                title: m.label,
                rows: [
                  ...[...OUTFLOW_SERIES].reverse().map((s) => ({ label: s.label, value: formatCurrency(m[s.key]), color: s.color })),
                  { label: 'Total do mês', value: formatCurrency(m.outflows), strong: true },
                ],
              }))}
            />
            {OUTFLOW_SERIES.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} stackId="gastos" fill={s.color} stroke={C.surface} strokeWidth={1.5} maxBarSize={30} radius={i === OUTFLOW_SERIES.length - 1 ? [4, 4, 0, 0] : 0} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Totais do período: a legenda com o valor e a participação de cada grupo */}
      <ul className="grid grid-cols-2 gap-2">
        {OUTFLOW_SERIES.map((s) => (
          <li key={s.key} className="rounded-xl border border-line bg-black/2 dark:bg-white/3 px-3 py-2 text-[12px] min-w-0">
            <p className="flex items-center gap-1.5 text-stone-600 dark:text-stone-300">
              <span aria-hidden className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: s.color }} />
              <span className="truncate" title={s.label}>
                {s.label}
              </span>
            </p>
            <p className="mt-1 font-mono tabular-nums whitespace-nowrap">
              <span className="font-semibold text-stone-900 dark:text-stone-100">{formatCurrency(totals[s.key][0])}</span>
              <span className="ml-1.5 text-[11px] text-stone-500 dark:text-stone-400">{pct(totals[s.key][1])}</span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* =========================================================================
   5. Margem líquida, com a média do período
   ========================================================================= */

export function MarginTrendChart({ monthly, average }: { monthly: readonly ExecutiveMonthlyBreakdown[]; average: number }) {
  // Mês sem receita não tem margem: o ponto fica vazio em vez de cair para zero.
  const data = monthly.map((m) => ({ ...m, margin: Math.abs(m.netRevenue) > 0.005 ? Math.max(-100, Math.min(100, m.netMargin)) : null }));
  if (data.every((d) => d.margin === null)) return <Empty text="Sem receita no período para calcular a margem." />;
  return (
    <div className="space-y-3">
      <ChartLegend
        items={[
          { label: 'Margem líquida do mês', color: C.result, mark: 'line' },
          { label: 'Média dos 12 meses', color: C.axis, mark: 'line', value: pct(average) },
        ]}
      />
      <div role="img" aria-label="Margem líquida percentual de cada mês e a média dos 12 meses" className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 22, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} stroke={C.grid} />
            <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={18} />
            <YAxis tickLine={false} axisLine={false} width={46} tick={PercentTick} />
            <ReferenceLine y={0} stroke={C.axis} strokeWidth={1} />
            <ReferenceLine y={average} stroke={C.axis} strokeWidth={1.5} strokeDasharray="5 4" />
            <Tooltip
              cursor={CURSOR_LINE}
              content={tipContent<ExecutiveMonthlyBreakdown & { margin: number | null }>((m) => ({
                title: m.label,
                rows: [
                  { label: 'Margem líquida', value: m.margin === null ? 'sem receita' : pct(m.netMargin), color: C.result, strong: true },
                  { label: 'Média dos 12 meses', value: pct(average) },
                  { label: 'Resultado líquido', value: formatCurrency(m.netResult) },
                ],
              }))}
            />
            <Line dataKey="margin" type="monotone" connectNulls stroke={C.result} strokeWidth={2} dot={{ r: 3.5, fill: C.result, stroke: C.surface, strokeWidth: 2 }} activeDot={{ r: 5, fill: C.result, stroke: C.surface, strokeWidth: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* =========================================================================
   6. Maiores gastos do período (barras horizontais)
   ========================================================================= */

/** Nome da conta no eixo, cortado para caber na coluna dos rótulos. */
function ExpenseTick(props: unknown) {
  const { x, y, payload } = props as { x: number; y: number; payload: { value: string } };
  const text = payload.value.length > 30 ? `${payload.value.slice(0, 29)}…` : payload.value;
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill="var(--viz-ink)" fontSize={12}>
      <title>{payload.value}</title>
      {text}
    </text>
  );
}

export function TopExpensesChart({ expenses }: { expenses: readonly TopExpense[] }) {
  if (expenses.length === 0) return <Empty text="Sem custos ou despesas conciliados no período." />;
  const data = expenses.map((e) => ({ ...e, text: `${compactBRL(e.value)} · ${pct(e.share, 0)}` }));
  return (
    <div role="img" aria-label="Maiores contas de custo e despesa dos últimos 12 meses" style={{ height: Math.max(170, data.length * 36 + 16) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 132, bottom: 0, left: 4 }} barCategoryGap="26%">
          <XAxis type="number" hide domain={[0, 'dataMax']} />
          <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={204} tick={ExpenseTick} interval={0} />
          <Tooltip
            cursor={CURSOR_BAND}
            content={tipContent<TopExpense>((e) => ({
              title: e.code ? `${e.code} ${e.name}` : e.name,
              rows: [
                { label: 'Em 12 meses', value: formatCurrency(e.value), color: C.outflows, strong: true },
                { label: 'Dos custos e despesas', value: pct(e.share) },
                { label: 'Média por mês', value: formatCurrency(e.value / 12) },
              ],
            }))}
          />
          <Bar dataKey="value" fill={C.outflows} radius={[0, 4, 4, 0]} maxBarSize={18}>
            <LabelList dataKey="text" content={RightLabel} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* =========================================================================
   Minigráfico dos indicadores (sem eixos: só a forma dos 12 meses)
   ========================================================================= */

export function Sparkline({ values, color, label }: { values: readonly number[]; color: string; label: string }) {
  const data = values.map((value, i) => ({ i, value }));
  return (
    <div role="img" aria-label={label} className="h-9 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }} accessibilityLayer={false}>
          <Line dataKey="value" type="monotone" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export const VIZ_COLOR = C;
