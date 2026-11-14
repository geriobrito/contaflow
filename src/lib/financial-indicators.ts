import type { BalanceSheet, BalanceSheetLine } from '@/lib/ledger';
import { VIRTUAL } from '@/lib/ledger';
import type { DREStatement } from '@/lib/dre/build';
import { round2 } from '@/lib/money';

/**
 * Análise das demonstrações: índices de liquidez, endividamento e rentabilidade a partir do
 * balanço e da DRE, com o exercício anterior ao lado.
 *
 * Os grupos saem dos códigos do modelo de plano de contas do CFC (NBC TG 1002, Anexo 11):
 * 1.1 Ativo circulante (1.1.1 disponível, 1.1.3 estoques), 1.2.1 Realizável a longo prazo,
 * 1.2.2 a 1.2.4 investimentos, imobilizado e intangível, 2.1 Passivo circulante, 2.2 Passivo
 * não circulante. "Bancos sem vínculo contábil" conta como disponível; "Lançamentos a
 * classificar" fica fora dos grupos e gera aviso.
 */

export type IndicatorGroup = 'liquidity' | 'debt' | 'profitability';
export type IndicatorFormat = 'ratio' | 'percent' | 'currency';
/** Leitura usual do índice: verde, amarelo, vermelho (só onde há referência consagrada). */
export type IndicatorTone = 'good' | 'attention' | 'bad';

export interface Indicator {
  key: string;
  group: IndicatorGroup;
  label: string;
  /** Fórmula por extenso, para o rodapé e a dica. */
  formula: string;
  /** O que o número diz, em uma frase. */
  meaning: string;
  format: IndicatorFormat;
  /** Null quando o denominador é zero (ou negativo, onde não faz sentido). */
  value: number | null;
  previous: number | null;
  /** Maior é melhor (true), menor é melhor (false) ou depende (null): orienta a seta da variação. */
  higherIsBetter: boolean | null;
  tone: IndicatorTone | null;
}

/** Grupos patrimoniais somados a partir do balanço. */
export interface BalanceGroups {
  currentAssets: number;
  cash: number;
  inventories: number;
  longTermReceivables: number;
  fixedLike: number;
  totalAssets: number;
  currentLiabilities: number;
  nonCurrentLiabilities: number;
  equity: number;
  /** Saldo em "Lançamentos a classificar" (fora de qualquer grupo). */
  suspense: number;
  /** Ativo ou passivo com saldo fora dos grupos 1.1, 1.2, 2.1 e 2.2 (plano fora do modelo do CFC). */
  unmapped: number;
}

export interface FinancialAnalysis {
  date: string;
  previousDate: string | null;
  groups: BalanceGroups;
  previousGroups: BalanceGroups | null;
  indicators: Indicator[];
  /** Avisos de leitura (plano fora do modelo, pendências, PL negativo, exercício parcial). */
  warnings: string[];
}

const startsWithGroup = (code: string, group: string) => code === group || code.startsWith(`${group}.`);
const leafSum = (lines: readonly BalanceSheetLine[], group: string) =>
  round2(lines.filter((l) => !l.synthetic && l.code && startsWithGroup(l.code, group)).reduce((s, l) => s + l.value, 0));
const virtualSum = (lines: readonly BalanceSheetLine[], id: string) => round2(lines.filter((l) => l.accountId === id).reduce((s, l) => s + l.value, 0));

export function balanceGroups(bs: BalanceSheet): BalanceGroups {
  const unlinkedBanks = virtualSum(bs.assets, VIRTUAL.BANK_UNLINKED);
  const currentAssets = round2(leafSum(bs.assets, '1.1') + unlinkedBanks);
  const nonCurrentAssets = leafSum(bs.assets, '1.2');
  const currentLiabilities = leafSum(bs.liabilities, '2.1');
  const nonCurrentLiabilities = leafSum(bs.liabilities, '2.2');
  const suspense = round2(virtualSum(bs.assets, VIRTUAL.SUSPENSE) - virtualSum(bs.liabilities, VIRTUAL.SUSPENSE));
  const assetsOutside = round2(bs.totalAssets - currentAssets - nonCurrentAssets - virtualSum(bs.assets, VIRTUAL.SUSPENSE));
  const liabilitiesOutside = round2(bs.totalLiabilities - currentLiabilities - nonCurrentLiabilities - virtualSum(bs.liabilities, VIRTUAL.SUSPENSE));
  return {
    currentAssets,
    cash: round2(leafSum(bs.assets, '1.1.1') + unlinkedBanks),
    inventories: leafSum(bs.assets, '1.1.3'),
    longTermReceivables: leafSum(bs.assets, '1.2.1'),
    fixedLike: round2(leafSum(bs.assets, '1.2.2') + leafSum(bs.assets, '1.2.3') + leafSum(bs.assets, '1.2.4')),
    totalAssets: bs.totalAssets,
    currentLiabilities,
    nonCurrentLiabilities,
    equity: bs.totalEquity,
    suspense,
    unmapped: round2(Math.abs(assetsOutside) + Math.abs(liabilitiesOutside)),
  };
}

