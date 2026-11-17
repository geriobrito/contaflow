import type { InvoiceSummary } from '@/types/firestore';
import { blockedCreditCents } from '@/lib/nfe/cclasstrib';
import { toCents } from '@/lib/money';
import { cleanCNPJ } from '@/lib/utils/formatters';

/**
 * Simulação para empresa do Simples Nacional: IBS e CBS dentro do DAS ou apurados por fora, no
 * regime regular (LC 214/2025; NT 2026.005).
 *
 * - Dentro do DAS: o IBS e a CBS saem embutidos na alíquota efetiva do Simples (pIBSSN e pCBSSN,
 *   a parte da alíquota efetiva que cabe ao IBS e à CBS). O cliente do regime regular só aproveita
 *   como crédito esse mesmo valor.
 * - Por fora: o DAS deixa de ter essa parte; a empresa destaca o IBS e a CBS na alíquota cheia,
 *   recolhe a diferença entre o débito das vendas e o crédito das compras, e o cliente empresa
 *   aproveita o crédito cheio.
 *
 * Só a parte do IBS/CBS é comparada: os demais tributos do DAS não mudam com a opção. As
 * alíquotas vêm das próprias notas da empresa quando elas as trazem; o contador informa o que
 * faltar. Nenhuma alíquota é suposta pelo sistema.
 */

export interface SalesFigures {
  count: number;
  totalCents: number;
  /** Vendas a empresas (destinatário com CNPJ): as que aproveitam crédito. */
  businessCount: number;
  businessCents: number;
  /** Vendas a pessoa física ou sem destinatário identificado. */
  consumerCents: number;
}

export interface PurchaseFigures {
  /** Compras com IBS/CBS destacados. */
  count: number;
  /** IBS + CBS destacados nas compras. */
  taxCents: number;
  /** Destaque das classificações que não dão crédito (tabela oficial de cClassTrib). */
  blockedCents: number;
  /** Crédito que o regime regular aproveitaria: destaque − classificações sem crédito. */
  creditCents: number;
}

export interface ObservedRate {
  /** Alíquota em pontos percentuais (ex.: 3.25 = 3,25%). */
  rate: number;
  /** Notas de onde saiu. */
  invoices: number;
  baseCents: number;
}

export interface SimplesFigures {
  sales: SalesFigures;
  purchases: PurchaseFigures;
  /** IBS + CBS do Simples sobre a receita, nas notas de venda que trazem vIBSSN/vCBSSN. */
  observedSimplesRate: ObservedRate | null;
  /** IBS + CBS cheios nas compras de tributação integral (cClassTrib 000001) com a base informada. */
  observedFullRate: ObservedRate | null;
}

const FULL_TAXATION = '000001';
const isBusiness = (doc: string) => cleanCNPJ(doc).length === 14;
const pct = (num: number, den: number) => Math.round((num / den) * 1e6) / 1e4;

/** Números do período a partir das notas (só as autorizadas). */
export function simplesFigures(invoices: readonly InvoiceSummary[]): SimplesFigures {
  const sales: SalesFigures = { count: 0, totalCents: 0, businessCount: 0, businessCents: 0, consumerCents: 0 };
  const purchases: PurchaseFigures = { count: 0, taxCents: 0, blockedCents: 0, creditCents: 0 };
  const simples = { invoices: 0, baseCents: 0, taxCents: 0 };
  const full = { invoices: 0, baseCents: 0, taxCents: 0 };

  for (const inv of invoices) {
    if (inv.status === 'CANCELLED') continue;
    if (inv.direction === 'SALE') {
      // Receita da venda: o valor sem as retenções (NFS-e) e sem IBS/CBS por fora.
      const cents = toCents(inv.model === 'NFSE' ? Math.max(inv.total, inv.altTotal ?? 0) : inv.total);
      sales.count++;
      sales.totalCents += cents;
      if (isBusiness(inv.counterpartyDoc)) {
        sales.businessCount++;
        sales.businessCents += cents;
      } else sales.consumerCents += cents;
      if (inv.simplesTax && inv.simplesTax.base > 0) {
        simples.invoices++;
        simples.baseCents += toCents(inv.simplesTax.base);
        simples.taxCents += toCents(inv.simplesTax.ibs) + toCents(inv.simplesTax.cbs);
      }
      continue;
    }
    const tax = toCents(inv.ibs ?? 0) + toCents(inv.cbs ?? 0);
    if (tax > 0) {
      const blocked = blockedCreditCents(inv.ibsCbsItems ?? [], inv.issueDate);
      const blockedCents = Math.min(tax, blocked.ibs + blocked.cbs);
      purchases.count++;
      purchases.taxCents += tax;
      purchases.blockedCents += blockedCents;
      purchases.creditCents += tax - blockedCents;
    }
    const integral = (inv.ibsCbsItems ?? []).filter((i) => i.cClassTrib === FULL_TAXATION && i.base && i.base > 0);
    if (integral.length) {
      full.invoices++;
      for (const i of integral) {
        full.baseCents += toCents(i.base!);
        full.taxCents += toCents(i.ibs) + toCents(i.cbs);
      }
    }
  }

  return {
    sales,
    purchases,
    observedSimplesRate: simples.baseCents > 0 ? { rate: pct(simples.taxCents, simples.baseCents), invoices: simples.invoices, baseCents: simples.baseCents } : null,
    observedFullRate: full.baseCents > 0 ? { rate: pct(full.taxCents, full.baseCents), invoices: full.invoices, baseCents: full.baseCents } : null,
  };
}

