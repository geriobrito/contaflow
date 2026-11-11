'use client';

import { Trash2 } from 'lucide-react';
import type { InvoiceSummary } from '@/types/firestore';
import { paymentStateOf, type InvoicePaymentState } from '@/lib/nfe/import';
import { NFSE_MODEL } from '@/lib/nfe/parser';
import { retentionParts } from '@/lib/nfe/retentions';
import { formatCNPJ, formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { ConfirmButton } from '@/components/ui/primitives';

const STATE: Record<InvoicePaymentState, { label: (i: InvoiceSummary) => string; className: string }> = {
  OPEN: { label: () => 'Sem lançamento', className: 'bg-stone-50 text-stone-500 border-stone-200/70 dark:bg-stone-800 dark:border-stone-700' },
  PARTIAL: { label: () => 'Parcial', className: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200/70 dark:border-amber-500/25' },
  SETTLED: { label: (i) => (i.direction === 'PURCHASE' ? 'Paga' : 'Recebida'), className: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/70 dark:border-emerald-500/25' },
  CANCELLED: { label: () => 'Cancelada', className: 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-200/70 dark:border-rose-500/25' },
};

const docLabel = (doc: string) => (doc.length === 14 ? formatCNPJ(doc) : doc.length === 11 ? `${doc.slice(0, 3)}.${doc.slice(3, 6)}.${doc.slice(6, 9)}-${doc.slice(9)}` : doc);

interface InvoiceTableProps {
  invoices: readonly InvoiceSummary[];
  busy: boolean;
  onDelete: (invoice: InvoiceSummary) => void;
}

/** Lista das notas importadas, com a situação de pagamento pelo casamento com o extrato. */
export function InvoiceTable({ invoices, busy, onDelete }: InvoiceTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="text-[10.5px] uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400 bg-surface-2 border-b border-line">
            <th scope="col" className="font-medium pl-5 pr-3 py-2.5 w-24">Emissão</th>
            <th scope="col" className="font-medium px-3 py-2.5 w-28">Nota</th>
            <th scope="col" className="font-medium px-3 py-2.5">Fornecedor / cliente</th>
            <th scope="col" className="font-medium px-3 py-2.5 w-20">CFOP</th>
            <th scope="col" className="font-medium px-3 py-2.5 w-32">Situação</th>
            <th scope="col" className="font-medium px-3 py-2.5 text-right w-36">Valor</th>
            <th scope="col" className="pl-1 pr-5 py-2.5 w-12" />
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => {
            const state = paymentStateOf(inv);
            const style = STATE[state];
            return (
              <tr key={inv.id} className="group border-b border-black/4 dark:border-white/5 last:border-0 text-[13px] align-top">
                <td className="pl-5 pr-3 py-3 font-mono tabular-nums text-[12px] text-stone-500 whitespace-nowrap">{formatDateBR(inv.issueDate)}</td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <span className={`inline-block px-1.5 py-0.5 mr-1.5 rounded text-[10px] font-semibold ${inv.direction === 'PURCHASE' ? 'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300' : 'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300'}`}>
                    {inv.direction === 'PURCHASE' ? 'Compra' : 'Venda'}
                  </span>
                  {inv.model === NFSE_MODEL && <span className="mr-1 text-[10px] font-semibold text-stone-500">NFS-e</span>}
                  <span className="font-mono tabular-nums" title={`Chave ${inv.key}`}>
                    {inv.number}
                    {inv.series && inv.series !== '0' ? `/${inv.series}` : ''}
                  </span>
                </td>
                <td className="px-3 py-3 max-w-0 w-full">
                  <p className="truncate text-stone-900 dark:text-stone-100">{inv.counterpartyName || (inv.direction === 'SALE' ? 'Consumidor não identificado' : '—')}</p>
                  {inv.counterpartyDoc && <p className="font-mono tabular-nums text-[11px] text-stone-400">{docLabel(inv.counterpartyDoc)}</p>}
                  {inv.installments.length > 1 && <p className="text-[11px] text-stone-400">{inv.installments.length} parcelas</p>}
                  {Boolean(inv.ibs || inv.cbs) && (
                    <p className="font-mono tabular-nums text-[11px] text-stone-400">
                      IBS {formatCurrency(inv.ibs ?? 0)} · CBS {formatCurrency(inv.cbs ?? 0)}
                    </p>
                  )}
                  {Boolean(inv.altTotal) && inv.model === NFSE_MODEL && (
                    <p className="text-[11px] text-stone-400">
                      Serviço {formatCurrency(inv.altTotal ?? 0)}, líquido das retenções
                      {inv.retentions ? `: ${retentionParts(inv.retentions).map((p) => `${p.label} ${formatCurrency(p.cents / 100)}`).join(' · ')}` : ''}
                    </p>
                  )}
                </td>
                <td className="px-3 py-3 font-mono tabular-nums text-[12px] text-stone-500" title={inv.cfops.map((c) => `${c.cfop}: ${formatCurrency(c.amount)}`).join('\n')}>
                  {inv.cfops[0]?.cfop ?? (inv.serviceCode ? <span title="Código de tributação nacional do serviço">{inv.serviceCode}</span> : '—')}
                  {inv.cfops.length > 1 && <span className="text-stone-400"> +{inv.cfops.length - 1}</span>}
                </td>
                <td className="px-3 py-3">
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap ${style.className}`}>{style.label(inv)}</span>
                </td>
                <td className={`px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap ${state === 'CANCELLED' ? 'line-through text-stone-400' : ''}`}>
                  {formatCurrency(inv.total)}
                </td>
                <td className="pl-1 pr-5 py-2 text-right opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  {!busy && (
                    <ConfirmButton
                      ariaLabel={`Excluir nota ${inv.number}`}
                      label={<Trash2 className="w-3.5 h-3.5" />}
                      confirmLabel="Excluir"
                      onConfirm={() => onDelete(inv)}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
