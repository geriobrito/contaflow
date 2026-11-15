'use client';

import { useMemo, useState } from 'react';
import { FileSpreadsheet, FileText, Landmark, Plus, ReceiptText } from 'lucide-react';
import type { FixedAsset } from '@/types/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { useAssetInvoicesRadar, useFixedAssetReconciliation, useFixedAssets } from '@/hooks/imobilizado/useFixedAssets';
import { useMonthQueryState } from '@/hooks/imobilizado/useMonthQueryState';
import { FixedAssetsTable } from '@/components/imobilizado/FixedAssetsTable';
import { FixedAssetSheet } from '@/components/imobilizado/FixedAssetSheet';
import { DisposeAssetSheet } from '@/components/imobilizado/DisposeAssetSheet';
import { ControlsErrorBanner, ControlsTabs } from '@/components/imobilizado/ControlsTabs';
import { LedgerReconciliationCard } from '@/components/imobilizado/LedgerReconciliationCard';
import { assetPositionAt, postedQuotaCents, type UnregisteredAssetInvoice } from '@/lib/fixed-assets';
import { fromCents } from '@/lib/money';
import { formatMonth } from '@/lib/periods';
import { reportError } from '@/lib/monitoring';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, INPUT_COMPACT, PAGE, PageHeader, StatCard } from '@/components/ui/primitives';
import { Toast, useToast } from '@/components/ui/Toast';

const competence = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

/**
 * Imobilizado e intangível: cadastro dos bens, posição no fim do mês escolhido, depreciação a
 * lançar e a conferência com o balancete. Os dados e as gravações vêm de `useFixedAssets`.
 */
