import { ArrowDownRight, ArrowUpRight, Info, Minus } from 'lucide-react';
import { formatDateBR } from '@/lib/utils/formatters';
import { formatIndicator, INDICATOR_GROUP_LABEL, type FinancialAnalysis as Analysis, type Indicator, type IndicatorGroup, type IndicatorTone } from '@/lib/financial-indicators';
import { SURFACE } from '@/components/ui/primitives';
import { TABLE_HEAD, Th } from '@/components/ui/Table';
import { AccountingAmount } from '@/components/ui/Amount';

const TONE: Record<IndicatorTone, { dot: string; label: string }> = {
  good: { dot: 'bg-emerald-500', label: 'Confortável' },
  attention: { dot: 'bg-amber-500', label: 'Atenção' },
  bad: { dot: 'bg-rose-500', label: 'Desfavorável' },
};

const GROUPS: readonly IndicatorGroup[] = ['liquidity', 'debt', 'profitability'];

/** Seta da variação: verde quando melhora (pelo sentido do índice), vermelha quando piora. */
function Trend({ ind }: { ind: Indicator }) {
  if (ind.value === null || ind.previous === null || ind.higherIsBetter === null) return null;
  const diff = ind.value - ind.previous;
  if (Math.abs(diff) < (ind.format === 'currency' ? 0.005 : 0.0005)) {
    return <Minus className="w-3.5 h-3.5 text-stone-400" aria-label="Sem variação" />;
  }
  const better = diff > 0 === ind.higherIsBetter;
  const Icon = diff > 0 ? ArrowUpRight : ArrowDownRight;
  return <Icon className={`w-3.5 h-3.5 ${better ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`} aria-label={better ? 'Melhorou' : 'Piorou'} />;
}

/** Quadro dos índices de liquidez, endividamento e rentabilidade, com o exercício anterior ao lado. */
export function FinancialAnalysis({ analysis }: { analysis: Analysis }) {
  const { groups, previousGroups } = analysis;
  const hasPrevious = Boolean(analysis.previousDate);
  const summary: { label: string; now: number; before?: number }[] = [
    { label: 'Ativo circulante', now: groups.currentAssets, before: previousGroups?.currentAssets },
    { label: 'Passivo circulante', now: groups.currentLiabilities, before: previousGroups?.currentLiabilities },
    { label: 'Passivo não circulante', now: groups.nonCurrentLiabilities, before: previousGroups?.nonCurrentLiabilities },
    { label: 'Patrimônio líquido', now: groups.equity, before: previousGroups?.equity },
  ];

  return (
    <div className="space-y-6">
      {analysis.warnings.length > 0 && (
        <ul className="space-y-1.5" aria-label="Avisos da análise">
          {analysis.warnings.map((w) => (
            <li key={w} className="flex gap-2 text-[12.5px] text-amber-800 dark:text-amber-300">
              <Info className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.75} />
              {w}
            </li>
          ))}
        </ul>
      )}

      <section aria-label="Grupos patrimoniais" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {summary.map((s) => (
          <div key={s.label} className={`${SURFACE} rounded-[18px] px-4 py-3.5`}>
            <p className="text-[11.5px] font-medium text-stone-500 dark:text-stone-400">{s.label}</p>
            <AccountingAmount value={s.now} className="block mt-1 text-[17px] font-semibold tracking-tight" />
            {s.before !== undefined && (
              <p className="mt-0.5 text-[11.5px] text-stone-500 dark:text-stone-400">
                {formatDateBR(analysis.previousDate!)}: <AccountingAmount value={s.before} />
              </p>
            )}
          </div>
        ))}
      </section>

      {GROUPS.map((group) => (
        <section key={group} className={`${SURFACE} rounded-[22px] overflow-hidden print-avoid-break`} aria-label={INDICATOR_GROUP_LABEL[group]}>
          <div className="px-5 py-3.5 border-b border-black/4 dark:border-white/6">
            <h2 className="text-[14px] font-semibold tracking-tight">{INDICATOR_GROUP_LABEL[group]}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className={TABLE_HEAD}>
                  <Th edge="start">Índice</Th>
                  <Th align="right">{formatDateBR(analysis.date)}</Th>
                  {hasPrevious && <Th align="right">{formatDateBR(analysis.previousDate!)}</Th>}
                  <Th edge="end">Leitura</Th>
                </tr>
              </thead>
              <tbody>
                {analysis.indicators
                  .filter((i) => i.group === group)
                  .map((ind) => (
                    <tr key={ind.key} className="border-b border-black/4 dark:border-white/5 last:border-0 text-[13px] align-top">
                      <td className="pl-5 pr-3 py-3">
                        <p className="font-medium text-stone-900 dark:text-stone-100">{ind.label}</p>
                        <p className="text-[11.5px] text-stone-500 dark:text-stone-400">{ind.formula}</p>
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <Trend ind={ind} />
                          {formatIndicator(ind.value, ind.format)}
                        </span>
                      </td>
                      {hasPrevious && (
                        <td className="px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap text-stone-500 dark:text-stone-400">
                          {formatIndicator(ind.previous, ind.format)}
                        </td>
                      )}
                      <td className="pl-3 pr-5 py-3 text-[12px] text-stone-600 dark:text-stone-300 max-w-[360px]">
                        {ind.tone && (
                          <span className="inline-flex items-center gap-1.5 mr-1.5 font-medium">
                            <span className={`w-2 h-2 rounded-full ${TONE[ind.tone].dot}`} aria-hidden />
                            {TONE[ind.tone].label}.
                          </span>
                        )}
                        {ind.meaning}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <p className="text-[12px] text-stone-500 dark:text-stone-400">
        As faixas de leitura são referências usuais de análise, não normas: compare sempre com o histórico da empresa e com o setor. A rentabilidade usa a DRE do
        exercício até a data (antes do encerramento) e o patrimônio do fim do período.
      </p>
    </div>
  );
}
