'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Clock, ReceiptText, ShoppingBag, TrendingUp } from 'lucide-react';
import { useClient } from '@/contexts/ClientContext';
import { PeriodPicker, usePeriod } from '@/components/ui/PeriodPicker';
import { useInvoices, type InvoiceImportOutcome } from '@/hooks/nfe/useInvoices';
import { InvoiceDropzone } from '@/components/nfe/InvoiceDropzone';
import { InvoiceImportResult } from '@/components/nfe/InvoiceImportResult';
import { InvoiceAccountantChecks } from '@/components/nfe/InvoiceAccountantChecks';
import { InvoiceTable } from '@/components/nfe/InvoiceTable';
import { InvoiceDetailDrawer } from '@/components/conciliacao/InvoiceDetailDrawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  EmptyState,
  PAGE,
  PageHeader,
  SearchField,
  SEGMENT_PILL,
  segmentClass,
  SegmentedControl,
  StatCard,
  SURFACE,
  type StatTone,
} from '@/components/ui/primitives';
import { useSlidingIndicator } from '@/components/ui/useSlidingIndicator';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { Toast, useToast } from '@/components/ui/Toast';
import { todayISO } from '@/lib/business-days';
import { compareBillingWithRevenue, findNumberingGaps } from '@/lib/nfe/checks';
import {
  filterByDirection,
  filterInvoices,
  invoicePeriodSummary,
  invoiceStateCounts,
  nextInvoiceSort,
  sortInvoices,
  type InvoiceDirectionFilter,
  type InvoiceSort,
  type InvoiceStateFilter,
} from '@/lib/nfe/list';
import { formatCurrency } from '@/lib/utils/formatters';
import type { InvoiceSummary } from '@/types/firestore';

const DIRECTIONS: readonly { value: InvoiceDirectionFilter; label: string }[] = [
  { value: 'ALL', label: 'Todas' },
  { value: 'PURCHASE', label: 'Compras' },
  { value: 'SALE', label: 'Vendas' },
];

function stateOptions(direction: InvoiceDirectionFilter): readonly { value: InvoiceStateFilter; label: string }[] {
  const settledLabel = direction === 'PURCHASE' ? 'Pagas' : direction === 'SALE' ? 'Recebidas' : 'Pagas / recebidas';
  return [
    { value: 'ALL', label: 'Todas' },
    { value: 'OPEN', label: 'Sem lançamento' },
    { value: 'PARTIAL', label: 'Parcial' },
    { value: 'SETTLED', label: settledLabel },
    { value: 'CANCELLED', label: 'Canceladas' },
  ];
}

/**
 * Notas fiscais da empresa: importação dos XML e pacotes .zip (lidos no navegador, só o resumo é
 * gravado), resumo do período, fila por situação de pagamento, conferências do contador e detalhe
 * da nota integrado à Conciliação.
 */
