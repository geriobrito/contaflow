import type { InvoiceDirection, InvoiceInstallment, InvoiceSummary } from '@/types/firestore';
import { fromCents, toCents } from '@/lib/money';
import { paymentStateOf, type InvoicePaymentState } from '@/lib/nfe/import';
import { textKey } from '@/lib/payee';

/**
 * Fila de trabalho da tela de Notas Fiscais: filtros por direção e situação, contagens,
 * vencimentos das parcelas (próximo vencimento e atraso), resumo do período e ordenação.
 */

export type InvoiceDirectionFilter = 'ALL' | InvoiceDirection;
export type InvoiceStateFilter = 'ALL' | InvoicePaymentState;

export type InvoiceSortKey = 'issueDate' | 'partner' | 'total';

export interface InvoiceSort {
  key: InvoiceSortKey;
  dir: 'asc' | 'desc';
}

export type InstallmentStatus = 'SETTLED' | 'OVERDUE' | 'UPCOMING';

export interface EvaluatedInstallment {
  installment: InvoiceInstallment;
  index: number;
  status: InstallmentStatus;
}

export interface InvoiceDueInfo {
  state: InvoicePaymentState;
  /** Parcelas avaliadas na ordem de vencimento. */
  installments: EvaluatedInstallment[];
  /** Parcelas ainda em aberto. */
  openInstallments: InvoiceInstallment[];
  /** Próximo vencimento em aberto (YYYY-MM-DD), ou null quando quitada/cancelada/sem duplicatas. */
  nextDueDate: string | null;
  /** Há parcela em aberto com vencimento anterior a `today` (YYYY-MM-DD). */
  isOverdue: boolean;
  /** Valor em aberto da nota (total menos vínculos confirmados). */
  openAmount: number;
  /** Competência (AAAA-MM) para abrir na Conciliação: a do próximo vencimento ou a da emissão. */
  conciliationMonth: string;
}

/**
 * Avalia as parcelas da nota contra os vínculos já confirmados no extrato (`invoice.links`).
 * Primeiro casa parcelas de valor exato (como em `openSlots` de `src/lib/nfe/match.ts`); se
 * restar valor pago parcial sem parcela de mesmo valor, abate das mais antigas para as mais novas.
 */
export function invoiceDueInfo(invoice: InvoiceSummary, today: string): InvoiceDueInfo {
  const state = paymentStateOf(invoice);
  const paidCents = (invoice.links ?? []).reduce((s, l) => s + toCents(l.amount), 0);
  const totalCents = toCents(invoice.total);
  const openAmount = state === 'CANCELLED' || state === 'SETTLED' ? 0 : fromCents(Math.max(0, totalCents - paidCents));

  const sorted = invoice.installments
    .map((installment, index) => ({ installment, index }))
    .sort((a, b) => a.installment.dueDate.localeCompare(b.installment.dueDate) || a.index - b.index);

  if (state === 'CANCELLED' || state === 'SETTLED') {
    const installments: EvaluatedInstallment[] = sorted.map(({ installment, index }) => ({
      installment,
      index,
      status: 'SETTLED',
    }));
    return {
      state,
      installments,
      openInstallments: [],
      nextDueDate: null,
      isOverdue: false,
      openAmount: 0,
      conciliationMonth: invoice.issueDate.slice(0, 7),
    };
  }

  // Abate vínculos por valor exato primeiro; o que sobrar abate em ordem cronológica.
  const remainingLinks = (invoice.links ?? []).map((l) => toCents(l.amount));
  const settledIndices = new Set<number>();
  for (const item of sorted) {
    const cents = toCents(item.installment.amount);
    const hit = remainingLinks.indexOf(cents);
    if (hit >= 0) {
      settledIndices.add(item.index);
      remainingLinks.splice(hit, 1);
    }
  }
  let leftoverPaid = remainingLinks.reduce((s, c) => s + c, 0);
  for (const item of sorted) {
    if (settledIndices.has(item.index)) continue;
    const cents = toCents(item.installment.amount);
    if (leftoverPaid >= cents && cents > 0) {
      settledIndices.add(item.index);
      leftoverPaid -= cents;
    }
  }

  const installments: EvaluatedInstallment[] = sorted.map(({ installment, index }) => {
    const isSettled = settledIndices.has(index);
    const status: InstallmentStatus = isSettled ? 'SETTLED' : installment.dueDate < today ? 'OVERDUE' : 'UPCOMING';
    return { installment, index, status };
  });

  const openInstallments = installments.filter((i) => i.status !== 'SETTLED').map((i) => i.installment);
  const nextDueDate = openInstallments[0]?.dueDate ?? null;
  const isOverdue = nextDueDate !== null && nextDueDate < today;
  const conciliationMonth = (nextDueDate ?? invoice.issueDate).slice(0, 7);

  return {
    state,
    installments,
    openInstallments,
    nextDueDate,
    isOverdue,
    openAmount,
    conciliationMonth,
  };
}

/** Notas filtradas pelo lado (compra/venda). */
export function filterByDirection(invoices: readonly InvoiceSummary[], direction: InvoiceDirectionFilter): readonly InvoiceSummary[] {
  return direction === 'ALL' ? invoices : invoices.filter((i) => i.direction === direction);
}

