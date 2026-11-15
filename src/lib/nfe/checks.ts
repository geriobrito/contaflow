import type { BankTransaction, ChartAccount, InvoiceSummary, JournalEntry } from '@/types/firestore';
import type { DateRange } from '@/lib/data/repository';
import { buildDRE, type DREAccountLine } from '@/lib/dre/build';
import { fromCents, toCents } from '@/lib/money';
import { invoiceKindLabel, paymentStateOf } from '@/lib/nfe/import';
import { cfopAccountCode } from '@/lib/nfe/match';
import { NFSE_MODEL } from '@/lib/nfe/parser';
import { cleanCNPJ } from '@/lib/utils/formatters';

/**
 * Conferências fiscais e contábeis do contador sobre as notas do período:
 * 1. Furos na numeração das notas emitidas pela empresa (XML que o cliente deixou de enviar
 *    ou numeração inutilizada).
 * 2. Faturamento pelas notas de venda ao lado da Receita Bruta lançada na contabilidade, para
 *    conferir a base do Simples Nacional (ou do regime normal) antes de fechar o mês.
 */

export interface NumberRange {
  from: number;
  to: number;
}

export interface NumberingGapGroup {
  model: string;
  series: string;
  /** Ex.: "NF-e série 1", "NFC-e série 2", "NFS-e". */
  label: string;
  minNumber: number;
  maxNumber: number;
  missingCount: number;
  ranges: NumberRange[];
}

/** Formata uma faixa de números ausentes ("102" ou "105 a 107"). */
export const formatGapRange = (r: NumberRange): string => (r.from === r.to ? String(r.from) : `${r.from} a ${r.to}`);

/**
 * A nota pertence à sequência numérica emitida pela própria empresa?
 * Entram todas as notas de venda (`SALE`) e também as notas de entrada própria (`PURCHASE`
 * com `tpNF = 0`) cujo CNPJ emitente na chave de 44 dígitos tem a mesma raiz do cliente.
 */
function isIssuedByClient(inv: InvoiceSummary, clientRoot: string): boolean {
  if (inv.direction === 'SALE') return true;
  if (clientRoot.length === 8 && inv.key.length === 44) {
    const issuerRoot = inv.key.slice(6, 14);
    if (issuerRoot === clientRoot) return true;
  }
  return false;
}

function seriesLabel(model: string, series: string): string {
  const kind = invoiceKindLabel({ model });
  if (model === NFSE_MODEL || !series || series === '0') return kind;
  return `${kind} série ${series}`;
}

/**
 * Detecta furos na numeração das notas emitidas pela empresa em cada modelo e série.
 * Notas canceladas contam normalmente na sequência (elas ocupam número e não são furos).
 */
export function findNumberingGaps(invoices: readonly InvoiceSummary[], clientCnpj?: string): NumberingGapGroup[] {
  const clientRoot = clientCnpj ? cleanCNPJ(clientCnpj).slice(0, 8) : '';
  const bySeries = new Map<string, { model: string; series: string; numbers: Set<number> }>();

  for (const inv of invoices) {
    if (!isIssuedByClient(inv, clientRoot)) continue;
    const num = Number(inv.number);
    if (!Number.isInteger(num) || num <= 0) continue;
    const normalizedSeries = inv.model === NFSE_MODEL ? '' : inv.series || '0';
    const groupKey = `${inv.model}|${normalizedSeries}`;
    let group = bySeries.get(groupKey);
    if (!group) {
      group = { model: inv.model, series: normalizedSeries, numbers: new Set() };
      bySeries.set(groupKey, group);
    }
    group.numbers.add(num);
  }

  const out: NumberingGapGroup[] = [];
  for (const group of bySeries.values()) {
    if (group.numbers.size < 2) continue;
    const sorted = [...group.numbers].sort((a, b) => a - b);
    const ranges: NumberRange[] = [];
    let missingCount = 0;
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (curr - prev > 1) {
        ranges.push({ from: prev + 1, to: curr - 1 });
        missingCount += curr - prev - 1;
      }
    }
    if (ranges.length > 0) {
      out.push({
        model: group.model,
        series: group.series,
        label: seriesLabel(group.model, group.series),
        minNumber: sorted[0],
        maxNumber: sorted[sorted.length - 1],
        missingCount,
        ranges,
      });
    }
  }

  return out.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { numeric: true }));
}

