'use client';

import { useMemo, useState } from 'react';
import { useClient } from '@/contexts/ClientContext';
import { PeriodPicker, usePeriod } from '@/components/ui/PeriodPicker';
import { useInvoices, type InvoiceImportOutcome } from '@/hooks/nfe/useInvoices';
import { InvoiceDropzone } from '@/components/nfe/InvoiceDropzone';
import { InvoiceImportResult } from '@/components/nfe/InvoiceImportResult';
import { InvoiceTable } from '@/components/nfe/InvoiceTable';
import { EmptyState, PAGE, PageHeader, SearchField, SegmentedControl, SURFACE } from '@/components/ui/primitives';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { formatCurrency } from '@/lib/utils/formatters';
import { textKey } from '@/lib/payee';
import type { InvoiceDirection } from '@/types/firestore';

type DirectionFilter = 'ALL' | InvoiceDirection;

const DIRECTIONS: readonly { value: DirectionFilter; label: string }[] = [
  { value: 'ALL', label: 'Todas' },
  { value: 'PURCHASE', label: 'Compras' },
  { value: 'SALE', label: 'Vendas' },
];

/**
 * Notas fiscais da empresa: importação dos XML (lidos no navegador, só o resumo é gravado) e a
 * lista por data de emissão, com a situação de pagamento pelo casamento com o extrato.
 */
export default function NotasFiscaisPage() {
  const { currentClient } = useClient();
  const period = usePeriod('month');
  const { invoices, isLoading, error, busy, importFiles, remove } = useInvoices(currentClient, currentClient ? period.range : null);
  const [outcome, setOutcome] = useState<InvoiceImportOutcome | null>(null);
  const [direction, setDirection] = useState<DirectionFilter>('ALL');
  const [search, setSearch] = useState('');

  const visible = useMemo(() => {
    const term = textKey(search);
    const digits = search.replace(/\D/g, '');
    return (invoices ?? []).filter(
      (i) =>
        (direction === 'ALL' || i.direction === direction) &&
        (!term ||
          textKey(i.counterpartyName).includes(term) ||
          i.number === search.trim() ||
          (digits.length >= 4 && (i.counterpartyDoc.includes(digits) || i.key.includes(digits))))
    );
  }, [invoices, direction, search]);

  const totals = useMemo(() => {
    const active = visible.filter((i) => i.status !== 'CANCELLED');
    const sum = (d: InvoiceDirection) => active.filter((i) => i.direction === d).reduce((s, i) => s + i.total, 0);
    return { purchases: sum('PURCHASE'), sales: sum('SALE') };
  }, [visible]);

  const handleFiles = async (files: File[]) => {
    const result = await importFiles(files);
    if (!result) return;
    setOutcome(result);
    // Leva a lista ao mês da nota mais recente do lote.
    if (result.latestIssueDate) period.jumpTo(result.latestIssueDate);
  };

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Notas fiscais"
        description="Importe os XML das notas de compra e de venda: na Conciliação, o pagamento ou recebimento de mesmo valor e parceiro já vem com a conta sugerida."
      />

      <InvoiceDropzone busy={busy} disabled={!currentClient} onFiles={(files) => void handleFiles(files)} />

      {outcome && <InvoiceImportResult outcome={outcome} onClose={() => setOutcome(null)} />}
      {error && <p role="alert" className="text-[13px] text-rose-600 dark:text-rose-300">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl ariaLabel="Tipo de nota" value={direction} onChange={setDirection} options={DIRECTIONS} />
          <PeriodPicker period={period} />
        </div>
        <SearchField value={search} onChange={setSearch} placeholder="Parceiro, CNPJ ou número" className="w-72" />
      </div>

      <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
        {isLoading ? (
          <TableSkeleton rows={6} label="Carregando notas…" />
        ) : visible.length === 0 ? (
          <EmptyState
            title={invoices?.length ? 'Nenhuma nota encontrada' : 'Nenhuma nota neste período'}
            description={invoices?.length ? 'Mude o filtro ou a busca.' : 'Importe os XML acima ou escolha outro período (a lista é pela data de emissão).'}
          />
        ) : (
          <>
            <InvoiceTable invoices={visible} busy={busy} onDelete={(inv) => void remove(inv)} />
            <p className="px-5 py-3 border-t border-black/4 dark:border-white/6 text-[12px] text-stone-500 flex flex-wrap gap-x-4">
              <span>{visible.length} nota(s)</span>
              {totals.purchases > 0 && <span>Compras: <b className="font-mono tabular-nums">{formatCurrency(totals.purchases)}</b></span>}
              {totals.sales > 0 && <span>Vendas: <b className="font-mono tabular-nums">{formatCurrency(totals.sales)}</b></span>}
              <span className="text-stone-400">Canceladas ficam fora dos totais.</span>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
