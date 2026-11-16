'use client';

import { useState } from 'react';
import { AlertTriangle, Boxes, CheckCircle2, ClipboardCopy, FileSpreadsheet, FileText, Landmark, RotateCcw, Settings2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { useStockControl } from '@/hooks/imobilizado/useStockControl';
import { useMonthQueryState } from '@/hooks/imobilizado/useMonthQueryState';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { ControlsErrorBanner, ControlsTabs } from '@/components/imobilizado/ControlsTabs';
import { StockSetupSheet } from '@/components/imobilizado/StockSetupSheet';
import { countDue, STOCK_FREQUENCY_LABEL, stockCloseProblem, stockRequestText } from '@/lib/stock';
import { fromCents } from '@/lib/money';
import { parseMoneyInput } from '@/lib/opening';
import { reportError } from '@/lib/monitoring';
import { formatCurrency } from '@/lib/utils/formatters';
import {
  BUTTON,
  EmptyState,
  Field,
  INPUT,
  INPUT_COMPACT,
  INPUT_MONEY,
  PAGE,
  PageHeader,
  SURFACE,
} from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { Toast, useToast } from '@/components/ui/Toast';

const competence = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const moneyText = (v: number | undefined) => (v === undefined ? '' : v.toFixed(2).replace('.', ','));

/**
 * Estoque e CMV: o estoque final do relatório do cliente em cada competência e o CMV do mês
 * (estoque inicial + compras − estoque final), lançado no último dia.
 */
export default function EstoquePage() {
  const { user } = useAuth();
  const { currentClient } = useClient();
  const clientId = currentClient?.id;
  const [month, setMonth] = useMonthQueryState();
  const data = useStockControl(clientId, user?.uid, month);
  const [setup, setSetup] = useState(false);
  const [draft, setDraft] = useState<{ key: string; amount: string; source: string } | null>(null);
  const [pendingMonth, setPendingMonth] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [toast, setToast] = useToast();

  const control = data.control;
  const ctx = data.ctx;
  const locked = Boolean(ctx?.lockedMonths.has(month));
  const key = `${clientId}|${month}`;
  const editing = draft?.key === key ? draft : null;
  const savedAmountText = moneyText(control?.counts[month]);
  const savedSourceText = control?.notes?.[month] ?? '';
  const amountText = editing?.amount ?? savedAmountText;
  const sourceText = editing?.source ?? savedSourceText;
  const hasUnsavedDraft = Boolean(editing && (editing.amount !== savedAmountText || editing.source !== savedSourceText));
  const guard = useUnsavedChangesGuard(hasUnsavedDraft);

  const status = data.month?.status;
  const figures = status && 'figures' in status ? status.figures : null;
  const problem = status ? stockCloseProblem(status, month) : null;
  const warnings = data.month?.warnings ?? [];

  const changeMonth = (next: string) => {
    if (!next || next === month) return;
    if (hasUnsavedDraft) {
      setPendingMonth(next);
      return;
    }
    setMonth(next);
  };

  const exportReport = async (kind: 'pdf' | 'xlsx') => {
    if (!currentClient || !control) return;
    try {
      const [{ downloadBlob }, mod] = await Promise.all([import('@/lib/export/dre-rows'), import('@/lib/export/controls-export')]);
      const exportCtx = {
        client: currentClient,
        control,
        month,
        figures,
        issuedAt: new Date(),
      };
      const file = kind === 'pdf' ? mod.generateStockPdf(exportCtx) : await mod.generateStockExcel(exportCtx);
      downloadBlob(file.blob, file.fileName);
    } catch (e) {
      reportError(e, { area: 'estoque', op: `exportar ${kind}` });
      setToast(`Não foi possível gerar o relatório (${e instanceof Error ? e.message : 'erro'}).`);
    }
  };

  const saveCount = (clear = false) => {
    const amount = clear ? null : amountText.trim() ? parseMoneyInput(amountText) : null;
    if (!clear && amountText.trim() && amount === null) return setToast('Valor inválido. Use o formato 1.234,56.');
    void data.saveCount(amount, sourceText).then((ok) => {
      if (!ok) return;
      setDraft(null);
      setToast(clear ? `Estoque final de ${competence(month)} apagado` : `Estoque final de ${competence(month)} gravado`);
    });
  };

  const copyRequest = async () => {
    try {
      await navigator.clipboard.writeText(stockRequestText(currentClient?.tradeName || currentClient?.name || 'a empresa', month));
      setToast('Pedido copiado: cole na conversa com o cliente');
    } catch {
      setToast('Não foi possível copiar o texto.');
    }
  };

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Estoque e CMV"
        description="Informe o estoque final do relatório do cliente: o custo das mercadorias vendidas do mês (estoque inicial + compras − estoque final) é lançado no último dia da competência (NBC TG 1002 e 1001, seção 13)."
        actions={
          control ? (
            <>
              <label className="flex items-center gap-2 text-[12px] text-stone-500">
                Competência
                <input type="month" value={month} onChange={(e) => e.target.value && changeMonth(e.target.value)} className={`${INPUT_COMPACT} w-40 font-mono tabular-nums`} />
              </label>
              <button type="button" onClick={() => void exportReport('pdf')} className={BUTTON.secondary}>
                <FileText className="w-4 h-4" />
                PDF
              </button>
              <button type="button" onClick={() => void exportReport('xlsx')} className={BUTTON.secondary}>
                <FileSpreadsheet className="w-4 h-4" />
                Excel
              </button>
            </>
          ) : undefined
        }
      />
      <ControlsTabs month={month} busy={data.busy} />
      {data.error && !setup && <ControlsErrorBanner message={data.error} />}

      {!ctx ? (
        <TableSkeleton rows={3} label="Carregando o controle de estoque…" />
      ) : !control ? (
        <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
          <EmptyState
            title="Controle de estoque não configurado"
            description="Para comércio e indústria: escolha as contas do estoque e do custo e com que frequência o cliente manda o relatório. Depois, informe o estoque final e o sistema lança o CMV."
            action={
              <button type="button" onClick={() => setSetup(true)} className={BUTTON.accent}>
                <Settings2 className="w-4 h-4" />
                Configurar
              </button>
            }
          />
        </section>
      ) : (
        <>
          {data.missingMonths.length > 0 && (
            <section role="status" className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200/70 bg-amber-50/80 dark:bg-amber-950/25 dark:border-amber-800/40 px-4 py-3 text-[13px] text-amber-900 dark:text-amber-200">
              <Landmark className="w-4 h-4 shrink-0" />
              <span>Estoque final a informar em:</span>
              {data.missingMonths.map((m) => (
                <button key={m} type="button" onClick={() => changeMonth(m)} className="rounded-lg border border-amber-600/40 px-2 py-0.5 font-mono tabular-nums text-[12px] hover:bg-amber-100 dark:hover:bg-amber-900/40">
                  {competence(m)}
                </button>
              ))}
            </section>
          )}

          <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-black/4 dark:border-white/6">
              <Boxes className="w-4 h-4 text-stone-400" />
              <div className="flex-1 min-w-0">
                <h2 className="text-[15px] font-semibold tracking-tight">Estoque final de {competence(month)}</h2>
                <p className="text-[12px] text-stone-500">
                  {control.stockAccountCode} {control.stockAccountName ?? ''} → {control.costAccountCode} {control.costAccountName ?? ''} · {STOCK_FREQUENCY_LABEL[control.frequency].toLowerCase()} · desde {competence(control.startMonth)}
                </p>
              </div>
              <button type="button" onClick={() => void copyRequest()} className={`${BUTTON.secondary} h-8`}>
                <ClipboardCopy className="w-3.5 h-3.5" />
                Copiar pedido ao cliente
              </button>
              <button type="button" onClick={() => setSetup(true)} className={`${BUTTON.secondary} h-8`}>
                <Settings2 className="w-3.5 h-3.5" />
                Configurar
              </button>
            </div>

            {month < control.startMonth ? (
              <p className="px-5 py-4 text-[13px] text-stone-500">Antes da primeira competência controlada ({competence(control.startMonth)}).</p>
            ) : (
              <div className="px-5 py-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-[180px_1fr_auto] items-end">
                  <Field label="Estoque final (R$)" hint={countDue(control, month) ? undefined : 'Mês fora do trimestre: opcional.'}>
                    <input
                      disabled={locked || data.busy}
                      value={amountText}
                      onChange={(e) => setDraft({ key, amount: e.target.value, source: sourceText })}
                      placeholder="0,00"
                      inputMode="decimal"
                      className={`${INPUT_MONEY} text-right`}
                    />
                  </Field>
                  <Field label="Origem">
                    <input
                      disabled={locked || data.busy}
                      value={sourceText}
                      onChange={(e) => setDraft({ key, amount: amountText, source: e.target.value })}
                      placeholder="ex.: Relatório Bling de 31/07"
                      maxLength={120}
                      className={INPUT}
                    />
                  </Field>
                  <div className="flex gap-2">
                    <button type="button" disabled={locked || data.busy || !editing} onClick={() => saveCount()} className={`${BUTTON.accent} h-10`}>
                      Gravar
                    </button>
                    {control.counts[month] !== undefined && !locked && (
                      <button type="button" disabled={data.busy} onClick={() => setConfirmClear(true)} className={`${BUTTON.secondary} h-10`}>
                        Apagar
                      </button>
                    )}
                  </div>
                </div>

                {hasUnsavedDraft && (
                  <p role="status" className="text-[12px] text-amber-800 dark:text-amber-300">
                    Há alteração digitada e ainda não gravada. Clique em <strong>Gravar</strong> antes de lançar o CMV.
                  </p>
                )}

                {data.month === undefined ? (
                  <TableSkeleton rows={2} dense label="Conferindo com o razão…" />
                ) : data.monthError ? (
                  <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200/70 dark:border-rose-900/50 px-4 py-3 text-[13px] text-rose-700 dark:text-rose-300 bg-rose-50/60 dark:bg-rose-950/20">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{data.monthError}</span>
                    </div>
                    <button type="button" onClick={data.reload} className={`${BUTTON.secondary} h-8 text-[12px]`}>
                      <RotateCcw className="w-3.5 h-3.5" />
                      Tentar novamente
                    </button>
                  </div>
                ) : (
                  <>
                    {figures && (
                      <div className="rounded-2xl bg-black/3 dark:bg-white/4 px-3.5 py-3 text-[13px] space-y-1.5">
                        <Row label="Estoque contábil antes do ajuste (inicial + compras no estoque)" value={fromCents(figures.ledgerCents)} />
                        <Row label="(−) Estoque final informado" value={fromCents(figures.countCents)} />
                        <Row
                          strong
                          label={figures.adjustmentCents >= 0 ? `= CMV de ${competence(month)} (D ${control.costAccountCode} / C ${control.stockAccountCode})` : `= Volta ao estoque (D ${control.stockAccountCode} / C ${control.costAccountCode})`}
                          value={fromCents(Math.abs(figures.adjustmentCents))}
                        />
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                      <p className={`flex-1 min-w-0 flex items-start gap-2 text-[13px] ${problem || warnings.length ? 'text-amber-800 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-400'}`}>
                        {!problem && !warnings.length && <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}
                        {locked
                          ? `Competência ${competence(month)} fechada.`
                          : (problem ??
                            warnings[0] ??
                            (status?.kind === 'POSTED' ? 'CMV lançado e conferido com o estoque informado.' : status?.kind === 'MATCHED' ? 'Estoque contábil igual ao informado: nada a lançar.' : 'Nada a lançar nesta competência.'))}
                      </p>
                      {!locked && status && (status.kind === 'PENDING' || status.kind === 'REMOVE') && (
                        <button
                          type="button"
                          disabled={data.busy || hasUnsavedDraft}
                          title={hasUnsavedDraft ? 'Grave o estoque final antes de lançar o CMV' : undefined}
                          onClick={() => void data.postMonth().then((ok) => ok && setToast(`CMV de ${competence(month)} lançado`))}
                          className={`${BUTTON.accent} h-9`}
                        >
                          {data.busy ? 'Lançando…' : status.kind === 'REMOVE' || status.existing ? 'Atualizar o lançamento' : 'Lançar o CMV'}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        </>
      )}

      {setup && ctx && clientId && (
        <StockSetupSheet
          clientId={clientId}
          ctx={ctx}
          month={month}
          busy={data.busy}
          error={data.error}
          onClose={() => setSetup(false)}
          onSave={(c) => data.save(c).then((ok) => (ok && setToast('Controle de estoque salvo'), ok))}
        />
      )}

      {confirmClear && (
        <ConfirmDialog
          title={`Apagar o estoque final de ${competence(month)}?`}
          description="O valor informado e a origem serão removidos desta competência."
          confirmLabel="Apagar estoque"
          cancelLabel="Cancelar"
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            setConfirmClear(false);
            saveCount(true);
          }}
        />
      )}

      {pendingMonth && (
        <ConfirmDialog
          title="Descartar alterações não gravadas?"
          description="O estoque final digitado ainda não foi gravado. Se mudar de competência agora, o que foi digitado será perdido."
          confirmLabel="Descartar e mudar"
          cancelLabel="Continuar editando"
          onCancel={() => setPendingMonth(null)}
          onConfirm={() => {
            const next = pendingMonth;
            setPendingMonth(null);
            setDraft(null);
            setMonth(next);
          }}
        />
      )}

      {guard.pending && (
        <ConfirmDialog
          title="Descartar alterações não gravadas?"
          description="O estoque final digitado ainda não foi gravado. Se sair agora, o que foi digitado será perdido."
          confirmLabel="Descartar e sair"
          cancelLabel="Continuar editando"
          onCancel={guard.cancel}
          onConfirm={guard.confirm}
        />
      )}

      <Toast toast={toast} />
    </main>
  );
}

function Row({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <p className={`flex items-baseline justify-between gap-3 ${strong ? 'font-medium text-stone-900 dark:text-stone-100' : 'text-stone-600 dark:text-stone-300'}`}>
      <span className="min-w-0">{label}</span>
      <span className="font-mono tabular-nums">{formatCurrency(value)}</span>
    </p>
  );
}
