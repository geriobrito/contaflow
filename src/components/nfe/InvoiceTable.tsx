'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronsUpDown, Trash2 } from 'lucide-react';
import { TABLE_HEAD, Th } from '@/components/ui/Table';
import type { InvoiceSummary } from '@/types/firestore';
import { type InvoicePaymentState } from '@/lib/nfe/import';
import { invoiceDueInfo, type InvoiceSort, type InvoiceSortKey } from '@/lib/nfe/list';
import { NFSE_MODEL } from '@/lib/nfe/parser';
import { retentionParts } from '@/lib/nfe/retentions';
import { todayISO } from '@/lib/business-days';
import { formatCNPJ, formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { ConfirmButton } from '@/components/ui/primitives';

const STATE: Record<InvoicePaymentState, { label: (i: InvoiceSummary) => string; className: string }> = {
  OPEN: { label: () => 'Sem lançamento', className: 'bg-stone-50 text-stone-500 border-stone-200/70 dark:bg-stone-800 dark:border-stone-700' },
  PARTIAL: { label: () => 'Parcial', className: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200/70 dark:border-amber-500/25' },
  SETTLED: { label: (i) => (i.direction === 'PURCHASE' ? 'Paga' : 'Recebida'), className: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/70 dark:border-emerald-500/25' },
  CANCELLED: { label: () => 'Cancelada', className: 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-200/70 dark:border-rose-500/25' },
};

const SORT_LABEL: Record<InvoiceSortKey, string> = {
  issueDate: 'emissão',
  partner: 'fornecedor ou cliente',
  total: 'valor',
};

function SortHeader({
  column,
  sort,
  onSort,
  align,
  children,
}: {
  column: InvoiceSortKey;
  sort: InvoiceSort | null;
  onSort?: (key: InvoiceSortKey) => void;
  align?: 'right';
  children: React.ReactNode;
}) {
  if (!onSort) return <>{children}</>;
  const active = sort?.key === column;
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      title={
        active
          ? sort.dir === 'asc'
            ? `Ordenado por ${SORT_LABEL[column]}, crescente`
            : `Ordenado por ${SORT_LABEL[column]}, decrescente`
          : `Ordenar por ${SORT_LABEL[column]}`
      }
      className={`group/sort inline-flex items-center gap-1 uppercase tracking-[inherit] font-semibold hover:text-stone-800 dark:hover:text-stone-100 transition-colors ${
        align === 'right' ? 'flex-row-reverse' : ''
      } ${active ? 'text-stone-800 dark:text-stone-100' : ''}`}
    >
      {children}
      <Icon
        aria-hidden
        className={`w-3 h-3 ${active ? 'text-accent-ink' : 'opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60'} transition-opacity`}
        strokeWidth={2.25}
      />
    </button>
  );
}

const docLabel = (doc: string) => (doc.length === 14 ? formatCNPJ(doc) : doc.length === 11 ? `${doc.slice(0, 3)}.${doc.slice(3, 6)}.${doc.slice(6, 9)}-${doc.slice(9)}` : doc);

interface InvoiceTableProps {
  invoices: readonly InvoiceSummary[];
  busy: boolean;
  sort?: InvoiceSort | null;
  onSort?: (key: InvoiceSortKey) => void;
  onSelect?: (invoice: InvoiceSummary) => void;
  onDelete: (invoice: InvoiceSummary) => void;
}

/** Lista das notas importadas, com a situação de pagamento pelo casamento com o extrato. */
export function InvoiceTable({ invoices, busy, sort = null, onSort, onSelect, onDelete }: InvoiceTableProps) {
  const today = todayISO();
  const ariaSort = (column: InvoiceSortKey) =>
    sort?.key === column ? (sort.dir === 'asc' ? ('ascending' as const) : ('descending' as const)) : undefined;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className={TABLE_HEAD}>
            <Th scope="col" edge="start" className="w-24" aria-sort={ariaSort('issueDate')}>
              <SortHeader column="issueDate" sort={sort} onSort={onSort}>
                Emissão
              </SortHeader>
            </Th>
            <Th scope="col" className="w-28">Nota</Th>
            <Th scope="col" aria-sort={ariaSort('partner')}>
              <SortHeader column="partner" sort={sort} onSort={onSort}>
                Fornecedor / cliente
              </SortHeader>
            </Th>
            <Th scope="col" className="w-20">CFOP</Th>
            <Th scope="col" className="w-44">Situação</Th>
            <Th scope="col" align="right" className="w-36" aria-sort={ariaSort('total')}>
              <SortHeader column="total" sort={sort} onSort={onSort} align="right">
                Valor
              </SortHeader>
            </Th>
            <Th scope="col" className="pl-1 pr-5 py-2.5 w-12" />
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => {
            const due = invoiceDueInfo(inv, today);
            const state = due.state;
            const style = STATE[state];
            const hasLinks = (inv.links?.length ?? 0) > 0;
            return (
              <tr
                key={inv.id}
                tabIndex={onSelect ? 0 : undefined}
                onClick={() => onSelect?.(inv)}
                onKeyDown={(e) => {
                  if (!onSelect) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(inv);
                  }
                }}
                className={`group border-b border-black/4 dark:border-white/5 last:border-0 text-[13px] align-top ${
                  onSelect ? 'cursor-pointer hover:bg-black/2 dark:hover:bg-white/3 focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/60 transition-colors' : ''
                }`}
              >
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
                  {inv.counterpartyDoc && <p className="font-mono tabular-nums text-[11px] text-stone-500 dark:text-stone-400">{docLabel(inv.counterpartyDoc)}</p>}
                  {inv.installments.length === 1 && (
                    <p className={`text-[11px] ${due.isOverdue ? 'text-rose-600 dark:text-rose-400 font-medium' : 'text-stone-500 dark:text-stone-400'}`}>
                      Venc. <span className="font-mono tabular-nums">{formatDateBR(inv.installments[0].dueDate)}</span>
                    </p>
                  )}
                  {inv.installments.length > 1 && (
                    <p className={`text-[11px] ${due.isOverdue ? 'text-rose-600 dark:text-rose-400 font-medium' : 'text-stone-500 dark:text-stone-400'}`}>
                      {inv.installments.length} parcelas
                      {due.nextDueDate && (
                        <>
                          {' · próx. venc. '}
                          <span className="font-mono tabular-nums">{formatDateBR(due.nextDueDate)}</span>
                        </>
                      )}
                    </p>
                  )}
                  {Boolean(inv.ibs || inv.cbs) && (
                    <p className="font-mono tabular-nums text-[11px] text-stone-500 dark:text-stone-400">
                      IBS {formatCurrency(inv.ibs ?? 0)} · CBS {formatCurrency(inv.cbs ?? 0)}
                    </p>
                  )}
                  {Boolean(inv.altTotal) && inv.model === NFSE_MODEL && (
                    <p className="text-[11px] text-stone-500 dark:text-stone-400">
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
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap ${style.className}`}>{style.label(inv)}</span>
                    {due.isOverdue && due.nextDueDate && (
                      <span
                        title={`Vencida em ${formatDateBR(due.nextDueDate)}`}
                        className="inline-flex px-2 py-0.5 rounded-full border text-[10.5px] font-medium whitespace-nowrap bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-200/70 dark:border-rose-500/25"
                      >
                        Vencida
                      </span>
                    )}
                  </div>
                  {(state === 'OPEN' || state === 'PARTIAL') && (
                    <Link
                      href={`/?mes=${due.conciliationMonth}&filtro=PENDING`}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                      className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-accent-ink hover:underline whitespace-nowrap"
                    >
                      <span>Ver na Conciliação</span>
                      <ArrowUpRight className="w-3 h-3" />
                    </Link>
                  )}
                </td>
                <td className={`px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap ${state === 'CANCELLED' ? 'line-through text-stone-400' : ''}`}>
                  {formatCurrency(inv.total)}
                </td>
                <td className="pl-1 pr-5 py-2 text-right" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  {!busy && (
                    hasLinks ? (
                      <button
                        type="button"
                        aria-label={`Excluir nota ${inv.number}`}
                        onClick={() => onDelete(inv)}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-full text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 active:scale-[0.94] transition-all duration-150"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <ConfirmButton
                        ariaLabel={`Excluir nota ${inv.number}`}
                        label={<Trash2 className="w-3.5 h-3.5" />}
                        confirmLabel="Excluir"
                        onConfirm={() => onDelete(inv)}
                      />
                    )
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