export interface SimplesScenario {
  /** IBS + CBS pagos (dentro do DAS ou por fora, já com os créditos das compras). */
  taxCents: number;
  /** Crédito que os clientes empresa aproveitam nas compras feitas da empresa. */
  buyersCreditCents: number;
}

export interface SimplesSimulation {
  inside: SimplesScenario;
  outside: SimplesScenario & {
    /** Débito das vendas na alíquota cheia. */
    debitCents: number;
    /** Crédito das compras abatido. */
    purchaseCreditCents: number;
    /** Crédito das compras maior que o débito: saldo credor para os meses seguintes. */
    creditBalanceCents: number;
  };
  /** Por fora − dentro: imposto a mais (positivo) ou a menos (negativo) para a empresa. */
  extraTaxCents: number;
  /** Crédito a mais que os clientes empresa aproveitam por fora. */
  extraBuyersCreditCents: number;
  /**
   * Crédito a mais dos clientes empresa − imposto a mais da empresa: o que sobra se o preço às
   * empresas subir no valor do crédito a mais (o custo líquido delas fica igual).
   */
  netIfPricedCents: number;
  /**
   * A partir de que fração das vendas a empresas o crédito a mais delas cobre o imposto a mais:
   * 'always' (por fora não custa mais), 'never' (nem com todas as vendas a empresas) ou a fração.
   */
  breakEven: { kind: 'always' } | { kind: 'never' } | { kind: 'share'; share: number };
}

/**
 * Compara as duas opções no período. `simplesRate` e `fullRate` em pontos percentuais (IBS + CBS):
 * a parte da alíquota efetiva do Simples que cabe ao IBS e à CBS, e a alíquota cheia do regime
 * regular.
 */
export function simulateSimplesIbsCbs(figures: SimplesFigures, simplesRate: number, fullRate: number): SimplesSimulation {
  const { sales, purchases } = figures;
  const at = (cents: number, rate: number) => Math.round((cents * rate) / 100);

  const inside: SimplesScenario = { taxCents: at(sales.totalCents, simplesRate), buyersCreditCents: at(sales.businessCents, simplesRate) };
  const debitCents = at(sales.totalCents, fullRate);
  const used = Math.min(debitCents, purchases.creditCents);
  const outside = {
    debitCents,
    purchaseCreditCents: used,
    creditBalanceCents: purchases.creditCents - used,
    taxCents: debitCents - used,
    buyersCreditCents: at(sales.businessCents, fullRate),
  };
  const extraTaxCents = outside.taxCents - inside.taxCents;
  const extraBuyersCreditCents = outside.buyersCreditCents - inside.buyersCreditCents;

  // Com a fração s das vendas a empresas: crédito a mais = s × V × (cheia − Simples). Iguala o
  // imposto a mais quando s = imposto a mais / (V × (cheia − Simples)).
  const spread = sales.totalCents * (fullRate - simplesRate);
  const share = spread > 0 ? (extraTaxCents * 100) / spread : null;
  const breakEven: SimplesSimulation['breakEven'] =
    extraTaxCents <= 0 ? { kind: 'always' } : share === null || share > 1 ? { kind: 'never' } : { kind: 'share', share };

  return {
    inside,
    outside,
    extraTaxCents,
    extraBuyersCreditCents,
    netIfPricedCents: extraBuyersCreditCents - extraTaxCents,
    breakEven,
  };
}

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const percent = (fraction: number) => `${(fraction * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

/** Conclusão da simulação em uma frase (tela e relatório). */
export function simplesConclusion(figures: SimplesFigures, s: SimplesSimulation): string {
  const { sales } = figures;
  if (sales.totalCents <= 0) return 'Sem notas de venda no período: importe-as em Notas Fiscais para simular.';
  const current = sales.businessCents / sales.totalCents;
  const extra =
    s.extraTaxCents > 0
      ? `Por fora, a empresa paga ${brl(s.extraTaxCents)} a mais de IBS/CBS no período`
      : `Por fora, a empresa paga ${brl(-s.extraTaxCents)} a menos de IBS/CBS no período`;
  const credit = `os clientes empresa aproveitam ${brl(s.extraBuyersCreditCents)} a mais de crédito`;
  if (s.breakEven.kind === 'always') return `${extra}, e ${credit}: a opção pelo regime regular do IBS/CBS tende a compensar.`;
  if (s.breakEven.kind === 'never') return `${extra}, e ${credit}: dentro do DAS sai mais barato em qualquer composição de clientes.`;
  const verdict =
    current >= s.breakEven.share
      ? 'a opção por fora tende a compensar, desde que o crédito a mais possa ir para o preço às empresas.'
      : 'dentro do DAS tende a sair mais barato.';
  return `${extra}, e ${credit}. O crédito a mais cobre o imposto a mais quando as vendas a empresas passam de ${percent(s.breakEven.share)} do total; no período elas foram ${percent(current)}: ${verdict}`;
}

/** Ressalvas da simulação (tela e relatório). */
export const SIMPLES_SIMULATION_NOTES: readonly string[] = [
  'Só a parte do IBS e da CBS é comparada: os demais tributos do DAS não mudam com a opção.',
  'Receita e crédito das compras vêm das notas fiscais importadas no período; nota que faltar muda o resultado.',
  'Pessoa física e consumidor final não aproveitam crédito: para essas vendas, recolher por fora não traz vantagem.',
  'O crédito a mais dos clientes empresa só vira ganho se for repassado ao preço; a decisão comercial é da empresa.',
  'O sistema não supõe alíquotas: as que as notas não trazem são informadas pelo contador.',
  'A opção pelo regime regular do IBS/CBS tem prazo e período de vigência definidos em lei: confirme as regras vigentes antes de decidir.',
];
