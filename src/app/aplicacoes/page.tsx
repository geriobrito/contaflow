'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, FileText, Landmark, Pencil, PiggyBank, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { InvestmentAccount } from '@/types/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { useInvestments } from '@/hooks/imobilizado/useInvestments';
import { useMonthQueryState } from '@/hooks/imobilizado/useMonthQueryState';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { ControlsErrorBanner, ControlsTabs } from '@/components/imobilizado/ControlsTabs';
import { InvestmentSheet } from '@/components/imobilizado/InvestmentSheet';
import { investmentCloseProblem, isActiveIn } from '@/lib/investments';
import { fromCents, toCents } from '@/lib/money';
import { parseMoneyInput } from '@/lib/opening';
import { reportError } from '@/lib/monitoring';
import { formatCurrency } from '@/lib/utils/formatters';
import {
  BUTTON,
  ConfirmButton,
  EmptyState,
  INPUT_COMPACT,
  PAGE,
  PageHeader,
  StatCard,
  SURFACE,
} from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { TABLE_HEAD, Th } from '@/components/ui/Table';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { Toast, useToast } from '@/components/ui/Toast';

const NUM = 'px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap';
const competence = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const moneyText = (v: number | undefined) => (v === undefined ? '' : v.toFixed(2).replace('.', ','));

/**
 * Aplicações financeiras: o saldo bruto do extrato de cada aplicação, informado mês a mês, e o
 * rendimento da competência (saldo informado − saldo contábil), lançado no último dia do mês.
 * Aplicações e resgates vêm pelo extrato da conta corrente.
 */
