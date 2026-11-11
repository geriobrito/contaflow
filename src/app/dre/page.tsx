'use client';

import React, { useState } from 'react';
import { FileSpreadsheet, FileText, Loader2, Printer } from 'lucide-react';
import { PeriodPicker, usePeriod } from '@/components/ui/PeriodPicker';
import { useClient } from '@/contexts/ClientContext';
import { useDREData, type DREView } from '@/hooks/dre/useDREData';
import { formatDateBR } from '@/lib/utils/formatters';
import type { DREExportContext } from '@/lib/export/dre-rows';
import { BUTTON, PAGE, PageHeader, SegmentedControl, SURFACE } from '@/components/ui/primitives';
import { DRECompareTable } from '@/components/dre/DRECompareTable';
import { DREResultCard } from '@/components/dre/DREResultCard';
import { DREStatement } from '@/components/dre/DREStatement';
import { StatementChecks } from '@/components/ui/StatementChecks';
import { activityCheck, awaitingApprovalCheck, dreConsistencyChecks, openingCheck, periodLockCheck } from '@/lib/statement-checks';
import { useSignatureReminder } from '@/hooks/useSignatureReminder';
import { StatementSkeleton } from '@/components/ui/Skeleton';
import { reportError } from '@/lib/monitoring';

/**
 * Demonstração do resultado. Os dados vêm de `useDREData`, e o resultado em destaque, o
 * demonstrativo e as comparações ficam em src/components/dre/.
 */
