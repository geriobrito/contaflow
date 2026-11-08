'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Printer, TrendingUp } from 'lucide-react';
import type { ClientCompany } from '@/types/firestore';
import type { ExecutiveSummary } from '@/lib/executive-metrics';
import { formatCNPJ, formatCurrency } from '@/lib/utils/formatters';
import { BUTTON, SURFACE } from '@/components/ui/primitives';
import { CostCompositionChart, MarginTrendChart, RevenueAndResultChart } from '@/components/painel/ExecutiveCharts';

const REGIME_LABEL: Record<ClientCompany['regime'], string> = {
  SIMPLES_NACIONAL: 'Simples Nacional',
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  LUCRO_REAL: 'Lucro Real',
  MEI: 'MEI',
};

export interface ExecutiveDashboardProps {
  client: ClientCompany;
  summary: ExecutiveSummary;
}

/**
 * Dashboard Gerencial Gráfico para a Diretoria do Cliente.
 * Consolida os últimos 12 meses de faturamento, margem líquida, EBITDA e composição de gastos.
 */
export function ExecutiveDashboard({ client, summary }: ExecutiveDashboardProps) {
  const yoy = summary.twelveMonthsGrossRevenueVariation;
  const isProfitable = summary.twelveMonthsNetResult >= 0;

  return (
    <div className="space-y-5" role="region" aria-label="Visão Executiva">
      {/* Barra executiva de contexto e impressão */}
      <div className={`${SURFACE} rounded-[22px] px-6 py-4 flex flex-wrap items-center justify-between gap-4`}>
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-stone-500">
            <span className="inline-flex items-center gap-1 font-medium text-stone-800 dark:text-stone-200">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
              Relatório Executivo para a Diretoria
            </span>
            <span>·</span>
            <span>Período: <strong className="font-mono text-stone-700 dark:text-stone-300">{summary.periodLabel}</strong> (12 meses)</span>
            {client.cnpj && (
              <>
                <span>·</span>
                <span className="font-mono">{formatCNPJ(client.cnpj)}</span>
              </>
            )}
            <span>·</span>
            <span>{REGIME_LABEL[client.regime]}</span>
          </div>
          {summary.awaitingApprovalCount > 0 && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400 print:hidden">
              Há {summary.awaitingApprovalCount} lançamento(s) auto-classificado(s) aguardando aprovação na{' '}
              <Link href="/?filtro=AUTO_CLASSIFIED" className="underline font-medium">
                Conciliação
              </Link>
              .
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 print:hidden">
          <Link href="/dre" className={`${BUTTON.secondary} h-9 px-3.5 text-[12px]`}>
            Ver DRE Completa
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className={`${BUTTON.secondary} h-9 px-3.5 text-[12px]`}
            title="Imprimir ou salvar PDF executivo para enviar ao cliente"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Imprimir Relatório</span>
          </button>
        </div>
      </div>

      {/* KPIs Executivos (4 Cards) */}
      <section
        aria-label="Indicadores-chave dos últimos 12 meses"
        className="rounded-[22px] overflow-hidden grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-black/5 dark:bg-white/6 border border-black/6 dark:border-white/8 shadow-[0_2px_12px_rgba(0,0,0,0.04)]"
      >
        <div className="px-5 py-4 bg-white/85 dark:bg-stone-900/85">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-medium text-stone-500">Faturamento Bruto (12M)</p>
            {yoy !== null && (
              <span
                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-mono font-semibold ${
                  yoy >= 0
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                    : 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                }`}
                title="Variação em relação aos 12 meses anteriores"
              >
                {yoy >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {yoy >= 0 ? '+' : ''}
                {yoy.toFixed(1)}%
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[24px] leading-none font-semibold tracking-tight font-mono tabular-nums text-stone-900 dark:text-stone-100">
            {formatCurrency(summary.twelveMonthsGrossRevenue)}
          </p>
          <p className="mt-2 text-[11px] text-stone-400">
            Média mensal: {formatCurrency(summary.twelveMonthsGrossRevenue / 12)}
          </p>
        </div>

        <div className="px-5 py-4 bg-white/85 dark:bg-stone-900/85">
          <p className="text-[12px] font-medium text-stone-500">Receita Líquida (12M)</p>
          <p className="mt-1.5 text-[24px] leading-none font-semibold tracking-tight font-mono tabular-nums text-stone-900 dark:text-stone-100">
            {formatCurrency(summary.twelveMonthsNetRevenue)}
          </p>
          <p className="mt-2 text-[11px] text-stone-400">
            Após deduções e tributos s/ vendas
          </p>
        </div>

        <div className="px-5 py-4 bg-white/85 dark:bg-stone-900/85">
          <p className="text-[12px] font-medium text-stone-500">Resultado Líquido (12M)</p>
          <p
            className={`mt-1.5 text-[24px] leading-none font-semibold tracking-tight font-mono tabular-nums ${
              isProfitable ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {formatCurrency(summary.twelveMonthsNetResult)}
          </p>
          <p className="mt-2 text-[11px] text-stone-400">
            {isProfitable ? 'Lucro líquido acumulado' : 'Prejuízo líquido no período'}
          </p>
        </div>

        <div className="px-5 py-4 bg-white/85 dark:bg-stone-900/85">
          <p className="text-[12px] font-medium text-stone-500">Margem Líquida & EBITDA</p>
          <p
            className={`mt-1.5 text-[24px] leading-none font-semibold tracking-tight font-mono tabular-nums ${
              summary.twelveMonthsNetMargin >= 0 ? 'text-stone-900 dark:text-stone-100' : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {summary.twelveMonthsNetMargin.toFixed(1)}%
          </p>
          <p className="mt-2 text-[11px] text-stone-400 font-mono tabular-nums">
            EBITDA est.: {formatCurrency(summary.twelveMonthsEbitda)}
          </p>
        </div>
      </section>

      {/* Gráfico Principal: Faturamento vs Gastos e Resultado */}
      <section className={`${SURFACE} rounded-[22px] p-6 space-y-4 print:break-inside-avoid`}>
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
            Evolução de Faturamento, Gastos e Resultado (12 Meses)
          </h2>
          <p className="text-[12px] text-stone-500">
            Comparativo mensal entre entradas brutas, saídas operacionais/tributárias e geração de lucro líquido.
          </p>
        </div>
        <RevenueAndResultChart monthly={summary.monthly} />
      </section>

      {/* Grade Secundária: Composição de Custos + Evolução da Margem */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 print:break-inside-avoid">
        <section className={`${SURFACE} rounded-[22px] p-6 space-y-4 lg:col-span-7`}>
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              Estrutura e Composição de Custos e Despesas
            </h2>
            <p className="text-[12px] text-stone-500">
              Distribuição proporcional dos desembolsos acumulados ({formatCurrency(summary.costComposition.total)}).
            </p>
          </div>
          <CostCompositionChart composition={summary.costComposition} />
        </section>

        <section className={`${SURFACE} rounded-[22px] p-6 space-y-4 lg:col-span-5`}>
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              Tendência da Margem Líquida (%)
            </h2>
            <p className="text-[12px] text-stone-500">
              Rentabilidade líquida sobre a receita mês a mês.
            </p>
          </div>
          <MarginTrendChart monthly={summary.monthly} />
        </section>
      </div>

      {/* Tabela Executiva Mês a Mês */}
      <section className={`${SURFACE} rounded-[22px] overflow-hidden print:break-inside-avoid`}>
        <div className="px-6 py-4 border-b border-black/4 dark:border-white/6 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
            Demonstrativo Gerencial Mês a Mês
          </h2>
          <span className="text-[12px] text-stone-400 font-mono">{summary.periodLabel}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-stone-400 border-b border-black/4 dark:border-white/6">
                <th className="font-medium pl-6 pr-3 py-2.5">Mês</th>
                <th className="font-medium px-3 py-2.5 text-right">Receita Bruta</th>
                <th className="font-medium px-3 py-2.5 text-right">Tributos / Ded.</th>
                <th className="font-medium px-3 py-2.5 text-right">Custos (CMV/CSP)</th>
                <th className="font-medium px-3 py-2.5 text-right">Despesas Op./Fin.</th>
                <th className="font-medium px-3 py-2.5 text-right">Resultado Líquido</th>
                <th className="font-medium pl-3 pr-6 py-2.5 text-right">Margem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/4 dark:divide-white/5 font-mono tabular-nums">
              {summary.monthly.map((m) => (
                <tr key={m.month} className="hover:bg-black/2 dark:hover:bg-white/3 transition-colors">
                  <td className="pl-6 pr-3 py-2.5 font-sans font-medium uppercase text-stone-700 dark:text-stone-300">
                    {m.label}
                  </td>
                  <td className="px-3 py-2.5 text-right text-stone-900 dark:text-stone-100">
                    {formatCurrency(m.grossRevenue)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-stone-500">
                    {formatCurrency(m.taxes)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-stone-600 dark:text-stone-400">
                    {formatCurrency(m.costs)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-stone-600 dark:text-stone-400">
                    {formatCurrency(m.operatingExpenses + m.financialExpenses)}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-semibold ${
                      m.netResult >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {formatCurrency(m.netResult)}
                  </td>
                  <td className="pl-3 pr-6 py-2.5 text-right text-stone-500">
                    {m.netMargin.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

