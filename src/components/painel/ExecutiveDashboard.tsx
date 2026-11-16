'use client';

import { TABLE_HEAD, Th } from '@/components/ui/Table';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Lightbulb, Printer, TrendingUp } from 'lucide-react';
import type { ClientCompany } from '@/types/firestore';
import type { ExecutiveSummary } from '@/lib/executive-metrics';
import { executiveInsights } from '@/lib/executive-insights';
import { formatCNPJ, formatCurrency } from '@/lib/utils/formatters';
import { BUTTON, EmptyState, SURFACE } from '@/components/ui/primitives';
import {
  MarginTrendChart,
  OutflowCompositionChart,
  ResultBridgeChart,
  RevenueAndResultChart,
  RevenueComparisonChart,
  Sparkline,
  TopExpensesChart,
  VIZ_COLOR,
} from '@/components/painel/ExecutiveCharts';

const REGIME_LABEL: Record<ClientCompany['regime'], string> = {
  SIMPLES_NACIONAL: 'Simples Nacional',
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  LUCRO_REAL: 'Lucro Real',
  MEI: 'MEI',
};

const pct = (value: number) => `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

export interface ExecutiveDashboardProps {
  client: ClientCompany;
  summary: ExecutiveSummary;
}

/** Variação frente aos 12 meses anteriores: seta, sinal e a cor de bom ou ruim. */
function Delta({ value, title }: { value: number | null; title: string }) {
  if (value === null) return null;
  const up = value >= 0;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10.5px] font-mono font-semibold ${
        up ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
      }`}
    >
      {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {up ? '+' : ''}
      {pct(value)}
    </span>
  );
}

/** Indicador: rótulo, número, legenda e o minigráfico dos 12 meses. */
function Kpi({
  label,
  value,
  caption,
  delta,
  tone = 'neutral',
  spark,
}: {
  label: string;
  value: string;
  caption: string;
  delta?: React.ReactNode;
  tone?: 'neutral' | 'good' | 'bad';
  spark: { values: readonly number[]; color: string; label: string };
}) {
  const ink = tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'bad' ? 'text-rose-600 dark:text-rose-400' : 'text-stone-900 dark:text-stone-100';
  return (
    <div className="px-5 pt-4 pb-3 bg-white/85 dark:bg-stone-900/85 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-stone-500">{label}</p>
        {delta}
      </div>
      <p className={`mt-1.5 text-[24px] leading-none font-semibold tracking-tight font-mono tabular-nums ${ink}`}>{value}</p>
      <p className="mt-2 text-[11px] text-stone-500 dark:text-stone-400">{caption}</p>
      <div className="mt-1.5 print:hidden">
        <Sparkline {...spark} />
      </div>
    </div>
  );
}

