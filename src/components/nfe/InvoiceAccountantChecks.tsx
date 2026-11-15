'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowUpRight, CheckCircle2, Scale } from 'lucide-react';
import { formatGapRange, type BillingRevenueComparison, type NumberingGapGroup } from '@/lib/nfe/checks';
import { SURFACE } from '@/components/ui/primitives';
import { formatCurrency } from '@/lib/utils/formatters';

interface InvoiceAccountantChecksProps {
  gaps: readonly NumberingGapGroup[];
  comparison: BillingRevenueComparison | null;
  /** Competência (AAAA-MM) quando o filtro de período está em modo mensal, para abrir a Conciliação. */
  selectedMonth?: string | null;
  /** Filtra a tabela diretamente nas notas de venda sem lançamento. */
  onFilterOpenSales?: () => void;
}

/**
 * Conferências do contador:
 * 1. Furos na numeração das notas emitidas pela empresa (XML faltante ou inutilização).
 * 2. Faturamento pelas notas de venda ao lado da Receita Bruta lançada na contabilidade.
 */
export function InvoiceAccountantChecks({
  gaps,
  comparison,
  selectedMonth,
  onFilterOpenSales,
}: InvoiceAccountantChecksProps) {
  const showBilling = Boolean(comparison && (comparison.salesCount > 0 || comparison.launchedGross > 0));
  if (gaps.length === 0 && !showBilling) return null;

  return (
    <div className="space-y-3">
      {gaps.length > 0 && (
        <section
          aria-label="Furos na numeração das notas emitidas"
          className="rounded-2xl border border-amber-200/80 dark:border-amber-500/25 bg-amber-50/70 dark:bg-amber-950/25 px-4 py-3.5 text-[13px] text-amber-900 dark:text-amber-200 space-y-1.5"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-1 min-w-0 flex-1">
              <p className="font-semibold text-amber-950 dark:text-amber-100">
                Numeração das notas emitidas com salto neste período
              </p>
              <ul className="space-y-0.5 text-[12.5px] text-amber-900/90 dark:text-amber-200/90">
                {gaps.map((g) => {
                  const shown = g.ranges.slice(0, 6).map(formatGapRange).join(', ');
                  const extra = g.ranges.length > 6 ? ` e mais ${g.ranges.length - 6} faixa(s)` : '';
                  return (
                    <li key={`${g.model}-${g.series}`}>
                      <b className="font-semibold">{g.label}</b> (de {g.minNumber} a {g.maxNumber}):{' '}
                      {g.missingCount === 1 ? 'falta o número ' : `faltam ${g.missingCount} números (`}
                      <span className="font-mono tabular-nums font-medium">{shown}</span>
                      {extra}
                      {g.missingCount === 1 ? '.' : ').'}
                    </li>
                  );
                })}
              </ul>
              <p className="text-[11.5px] text-amber-800/80 dark:text-amber-300/80">
                Peça ao cliente o XML que falta (inclusive de nota cancelada) ou confirme se a numeração foi inutilizada na SEFAZ.
              </p>
            </div>
          </div>
        </section>
      )}

      {showBilling && comparison && (
        <section
          aria-label="Faturamento pelas notas e receita lançada"
          className={`${SURFACE} rounded-[20px] px-5 py-4 space-y-3`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Scale className="w-4 h-4 text-accent-ink shrink-0" strokeWidth={1.9} />
              <h2 className="text-[13.5px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
                Conferência do faturamento (Notas de venda × Receita lançada)
              </h2>
            </div>
            {comparison.matches ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11.5px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/50">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Faturamento confere com a receita
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11.5px] font-medium bg-amber-50 text-amber-700 border border-amber-200/70 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/50">
                Diferença de <span className="font-mono tabular-nums font-semibold">{formatCurrency(Math.abs(comparison.difference))}</span>
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <div className="rounded-xl bg-stone-50/80 dark:bg-stone-900/50 border border-black/4 dark:border-white/6 px-3.5 py-2.5">
              <p className="text-[11px] font-medium text-stone-500 dark:text-stone-400">
                Faturamento pelas notas ({comparison.salesCount} de venda)
              </p>
              <p className="mt-1 text-[17px] font-semibold font-mono tabular-nums text-stone-900 dark:text-stone-100">
                {formatCurrency(comparison.invoicedGross)}
              </p>
              {comparison.invoicedNet !== comparison.invoicedGross && (
                <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
                  Líquido de retenções: <span className="font-mono tabular-nums">{formatCurrency(comparison.invoicedNet)}</span>
                </p>
              )}
              {comparison.fixedAssetSalesCount > 0 && (
                <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
                  +{formatCurrency(comparison.fixedAssetSalesTotal)} em venda de imobilizado ({comparison.fixedAssetSalesCount})
                </p>
              )}
            </div>

            <div className="rounded-xl bg-stone-50/80 dark:bg-stone-900/50 border border-black/4 dark:border-white/6 px-3.5 py-2.5">
              <p className="text-[11px] font-medium text-stone-500 dark:text-stone-400">
                Receita Bruta lançada (DRE / 3.1.1)
              </p>
              <p className="mt-1 text-[17px] font-semibold font-mono tabular-nums text-stone-900 dark:text-stone-100">
                {formatCurrency(comparison.launchedGross)}
              </p>
              <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400 truncate">
                {comparison.revenueLines.length > 0
                  ? comparison.revenueLines.map((l) => `${l.name}: ${formatCurrency(l.value)}`).join(' · ')
                  : 'Nenhuma receita conciliada no período'}
              </p>
            </div>

            <div className="rounded-xl bg-stone-50/80 dark:bg-stone-900/50 border border-black/4 dark:border-white/6 px-3.5 py-2.5 flex flex-col justify-between">
              <div>
                <p className="text-[11px] font-medium text-stone-500 dark:text-stone-400">
                  {comparison.matches
                    ? 'Situação da base'
                    : comparison.difference > 0
                      ? 'Notas acima da receita lançada'
                      : 'Receita lançada acima das notas'}
                </p>
                <p
                  className={`mt-1 text-[17px] font-semibold font-mono tabular-nums ${
                    comparison.matches
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-amber-700 dark:text-amber-300'
                  }`}
                >
                  {comparison.matches
                    ? 'R$ 0,00'
                    : `${comparison.difference > 0 ? '+' : '-'}${formatCurrency(Math.abs(comparison.difference))}`}
                </p>
              </div>
              {!comparison.matches && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
                  {comparison.openSalesCount > 0 && onFilterOpenSales && (
                    <button
                      type="button"
                      onClick={onFilterOpenSales}
                      className="font-medium text-accent-ink hover:underline text-left"
                    >
                      {comparison.openSalesCount} venda(s) sem lançamento ({formatCurrency(comparison.openSalesTotal)})
                    </button>
                  )}
                  {comparison.pendingCreditsCount > 0 && (
                    <Link
                      href={selectedMonth ? `/?mes=${selectedMonth}&filtro=PENDING` : '/'}
                      className="inline-flex items-center gap-0.5 font-medium text-accent-ink hover:underline"
                    >
                      <span>
                        {comparison.pendingCreditsCount} entrada(s) pendente(s) no extrato ({formatCurrency(comparison.pendingCreditsTotal)})
                      </span>
                      <ArrowUpRight className="w-3 h-3" />
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
