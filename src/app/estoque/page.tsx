'use client';

import React, { useEffect, useState } from 'react';
import { Boxes, CheckCircle2, ClipboardCopy, Landmark, Settings2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { useStockControl } from '@/hooks/imobilizado/useStockControl';
import { ControlsTabs } from '@/components/imobilizado/ControlsTabs';
import { StockSetupSheet } from '@/components/imobilizado/StockSetupSheet';
import { countDue, STOCK_FREQUENCY_LABEL, stockCloseProblem, stockRequestText } from '@/lib/stock';
import { fromCents } from '@/lib/money';
import { parseMoneyInput } from '@/lib/opening';
import { formatCurrency } from '@/lib/utils/formatters';
import { BUTTON, EmptyState, Field, INPUT, PAGE, PageHeader, SURFACE } from '@/components/ui/primitives';
import { TableSkeleton } from '@/components/ui/Skeleton';

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
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const data = useStockControl(clientId, user?.uid, month);
  const [setup, setSetup] = useState(false);
  const [draft, setDraft] = useState<{ key: string; amount: string; source: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Link da barra de fechamento: `?mes=AAAA-MM` abre a competência pedida.
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      const m = new URLSearchParams(window.location.search).get('mes');
      if (active && m && /^\d{4}-\d{2}$/.test(m)) setMonth(m);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const control = data.control;
  const ctx = data.ctx;
  const locked = Boolean(ctx?.lockedMonths.has(month));
  const key = `${clientId}|${month}`;
  const editing = draft?.key === key ? draft : null;
  const amountText = editing?.amount ?? moneyText(control?.counts[month]);
  const sourceText = editing?.source ?? control?.notes?.[month] ?? '';
  const status = data.month?.status;
  const figures = status && 'figures' in status ? status.figures : null;
  const problem = status ? stockCloseProblem(status, month) : null;
  const warnings = data.month?.warnings ?? [];

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
            <label className="flex items-center gap-2 text-[12px] text-stone-500">
              Competência
              <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={`${INPUT} h-9 w-40 font-mono tabular-nums text-[13px]`} />
            </label>
          ) : undefined
        }
      />
      <ControlsTabs />
      {data.error && !setup && (
        <p role="alert" className="text-[13px] text-rose-600">
          {data.error}
        </p>
      )}

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
                <button key={m} type="button" onClick={() => setMonth(m)} className="rounded-lg border border-amber-600/40 px-2 py-0.5 font-mono tabular-nums text-[12px] hover:bg-amber-100 dark:hover:bg-amber-900/40">
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
                      className={`${INPUT} text-right font-mono tabular-nums`}
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
                      <button type="button" disabled={data.busy} onClick={() => saveCount(true)} className={`${BUTTON.secondary} h-10`}>
                        Apagar
                      </button>
                    )}
                  </div>
                </div>

                {data.month === undefined ? (
                  <TableSkeleton rows={2} dense label="Conferindo com o razão…" />
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
                        <button type="button" disabled={data.busy} onClick={() => void data.postMonth().then((ok) => ok && setToast(`CMV de ${competence(month)} lançado`))} className={`${BUTTON.accent} h-9`}>
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

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full bg-stone-900/90 text-white text-[13px] shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-xl animate-sheet-in">
          {toast}
        </div>
      )}
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
