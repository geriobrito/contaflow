'use client';

import React, { useState } from 'react';
import type { CostComposition, ExecutiveMonthlyBreakdown } from '@/lib/executive-metrics';
import { formatCurrency } from '@/lib/utils/formatters';

const compactBRL = (value: number): string => {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}R$ ${(abs / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}M`;
  if (abs >= 1_000) return `${sign}R$ ${(abs / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`;
  return formatCurrency(value);
};

/**
 * Gráfico combinado de Barras (Receita Bruta vs Saídas Totais) e Linha (Resultado Líquido)
 * para os últimos 12 meses. Renderizado em SVG responsivo sem dependências externas.
 */
export function RevenueAndResultChart({ monthly }: { monthly: readonly ExecutiveMonthlyBreakdown[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const width = 760;
  const height = 250;
  const padLeft = 64;
  const padRight = 20;
  const padTop = 24;
  const padBottom = 34;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxVal = Math.max(
    1,
    ...monthly.map((m) =>
      Math.max(
        m.grossRevenue,
        m.costs + m.operatingExpenses + m.financialExpenses + m.taxes,
        Math.abs(m.netResult)
      )
    )
  );
  const minVal = Math.min(0, ...monthly.map((m) => m.netResult));
  const span = maxVal - minVal || 1;

  const yOf = (v: number) => padTop + ((maxVal - v) / span) * plotH;
  const zeroY = yOf(0);
  const slotW = plotW / Math.max(1, monthly.length);
  const barW = Math.min(18, slotW * 0.34);

  const linePoints = monthly
    .map((m, i) => {
      const cx = padLeft + i * slotW + slotW / 2;
      const cy = yOf(m.netResult);
      return `${cx},${cy}`;
    })
    .join(' ');

  const gridValues = [maxVal, maxVal * 0.5, 0, ...(minVal < 0 ? [minVal] : [])];
  const hovered = hoveredIndex !== null ? monthly[hoveredIndex] : null;

  return (
    <div className="space-y-3">
      {/* Legenda e Tooltip dinâmico */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-[12px]">
        <div className="flex flex-wrap items-center gap-4 text-stone-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 inline-block" />
            Receita bruta
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-stone-300 dark:bg-stone-600 inline-block" />
            Custos, despesas e tributos
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-amber-600 dark:bg-amber-400 inline-block" />
            Resultado líquido
          </span>
        </div>

        {hovered && (
          <div className="font-mono tabular-nums text-[11px] bg-stone-900 text-stone-100 dark:bg-stone-100 dark:text-stone-900 px-3 py-1 rounded-full shadow-xs">
            <strong className="uppercase">{hovered.label}:</strong> Rec. {formatCurrency(hovered.grossRevenue)} · Res.{' '}
            {formatCurrency(hovered.netResult)} ({hovered.netMargin.toFixed(1)}%)
          </div>
        )}
      </div>

      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Evolução de faturamento bruto, gastos e resultado líquido nos últimos 12 meses"
          className="w-full h-auto min-w-[540px] select-none overflow-visible"
        >
          {/* Linhas de grade horizontais */}
          {gridValues.map((gv, idx) => {
            const y = yOf(gv);
            return (
              <g key={idx}>
                <line
                  x1={padLeft}
                  x2={width - padRight}
                  y1={y}
                  y2={y}
                  className={
                    gv === 0
                      ? 'stroke-stone-400/70 dark:stroke-stone-500/70'
                      : 'stroke-stone-200/80 dark:stroke-stone-800'
                  }
                  strokeDasharray={gv === 0 ? undefined : '3 3'}
                  strokeWidth={1}
                />
                <text
                  x={padLeft - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  className="fill-stone-400 font-mono text-[10px]"
                >
                  {compactBRL(gv)}
                </text>
              </g>
            );
          })}

          {/* Barras de cada mês */}
          {monthly.map((m, i) => {
            const cx = padLeft + i * slotW + slotW / 2;
            const outflows = m.costs + m.operatingExpenses + m.financialExpenses + m.taxes;
            const revY = yOf(Math.max(0, m.grossRevenue));
            const revH = Math.max(0, zeroY - revY);
            const outY = yOf(Math.max(0, outflows));
            const outH = Math.max(0, zeroY - outY);
            const isHover = hoveredIndex === i;

            return (
              <g
                key={m.month}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                className="cursor-pointer"
              >
                {/* Faixa de foco ao passar o mouse */}
                <rect
                  x={padLeft + i * slotW}
                  y={padTop}
                  width={slotW}
                  height={plotH}
                  className={`transition-opacity ${
                    isHover ? 'fill-stone-500/8 dark:fill-white/5 opacity-100' : 'opacity-0'
                  }`}
                  rx={6}
                />

                {/* Barra de Receita Bruta */}
                <rect
                  x={cx - barW - 1.5}
                  y={revY}
                  width={barW}
                  height={Math.max(revH, m.grossRevenue > 0 ? 2 : 0)}
                  rx={3}
                  className="fill-emerald-500/90 dark:fill-emerald-500 transition-all"
                />

                {/* Barra de Custos + Despesas + Tributos */}
                <rect
                  x={cx + 1.5}
                  y={outY}
                  width={barW}
                  height={Math.max(outH, outflows > 0 ? 2 : 0)}
                  rx={3}
                  className="fill-stone-300 dark:fill-stone-600 transition-all"
                />

                {/* Rótulo do mês */}
                <text
                  x={cx}
                  y={height - 10}
                  textAnchor="middle"
                  className={`font-mono text-[10px] ${
                    isHover ? 'fill-stone-900 dark:fill-stone-100 font-semibold' : 'fill-stone-400'
                  }`}
                >
                  {m.label}
                </text>
              </g>
            );
          })}

          {/* Linha de Resultado Líquido */}
          {monthly.length > 1 && (
            <polyline
              fill="none"
              points={linePoints}
              className="stroke-amber-600 dark:stroke-amber-400"
              strokeWidth={2.25}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Pontos da Linha de Resultado Líquido */}
          {monthly.map((m, i) => {
            const cx = padLeft + i * slotW + slotW / 2;
            const cy = yOf(m.netResult);
            return (
              <circle
                key={`pt-${m.month}`}
                cx={cx}
                cy={cy}
                r={hoveredIndex === i ? 4.5 : 3}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                className={
                  m.netResult >= 0
                    ? 'fill-white dark:fill-stone-900 stroke-amber-600 dark:stroke-amber-400 cursor-pointer'
                    : 'fill-rose-500 stroke-white dark:stroke-stone-900 cursor-pointer'
                }
                strokeWidth={2}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/**
 * Gráfico de Composição de Custos, Despesas e Tributos (Estrutura de Saídas da DRE).
 */
export function CostCompositionChart({ composition }: { composition: CostComposition }) {
  const items = [
    {
      key: 'costs',
      label: 'Custos (CMV / CSP)',
      amount: composition.costs,
      pct: composition.costsPct,
      barClass: 'bg-emerald-600 dark:bg-emerald-500',
      dotClass: 'bg-emerald-600 dark:bg-emerald-500',
    },
    {
      key: 'opex',
      label: 'Despesas Operacionais e Gerais',
      amount: composition.operatingExpenses,
      pct: composition.operatingExpensesPct,
      barClass: 'bg-sky-500 dark:bg-sky-400',
      dotClass: 'bg-sky-500 dark:bg-sky-400',
    },
    {
      key: 'taxes',
      label: 'Tributos e Deduções sobre Vendas',
      amount: composition.taxes,
      pct: composition.taxesPct,
      barClass: 'bg-violet-500 dark:bg-violet-400',
      dotClass: 'bg-violet-500 dark:bg-violet-400',
    },
    {
      key: 'fin',
      label: 'Despesas Financeiras (Juros/Tarifas)',
      amount: composition.financialExpenses,
      pct: composition.financialExpensesPct,
      barClass: 'bg-amber-500 dark:bg-amber-400',
      dotClass: 'bg-amber-500 dark:bg-amber-400',
    },
  ];

  if (composition.total <= 0) {
    return <p className="text-[13px] text-stone-400 py-6 text-center">Sem custos ou despesas conciliados no período.</p>;
  }

  return (
    <div className="space-y-4">
      {/* Barra segmentada proporcional */}
      <div
        role="img"
        aria-label="Proporção de custos, despesas operacionais, tributos e despesas financeiras"
        className="h-4 w-full rounded-full overflow-hidden flex bg-stone-100 dark:bg-stone-800 p-0.5 gap-0.5"
      >
        {items
          .filter((item) => item.pct > 0)
          .map((item) => (
            <div
              key={item.key}
              style={{ width: `${Math.max(2, item.pct)}%` }}
              title={`${item.label}: ${formatCurrency(item.amount)} (${item.pct.toFixed(1)}%)`}
              className={`h-full first:rounded-l-full last:rounded-r-full transition-all duration-300 ${item.barClass}`}
            />
          ))}
      </div>

      {/* Lista detalhada com valores e percentuais */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {items.map((item) => (
          <div
            key={item.key}
            className="flex items-center justify-between gap-3 rounded-xl border border-black/5 dark:border-white/6 bg-black/2 dark:bg-white/3 px-3.5 py-2.5 text-[12px]"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${item.dotClass}`} />
              <span className="text-stone-700 dark:text-stone-300 truncate">{item.label}</span>
            </div>
            <div className="text-right font-mono tabular-nums shrink-0">
              <span className="font-semibold text-stone-900 dark:text-stone-100">{formatCurrency(item.amount)}</span>
              <span className="ml-1.5 text-[11px] text-stone-400">({item.pct.toFixed(1)}%)</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Gráfico de Tendência da Margem Líquida (%) mês a mês.
 */
export function MarginTrendChart({ monthly }: { monthly: readonly ExecutiveMonthlyBreakdown[] }) {
  const width = 460;
  const height = 160;
  const padLeft = 44;
  const padRight = 16;
  const padTop = 18;
  const padBottom = 28;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const margins = monthly.map((m) => Math.max(-100, Math.min(100, m.netMargin)));
  const maxM = Math.max(20, ...margins);
  const minM = Math.min(0, ...margins);
  const span = maxM - minM || 1;

  const yOf = (v: number) => padTop + ((maxM - v) / span) * plotH;
  const zeroY = yOf(0);
  const stepX = plotW / Math.max(1, monthly.length - 1);

  const points = margins
    .map((m, i) => `${padLeft + i * stepX},${yOf(m)}`)
    .join(' ');

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Tendência da margem líquida percentual nos últimos 12 meses"
        className="w-full h-auto min-w-[340px] select-none"
      >
        {/* Linha zero */}
        <line
          x1={padLeft}
          x2={width - padRight}
          y1={zeroY}
          y2={zeroY}
          className="stroke-stone-300 dark:stroke-stone-700"
          strokeDasharray="3 3"
          strokeWidth={1}
        />
        <text x={padLeft - 6} y={zeroY + 3} textAnchor="end" className="fill-stone-400 font-mono text-[9.5px]">
          0%
        </text>
        <text x={padLeft - 6} y={yOf(maxM) + 3} textAnchor="end" className="fill-stone-400 font-mono text-[9.5px]">
          {maxM.toFixed(0)}%
        </text>

        {/* Linha da margem */}
        {monthly.length > 1 && (
          <polyline
            fill="none"
            points={points}
            className="stroke-emerald-600 dark:stroke-emerald-400"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {monthly.map((m, i) => {
          const x = padLeft + i * stepX;
          const y = yOf(margins[i]);
          return (
            <g key={m.month}>
              <circle
                cx={x}
                cy={y}
                r={3}
                className={
                  m.netMargin >= 0
                    ? 'fill-emerald-600 dark:fill-emerald-400'
                    : 'fill-rose-500'
                }
              >
                <title>{`${m.label}: ${m.netMargin.toFixed(1)}%`}</title>
              </circle>
              {i % 2 === 0 && (
                <text x={x} y={height - 8} textAnchor="middle" className="fill-stone-400 font-mono text-[9.5px]">
                  {m.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