/** Divisão protegida: null sem denominador (ou com denominador negativo, quando pedido). */
const div = (num: number, den: number, positiveOnly = false): number | null =>
  Math.abs(den) < 0.005 || (positiveOnly && den < 0) ? null : num / den;
const pct = (num: number, den: number, positiveOnly = false) => {
  const v = div(num, den, positiveOnly);
  return v === null ? null : v * 100;
};

/** Faixas usuais de leitura (referências de mercado, não normas): liquidez em vezes, endividamento em %. */
const toneAbove = (v: number | null, good: number, attention: number): IndicatorTone | null =>
  v === null ? null : v >= good ? 'good' : v >= attention ? 'attention' : 'bad';
const toneBelow = (v: number | null, good: number, attention: number): IndicatorTone | null =>
  v === null ? null : v <= good ? 'good' : v <= attention ? 'attention' : 'bad';
const toneSign = (v: number | null): IndicatorTone | null => (v === null ? null : v > 0.005 ? 'good' : v < -0.005 ? 'bad' : 'attention');

/** Resultado operacional (antes do resultado financeiro e dos tributos sobre o lucro). */
const operatingResult = (d: DREStatement) => d.grossProfit - d.operatingExpenses + d.otherResult;

function compute(g: BalanceGroups, d: DREStatement | null) {
  const liabilities = g.currentLiabilities + g.nonCurrentLiabilities;
  return {
    current: div(g.currentAssets, g.currentLiabilities),
    quick: div(g.currentAssets - g.inventories, g.currentLiabilities),
    immediate: div(g.cash, g.currentLiabilities),
    general: div(g.currentAssets + g.longTermReceivables, liabilities),
    workingCapital: round2(g.currentAssets - g.currentLiabilities),
    debtRatio: pct(liabilities, g.totalAssets),
    debtComposition: pct(g.currentLiabilities, liabilities),
    leverage: pct(liabilities, g.equity, true),
    fixedOnEquity: pct(g.fixedLike, g.equity, true),
    grossMargin: d ? pct(d.grossProfit, d.netRevenue, true) : null,
    operatingMargin: d ? pct(operatingResult(d), d.netRevenue, true) : null,
    netMargin: d ? pct(d.netResult, d.netRevenue, true) : null,
    roa: d ? pct(d.netResult, g.totalAssets, true) : null,
    roe: d ? pct(d.netResult, g.equity, true) : null,
    assetTurnover: d ? div(d.netRevenue, g.totalAssets, true) : null,
  };
}

/**
 * Análise na data do balanço, com a DRE do exercício até ela; `previous` é o fim do exercício
 * anterior (balanço e DRE do ano inteiro), quando há movimento.
 */
