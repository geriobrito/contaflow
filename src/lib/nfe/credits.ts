import type { ChartAccount, InvoiceSummary, TaxRegime } from '@/types/firestore';
import { fromCents, toCents } from '@/lib/money';
import { newSplitId, type SplitDraft } from '@/lib/splits';

/**
 * Crédito de IBS e CBS na compra (reforma tributária, LC 214/2025).
 *
 * A nota de compra traz o IBS e a CBS destacados; a empresa do regime regular recupera esse
 * valor, que sai da despesa (ou do custo) e vai para "IBS a Recuperar" e "CBS a Recuperar".
 * Fora disso, o destaque é só informativo:
 * - 2026 é o ano de teste (CBS 0,9% e IBS 0,1%): quem cumpre as obrigações acessórias fica
 *   dispensado do recolhimento, e não há crédito a lançar.
 * - Empresas do Simples Nacional e MEI não tomam o crédito (salvo a opção pelo regime regular
 *   do IBS/CBS, que o cadastro não registra: nesse caso o contador lança pelo rateio).
 *
 * Como a contabilidade parte do extrato, o crédito entra no pagamento: proporcional ao que foi
 * pago quando o pagamento é de uma parcela.
 */

/** Primeiro dia em que o destaque gera crédito. */
export const IBS_CBS_CREDIT_FROM = '2027-01-01';
export const IBS_RECOVERABLE_CODE = '1.1.2.07';
export const CBS_RECOVERABLE_CODE = '1.1.2.08';

export type IbsCbsCreditStatus = 'CREDIT' | 'TEST_YEAR' | 'SIMPLES' | 'SALE';

export interface IbsCbsCredit {
  status: IbsCbsCreditStatus;
  /** Destaque da nota inteira. */
  invoiceIbs: number;
  invoiceCbs: number;
  /** Crédito correspondente ao pagamento (só em CREDIT; zero nos demais). */
  ibs: number;
  cbs: number;
}

/**
 * Situação do IBS/CBS da nota casada com o pagamento de `paidAmount`, ou null se a nota não
 * traz o destaque.
 */
export function ibsCbsCredit(
  invoice: Pick<InvoiceSummary, 'direction' | 'issueDate' | 'total' | 'ibs' | 'cbs'>,
  paidAmount: number,
  regime: TaxRegime | undefined
): IbsCbsCredit | null {
  const invoiceIbs = invoice.ibs ?? 0;
  const invoiceCbs = invoice.cbs ?? 0;
  if (invoiceIbs <= 0 && invoiceCbs <= 0) return null;
  const base = { invoiceIbs, invoiceCbs, ibs: 0, cbs: 0 };
  if (invoice.direction === 'SALE') return { ...base, status: 'SALE' };
  if (invoice.issueDate < IBS_CBS_CREDIT_FROM) return { ...base, status: 'TEST_YEAR' };
  if (regime === 'SIMPLES_NACIONAL' || regime === 'MEI') return { ...base, status: 'SIMPLES' };

  // Pagamento do total (ou de mais, quando inclui o próprio IBS/CBS): crédito inteiro.
  const share = invoice.total > 0 ? Math.min(1, Math.abs(paidAmount) / invoice.total) : 1;
  const part = (v: number) => fromCents(Math.round(toCents(v) * share));
  return { ...base, status: 'CREDIT', ibs: part(invoiceIbs), cbs: part(invoiceCbs) };
}

/**
 * Rateio do pagamento com o crédito: a conta da despesa fica com o pagamento menos o IBS e a
 * CBS, que vão para as contas a recuperar. Null se o plano não tem essas contas analíticas ou
 * se o crédito não cabe no pagamento.
 */
export function creditSplitDrafts(
  paidAmount: number,
  expenseAccountId: string,
  credit: Pick<IbsCbsCredit, 'ibs' | 'cbs'>,
  accounts: readonly ChartAccount[]
): SplitDraft[] | null {
  const analytic = (code: string) => accounts.find((a) => a.code === code && a.nature === 'ANALYTIC');
  const ibsAccount = analytic(IBS_RECOVERABLE_CODE);
  const cbsAccount = analytic(CBS_RECOVERABLE_CODE);
  const ibsCents = toCents(credit.ibs);
  const cbsCents = toCents(credit.cbs);
  const expenseCents = Math.abs(toCents(paidAmount)) - ibsCents - cbsCents;
  if (!ibsAccount || !cbsAccount || expenseCents <= 0 || ibsCents + cbsCents <= 0) return null;

  return [
    { id: newSplitId(), accountId: expenseAccountId, memo: '', cents: expenseCents },
    ...(ibsCents > 0 ? [{ id: newSplitId(), accountId: ibsAccount.id, memo: 'IBS a recuperar (nota fiscal)', cents: ibsCents }] : []),
    ...(cbsCents > 0 ? [{ id: newSplitId(), accountId: cbsAccount.id, memo: 'CBS a recuperar (nota fiscal)', cents: cbsCents }] : []),
  ];
}