function Card({ title, subtitle, className = '', children }: { title: string; subtitle: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`${SURFACE} rounded-[22px] p-6 space-y-4 min-w-0 print:break-inside-avoid ${className}`}>
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">{title}</h2>
        <p className="text-[12px] text-stone-500">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * Visão Executiva para a diretoria do cliente: os últimos 12 meses comparados com os 12
 * anteriores, em indicadores, gráficos e uma leitura em texto do que os números dizem.
 */
export function ExecutiveDashboard({ client, summary }: ExecutiveDashboardProps) {
  const isProfitable = summary.twelveMonthsNetResult >= 0;
  const months = summary.monthly;
  const insights = executiveInsights(summary);
  const versus = `Frente a ${summary.previous.periodLabel}`;

  return (
    <div className="space-y-5" role="region" aria-label="Visão Executiva">
      {/* Barra executiva de contexto e impressão */}
      <div className={`${SURFACE} rounded-[22px] px-6 py-4 flex flex-wrap items-center justify-between gap-4`}>
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-stone-500">
            <span className="inline-flex items-center gap-1 font-medium text-stone-800 dark:text-stone-200">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-300" />
              Relatório Executivo para a Diretoria
            </span>
            <span>·</span>
            <span>
              Período: <strong className="font-mono text-stone-700 dark:text-stone-300">{summary.periodLabel}</strong> (12 meses)
            </span>
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
              : ainda não entram nestes números.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 print:hidden">
          <Link href="/dre" className={`${BUTTON.secondary} h-9 px-3.5 text-[12px]`}>
            Ver DRE Completa
          </Link>
          <button type="button" onClick={() => window.print()} className={`${BUTTON.secondary} h-9 px-3.5 text-[12px]`} title="Imprimir ou salvar PDF executivo para enviar ao cliente">
            <Printer className="w-3.5 h-3.5" />
            <span>Imprimir Relatório</span>
          </button>
        </div>
      </div>

      {summary.monthsWithData === 0 ? (
        <section className={`${SURFACE} rounded-[22px]`}>
          <EmptyState
            title="Ainda não há resultado para mostrar"
            description={`Nenhuma receita ou gasto conciliado entre ${summary.periodLabel}. Classifique os lançamentos na Conciliação e os gráficos aparecem aqui.`}
            action={
              <Link href="/" className={BUTTON.primary}>
                Abrir a Conciliação
              </Link>
            }
          />
        </section>
      ) : (
        <>
          {/* Indicadores dos 12 meses, com a variação e a forma do período */}
          <section
            aria-label="Indicadores-chave dos últimos 12 meses"
            className="rounded-[22px] overflow-hidden grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-black/5 dark:bg-white/6 border border-line shadow-card"
          >
            <Kpi
              label="Faturamento Bruto (12M)"
              value={formatCurrency(summary.twelveMonthsGrossRevenue)}
              caption={`Média mensal: ${formatCurrency(summary.twelveMonthsGrossRevenue / 12)}`}
              delta={<Delta value={summary.twelveMonthsGrossRevenueVariation} title={versus} />}
              spark={{ values: months.map((m) => m.grossRevenue), color: VIZ_COLOR.revenue, label: 'Receita bruta mês a mês' }}
            />
            <Kpi
              label="Receita Líquida (12M)"
              value={formatCurrency(summary.twelveMonthsNetRevenue)}
              caption="Após deduções e tributos s/ vendas"
              spark={{ values: months.map((m) => m.netRevenue), color: VIZ_COLOR.revenue, label: 'Receita líquida mês a mês' }}
            />
            <Kpi
              label="Resultado Líquido (12M)"
              value={formatCurrency(summary.twelveMonthsNetResult)}
              caption={isProfitable ? 'Lucro líquido acumulado' : 'Prejuízo líquido no período'}
              tone={isProfitable ? 'good' : 'bad'}
              delta={<Delta value={summary.twelveMonthsNetResultVariation} title={versus} />}
              spark={{ values: months.map((m) => m.cumulativeResult), color: VIZ_COLOR.result, label: 'Resultado líquido acumulado mês a mês' }}
            />
            <Kpi
              label="Margem Líquida & EBITDA"
              value={pct(summary.twelveMonthsNetMargin)}
              caption={`EBITDA est.: ${formatCurrency(summary.twelveMonthsEbitda)} (${pct(summary.twelveMonthsEbitdaMargin)})`}
              tone={summary.twelveMonthsNetMargin >= 0 ? 'neutral' : 'bad'}
              spark={{ values: months.map((m) => m.netMargin), color: VIZ_COLOR.result, label: 'Margem líquida mês a mês' }}
            />
          </section>

          {/* Leitura: o que os números dizem, em frases */}
          {insights.length > 0 && (
            <section aria-label="Leitura do período" className={`${SURFACE} rounded-[22px] px-6 py-4 print:break-inside-avoid`}>
              <h2 className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
                <Lightbulb className="w-4 h-4 text-amber-500" />
                Leitura do período
              </h2>
              <ul className="mt-2.5 grid gap-x-8 gap-y-1.5 md:grid-cols-2 text-[13px] text-stone-700 dark:text-stone-300">
                {insights.map((text) => (
                  <li key={text} className="flex gap-2">
                    <span aria-hidden className="mt-[7px] w-1.5 h-1.5 rounded-full bg-stone-400 shrink-0" />
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Card title="Faturamento, gastos e resultado mês a mês" subtitle="O que entrou, o que saiu em custos, despesas e tributos, e o que sobrou em cada mês.">
            <RevenueAndResultChart monthly={months} />
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <Card className="lg:col-span-7" title="Da receita ao resultado (12 meses)" subtitle="Quanto da receita bruta fica em cada grupo de gasto até chegar ao resultado líquido.">
              <ResultBridgeChart steps={summary.bridge} />
            </Card>
            <Card className="lg:col-span-5" title="Faturamento × ano anterior" subtitle="Receita bruta de cada mês e a do mesmo mês um ano antes.">
              <RevenueComparisonChart monthly={months} currentLabel={summary.periodLabel} previousLabel={summary.previous.periodLabel} />
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <Card className="lg:col-span-7" title="Composição dos gastos mês a mês" subtitle={`Como os ${formatCurrency(summary.costComposition.total)} de custos, despesas e tributos se distribuem.`}>
              <OutflowCompositionChart monthly={months} composition={summary.costComposition} />
            </Card>
            <Card className="lg:col-span-5" title="Margem líquida (%)" subtitle="Quanto de cada R$ 100 de receita líquida sobrou como resultado.">
              <MarginTrendChart monthly={months} average={summary.twelveMonthsNetMargin} />
            </Card>
          </div>

          <Card title="Maiores gastos do período" subtitle="As contas de custo e despesa que mais pesaram em 12 meses, com a participação no total.">
            <TopExpensesChart expenses={summary.topExpenses} />
          </Card>

          {/* Tabela Executiva Mês a Mês */}
          <section className={`${SURFACE} rounded-[22px] overflow-hidden print:break-inside-avoid`}>
            <div className="px-6 py-4 border-b border-black/4 dark:border-white/6 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">Demonstrativo Gerencial Mês a Mês</h2>
              <span className="text-[12px] text-stone-500 dark:text-stone-400 font-mono">{summary.periodLabel}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className={TABLE_HEAD}>
                    <Th className="pl-6 pr-3 py-2.5">Mês</Th>
                    <Th align="right">Receita Bruta</Th>
                    <Th align="right">Tributos / Ded.</Th>
                    <Th align="right">Custos (CMV/CSP)</Th>
                    <Th align="right">Despesas Op./Fin.</Th>
                    <Th align="right">Resultado Líquido</Th>
                    <Th align="right">Margem</Th>
                    <Th align="right" className="pl-3 pr-6 py-2.5">Acumulado</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/4 dark:divide-white/5 font-mono tabular-nums">
                  {months.map((m) => (
                    <tr key={m.month} className="hover:bg-black/2 dark:hover:bg-white/3 transition-colors">
                      <td className="pl-6 pr-3 py-2.5 font-sans font-medium uppercase text-stone-700 dark:text-stone-300">{m.label}</td>
                      <td className="px-3 py-2.5 text-right text-stone-900 dark:text-stone-100">{formatCurrency(m.grossRevenue)}</td>
                      <td className="px-3 py-2.5 text-right text-stone-500">{formatCurrency(m.taxes)}</td>
                      <td className="px-3 py-2.5 text-right text-stone-600 dark:text-stone-400">{formatCurrency(m.costs)}</td>
                      <td className="px-3 py-2.5 text-right text-stone-600 dark:text-stone-400">{formatCurrency(m.operatingExpenses + m.financialExpenses)}</td>
                      <td className={`px-3 py-2.5 text-right font-semibold ${m.netResult >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {formatCurrency(m.netResult)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-stone-500">{pct(m.netMargin)}</td>
                      <td className={`pl-3 pr-6 py-2.5 text-right ${m.cumulativeResult >= 0 ? 'text-stone-700 dark:text-stone-300' : 'text-rose-600 dark:text-rose-400'}`}>
                        {formatCurrency(m.cumulativeResult)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line-strong font-mono tabular-nums font-semibold text-stone-900 dark:text-stone-100">
                    <td className="pl-6 pr-3 py-3 font-sans">12 meses</td>
                    <td className="px-3 py-3 text-right">{formatCurrency(summary.twelveMonthsGrossRevenue)}</td>
                    <td className="px-3 py-3 text-right">{formatCurrency(summary.costComposition.taxes)}</td>
                    <td className="px-3 py-3 text-right">{formatCurrency(summary.costComposition.costs)}</td>
                    <td className="px-3 py-3 text-right">{formatCurrency(summary.costComposition.operatingExpenses + summary.costComposition.financialExpenses)}</td>
                    <td className={`px-3 py-3 text-right ${isProfitable ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{formatCurrency(summary.twelveMonthsNetResult)}</td>
                    <td className="px-3 py-3 text-right">{pct(summary.twelveMonthsNetMargin)}</td>
                    <td className="pl-3 pr-6 py-3" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
