'use client';

import { Calculator, Scale, TrendingDown, TrendingUp } from 'lucide-react';
import { formatCurrency } from '@/lib/utils/formatters';
import { StatCard } from '@/components/ui/primitives';

export interface JournalStats {
  count: number;
  /** Lançados nesta tela. */
  manual: number;
  /** Gerados pelas rotinas (depreciação, apropriação, juros, rendimento, CMV, folha, encerramento). */
  generated: number;
  totalVolume: number;
  /** Créditos menos débitos nas contas de resultado: positivo aumenta o lucro do período. */
  resultEffect: number;
}

/** Resumo do período: quantos lançamentos (manuais e das rotinas), o volume e o efeito no resultado. */
export function JournalSummaryCards({ stats }: { stats: JournalStats }) {
  const effect = stats.resultEffect;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <StatCard
        label="Lançamentos no período"
        value={stats.count}
        caption={`${stats.manual} manual(is) · ${stats.generated} das rotinas`}
        icon={Calculator}
      />
      <StatCard label="Volume movimentado" value={formatCurrency(stats.totalVolume)} caption="soma dos débitos (= créditos)" icon={Scale} />
      <StatCard
        label="Efeito no resultado"
        value={`${effect > 0 ? '+' : ''}${formatCurrency(effect)}`}
        caption={effect > 0 ? 'aumenta o lucro do período' : effect < 0 ? 'reduz o lucro do período' : 'sem efeito: só contas patrimoniais'}
        icon={effect < 0 ? TrendingDown : TrendingUp}
        tone={effect > 0 ? 'good' : 'neutral'}
      />
    </div>
  );
}