export default function AplicacoesPage() {
  const { user } = useAuth();
  const { currentClient } = useClient();
  const clientId = currentClient?.id;
  const [month, setMonth] = useMonthQueryState();
  const data = useInvestments(clientId, user?.uid, month);
  const [editing, setEditing] = useState<InvestmentAccount | 'new' | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingMonth, setPendingMonth] = useState<string | null>(null);
  const [toast, setToast] = useToast();

  const done = (ok: boolean, message: string) => {
    if (ok) setToast(message);
    return ok;
  };

  const ctx = data.ctx;
  const locked = Boolean(ctx?.lockedMonths.has(month));
  const status = data.month?.status;
  const rows = useMemo(() => (status && 'rows' in status ? status.rows : []), [status]);
  const problem = status ? investmentCloseProblem(status, month) : null;
  const draftKey = (inv: InvestmentAccount) => `${inv.id}|${month}`;
  const textOf = (inv: InvestmentAccount) => drafts[draftKey(inv)] ?? moneyText(inv.balances[month]);

  const hasUnsavedDrafts = useMemo(
    () =>
      data.investments.some((inv) => {
        const key = `${inv.id}|${month}`;
        return drafts[key] !== undefined && drafts[key] !== moneyText(inv.balances[month]);
      }),
    [data.investments, drafts, month]
  );

  const guard = useUnsavedChangesGuard(hasUnsavedDrafts);

  const changeMonth = (next: string) => {
    if (!next || next === month) return;
    if (hasUnsavedDrafts) {
      setPendingMonth(next);
      return;
    }
    setMonth(next);
  };

  const summary = useMemo(() => {
    let activeCount = 0;
    let informedCount = 0;
    let informedCents = 0;
    for (const inv of data.investments) {
      if (!isActiveIn(inv, month)) continue;
      activeCount++;
      const val = inv.balances[month];
      if (val !== undefined) {
        informedCount++;
        informedCents += toCents(val);
      }
    }
    const ledgerCents = rows.reduce((s, r) => s + r.ledgerCents, 0);
    const yieldCents = rows.reduce((s, r) => s + r.yieldCents, 0);
    return {
      activeCount,
      informedCount,
      informed: fromCents(informedCents),
      ledger: fromCents(ledgerCents),
      yieldAmount: fromCents(yieldCents),
    };
  }, [data.investments, month, rows]);

  const exportReport = async (kind: 'pdf' | 'xlsx') => {
    if (!currentClient || !ctx) return;
    try {
      const [{ downloadBlob }, mod] = await Promise.all([import('@/lib/export/dre-rows'), import('@/lib/export/controls-export')]);
      const reportRows = mod.investmentReportRows(data.investments, month, rows);
      const exportCtx = { client: currentClient, rows: reportRows, month, issuedAt: new Date() };
      const file = kind === 'pdf' ? mod.generateInvestmentsPdf(exportCtx) : await mod.generateInvestmentsExcel(exportCtx);
      downloadBlob(file.blob, file.fileName);
    } catch (e) {
      reportError(e, { area: 'aplicacoes', op: `exportar ${kind}` });
      setToast(`Não foi possível gerar o relatório (${e instanceof Error ? e.message : 'erro'}).`);
    }
  };

  const saveBalance = (inv: InvestmentAccount) => {
    const text = textOf(inv).trim();
    const amount = text ? parseMoneyInput(text) : null;
    if (text && amount === null) return setToast('Valor inválido. Use o formato 1.234,56.');
    void data.saveBalance(inv, amount).then((ok) => {
      if (!ok) return;
      setDrafts(({ [draftKey(inv)]: _gone, ...rest }) => {
        void _gone;
        return rest;
      });
      setToast(`Saldo de ${inv.description} em ${competence(month)} gravado`);
    });
  };

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Aplicações financeiras"
        description="Informe todo mês o saldo bruto do extrato de cada aplicação: o rendimento (saldo informado − saldo contábil) é lançado em receitas financeiras no último dia da competência, como pede o regime de competência."
        actions={
          <>
            <label className="flex items-center gap-2 text-[12px] text-stone-500">
              Competência
              <input type="month" value={month} onChange={(e) => e.target.value && changeMonth(e.target.value)} className={`${INPUT_COMPACT} w-40 font-mono tabular-nums`} />
            </label>
            {data.investments.length > 0 && (
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
      <ControlsTabs month={month} busy={data.busy} />
      {data.error && !editing && <ControlsErrorBanner message={data.error} />}

      {data.investments.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard
            label="Saldo bruto informado"
            value={formatCurrency(summary.informed)}
            caption={`${summary.informedCount} de ${summary.activeCount} aplicação(ões) ativa(s)`}
          />
          <StatCard label="Contábil (antes do rend.)" value={formatCurrency(summary.ledger)} caption={`em ${competence(month)}`} />
          <StatCard
            label="Rendimento do mês"
            value={formatCurrency(summary.yieldAmount)}
            caption={`competência ${competence(month)}`}
            tone={summary.yieldAmount > 0 ? 'accent' : 'neutral'}
          />
        </div>
      )}

      {data.missingMonths.length > 0 && (
        <section role="status" className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200/70 bg-amber-50/80 dark:bg-amber-950/25 dark:border-amber-800/40 px-4 py-3 text-[13px] text-amber-900 dark:text-amber-200">
          <Landmark className="w-4 h-4 shrink-0" />
          <span>Saldo do extrato a informar em:</span>
          {data.missingMonths.map((m) => (
            <button key={m} type="button" onClick={() => changeMonth(m)} className="rounded-lg border border-amber-600/40 px-2 py-0.5 font-mono tabular-nums text-[12px] hover:bg-amber-100 dark:hover:bg-amber-900/40">
              {competence(m)}
            </button>
          ))}
        </section>
      )}

      <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-black/4 dark:border-white/6">
          <PiggyBank className="w-4 h-4 text-stone-400" />
          <h2 className="flex-1 text-[15px] font-semibold tracking-tight">Aplicações</h2>
          {ctx && (
            <button type="button" onClick={() => setEditing('new')} className={`${BUTTON.secondary} h-8`}>
              <Plus className="w-3.5 h-3.5" />
              Nova aplicação
            </button>
          )}
        </div>
        {!ctx ? (
          <TableSkeleton rows={3} label="Carregando aplicações…" />
        ) : data.investments.length === 0 ? (
          <EmptyState
            title="Nenhuma aplicação cadastrada"
            description="Cadastre a aplicação (Caixinha, CDB, fundo) com a conta do plano. Depois, todo mês, informe o saldo do extrato dela: o sistema lança o rendimento."
            action={
              <button type="button" onClick={() => setEditing('new')} className={BUTTON.accent}>
                <Plus className="w-4 h-4" />
                Cadastrar a primeira aplicação
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className={TABLE_HEAD}>
                  <Th edge="start">Aplicação</Th>
                  <Th align="right" className="w-56">Saldo bruto do extrato em {competence(month)}</Th>
                  <Th edge="end" className="w-20">
                    <span className="sr-only">Ações</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {data.investments.map((inv) => {
                  const active = isActiveIn(inv, month);
                  return (
                    <tr key={inv.id} className="border-b border-black/4 dark:border-white/6 last:border-0 text-[13px]">
                      <td className="pl-5 pr-3 py-3">
                        <p className="font-medium text-stone-900 dark:text-stone-100">{inv.description}</p>
                        <p className="text-[11px] text-stone-500 dark:text-stone-400">
                          {inv.ledgerAccountCode} {inv.ledgerAccountName ?? ''} · desde {competence(inv.startMonth)}
                          {inv.closedMonth ? ` · encerrada em ${competence(inv.closedMonth)}` : ''}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-right">
                        {active ? (
                          <div className="flex items-center justify-end gap-2">
                            <input
                              aria-label={`Saldo de ${inv.description} em ${competence(month)}`}
                              disabled={locked || data.busy}
                              value={textOf(inv)}
                              onChange={(e) => setDrafts((d) => ({ ...d, [draftKey(inv)]: e.target.value }))}
                              onKeyDown={(e) => e.key === 'Enter' && saveBalance(inv)}
                              placeholder="0,00"
                              inputMode="decimal"
                              className={`${INPUT_COMPACT} w-36 text-right font-mono tabular-nums`}
                            />
                            {drafts[draftKey(inv)] !== undefined && (
                              <button type="button" disabled={data.busy} onClick={() => saveBalance(inv)} className={`${BUTTON.accent} h-9`}>
                                Gravar
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-[12px] text-stone-500 dark:text-stone-400">fora do período</span>
                        )}
                      </td>
                      <td className="pl-3 pr-5 py-3 text-right whitespace-nowrap">
                        <button type="button" onClick={() => setEditing(inv)} aria-label={`Editar ${inv.description}`} className="w-8 h-8 rounded-full inline-flex items-center justify-center text-stone-400 hover:text-stone-800 hover:bg-black/5 dark:hover:bg-white/8 active:scale-[0.94] transition-all">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <ConfirmButton ariaLabel={`Excluir ${inv.description}`} label={<Trash2 className="w-3.5 h-3.5" />} confirmLabel="Excluir" onConfirm={() => void data.remove(inv).then((ok) => done(ok, 'Aplicação excluída'))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {ctx && data.investments.length > 0 && (
        <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
          <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-black/4 dark:border-white/6">
            <h2 className="flex-1 text-[15px] font-semibold tracking-tight">Rendimento de {competence(month)}</h2>
            {!locked && status && (status.kind === 'PENDING' || status.kind === 'REMOVE') && (
              <button
                type="button"
                disabled={data.busy || hasUnsavedDrafts}
                title={hasUnsavedDrafts ? 'Grave os saldos digitados antes de lançar o rendimento' : undefined}
                onClick={() => void data.postMonth().then((ok) => done(ok, `Rendimento de ${competence(month)} lançado`))}
                className={`${BUTTON.accent} h-8`}
              >
                {data.busy ? 'Lançando…' : status.kind === 'REMOVE' || status.existing ? 'Atualizar o lançamento' : 'Lançar o rendimento'}
              </button>
            )}
          </div>
          {hasUnsavedDrafts && (
            <p role="status" className="px-5 py-2.5 text-[12px] text-amber-800 dark:text-amber-300 bg-amber-50/60 dark:bg-amber-950/20 border-b border-black/4 dark:border-white/6">
              Há saldo(s) digitado(s) ainda não gravado(s). Clique em <strong>Gravar</strong> na linha da aplicação antes de lançar o rendimento.
            </p>
          )}
          {data.month === undefined ? (
            <TableSkeleton rows={2} label="Conferindo com o razão…" />
          ) : data.monthError ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-[13px] text-rose-700 dark:text-rose-300 bg-rose-50/60 dark:bg-rose-950/20">
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
              <p className={`flex items-start gap-2 px-5 py-3 text-[13px] ${problem ? 'text-amber-800 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-400'}`}>
                {!problem && <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}
                {locked
                  ? `Competência ${competence(month)} fechada.`
                  : problem ?? (status?.kind === 'POSTED' ? 'Rendimento lançado e conferido com os saldos informados.' : 'Nada a lançar nesta competência.')}
              </p>
              {rows.length > 0 && (
                <table className="w-full text-left">
                  <thead>
                    <tr className={`${TABLE_HEAD} border-t`}>
                      <Th edge="start">Conta</Th>
                      <Th align="right">Extrato</Th>
                      <Th align="right">Contábil antes do rendimento</Th>
                      <Th align="right" edge="end">Rendimento</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.ledgerAccountId} className="border-b border-black/4 dark:border-white/6 last:border-0 text-[13px]">
                        <td className="pl-5 pr-3 py-2.5">{r.label}</td>
                        <td className={NUM}>{formatCurrency(fromCents(r.informedCents))}</td>
                        <td className={NUM}>{formatCurrency(fromCents(r.ledgerCents))}</td>
                        <td className={`${NUM} pr-5 ${r.yieldCents < 0 ? 'text-rose-600 dark:text-rose-300' : ''}`}>{formatCurrency(fromCents(r.yieldCents))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </section>
      )}

      {editing && ctx && (
        <InvestmentSheet
          key={editing === 'new' ? 'new' : editing.id}
          investment={editing === 'new' ? null : editing}
          ctx={ctx}
          month={month}
          busy={data.busy}
          error={data.error}
          onClose={() => setEditing(null)}
          onSave={(inv) => data.save(inv).then((ok) => done(ok, editing === 'new' ? 'Aplicação cadastrada' : 'Aplicação atualizada'))}
        />
      )}

      {pendingMonth && (
        <ConfirmDialog
          title="Descartar saldos não gravados?"
          description="Há saldos digitados e ainda não gravados. Se mudar de competência agora, o que foi digitado será perdido."
          confirmLabel="Descartar e mudar"
          cancelLabel="Continuar editando"
          onCancel={() => setPendingMonth(null)}
          onConfirm={() => {
            const next = pendingMonth;
            setPendingMonth(null);
            setDrafts({});
            setMonth(next);
          }}
        />
      )}

      {guard.pending && (
        <ConfirmDialog
          title="Descartar saldos não gravados?"
          description="Há saldos digitados e ainda não gravados. Se sair agora, o que foi digitado será perdido."
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
