import type { ExecutiveSummary } from '@/lib/executive-metrics';
import { formatCurrency } from '@/lib/utils/formatters';

/**
 * Leitura do período da Visão Executiva: o que os números dos 12 meses dizem, em frases curtas
 * para a diretoria do cliente. Só afirma o que os dados mostram; sem base (ano anterior vazio,
 * mês sem receita), a frase não aparece.
 */

const pct = (value: number, digits = 1) => `${Math.abs(value).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;

export function executiveInsights(summary: ExecutiveSummary): string[] {
  const out: string[] = [];
  const months = summary.monthly.filter((m) => Math.abs(m.grossRevenue) > 0.005 || Math.abs(m.outflows) > 0.005);
  if (months.length === 0) return out;

  // Faturamento frente aos 12 meses anteriores.
  const yoy = summary.twelveMonthsGrossRevenueVariation;
  if (yoy !== null) {
    out.push(
      Math.abs(yoy) < 0.05
        ? `O faturamento ficou estável frente a ${summary.previous.periodLabel} (${formatCurrency(summary.previous.grossRevenue)}).`
        : `O faturamento ${yoy > 0 ? 'cresceu' : 'caiu'} ${pct(yoy)} frente a ${summary.previous.periodLabel} (de ${formatCurrency(summary.previous.grossRevenue)} para ${formatCurrency(summary.twelveMonthsGrossRevenue)}).`
    );
  }

  // Quanto sobra de cada R$ 100.
  if (Math.abs(summary.twelveMonthsNetRevenue) > 0.005) {
    const kept = summary.twelveMonthsNetMargin;
    out.push(
      kept >= 0
        ? `De cada R$ 100 de receita líquida, sobraram R$ ${kept.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} de resultado.`
        : `Os gastos passaram da receita líquida: prejuízo de ${pct(kept)} sobre ela no período.`
    );
  }

  // Melhor e pior mês pelo resultado.
  if (months.length > 1) {
    const best = months.reduce((a, b) => (b.netResult > a.netResult ? b : a));
    const worst = months.reduce((a, b) => (b.netResult < a.netResult ? b : a));
    if (best.month !== worst.month) {
      out.push(`Melhor mês: ${best.label}, com resultado de ${formatCurrency(best.netResult)}. Pior: ${worst.label}, com ${formatCurrency(worst.netResult)}.`);
    }
  }

  // Meses no vermelho.
  const losses = months.filter((m) => m.netResult < -0.005);
  if (losses.length > 0) {
    out.push(
      losses.length === months.length
        ? `Todos os ${months.length} meses com movimento fecharam com prejuízo.`
        : `${losses.length} de ${months.length} meses com movimento ${losses.length === 1 ? 'fechou' : 'fecharam'} com prejuízo: ${losses.map((m) => m.label).join(', ')}.`
    );
  }

  // Onde está o maior gasto.
  const top = summary.topExpenses[0];
  if (top?.code) {
    out.push(`Maior gasto: ${top.name}, com ${formatCurrency(top.value)} (${pct(top.share, 0)} dos custos e despesas).`);
  }

  // O grupo que mais pesa na composição.
  const c = summary.costComposition;
  if (c.total > 0.005) {
    const groups: [string, number][] = [
      ['os custos (CMV/CSP)', c.costsPct],
      ['as despesas operacionais', c.operatingExpensesPct],
      ['os tributos e deduções', c.taxesPct],
      ['as despesas financeiras', c.financialExpensesPct],
    ];
    const [name, share] = groups.reduce((a, b) => (b[1] > a[1] ? b : a));
    out.push(`Do total que saiu, ${pct(share, 0)} foram ${name}.`);
  }

  return out;
}
