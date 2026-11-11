'use client';

import { ReceiptText } from 'lucide-react';
import type { ChartAccount, InvoiceSummary } from '@/types/firestore';
import type { InvoiceMatch } from '@/lib/nfe/match';
import type { IbsCbsCredit } from '@/lib/nfe/credits';
import { invoiceKindLabel } from '@/lib/nfe/import';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

const PARTY_HINT: Record<InvoiceMatch['party'], string> = {
  document: 'CNPJ/CPF do extrato confere com a nota',
  name: 'nome do extrato confere com a nota',
  none: 'o extrato não identifica o parceiro: confira se é esta nota',
};

export const describeInvoice = (inv: InvoiceSummary) =>
  `${invoiceKindLabel(inv)} ${inv.number}${inv.series && inv.series !== '0' ? `/${inv.series}` : ''} · ${inv.counterpartyName || 'parceiro não identificado'}`;

const CREDIT_NOTE: Record<Exclude<IbsCbsCredit['status'], 'CREDIT'>, string> = {
  TEST_YEAR: 'em 2026 (ano de teste) o destaque é informativo, sem crédito a lançar',
  SIMPLES: 'empresa do Simples Nacional não toma o crédito',
  SALE: 'destacados na venda',
};

interface InvoiceMatchCardProps {
  match: InvoiceMatch;
  accounts: readonly ChartAccount[];
  /** Conta escolhida no momento. */
  accountId: string;
  rejected: boolean;
  onUseSuggestion: (accountId: string) => void;
  onRejectedChange: (rejected: boolean) => void;
  /** IBS/CBS da nota para este pagamento (null: a nota não traz o destaque). */
  credit?: IbsCbsCredit | null;
  /** Abre o rateio com o crédito de IBS/CBS separado da despesa. */
  onUseCredit?: () => void;
  /** Abre a gaveta lateral com os detalhes completos da nota fiscal. */
  onViewDetails?: () => void;
}

/** Nota fiscal casada com o lançamento: dados, por que casou, a conta sugerida e o IBS/CBS. */
export function InvoiceMatchCard({
  match,
  accounts,
  accountId,
  rejected,
  onUseSuggestion,
  onRejectedChange,
  credit,
  onUseCredit,
  onViewDetails,
}: InvoiceMatchCardProps) {
  const inv = match.invoice;
  const suggested = match.suggestedAccountId ? accounts.find((a) => a.id === match.suggestedAccountId) : undefined;
  const parcel = match.installment
    ? `parcela ${match.installment.number ?? ''}${inv.installments.length > 1 ? ` de ${inv.installments.length}` : ''}, vencimento ${formatDateBR(match.installment.dueDate)}`
    : null;

  return (
    <section
      aria-label="Nota fiscal correspondente"
      className={`rounded-2xl border px-3.5 py-3 text-[12px] space-y-1.5 ${
        rejected ? 'border-line opacity-70' : match.party === 'none' ? 'border-amber-200/70 dark:border-amber-500/25 bg-amber-50/60 dark:bg-amber-950/20' : 'border-emerald-200/70 dark:border-emerald-500/25 bg-emerald-50/60 dark:bg-emerald-950/20'
      }`}
    >
      <p className="flex items-start gap-2 text-stone-800 dark:text-stone-100">
        <ReceiptText className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-300" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="font-medium">{describeInvoice(inv)}</span>
            {onViewDetails && (
              <button
                type="button"
                onClick={onViewDetails}
                className="shrink-0 font-medium text-accent-ink hover:underline"
              >
                Ver detalhes da nota
              </button>
            )}
          </span>
          <span className="block text-stone-500">
            Emitida em {formatDateBR(inv.issueDate)} · {formatCurrency(match.amount)}
            {parcel ? ` (${parcel})` : ''}
            {inv.cfops[0] ? ` · CFOP ${inv.cfops[0].cfop}` : ''}
            {inv.serviceCode ? ` · serviço ${inv.serviceCode}` : ''}
          </span>
          <span className={`block ${match.party === 'none' ? 'text-amber-700 dark:text-amber-300' : 'text-stone-500'}`}>Mesmo valor; {PARTY_HINT[match.party]}.</span>
        </span>
      </p>
      {!rejected && suggested && (
        <p className="pl-5.5 flex flex-wrap items-center gap-x-2 text-stone-600 dark:text-stone-300">
          <span>
            Conta sugerida{match.suggestionSource === 'history' ? ' (usada antes com este parceiro)' : ' (pelo CFOP)'}:{' '}
            <b className="font-medium">
              <span className="font-mono tabular-nums">{suggested.code}</span> {suggested.name}
            </b>
          </span>
          {accountId !== suggested.id && (
            <button type="button" onClick={() => onUseSuggestion(suggested.id)} className="font-medium text-accent-ink hover:underline">
              Usar
            </button>
          )}
        </p>
      )}
      {!rejected && credit && (
        <p className="pl-5.5 flex flex-wrap items-center gap-x-2 text-stone-600 dark:text-stone-300">
          {credit.status === 'CREDIT' ? (
            <>
              <span>
                Crédito a recuperar: IBS <b className="font-mono tabular-nums font-medium">{formatCurrency(credit.ibs)}</b> e CBS{' '}
                <b className="font-mono tabular-nums font-medium">{formatCurrency(credit.cbs)}</b>
                {credit.ibs !== credit.invoiceIbs || credit.cbs !== credit.invoiceCbs ? ' (proporcional ao pago)' : ''}
              </span>
              {onUseCredit && (
                <button type="button" onClick={onUseCredit} className="font-medium text-accent-ink hover:underline">
                  Lançar com o crédito
                </button>
              )}
            </>
          ) : (
            <span className="text-stone-500">
              IBS {formatCurrency(credit.invoiceIbs)} e CBS {formatCurrency(credit.invoiceCbs)}: {CREDIT_NOTE[credit.status]}.
            </span>
          )}
        </p>
      )}
      <label className="pl-5.5 flex items-center gap-1.5 text-stone-500">
        <input type="checkbox" checked={rejected} onChange={(e) => onRejectedChange(e.target.checked)} className="rounded border-stone-300" />
        Não é esta nota
      </label>
    </section>
  );
}

/** Aviso da nota já vinculada a um lançamento conciliado. */
export function LinkedInvoiceNote({ invoice, onViewDetails }: { invoice: InvoiceSummary; onViewDetails?: () => void }) {
  return (
    <p className="flex items-start justify-between gap-2 rounded-2xl border border-line px-3.5 py-2.5 text-[12px] text-stone-600 dark:text-stone-300">
      <span className="flex items-start gap-2">
        <ReceiptText className="w-3.5 h-3.5 mt-0.5 shrink-0 text-stone-400" />
        <span>
          Nota vinculada: {describeInvoice(invoice)}, emitida em {formatDateBR(invoice.issueDate)} ({formatCurrency(invoice.total)}).
        </span>
      </span>
      {onViewDetails && (
        <button type="button" onClick={onViewDetails} className="shrink-0 font-medium text-accent-ink hover:underline">
          Ver detalhes
        </button>
      )}
    </p>
  );
}
