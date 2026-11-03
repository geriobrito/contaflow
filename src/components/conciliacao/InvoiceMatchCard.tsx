'use client';

import { ReceiptText } from 'lucide-react';
import type { ChartAccount, InvoiceSummary } from '@/types/firestore';
import type { InvoiceMatch } from '@/lib/nfe/match';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

const PARTY_HINT: Record<InvoiceMatch['party'], string> = {
  document: 'CNPJ/CPF do extrato confere com a nota',
  name: 'nome do extrato confere com a nota',
  none: 'o extrato não identifica o parceiro: confira se é esta nota',
};

const describeInvoice = (inv: InvoiceSummary) =>
  `NF-e ${inv.number}${inv.series && inv.series !== '0' ? `/${inv.series}` : ''} · ${inv.counterpartyName || 'parceiro não identificado'}`;

interface InvoiceMatchCardProps {
  match: InvoiceMatch;
  accounts: readonly ChartAccount[];
  /** Conta escolhida no momento. */
  accountId: string;
  rejected: boolean;
  onUseSuggestion: (accountId: string) => void;
  onRejectedChange: (rejected: boolean) => void;
}

/** Nota fiscal casada com o lançamento: dados, por que casou e a conta sugerida. */
export function InvoiceMatchCard({ match, accounts, accountId, rejected, onUseSuggestion, onRejectedChange }: InvoiceMatchCardProps) {
  const inv = match.invoice;
  const suggested = match.suggestedAccountId ? accounts.find((a) => a.id === match.suggestedAccountId) : undefined;
  const parcel = match.installment
    ? `parcela ${match.installment.number ?? ''}${inv.installments.length > 1 ? ` de ${inv.installments.length}` : ''}, vencimento ${formatDateBR(match.installment.dueDate)}`
    : null;

  return (
    <section
      aria-label="Nota fiscal correspondente"
      className={`rounded-2xl border px-3.5 py-3 text-[12px] space-y-1.5 ${
        rejected ? 'border-black/6 dark:border-white/8 opacity-70' : match.party === 'none' ? 'border-amber-200/70 bg-amber-50/60 dark:bg-amber-950/20' : 'border-emerald-200/70 bg-emerald-50/60 dark:bg-emerald-950/20'
      }`}
    >
      <p className="flex items-start gap-2 text-stone-800 dark:text-stone-100">
        <ReceiptText className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-700" />
        <span className="min-w-0">
          <span className="font-medium">{describeInvoice(inv)}</span>
          <span className="block text-stone-500">
            Emitida em {formatDateBR(inv.issueDate)} · {formatCurrency(match.amount)}
            {parcel ? ` (${parcel})` : ''}
            {inv.cfops[0] ? ` · CFOP ${inv.cfops[0].cfop}` : ''}
          </span>
          <span className={`block ${match.party === 'none' ? 'text-amber-700' : 'text-stone-500'}`}>Mesmo valor; {PARTY_HINT[match.party]}.</span>
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
      <label className="pl-5.5 flex items-center gap-1.5 text-stone-500">
        <input type="checkbox" checked={rejected} onChange={(e) => onRejectedChange(e.target.checked)} className="rounded border-stone-300" />
        Não é esta nota
      </label>
    </section>
  );
}

/** Aviso da nota já vinculada a um lançamento conciliado. */
export function LinkedInvoiceNote({ invoice }: { invoice: InvoiceSummary }) {
  return (
    <p className="flex items-start gap-2 rounded-2xl border border-black/6 dark:border-white/8 px-3.5 py-2.5 text-[12px] text-stone-600 dark:text-stone-300">
      <ReceiptText className="w-3.5 h-3.5 mt-0.5 shrink-0 text-stone-400" />
      <span>
        Nota vinculada: {describeInvoice(invoice)}, emitida em {formatDateBR(invoice.issueDate)} ({formatCurrency(invoice.total)}).
      </span>
    </p>
  );
}