export default function DREPage() {
  const { currentClient } = useClient();
  const clientId = currentClient?.id;
  const period = usePeriod('year');
  const { range, label: periodLabel, jumpTo } = period;
  const [view, setView] = useState<DREView>('simple');
  const [withAccounts, setWithAccounts] = useState(false);
  const { dre, months, prevDre, prevRange, loadPrevious, consistency, opening, lockStatus, org, blockingError, failed, isLoading, hasData, profit, tone } = useDREData(clientId, range, jumpTo, view);

  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isGeneratingExcel, setIsGeneratingExcel] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const signature = useSignatureReminder(org);
  const canExport = hasData && !isLoading && Boolean(currentClient);
  const busy = isGeneratingPdf || isGeneratingExcel;

  const exportContext = (): DREExportContext | null =>
    currentClient
      ? {
          client: currentClient,
          range,
          statement: dre,
          issuedAt: new Date(),
          signatories: {
            legalRepresentative: { name: currentClient.legalRepresentativeName, cpf: currentClient.legalRepresentativeCpf },
            accountant: org ? { name: org.accountantName, crc: org.accountantCrc } : undefined,
          },
        }
      : null;

  /** Carrega o gerador sob demanda (jsPDF/ExcelJS ficam fora do bundle inicial). */
  const handleExport = async (format: 'pdf' | 'xlsx') => {
    const base = exportContext();
    if (!base || busy) return;
    const setBusy = format === 'pdf' ? setIsGeneratingPdf : setIsGeneratingExcel;
    setBusy(true);
    setExportError(null);
    try {
      // Comparabilidade: o PDF traz o mesmo período do exercício anterior, quando houve movimento.
      const previous = format === 'pdf' ? await loadPrevious() : null;
      const ctx: DREExportContext = { ...base, previous: previous ? { range: prevRange, statement: previous } : null };
      const [{ downloadBlob }, file] = await Promise.all([
        import('@/lib/export/dre-rows'),
        format === 'pdf'
          ? import('@/lib/export/dre-pdf').then((m) => m.generateDREPdf(ctx))
          : import('@/lib/export/dre-excel').then((m) => m.generateDREExcel(ctx)),
      ]);
      downloadBlob(file.blob, file.fileName);
      signature.remind();
    } catch (e) {
      reportError(e, { area: 'dre', op: 'exportar' });
      setExportError(`Não foi possível gerar o ${format === 'pdf' ? 'PDF' : 'Excel'}. Tente novamente.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={`${PAGE} print:p-0 print:space-y-6`}>
      <PageHeader
        eyebrow={currentClient?.name}
        title="Demonstração do resultado"
        description={
          <>
            De <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{formatDateBR(range.start)}</span> a{' '}
            <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{formatDateBR(range.end)}</span>, somente
            lançamentos conciliados.
          </>
        }
        actions={
          <div role="group" aria-label="Exportar DRE" className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleExport('pdf')}
              disabled={!canExport || busy}
              aria-busy={isGeneratingPdf}
              className={BUTTON.primary}
            >
              {isGeneratingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" strokeWidth={1.75} />}
              {isGeneratingPdf ? 'Gerando…' : 'PDF Oficial'}
            </button>
            <button
              type="button"
              onClick={() => void handleExport('xlsx')}
              disabled={!canExport || busy}
              aria-busy={isGeneratingExcel}
              className={BUTTON.secondary}
            >
              {isGeneratingExcel ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="w-4 h-4" strokeWidth={1.75} />
              )}
              {isGeneratingExcel ? 'Gerando…' : 'Exportar Excel'}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              aria-label="Imprimir"
              title="Imprimir"
              className="inline-flex items-center justify-center w-9 h-9 shrink-0 rounded-full text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-black/5 dark:hover:bg-white/8 active:scale-[0.96] transition-all duration-150"
            >
              <Printer className="w-4 h-4 shrink-0" strokeWidth={1.75} />
            </button>
          </div>
        }
      />

      {/* Seletor de período e visão */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <PeriodPicker period={period} />
        <SegmentedControl
          ariaLabel="Visão da DRE"
          value={view}
          onChange={setView}
          options={[
            { value: 'simple', label: 'Simples' },
            { value: 'monthly', label: 'Mês a mês' },
            { value: 'yoy', label: 'vs. ano anterior' },
          ]}
        />
      </div>
      {blockingError && (
        <p role="alert" className="-mt-4 text-[13px] text-rose-600 dark:text-rose-300 print:hidden">
          Não foi possível carregar a DRE: {blockingError}
        </p>
      )}

      {!isLoading && !failed && !hasData && (
        <p className="-mt-4 text-[13px] text-stone-500 print:hidden">
          Exportação indisponível: não há lançamentos conciliados neste período.
        </p>
      )}
      {exportError && (
        <p role="alert" className="-mt-4 text-[13px] text-rose-600 dark:text-rose-300 print:hidden animate-fade-in">
          {exportError}
        </p>
      )}

      {/* Resultado em destaque */}
      <DREResultCard dre={dre} tone={tone} profit={profit} isLoading={isLoading} failed={failed} periodLabel={periodLabel} />

      {/* Abertura, competências, aprovação e conferência com o Balanço, num bloco só. */}
      {!isLoading && !failed && (
        <StatementChecks
          checks={[
            openingCheck(opening),
            clientId ? periodLockCheck(lockStatus, 'esta DRE') : null,
            // A conferência com o Balanço já cita os aguardando aprovação; sem ela, o aviso vem sozinho.
            !(consistency && hasData) && awaitingApprovalCheck(dre.awaitingApproval),
            ...(consistency && hasData ? dreConsistencyChecks(consistency, range.end) : []),
            hasData && activityCheck(currentClient),
          ]}
        />
      )}

      {view !== 'simple' && (
        <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
          <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-line">
            <h2 className="flex-1 text-[14px] font-semibold tracking-tight">
              {view === 'monthly' ? `Mês a mês · ${periodLabel}` : `${periodLabel} vs. mesmo período de ${prevRange.start.slice(0, 4)}`}
            </h2>
            <label className="flex items-center gap-2 text-[12px] text-stone-500 print:hidden">
              <input type="checkbox" checked={withAccounts} onChange={(e) => setWithAccounts(e.target.checked)} /> Detalhar contas
            </label>
          </div>
          {failed ? (
            <p className="px-5 py-10 text-center text-[13px] text-stone-500">DRE indisponível: os dados não puderam ser carregados.</p>
          ) : isLoading || (view === 'yoy' && !prevDre) ? (
            <StatementSkeleton rows={12} label="Carregando DRE…" />
          ) : view === 'monthly' && months.length < 2 ? (
            <p className="px-5 py-10 text-center text-[13px] text-stone-500">Selecione Trimestre ou Ano para comparar os meses.</p>
          ) : view === 'monthly' ? (
            <DRECompareTable mode="monthly" columns={months} total={{ label: 'Total', statement: dre }} withAccounts={withAccounts} />
          ) : (
            <DRECompareTable
              mode="yoy"
              columns={[
                { label: periodLabel, statement: dre },
                { label: `${formatDateBR(prevRange.start)} – ${formatDateBR(prevRange.end)}`, statement: prevDre! },
              ]}
              withAccounts={withAccounts}
            />
          )}
        </section>
      )}

      {view === 'simple' && (
        <DREStatement dre={dre} failed={failed} isLoading={isLoading} hasData={hasData} profit={profit} />
      )}

      <p className="text-[12px] text-stone-400">
        Baseado em <span className="font-mono tabular-nums">{dre.reconciledCount}</span> lançamento(s) conciliado(s). Valores entre
        parênteses reduzem o resultado.
      </p>
      {signature.toast}
    </main>
  );
}