export interface BillingRevenueComparison {
  /** Quantidade de notas de venda operacionais autorizadas no período. */
  salesCount: number;
  /** Faturamento bruto pelas notas de venda (NFS-e pelo valor bruto do serviço `altTotal ?? total`). */
  invoicedGross: number;
  /** Valor líquido das notas de venda (diferente de `invoicedGross` quando há retenções em NFS-e). */
  invoicedNet: number;
  /** Receita Bruta lançada e conciliada na contabilidade (grupo 3.1.1 da DRE: extrato + Diário). */
  launchedGross: number;
  /** Deduções da receita bruta lançadas no período (devoluções, descontos, tributos s/ vendas). */
  launchedDeductions: number;
  /** Contas analíticas de Receita Bruta movimentadas no período. */
  revenueLines: DREAccountLine[];
  /** Diferença: `invoicedGross - launchedGross` (> 0: falta receita lançada; < 0: mais receita lançada que notas). */
  difference: number;
  /** Faturamento das notas e receita lançada batem centavo a centavo. */
  matches: boolean;
  /** Notas de venda do período ainda sem lançamento ou quitadas parcialmente. */
  openSalesCount: number;
  openSalesTotal: number;
  /** Entradas no extrato bancário do período ainda pendentes ou aguardando aprovação. */
  pendingCreditsCount: number;
  pendingCreditsTotal: number;
  /** Vendas de ativo imobilizado (CFOP final 551), fora do faturamento operacional. */
  fixedAssetSalesCount: number;
  fixedAssetSalesTotal: number;
}

/** Valor bruto de faturamento de uma nota de venda (na NFS-e com retenções, o valor do serviço). */
export const grossSaleAmount = (inv: Pick<InvoiceSummary, 'model' | 'total' | 'altTotal'>): number =>
  inv.model === NFSE_MODEL && inv.altTotal && inv.altTotal > inv.total ? inv.altTotal : inv.total;

/**
 * Compara o faturamento das notas de venda autorizadas do período com o que foi classificado
 * como Receita Bruta na contabilidade (conciliação bancária + lançamentos manuais do Diário).
 */
export function compareBillingWithRevenue(args: {
  invoices: readonly InvoiceSummary[];
  transactions: readonly BankTransaction[];
  accounts: readonly ChartAccount[];
  journalEntries?: readonly JournalEntry[] | null;
  range: DateRange;
}): BillingRevenueComparison {
  const { invoices, transactions, accounts, journalEntries, range } = args;

  let salesCount = 0;
  let invoicedGrossCents = 0;
  let invoicedNetCents = 0;
  let openSalesCount = 0;
  let openSalesCents = 0;
  let fixedAssetSalesCount = 0;
  let fixedAssetSalesCents = 0;

  for (const inv of invoices) {
    if (inv.direction !== 'SALE' || inv.status === 'CANCELLED') continue;
    // Venda de bem do imobilizado (CFOP 5551/6551) não compõe a receita bruta operacional.
    if (cfopAccountCode(inv) === '1.1.2.11') {
      fixedAssetSalesCount++;
      fixedAssetSalesCents += toCents(inv.total);
      continue;
    }
    salesCount++;
    const grossCents = toCents(grossSaleAmount(inv));
    const netCents = toCents(inv.total);
    invoicedGrossCents += grossCents;
    invoicedNetCents += netCents;

    const state = paymentStateOf(inv);
    if (state === 'OPEN' || state === 'PARTIAL') {
      openSalesCount++;
      const paidCents = (inv.links ?? []).reduce((s, l) => s + toCents(l.amount), 0);
      openSalesCents += Math.max(0, grossCents - paidCents);
    }
  }

  const dre = buildDRE(transactions, accounts, range, journalEntries);
  const launchedGrossCents = toCents(dre.grossRevenue);
  const diffCents = invoicedGrossCents - launchedGrossCents;

  let pendingCreditsCount = 0;
  let pendingCreditsCents = 0;
  for (const tx of transactions) {
    if (tx.date < range.start || tx.date > range.end) continue;
    if (tx.amount <= 0 || tx.transferPairId) continue;
    if (tx.status === 'PENDING' || tx.status === 'AUTO_CLASSIFIED') {
      pendingCreditsCount++;
      pendingCreditsCents += toCents(tx.amount);
    }
  }

  return {
    salesCount,
    invoicedGross: fromCents(invoicedGrossCents),
    invoicedNet: fromCents(invoicedNetCents),
    launchedGross: fromCents(launchedGrossCents),
    launchedDeductions: dre.deductions,
    revenueLines: dre.sections.GROSS_REVENUE.lines,
    difference: fromCents(diffCents),
    matches: diffCents === 0,
    openSalesCount,
    openSalesTotal: fromCents(openSalesCents),
    pendingCreditsCount,
    pendingCreditsTotal: fromCents(pendingCreditsCents),
    fixedAssetSalesCount,
    fixedAssetSalesTotal: fromCents(fixedAssetSalesCents),
  };
}