export default function NotasFiscaisPage() {
  const { currentClient } = useClient();
  const period = usePeriod('month');
  const {
    invoices,
    transactions,
    journalEntries,
    accounts,
    transactionsById,
    ensureLinkedTransactions,
    isLoading,
    error,
    busy,
    importFiles,
    remove,
  } = useInvoices(currentClient, currentClient ? period.range : null);

  const [outcome, setOutcome] = useState<InvoiceImportOutcome | null>(null);
  const [direction, setDirection] = useState<InvoiceDirectionFilter>('ALL');
  const [stateFilter, setStateFilter] = useState<InvoiceStateFilter>('ALL');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<InvoiceSort | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<InvoiceSummary | null>(null);
  const [toast, setToast] = useToast();

  const { containerRef: stateTabsRef, indicatorRef: statePillRef } = useSlidingIndicator<HTMLDivElement>(stateFilter);

  const today = todayISO();
  const list = useMemo(() => invoices ?? [], [invoices]);
  const byDirection = useMemo(() => filterByDirection(list, direction), [list, direction]);
  const counts = useMemo(() => invoiceStateCounts(byDirection), [byDirection]);
  const visible = useMemo(
    () => sortInvoices(filterInvoices(byDirection, stateFilter, search), sort),
    [byDirection, stateFilter, search, sort]
  );

  const summary = useMemo(() => invoicePeriodSummary(list, today), [list, today]);
  const gaps = useMemo(() => findNumberingGaps(list, currentClient?.cnpj), [list, currentClient?.cnpj]);
  const billingComparison = useMemo(
    () =>
      currentClient && invoices
        ? compareBillingWithRevenue({
            invoices: list,
            transactions,
            accounts,
            journalEntries,
            range: period.range,
          })
        : null,
    [currentClient, invoices, list, transactions, accounts, journalEntries, period.range]
  );

  const selectedInvoice = useMemo(
    () => (selectedId ? list.find((i) => i.id === selectedId) ?? null : null),
    [list, selectedId]
  );

  const selectedMonth =
    period.mode === 'month' ? `${period.year}-${String(period.month).padStart(2, '0')}` : null;

  const handleFiles = async (files: File[]) => {
    const result = await importFiles(files);
    if (!result) return;
    setOutcome(result);
    // Leva a lista ao mês da nota mais recente do lote.
    if (result.latestIssueDate) period.jumpTo(result.latestIssueDate);
  };

  const handleSelectInvoice = (inv: InvoiceSummary) => {
    setSelectedId(inv.id);
    if (inv.links?.length) void ensureLinkedTransactions(inv);
  };

  const executeDelete = async (inv: InvoiceSummary) => {
    const ok = await remove(inv);
    if (ok) {
      if (selectedId === inv.id) setSelectedId(null);
      setToast(`Nota ${inv.number} excluída`);
    }
  };

  const handleRequestDelete = (inv: InvoiceSummary) => {
    if ((inv.links?.length ?? 0) > 0) {
      setConfirmingDelete(inv);
    } else {
      void executeDelete(inv);
    }
  };

  const openTone: StatTone =
    summary.totalCount === 0
      ? 'neutral'
      : summary.overdueCount > 0
        ? 'alert'
        : summary.openCount + summary.partialCount > 0
          ? 'warn'
          : 'good';

  const openCaption =
    summary.totalCount === 0
      ? 'nenhuma nota no período'
      : summary.overdueCount > 0
        ? `${summary.overdueCount} vencida(s) · ${formatCurrency(summary.openAmount)} em aberto`
        : summary.openCount + summary.partialCount > 0
          ? `${formatCurrency(summary.openAmount)} aguardando conciliação`
          : 'todas quitadas no extrato';

  const tabs = stateOptions(direction);

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Notas fiscais"
        description="Importe os XML ou pacotes .zip das notas de compra e de venda: na Conciliação, o pagamento ou recebimento de mesmo valor e parceiro já vem com a conta sugerida."
      />

      <InvoiceDropzone busy={busy} disabled={!currentClient} onFiles={(files) => void handleFiles(files)} />

      {outcome && <InvoiceImportResult outcome={outcome} onClose={() => setOutcome(null)} />}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-2xl border border-rose-200/70 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-[13px] text-rose-700 dark:text-rose-300"
        >
          <AlertTriangle className="w-4 h-4 mt-px shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!isLoading && list.length > 0 && (
        <section aria-label="Resumo das notas do período" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            icon={ShoppingBag}
            label="Compras"
            value={formatCurrency(summary.purchasesTotal)}
            caption={summary.purchasesCount > 0 ? `${summary.purchasesCount} nota(s) autorizada(s)` : 'nenhuma compra no período'}
          />
          <StatCard
            icon={TrendingUp}
            label="Vendas"
            value={formatCurrency(summary.salesTotal)}
            tone={summary.salesCount > 0 ? 'good' : 'neutral'}
            caption={summary.salesCount > 0 ? `${summary.salesCount} nota(s) autorizada(s)` : 'nenhuma venda no período'}
          />
          <StatCard
            icon={ReceiptText}
            label="Notas no período"
            value={summary.totalCount}
            caption={
              summary.cancelledCount > 0
                ? `${summary.authorizedCount} autorizada(s) · ${summary.cancelledCount} cancelada(s)`
                : `${summary.authorizedCount} autorizada(s) (canceladas fora dos totais)`
            }
          />
          <StatCard
            icon={Clock}
            label="Sem lançamento"
            value={summary.openCount + summary.partialCount}
            tone={openTone}
            caption={openCaption}
          />
        </section>
      )}

      {!isLoading && (
        <InvoiceAccountantChecks
          gaps={gaps}
          comparison={billingComparison}
          selectedMonth={selectedMonth}
          onFilterOpenSales={() => {
            setDirection('SALE');
            setStateFilter('OPEN');
          }}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl ariaLabel="Tipo de nota" value={direction} onChange={setDirection} options={DIRECTIONS} />
          <PeriodPicker period={period} />
        </div>
        <SearchField value={search} onChange={setSearch} placeholder="Parceiro, CNPJ, número ou CFOP" className="w-72" />
      </div>

      <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
        {list.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-black/4 dark:border-white/6">
            <div
              ref={stateTabsRef}
              role="tablist"
              aria-label="Filtrar por situação da nota"
              className="inline-flex flex-wrap relative p-0.5 rounded-xl bg-black/4 dark:bg-white/6"
            >
              <span ref={statePillRef} aria-hidden className={SEGMENT_PILL} />
              {tabs.map((tab) => {
                const active = stateFilter === tab.value;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    data-active={active}
                    onClick={() => setStateFilter(tab.value)}
                    className={`${segmentClass(active)} inline-flex items-center gap-1.5`}
                  >
                    {tab.label}
                    <span
                      className={`font-mono tabular-nums text-[11px] font-normal ${
                        active ? 'text-stone-500 dark:text-stone-300' : 'text-stone-400 dark:text-stone-500'
                      }`}
                    >
                      {counts[tab.value]}
                    </span>
                  </button>
                );
              })}
            </div>
            {(stateFilter !== 'ALL' || direction !== 'ALL' || search.trim() !== '') && (
              <span className="text-[12px] text-stone-500 font-mono tabular-nums">
                {visible.length} de {list.length} nota(s)
              </span>
            )}
          </div>
        )}

        {isLoading ? (
          <TableSkeleton rows={6} label="Carregando notas…" />
        ) : visible.length === 0 ? (
          <EmptyState
            title={list.length ? 'Nenhuma nota encontrada' : 'Nenhuma nota neste período'}
            description={
              list.length
                ? 'Mude o filtro de situação, o tipo de nota ou a busca.'
                : 'Importe os XML (ou .zip) acima ou escolha outro período (a lista é pela data de emissão).'
            }
          />
        ) : (
          <InvoiceTable
            invoices={visible}
            busy={busy}
            sort={sort}
            onSort={(key) => setSort((curr) => nextInvoiceSort(curr, key))}
            onSelect={handleSelectInvoice}
            onDelete={handleRequestDelete}
          />
        )}
      </section>

      {selectedInvoice && (
        <InvoiceDetailDrawer
          invoice={selectedInvoice}
          linkedTransactions={transactionsById}
          accounts={accounts}
          onClose={() => setSelectedId(null)}
          onDelete={handleRequestDelete}
        />
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title={`Excluir a nota ${confirmingDelete.number}?`}
          description={`Esta nota já está vinculada a ${confirmingDelete.links?.length ?? 1} lançamento(s) na Conciliação. O lançamento continuará classificado na sua conta contábil, mas deixará de apontar para esta nota.`}
          confirmLabel="Excluir nota"
          destructive
          onConfirm={async () => {
            const target = confirmingDelete;
            setConfirmingDelete(null);
            await executeDelete(target);
          }}
          onCancel={() => setConfirmingDelete(null)}
        />
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </main>
  );
}