export default function ImobilizadoPage() {
  const { user } = useAuth();
  const { currentClient } = useClient();
  const clientId = currentClient?.id;
  const data = useFixedAssets(clientId, user?.uid, currentClient?.porte);
  const reconciliation = useFixedAssetReconciliation(clientId, data.ctx);
  const radar = useAssetInvoicesRadar(clientId, data.assets);
  const [month, setMonth] = useMonthQueryState();
  const [editing, setEditing] = useState<FixedAsset | 'new' | null>(null);
  const [prefill, setPrefill] = useState<Partial<FixedAsset> | null>(null);
  const [disposing, setDisposing] = useState<FixedAsset | null>(null);
  const [toast, setToast] = useToast();

  const done = (ok: boolean, message: string) => {
    if (ok) {
      setToast(message);
      reconciliation.clear();
    }
    return ok;
  };

  /** Relatório analítico (papel de trabalho da conciliação), carregado só ao exportar. */
  const exportReport = async (kind: 'pdf' | 'xlsx') => {
    if (!currentClient || !data.ctx) return;
    try {
      const [{ downloadBlob }, mod] = await Promise.all([import('@/lib/export/dre-rows'), import('@/lib/export/fixed-assets-export')]);
      const rows = mod.fixedAssetReportRows(data.assets, month, data.ctx.implantationMonth, data.ctx.accounts);
      const ctx = { client: currentClient, rows, month, issuedAt: new Date() };
      const file = kind === 'pdf' ? mod.generateFixedAssetsPdf(ctx) : await mod.generateFixedAssetsExcel(ctx);
      downloadBlob(file.blob, file.fileName);
    } catch (e) {
      reportError(e, { area: 'imobilizado', op: `exportar ${kind}` });
      setToast(`Não foi possível gerar o relatório (${e instanceof Error ? e.message : 'erro'}).`);
    }
  };

  const summary = useMemo(() => {
    let costCents = 0;
    let accumCents = 0;
    let netCents = 0;
    let monthCents = 0;
    let activeCount = 0;
    const imp = data.ctx?.implantationMonth ?? null;
    for (const a of data.assets) {
      const pos = assetPositionAt(a, month, imp);
      monthCents += postedQuotaCents(a, month, imp);
      if (pos.costCents > 0) {
        activeCount++;
        costCents += pos.costCents;
        accumCents += pos.accumulatedCents;
        netCents += pos.netCents;
      }
    }
    return {
      activeCount,
      cost: fromCents(costCents),
      accumulated: fromCents(accumCents),
      bookValue: fromCents(netCents),
      monthDepreciation: fromCents(monthCents),
    };
  }, [data.assets, month, data.ctx?.implantationMonth]);

  const openFromInvoice = (item: UnregisteredAssetInvoice) => {
    setPrefill({
      description: item.invoice.counterpartyName ? `Bem adquirido de ${item.invoice.counterpartyName}` : `NF ${item.invoice.number}`,
      accountCode: item.suggestedAccountCode,
      acquisitionDate: item.invoice.issueDate,
      inUseDate: item.invoice.issueDate,
      invoiceValue: item.invoice.total,
      documentRef: item.invoice.number,
      invoiceKey: item.invoice.key,
    });
    setEditing('new');
  };

  const openDispose = (asset: FixedAsset) => {
    const year = month.slice(0, 4);
    if (radar.scannedYear !== year && !radar.loading) {
      void radar.scanYear(year);
    }
    setDisposing(asset);
  };

  const pending = data.pendingMonths;
  const unregisteredInvoices = reconciliation.result?.unregisteredInvoices ?? radar.unregistered ?? null;

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Imobilizado"
        description="Bens do imobilizado e do intangível, com a depreciação de cada mês calculada pela linha reta e lançada no último dia da competência (NBC TG 1002 e 1001, seção 17)."
        actions={
          <>
            <label className="flex items-center gap-2 text-[12px] text-stone-500">
              Posição no fim de
              <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={`${INPUT_COMPACT} w-40 font-mono tabular-nums`} />
            </label>
            <button
              type="button"
              disabled={radar.loading}
              onClick={() => void radar.scanYear(month.slice(0, 4))}
              className={BUTTON.secondary}
            >
              <ReceiptText className="w-4 h-4" />
              {radar.loading ? 'Buscando NF-e…' : 'Cruzar com NF-e'}
            </button>
            {data.assets.length > 0 && (
              <>
                <button type="button" onClick={() => void exportReport('pdf')} className={BUTTON.secondary}>
                  <FileText className="w-4 h-4" />
                  PDF
                </button>
                <button type="button" onClick={() => void exportReport('xlsx')} className={BUTTON.secondary}>
                  <FileSpreadsheet className="w-4 h-4" />
                  Excel
                </button>
              </>
            )}
          </>
        }
      />
      <ControlsTabs month={month} />
      {data.error && !editing && !disposing && <ControlsErrorBanner message={data.error} />}

      {data.assets.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Custo ativo" value={formatCurrency(summary.cost)} caption={`${summary.activeCount} bem(ns) em uso`} />
          <StatCard label="Depreciação acumulada" value={formatCurrency(summary.accumulated)} caption={`até ${competence(month)}`} />
          <StatCard label="Valor líquido" value={formatCurrency(summary.bookValue)} caption="saldo residual contábil" />
          <StatCard
            label="Cota do mês"
            value={formatCurrency(summary.monthDepreciation)}
            caption={`competência ${competence(month)}`}
            tone={summary.monthDepreciation > 0 ? 'accent' : 'neutral'}
          />
        </div>
      )}

      {pending.length > 0 && (
        <section role="status" className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200/70 bg-amber-50/80 dark:bg-amber-950/25 dark:border-amber-800/40 px-4 py-3 text-[13px] text-amber-900 dark:text-amber-200">
          <Landmark className="w-4 h-4 shrink-0" />
          <p className="flex-1 min-w-0">
            Depreciação a lançar ou atualizar em {pending.length} competência(s) aberta(s): {pending.map(competence).join(', ')}.
          </p>
          <button
            type="button"
            disabled={data.busy}
            onClick={() => void data.postPending(pending).then((ok) => done(ok, `Depreciação lançada em ${pending.length} competência(s)`))}
            className={`${BUTTON.accent} h-8`}
          >
            {data.busy ? 'Lançando…' : 'Lançar agora'}
          </button>
        </section>
      )}

      {unregisteredInvoices && unregisteredInvoices.length > 0 && (
        <section
          role="region"
          aria-label="Notas fiscais de imobilizado sem cadastro"
          className="rounded-2xl border border-amber-200/70 dark:border-amber-800/40 bg-amber-50/80 dark:bg-amber-950/25 px-4 py-3.5 space-y-2.5 text-[13px]"
        >
          <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-medium">
            <ReceiptText className="w-4 h-4 shrink-0" />
            <span>
              {unregisteredInvoices.length} nota(s) fiscal(is) com CFOP de imobilizado sem bem correspondente cadastrado:
            </span>
          </div>
          <div className="divide-y divide-amber-200/60 dark:divide-amber-800/40">
            {unregisteredInvoices.map((item) => (
              <div key={item.invoice.id} className="flex flex-wrap items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="font-medium text-stone-900 dark:text-stone-100">
                    NF {item.invoice.number} · {item.invoice.counterpartyName || item.invoice.counterpartyDoc}
                  </p>
                  <p className="text-[12px] text-stone-600 dark:text-stone-400">
                    Emissão {formatDateBR(item.invoice.issueDate)} · CFOP {item.invoice.cfops.map((c) => c.cfop).join(', ')} ·{' '}
                    <span className="font-mono tabular-nums font-medium">{formatCurrency(item.invoice.total)}</span>
                  </p>
                </div>
                <button type="button" onClick={() => openFromInvoice(item)} className={`${BUTTON.secondary} h-8 text-[12px]`}>
                  <Plus className="w-3.5 h-3.5" />
                  Cadastrar bem
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <FixedAssetsTable
        ctx={data.ctx}
        assets={data.assets}
        month={month}
        busy={data.busy}
        onCreate={() => {
          setPrefill(null);
          setEditing('new');
        }}
        onEdit={(a) => {
          setPrefill(null);
          setEditing(a);
        }}
        onDispose={openDispose}
        onUndoDisposal={(a) => void data.undoDisposal(a).then((ok) => done(ok, 'Baixa desfeita'))}
        onDelete={(a) => void data.remove(a).then((ok) => done(ok, 'Bem excluído'))}
      />

      {data.ctx && (data.assets.length > 0 || unregisteredInvoices !== null) && (
        <LedgerReconciliationCard
          description={`Custo por conta de bem e acumulada na retificadora, cadastro × saldo contábil em ${formatMonth(month)}.`}
          divergenceNote="bem comprado e não cadastrado, cadastrado e não contabilizado, ou depreciação lançada fora da rotina."
          loading={reconciliation.loading}
          error={reconciliation.error}
          result={reconciliation.result}
          onCheck={() => void reconciliation.check(month)}
        />
      )}

      {editing && data.ctx && (
        <FixedAssetSheet
          key={editing === 'new' ? `new-${prefill?.invoiceKey ?? ''}` : editing.id}
          asset={editing === 'new' ? null : editing}
          prefill={editing === 'new' ? prefill : null}
          ctx={data.ctx}
          porte={currentClient?.porte}
          busy={data.busy}
          error={data.error}
          onClose={() => {
            setEditing(null);
            setPrefill(null);
          }}
          onSave={(asset) => data.save(asset).then((ok) => done(ok, editing === 'new' ? 'Bem cadastrado' : 'Bem atualizado'))}
        />
      )}
      {disposing && data.ctx && (
        <DisposeAssetSheet
          key={disposing.id}
          asset={disposing}
          ctx={data.ctx}
          saleInvoices={radar.saleSuggestions}
          busy={data.busy}
          error={data.error}
          onClose={() => setDisposing(null)}
          onDispose={(d) => data.dispose(disposing, d).then((ok) => done(ok, 'Baixa lançada'))}
        />
      )}

      <Toast toast={toast} />
    </main>
  );
}
