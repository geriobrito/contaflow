'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, FileText, Landmark, Scale } from 'lucide-react';
import type { FixedAsset } from '@/types/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { useFixedAssetReconciliation, useFixedAssets } from '@/hooks/imobilizado/useFixedAssets';
import { FixedAssetsTable } from '@/components/imobilizado/FixedAssetsTable';
import { FixedAssetSheet } from '@/components/imobilizado/FixedAssetSheet';
import { DisposeAssetSheet } from '@/components/imobilizado/DisposeAssetSheet';
import { ControlsTabs } from '@/components/imobilizado/ControlsTabs';
import { formatMonth } from '@/lib/periods';
import { formatCurrency } from '@/lib/utils/formatters';
import { BUTTON, INPUT, PAGE, PageHeader, SURFACE } from '@/components/ui/primitives';

const competence = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

/**
 * Imobilizado e intangível: cadastro dos bens, posição no fim do mês escolhido, depreciação a
 * lançar e a conferência com o balancete. Os dados e as gravações vêm de `useFixedAssets`.
 */
export default function ImobilizadoPage() {
  const { user } = useAuth();
  const { currentClient } = useClient();
  const clientId = currentClient?.id;
  const data = useFixedAssets(clientId, user?.uid);
  const reconciliation = useFixedAssetReconciliation(clientId, data.ctx);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [editing, setEditing] = useState<FixedAsset | 'new' | null>(null);
  const [disposing, setDisposing] = useState<FixedAsset | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

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
      setToast(`Não foi possível gerar o relatório (${e instanceof Error ? e.message : 'erro'}).`);
    }
  };

  const pending = data.pendingMonths;
  const diverging = reconciliation.result?.rows.filter((r) => Math.abs(r.difference) >= 0.005) ?? [];

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
              <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={`${INPUT} h-9 w-40 font-mono tabular-nums text-[13px]`} />
            </label>
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
      <ControlsTabs />
      {data.error && !editing && !disposing && (
        <p role="alert" className="text-[13px] text-rose-600">
          {data.error}
        </p>
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

      <FixedAssetsTable
        ctx={data.ctx}
        assets={data.assets}
        month={month}
        busy={data.busy}
        onCreate={() => setEditing('new')}
        onEdit={setEditing}
        onDispose={setDisposing}
        onUndoDisposal={(a) => void data.undoDisposal(a).then((ok) => done(ok, 'Baixa desfeita'))}
        onDelete={(a) => void data.remove(a).then((ok) => done(ok, 'Bem excluído'))}
      />

      {data.ctx && data.assets.length > 0 && (
        <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
          <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-black/4 dark:border-white/6">
            <Scale className="w-4 h-4 text-stone-400" />
            <div className="flex-1 min-w-0">
              <h2 className="text-[15px] font-semibold tracking-tight">Conferência com o balancete</h2>
              <p className="text-[12px] text-stone-500">Custo por conta de bem e acumulada na retificadora, cadastro × saldo contábil em {formatMonth(month)}.</p>
            </div>
            <button type="button" disabled={reconciliation.loading} onClick={() => void reconciliation.check(month)} className={`${BUTTON.secondary} h-8`}>
              {reconciliation.loading ? 'Conferindo…' : reconciliation.result ? 'Conferir de novo' : 'Conferir'}
            </button>
          </div>
          {reconciliation.error && <p className="px-5 py-3 text-[13px] text-rose-600">{reconciliation.error}</p>}
          {reconciliation.result && (
            <>
              <p className={`flex items-center gap-2 px-5 py-3 text-[13px] ${diverging.length ? 'text-amber-800 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-400'}`}>
                {diverging.length ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                {diverging.length
                  ? `${diverging.length} conta(s) com diferença em ${formatMonth(reconciliation.result.month)}: bem comprado e não cadastrado, cadastrado e não contabilizado, ou depreciação lançada fora da rotina.`
                  : `Cadastro e balancete conferem em ${formatMonth(reconciliation.result.month)}.`}
              </p>
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-stone-400 border-y border-black/4">
                    <th className="font-medium pl-5 pr-3 py-2.5">Conta</th>
                    <th className="font-medium px-3 py-2.5 text-right">Cadastro</th>
                    <th className="font-medium px-3 py-2.5 text-right">Balancete</th>
                    <th className="font-medium pl-3 pr-5 py-2.5 text-right">Diferença</th>
                  </tr>
                </thead>
                <tbody>
                  {reconciliation.result.rows.map((r) => (
                    <tr key={r.accountId} className="border-b border-black/4 last:border-0 text-[13px]">
                      <td className="pl-5 pr-3 py-2.5">
                        <span className="font-mono text-[12px] text-stone-400">{r.accountCode}</span> {r.accountName}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{formatCurrency(r.register)}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{formatCurrency(r.ledger)}</td>
                      <td className={`pl-3 pr-5 py-2.5 text-right font-mono tabular-nums ${Math.abs(r.difference) >= 0.005 ? 'text-rose-600' : 'text-stone-400'}`}>
                        {formatCurrency(r.difference)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      {editing && data.ctx && (
        <FixedAssetSheet
          key={editing === 'new' ? 'new' : editing.id}
          asset={editing === 'new' ? null : editing}
          ctx={data.ctx}
          busy={data.busy}
          error={data.error}
          onClose={() => setEditing(null)}
          onSave={(asset) => data.save(asset).then((ok) => done(ok, editing === 'new' ? 'Bem cadastrado' : 'Bem atualizado'))}
        />
      )}
      {disposing && data.ctx && (
        <DisposeAssetSheet
          key={disposing.id}
          asset={disposing}
          ctx={data.ctx}
          busy={data.busy}
          error={data.error}
          onClose={() => setDisposing(null)}
          onDispose={(d) => data.dispose(disposing, d).then((ok) => done(ok, 'Baixa lançada'))}
        />
      )}

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full bg-stone-900/90 text-white text-[13px] shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-xl animate-sheet-in">
          {toast}
        </div>
      )}
    </main>
  );
}
