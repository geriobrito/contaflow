'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { FileText, ReceiptText } from 'lucide-react';
import { useClient } from '@/contexts/ClientContext';
import { useSimplesSimulation } from '@/hooks/simples/useSimplesSimulation';
import { PeriodPicker, usePeriod } from '@/components/ui/PeriodPicker';
import { SIMPLES_SIMULATION_NOTES, simplesConclusion, simplesFigures, simulateSimplesIbsCbs, type ObservedRate } from '@/lib/simples-ibs-cbs';
import { statementSignatories } from '@/lib/balance-sheet-view';
import { fromCents } from '@/lib/money';
import { reportError } from '@/lib/monitoring';
import { describeError } from '@/lib/utils/errors';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, CardHeader, EmptyState, Field, INPUT, OVERLINE, PAGE, PageHeader, SURFACE } from '@/components/ui/primitives';
import { CardsSkeleton } from '@/components/ui/Skeleton';
import { Toast, useToast } from '@/components/ui/Toast';

const money = (cents: number) => formatCurrency(fromCents(cents));
const rateText = (r: number) => r.toLocaleString('pt-BR', { maximumFractionDigits: 4 });

/** "3,25" ou "3.25" → 3.25; vazio ou fora de 0–100 → null. */
function parseRate(text: string): number | null {
  const t = text.trim().replace('%', '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

interface RateFieldProps {
  label: string;
  value: string;
  onChange: (text: string) => void;
  observed: ObservedRate | null;
  observedWhere: string;
  missingHint: string;
}

function RateField({ label, value, onChange, observed, observedWhere, missingHint }: RateFieldProps) {
  const bad = value.trim() !== '' && parseRate(value) === null;
  return (
    <Field
      label={label}
      error={bad ? 'Informe um percentual entre 0 e 100.' : null}
      hint={
        observed ? (
          <>
            Observada em {observed.invoices} {observedWhere} ({rateText(observed.rate)}%).{' '}
            {parseRate(value) !== observed.rate && (
              <button type="button" onClick={() => onChange(rateText(observed.rate))} className="font-medium text-accent-ink hover:underline">
                Usar a observada
              </button>
            )}
          </>
        ) : (
          missingHint
        )
      }
    >
      <div className="relative">
        <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0,00" aria-invalid={bad} className={`${INPUT} pr-9 text-right font-mono tabular-nums`} />
        <span aria-hidden className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] text-stone-500">
          %
        </span>
      </div>
    </Field>
  );
}

/**
 * Simulação para empresa do Simples: IBS e CBS dentro do DAS ou por fora (regime regular), com a
 * receita e as compras das notas fiscais do período e o relatório de assessoria em PDF.
 */
export default function SimplesIbsCbsPage() {
  const { currentClient } = useClient();
  const period = usePeriod('year');
  const { invoices, org, loading, error } = useSimplesSimulation(currentClient?.id, currentClient ? period.range : null);
  const [toast, setToast] = useToast();
  // Alíquotas digitadas, por empresa (sem digitação, vale a observada nas notas).
  const [typed, setTyped] = useState<Record<string, { simples?: string; full?: string }>>({});

  const figures = useMemo(() => (invoices ? simplesFigures(invoices) : null), [invoices]);
  const clientKey = currentClient?.id ?? '';
  const mine = typed[clientKey] ?? {};
  const simplesText = mine.simples ?? (figures?.observedSimplesRate ? rateText(figures.observedSimplesRate.rate) : '');
  const fullText = mine.full ?? (figures?.observedFullRate ? rateText(figures.observedFullRate.rate) : '');
  const setRate = (which: 'simples' | 'full') => (text: string) => setTyped((t) => ({ ...t, [clientKey]: { ...t[clientKey], [which]: text } }));
  const simplesRate = parseRate(simplesText);
  const fullRate = parseRate(fullText);

  const simulation = useMemo(
    () => (figures && simplesRate !== null && fullRate !== null ? simulateSimplesIbsCbs(figures, simplesRate, fullRate) : null),
    [figures, simplesRate, fullRate]
  );
  const conclusion = figures && simulation ? simplesConclusion(figures, simulation) : null;

  const sourceOf = (rate: number | null, observed: ObservedRate | null, where: string) =>
    observed && rate === observed.rate ? `observada em ${observed.invoices} ${where}` : 'informada pelo contador';

  const exportPdf = async () => {
    if (!currentClient || !figures || !simulation || simplesRate === null || fullRate === null || !conclusion) return;
    try {
      const [{ downloadBlob }, mod] = await Promise.all([import('@/lib/export/dre-rows'), import('@/lib/export/simples-ibs-cbs-pdf')]);
      const file = mod.generateSimplesIbsCbsPdf({
        client: currentClient,
        periodLabel: `Período: ${formatDateBR(period.range.start)} a ${formatDateBR(period.range.end)}`,
        figures,
        simulation,
        simplesRate,
        fullRate,
        simplesRateSource: sourceOf(simplesRate, figures.observedSimplesRate, 'nota(s) de venda'),
        fullRateSource: sourceOf(fullRate, figures.observedFullRate, 'nota(s) de compra de tributação integral'),
        conclusion,
        notes: SIMPLES_SIMULATION_NOTES,
        issuedAt: new Date(),
        signatories: statementSignatories(currentClient, org),
      });
      downloadBlob(file.blob, file.fileName);
    } catch (e) {
      reportError(e, { area: 'simples-ibs-cbs', op: 'exportar pdf' });
      setToast(`Não foi possível gerar o relatório (${describeError(e)}).`);
    }
  };

  const isSimples = currentClient?.regime === 'SIMPLES_NACIONAL';

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="IBS/CBS no Simples"
        description="Dentro do DAS ou por fora, no regime regular? Compara o IBS e a CBS que a empresa paga e o crédito que os clientes empresa aproveitam, com as notas fiscais do período."
        actions={
          isSimples ? (
            <>
              <PeriodPicker period={period} />
              <button type="button" disabled={!simulation} onClick={() => void exportPdf()} className={BUTTON.secondary}>
                <FileText className="w-4 h-4" />
                PDF
              </button>
            </>
          ) : undefined
        }
      />

      {!currentClient ? null : !isSimples ? (
        <section className={`${SURFACE} rounded-[22px]`}>
          <EmptyState
            title="Simulação para empresa do Simples Nacional"
            description="A empresa ativa não está no Simples Nacional (o MEI não tem a opção). Troque de empresa ou ajuste o regime em Clientes."
          />
        </section>
      ) : error ? (
        <p role="alert" className="rounded-2xl px-4 py-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-200/60 dark:border-rose-500/25 text-[13px] text-rose-700 dark:text-rose-300">
          Não foi possível carregar as notas do período ({error}).
        </p>
      ) : loading || !figures ? (
        <CardsSkeleton count={2} className="grid gap-4 md:grid-cols-2" label="Carregando notas do período…" />
      ) : (
        <>
          <section aria-label="Números do período" className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            <CardHeader icon={ReceiptText} title="Números do período" meta="das notas fiscais importadas" />
            {figures.sales.count === 0 ? (
              <p className="px-5 py-5 text-[13px] text-stone-600 dark:text-stone-300">
                Nenhuma nota de venda no período.{' '}
                <Link href="/nfe" className="font-medium text-accent-ink hover:underline">
                  Importe os XML em Notas Fiscais
                </Link>{' '}
                para simular.
              </p>
            ) : (
              <dl className="grid gap-x-8 gap-y-3 px-5 py-4 text-[13px] sm:grid-cols-2 xl:grid-cols-3">
                {[
                  [`Vendas (${figures.sales.count} nota(s))`, money(figures.sales.totalCents)],
                  [`A empresas, que aproveitam crédito (${figures.sales.businessCount})`, money(figures.sales.businessCents)],
                  ['A pessoa física ou consumidor', money(figures.sales.consumerCents)],
                  [`IBS + CBS nas compras (${figures.purchases.count} nota(s))`, money(figures.purchases.taxCents)],
                  ['Sem crédito pela classificação', money(figures.purchases.blockedCents)],
                  ['Crédito aproveitável por fora', money(figures.purchases.creditCents)],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
                    <dt className="text-stone-500 dark:text-stone-400">{label}</dt>
                    <dd className="font-mono tabular-nums text-stone-900 dark:text-stone-100">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <section aria-label="Alíquotas" className={`${SURFACE} rounded-[22px] px-5 py-4 space-y-3`}>
            <p className={OVERLINE}>Alíquotas de IBS + CBS</p>
            <div className="grid gap-5 md:grid-cols-2">
              <RateField
                label="No Simples (parte da alíquota efetiva)"
                value={simplesText}
                onChange={setRate('simples')}
                observed={figures.observedSimplesRate}
                observedWhere="nota(s) de venda"
                missingHint="As notas de venda do período não trazem o IBS/CBS do Simples: informe pelo PGDAS-D a parte da alíquota efetiva que cabe ao IBS e à CBS."
              />
              <RateField
                label="Por fora (alíquota cheia do regime regular)"
                value={fullText}
                onChange={setRate('full')}
                observed={figures.observedFullRate}
                observedWhere="nota(s) de compra de tributação integral"
                missingHint="Nenhuma compra de tributação integral com a base informada: informe a alíquota de CBS + IBS do período."
              />
            </div>
          </section>

          {simulation && conclusion ? (
            <section aria-label="Comparação" className={`${SURFACE} rounded-[22px] overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-[13px]">
                  <thead>
                    <tr className="text-[10.5px] uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400 bg-surface-2 border-b border-line">
                      <th scope="col" className="text-left font-semibold px-5 py-2.5">Comparação</th>
                      <th scope="col" className="text-right font-semibold px-3 py-2.5">Dentro do DAS</th>
                      <th scope="col" className="text-right font-semibold px-5 py-2.5">Por fora</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/4 dark:divide-white/5 font-mono tabular-nums">
                    {[
                      ['Débito sobre as vendas', money(simulation.inside.taxCents), money(simulation.outside.debitCents), false],
                      ['(−) Crédito das compras', '—', money(simulation.outside.purchaseCreditCents), false],
                      ['IBS + CBS pagos pela empresa', money(simulation.inside.taxCents), money(simulation.outside.taxCents), true],
                      ['Crédito dos clientes empresa', money(simulation.inside.buyersCreditCents), money(simulation.outside.buyersCreditCents), true],
                    ].map(([label, inside, outside, strong]) => (
                      <tr key={label as string} className={strong ? 'font-semibold text-stone-900 dark:text-stone-50' : 'text-stone-700 dark:text-stone-300'}>
                        <th scope="row" className="text-left font-sans font-normal px-5 py-2.5">
                          {label}
                        </th>
                        <td className="text-right px-3 py-2.5">{inside}</td>
                        <td className="text-right px-5 py-2.5">{outside}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {simulation.outside.creditBalanceCents > 0 && (
                <p className="px-5 pt-3 text-[12px] text-stone-500 dark:text-stone-400">
                  Por fora, sobram {money(simulation.outside.creditBalanceCents)} de crédito das compras para os meses seguintes.
                </p>
              )}
              <p role="status" className="px-5 py-4 text-[14px] leading-relaxed text-stone-900 dark:text-stone-100">
                {conclusion}
              </p>
            </section>
          ) : (
            figures.sales.count > 0 && <p className="text-[13px] text-stone-500 dark:text-stone-400">Informe as duas alíquotas para comparar.</p>
          )}

          <ul className="space-y-1 text-[12px] leading-relaxed text-stone-500 dark:text-stone-400 list-disc pl-5">
            {SIMPLES_SIMULATION_NOTES.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      )}

      <Toast toast={toast} />
    </main>
  );
}