/** Contagem de notas em cada situação de pagamento (dentro do filtro de direção atual). */
export function invoiceStateCounts(invoices: readonly InvoiceSummary[]): Record<InvoiceStateFilter, number> {
  const counts: Record<InvoiceStateFilter, number> = {
    ALL: invoices.length,
    OPEN: 0,
    PARTIAL: 0,
    SETTLED: 0,
    CANCELLED: 0,
  };
  for (const inv of invoices) {
    counts[paymentStateOf(inv)]++;
  }
  return counts;
}

/** Filtra notas pela situação e pela busca (nome, CNPJ/CPF, chave, número ou CFOP). */
export function filterInvoices(
  invoices: readonly InvoiceSummary[],
  stateFilter: InvoiceStateFilter,
  search: string
): readonly InvoiceSummary[] {
  const byState = stateFilter === 'ALL' ? invoices : invoices.filter((i) => paymentStateOf(i) === stateFilter);
  const trimmed = search.trim();
  if (!trimmed) return byState;
  const term = textKey(trimmed);
  const digits = trimmed.replace(/\D/g, '');
  return byState.filter(
    (i) =>
      (term.length > 0 && textKey(i.counterpartyName).includes(term)) ||
      i.number === trimmed ||
      i.cfops.some((c) => c.cfop === trimmed) ||
      (digits.length >= 4 && (i.counterpartyDoc.includes(digits) || i.key.includes(digits)))
  );
}

export interface InvoicePeriodSummary {
  totalCount: number;
  authorizedCount: number;
  cancelledCount: number;
  purchasesTotal: number;
  purchasesCount: number;
  salesTotal: number;
  salesCount: number;
  /** Notas sem lançamento (`OPEN`). */
  openCount: number;
  /** Notas parciais (`PARTIAL`). */
  partialCount: number;
  /** Soma em aberto das notas `OPEN` e `PARTIAL`. */
  openAmount: number;
  /** Notas `OPEN` ou `PARTIAL` com parcela vencida antes de `today`. */
  overdueCount: number;
}

/** Resumo consolidado do período (canceladas ficam fora dos valores de compra e venda). */
export function invoicePeriodSummary(invoices: readonly InvoiceSummary[], today: string): InvoicePeriodSummary {
  let authorizedCount = 0;
  let cancelledCount = 0;
  let purchasesCents = 0;
  let purchasesCount = 0;
  let salesCents = 0;
  let salesCount = 0;
  let openCount = 0;
  let partialCount = 0;
  let openCents = 0;
  let overdueCount = 0;

  for (const inv of invoices) {
    if (inv.status === 'CANCELLED') {
      cancelledCount++;
      continue;
    }
    authorizedCount++;
    const cents = toCents(inv.total);
    if (inv.direction === 'PURCHASE') {
      purchasesCents += cents;
      purchasesCount++;
    } else {
      salesCents += cents;
      salesCount++;
    }
    const due = invoiceDueInfo(inv, today);
    if (due.state === 'OPEN') openCount++;
    else if (due.state === 'PARTIAL') partialCount++;
    if (due.state === 'OPEN' || due.state === 'PARTIAL') {
      openCents += toCents(due.openAmount);
      if (due.isOverdue) overdueCount++;
    }
  }

  return {
    totalCount: invoices.length,
    authorizedCount,
    cancelledCount,
    purchasesTotal: fromCents(purchasesCents),
    purchasesCount,
    salesTotal: fromCents(salesCents),
    salesCount,
    openCount,
    partialCount,
    openAmount: fromCents(openCents),
    overdueCount,
  };
}

/**
 * Próxima ordenação ao clicar no título de uma coluna: a primeira vez no sentido mais útil
 * (emissão e valor do maior para o menor, parceiro de A a Z), a segunda inverte e a terceira
 * volta à ordem padrão (`null`).
 */
export function nextInvoiceSort(current: InvoiceSort | null, key: InvoiceSortKey): InvoiceSort | null {
  const first = key === 'partner' ? 'asc' : 'desc';
  if (current?.key !== key) return { key, dir: first };
  return current.dir === first ? { key, dir: first === 'asc' ? 'desc' : 'asc' } : null;
}

/** Ordena as notas pela coluna escolhida; `null` mantém a ordem padrão (emissão desc + número desc). */
export function sortInvoices(invoices: readonly InvoiceSummary[], sort: InvoiceSort | null): readonly InvoiceSummary[] {
  if (!sort) return invoices;
  const sign = sort.dir === 'asc' ? 1 : -1;
  const compare: (a: InvoiceSummary, b: InvoiceSummary) => number =
    sort.key === 'issueDate'
      ? (a, b) => a.issueDate.localeCompare(b.issueDate) || a.number.localeCompare(b.number, undefined, { numeric: true })
      : sort.key === 'total'
        ? (a, b) => a.total - b.total
        : (a, b) =>
            (a.counterpartyName || a.counterpartyDoc).localeCompare(b.counterpartyName || b.counterpartyDoc, 'pt-BR', {
              sensitivity: 'base',
              numeric: true,
            });
  return [...invoices].sort((a, b) => sign * compare(a, b));
}