export function buildFinancialAnalysis(args: {
  balanceSheet: BalanceSheet;
  dre: DREStatement | null;
  previous?: { balanceSheet: BalanceSheet; dre: DREStatement | null } | null;
  /** Meses do exercício cobertos pela DRE atual (rentabilidade de exercício parcial não é anualizada). */
  monthsInExercise?: number;
}): FinancialAnalysis {
  const { balanceSheet, dre, previous, monthsInExercise } = args;
  const groups = balanceGroups(balanceSheet);
  const previousGroups = previous ? balanceGroups(previous.balanceSheet) : null;
  const now = compute(groups, dre);
  const before = previous && previousGroups ? compute(previousGroups, previous.dre) : null;

  const item = (
    key: keyof ReturnType<typeof compute>,
    group: IndicatorGroup,
    label: string,
    formula: string,
    meaning: string,
    format: IndicatorFormat,
    higherIsBetter: boolean | null,
    tone: (v: number | null) => IndicatorTone | null = () => null
  ): Indicator => ({ key, group, label, formula, meaning, format, value: now[key], previous: before ? before[key] : null, higherIsBetter, tone: tone(now[key]) });

  const indicators: Indicator[] = [
    item('current', 'liquidity', 'Liquidez corrente', 'Ativo circulante ÷ Passivo circulante', 'Quanto há de bens e direitos de curto prazo para cada R$ 1 de dívida de curto prazo.', 'ratio', true, (v) => toneAbove(v, 1.2, 1)),
    item('quick', 'liquidity', 'Liquidez seca', '(Ativo circulante − Estoques) ÷ Passivo circulante', 'A mesma cobertura sem contar com a venda dos estoques.', 'ratio', true, (v) => toneAbove(v, 1, 0.7)),
    item('immediate', 'liquidity', 'Liquidez imediata', 'Disponível ÷ Passivo circulante', 'Quanto das dívidas de curto prazo o caixa e os bancos pagariam hoje.', 'ratio', true),
    item('general', 'liquidity', 'Liquidez geral', '(Ativo circulante + Realizável a longo prazo) ÷ (Passivo circulante + não circulante)', 'Cobertura de todas as dívidas pelos direitos realizáveis, de curto e longo prazo.', 'ratio', true, (v) => toneAbove(v, 1, 0.8)),
    item('workingCapital', 'liquidity', 'Capital circulante líquido', 'Ativo circulante − Passivo circulante', 'Folga (ou falta) de recursos de curto prazo, em reais.', 'currency', true, toneSign),
    item('debtRatio', 'debt', 'Endividamento geral', '(Passivo circulante + não circulante) ÷ Ativo total', 'Parte do ativo financiada por terceiros.', 'percent', false, (v) => toneBelow(v, 50, 70)),
    item('debtComposition', 'debt', 'Composição do endividamento', 'Passivo circulante ÷ (Passivo circulante + não circulante)', 'Quanto das dívidas vence no curto prazo.', 'percent', false),
    item('leverage', 'debt', 'Participação de capital de terceiros', '(Passivo circulante + não circulante) ÷ Patrimônio líquido', 'Dívidas para cada R$ 100 de capital próprio.', 'percent', false, (v) => toneBelow(v, 100, 200)),
    item('fixedOnEquity', 'debt', 'Imobilização do patrimônio líquido', '(Investimentos + Imobilizado + Intangível) ÷ Patrimônio líquido', 'Parte do capital próprio aplicada em bens de longo prazo.', 'percent', false, (v) => toneBelow(v, 70, 100)),
    item('grossMargin', 'profitability', 'Margem bruta', 'Lucro bruto ÷ Receita líquida', 'O que sobra da receita depois dos custos.', 'percent', true, toneSign),
    item('operatingMargin', 'profitability', 'Margem operacional', 'Resultado operacional ÷ Receita líquida', 'O que sobra depois de custos e despesas, antes do resultado financeiro e dos tributos sobre o lucro.', 'percent', true, toneSign),
    item('netMargin', 'profitability', 'Margem líquida', 'Resultado líquido ÷ Receita líquida', 'O lucro (ou prejuízo) a cada R$ 100 de receita.', 'percent', true, toneSign),
    item('roa', 'profitability', 'Rentabilidade do ativo (ROA)', 'Resultado líquido ÷ Ativo total', 'Retorno gerado pelo conjunto de bens e direitos.', 'percent', true, toneSign),
    item('roe', 'profitability', 'Rentabilidade do PL (ROE)', 'Resultado líquido ÷ Patrimônio líquido', 'Retorno sobre o capital dos sócios.', 'percent', true, toneSign),
    item('assetTurnover', 'profitability', 'Giro do ativo', 'Receita líquida ÷ Ativo total', 'Quantas vezes o ativo "se transformou" em receita no período.', 'ratio', true),
  ];

  const warnings: string[] = [];
  if (groups.totalAssets > 0.005 && groups.currentAssets === 0 && groups.currentLiabilities === 0 && groups.unmapped > 0.005) {
    warnings.push('O plano de contas não usa os grupos do modelo do CFC (1.1 Ativo circulante, 2.1 Passivo circulante…): os índices de liquidez e endividamento ficam sem base.');
  } else if (groups.unmapped > 0.005) {
    warnings.push('Há saldo em contas patrimoniais fora dos grupos 1.1, 1.2, 2.1 e 2.2: elas não entram nos índices por grupo, só nos totais.');
  }
  if (Math.abs(groups.suspense) > 0.005) warnings.push('Há saldo em "Lançamentos a classificar": concilie os pendentes para os índices refletirem a posição real.');
  if (groups.equity < -0.005) warnings.push('Patrimônio líquido negativo (passivo a descoberto): ROE, participação de terceiros e imobilização do PL não se aplicam.');
  if (dre && monthsInExercise !== undefined && monthsInExercise < 12) {
    warnings.push(`A rentabilidade cobre ${monthsInExercise} ${monthsInExercise === 1 ? 'mês' : 'meses'} do exercício, sem anualizar; a coluna do exercício anterior cobre o ano inteiro.`);
  }

  return { date: balanceSheet.date, previousDate: previous?.balanceSheet.date ?? null, groups, previousGroups, indicators, warnings };
}

/** Texto do índice no formato dele (null vira travessão). */
export function formatIndicator(value: number | null, format: IndicatorFormat): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (format === 'percent') return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  if (format === 'currency') return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const INDICATOR_GROUP_LABEL: Record<IndicatorGroup, string> = {
  liquidity: 'Liquidez',
  debt: 'Estrutura e endividamento',
  profitability: 'Rentabilidade',
};
