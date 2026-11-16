'use client';

import { Fragment, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, FileSpreadsheet, FileText, Landmark, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import type { PrepaidExpense } from '@/types/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { usePrepaidExpenses, usePrepaidReconciliation } from '@/hooks/imobilizado/usePrepaidExpenses';
import { useMonthQueryState } from '@/hooks/imobilizado/useMonthQueryState';
import { ControlsErrorBanner, ControlsTabs } from '@/components/imobilizado/ControlsTabs';
import { LedgerReconciliationCard } from '@/components/imobilizado/LedgerReconciliationCard';
import { PrepaidSheet } from '@/components/imobilizado/PrepaidSheet';
import {
  disposedInsuredAssetAlerts,
  lockedPrepaidMonths,
  postedPrepaidCents,
  prepaidBalanceAt,
  prepaidEndDate,
  prepaidSchedule,
  PREPAID_KIND_LABEL,
} from '@/lib/prepaid-expenses';
import { fromCents, toCents } from '@/lib/money';
import { formatMonth } from '@/lib/periods';
import { reportError } from '@/lib/monitoring';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import {
  BUTTON,
  ConfirmButton,
  EmptyState,
  INPUT_COMPACT,
  PAGE,
  PageHeader,
  SearchField,
  SegmentedControl,
  StatCard,
  SURFACE,
} from '@/components/ui/primitives';
import { TABLE_HEAD, Th } from '@/components/ui/Table';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { Toast, useToast } from '@/components/ui/Toast';

const NUM = 'px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap';
const competence = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
type PrepaidStatusFilter = 'ALL' | 'ACTIVE' | 'ENDED';

/**
 * Seguros e despesas antecipadas: o valor contratado vai para o ativo na data da apólice e para o
 * resultado mês a mês, pela vigência. Os pagamentos das parcelas vêm pelo extrato.
 */
export default function DespesasAntecipadasPage() {
  const { user } = useAuth();
  const { currentClient } = useClient();
  const clientId = currentClient?.id;
  const data = usePrepaidExpenses(clientId, user?.uid);
  const reconciliation = usePrepaidReconciliation(clientId, data.ctx);
  const [month, setMonth] = useMonthQueryState();
  const [editing, setEditing] = useState<PrepaidExpense | 'new' | null>(null);
  const [statusFilter, setStatusFilter] = useState<PrepaidStatusFilter>('ALL');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useToast();

  const done = (ok: boolean, message: string) => {
    if (ok) {
      setToast(message);
      reconciliation.clear();
    }
    return ok;
  };

  const ctx = data.ctx;

  const exportReport = async (kind: 'pdf' | 'xlsx') => {
    if (!currentClient || !ctx) return;
    try {
      const [{ downloadBlob }, mod] = await Promise.all([import('@/lib/export/dre-rows'), import('@/lib/export/controls-export')]);
      const rows = mod.prepaidReportRows(data.items, month, ctx.implantationMonth, ctx.accounts);
      const exportCtx = { client: currentClient, rows, month, issuedAt: new Date() };
      const file = kind === 'pdf' ? mod.generatePrepaidPdf(exportCtx) : await mod.generatePrepaidExcel(exportCtx);
      downloadBlob(file.blob, file.fileName);
    } catch (e) {
      reportError(e, { area: 'despesas-antecipadas', op: `exportar ${kind}` });
      setToast(`Não foi possível gerar o relatório (${e instanceof Error ? e.message : 'erro'}).`);
    }
  };

  const allRows = useMemo(
    () =>
      ctx
        ? [...data.items]
            .sort((a, b) => a.startDate.localeCompare(b.startDate))
            .map((item) => ({
              item,
              quota: postedPrepaidCents(item, month, ctx.implantationMonth),
              balance: prepaidBalanceAt(item, month, ctx.implantationMonth),
            }))
        : [],
    [ctx, data.items, month]
  );

  const counts = useMemo(() => {
    let active = 0;
    let ended = 0;
    let contractedActiveCents = 0;
    for (const r of allRows) {
      if (r.balance > 0) {
        active++;
        contractedActiveCents += toCents(r.item.amount);
      } else {
        ended++;
      }
    }
    return { all: allRows.length, active, ended, contractedActive: fromCents(contractedActiveCents) };
  }, [allRows]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows.filter(({ item, balance }) => {
      if (statusFilter === 'ACTIVE' && balance <= 0) return false;
      if (statusFilter === 'ENDED' && balance > 0) return false;
      if (q) {
        const hay = `${item.description} ${item.documentRef ?? ''} ${item.expenseAccountCode} ${PREPAID_KIND_LABEL[item.kind]}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allRows, statusFilter, query]);

  const total = rows.reduce((t, r) => ({ quota: t.quota + r.quota, balance: t.balance + r.balance }), { quota: 0, balance: 0 });
  const overallTotal = allRows.reduce((t, r) => ({ quota: t.quota + r.quota, balance: t.balance + r.balance }), { quota: 0, balance: 0 });
  const pending = data.pendingMonths;

  const disposedAlerts = useMemo(
    () => (ctx ? disposedInsuredAssetAlerts(data.items, ctx.fixedAssets, month, ctx.implantationMonth) : []),
    [ctx, data.items, month]
  );
  const disposedByItemId = useMemo(
    () => new Map(disposedAlerts.map((a) => [a.item.id, a])),
    [disposedAlerts]
  );

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Seguros e despesas antecipadas"
        description="O valor contratado vai para o ativo na data da apólice e para o resultado mês a mês, pela vigência — nunca pelas parcelas pagas. Os pagamentos vêm pelo extrato."
        actions={
          <>
            <label className="flex items-center gap-2 text-[12px] text-stone-500">
              Posição no fim de
              <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={`${INPUT_COMPACT} w-40 font-mono tabular-nums`} />
            </label>
            {data.items.length > 0 && (
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

      {data.items.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Contratado vigente" value={formatCurrency(counts.contractedActive)} caption={`${counts.active} em vigência`} />
          <StatCard label="A apropriar" value={formatCurrency(fromCents(overallTotal.balance))} caption={`saldo no ativo em ${competence(month)}`} />
          <StatCard
            label="Cota do mês"
            value={formatCurrency(fromCents(overallTotal.quota))}
            caption={`competência ${competence(month)}`}
            tone={overallTotal.quota > 0 ? 'accent' : 'neutral'}
          />
          <StatCard label="Apólices vigentes" value={String(counts.active)} caption={`de ${counts.all} cadastrada(s)`} />
        </div>
      )}

      {disposedAlerts.length > 0 && (
        <section
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-amber-200/70 bg-amber-50/80 dark:bg-amber-950/25 dark:border-amber-800/40 px-4 py-3 text-[13px] text-amber-900 dark:text-amber-200"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">Apólice vigente vinculada a bem já baixado no imobilizado:</p>
            {disposedAlerts.map(({ item, asset, remainingCents }) => (
              <p key={item.id} className="text-[12px]">
                <span className="font-medium">{item.description}</span> cobre <span className="font-medium">{asset.description}</span> (baixado em{' '}
                {asset.disposal ? formatDateBR(asset.disposal.date) : '—'}) e ainda tem <span className="font-mono">{formatCurrency(fromCents(remainingCents))}</span> a apropriar. Verifique se houve endosso ou cancelamento da apólice.
              </p>
            ))}
          </div>
        </section>
      )}

      {pending.length > 0 && (
        <section role="status" className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200/70 bg-amber-50/80 dark:bg-amber-950/25 dark:border-amber-800/40 px-4 py-3 text-[13px] text-amber-900 dark:text-amber-200">
          <Landmark className="w-4 h-4 shrink-0" />
          <p className="flex-1 min-w-0">
            Apropriação a lançar ou atualizar em {pending.length} competência(s) aberta(s): {pending.map(competence).join(', ')}.
          </p>
          <button
            type="button"
            disabled={data.busy}
            onClick={() => void data.postPending(pending).then((ok) => done(ok, `Apropriação lançada em ${pending.length} competência(s)`))}
            className={`${BUTTON.accent} h-8`}
          >
            {data.busy ? 'Lançando…' : 'Lançar agora'}
          </button>
        </section>
      )}

      <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
        <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-black/4 dark:border-white/6">
          <ShieldCheck className="w-4 h-4 text-stone-400" />
          <h2 className="flex-1 text-[15px] font-semibold tracking-tight">Apólices e contratos</h2>
          {ctx && (
            <button type="button" onClick={() => setEditing('new')} className={`${BUTTON.secondary} h-8`}>
              <Plus className="w-3.5 h-3.5" />
              Novo seguro ou despesa
            </button>
          )}
        </div>

        {ctx && allRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2.5 px-5 py-3 border-b border-black/4 dark:border-white/6 bg-stone-50/50 dark:bg-white/[0.01]">
            <SegmentedControl<PrepaidStatusFilter>
              ariaLabel="Filtrar por vigência"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'ALL', label: `Todas (${counts.all})` },
                { value: 'ACTIVE', label: `Vigentes (${counts.active})` },
                { value: 'ENDED', label: `Encerradas (${counts.ended})` },
              ]}
            />
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Buscar apólice, nº ou conta…"
              className="flex-1 min-w-[180px] max-w-xs ml-auto"
            />
          </div>
        )}

        {!ctx ? (
          <TableSkeleton rows={3} label="Carregando…" />
        ) : allRows.length === 0 ? (
          <EmptyState
            title="Nenhum seguro ou despesa antecipada"
            description="Cadastre a apólice com o prêmio e a vigência: o sistema lança o valor no ativo e apropria a cota de cada mês."
            action={
              <button type="button" onClick={() => setEditing('new')} className={BUTTON.accent}>
                <Plus className="w-4 h-4" />
                Cadastrar a primeira apólice
              </button>
            }
          />
        ) : rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-stone-500">Nenhuma apólice corresponde ao filtro selecionado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className={TABLE_HEAD}>
                  <Th edge="start">Descrição</Th>
                  <Th>Vigência</Th>
                  <Th align="right">Valor</Th>
                  <Th align="right">Cota do mês</Th>
                  <Th align="right">A apropriar</Th>
                  <Th edge="end" className="w-20"><span className="sr-only">Ações</span></Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ item, quota, balance }) => {
                  const frozen = lockedPrepaidMonths(item, ctx.lockedMonths, ctx.implantationMonth).length > 0;
                  const open = openId === item.id;
                  const schedule = open ? prepaidSchedule(item, ctx.implantationMonth) : [];
                  const disposedAlert = disposedByItemId.get(item.id);
                  return (
                    <Fragment key={item.id}>
                      <tr className="border-b border-black/4 dark:border-white/6 last:border-0 text-[13px]">
                        <td className="pl-5 pr-3 py-3">
                          <button
                            type="button"
                            onClick={() => setOpenId(open ? null : item.id)}
                            aria-expanded={open}
                            aria-label={`Ver cotas de ${item.description}`}
                            className="inline-flex items-center gap-1.5 font-medium text-stone-900 dark:text-stone-100 hover:underline text-left"
                          >
                            {open ? <ChevronDown className="w-3.5 h-3.5 text-stone-400" /> : <ChevronRight className="w-3.5 h-3.5 text-stone-400" />}
                            {item.description}
                          </button>
                          <p className="pl-5 text-[11px] text-stone-500 dark:text-stone-400">
                            {PREPAID_KIND_LABEL[item.kind]}
                            {item.documentRef ? ` nº ${item.documentRef}` : ''} · {item.use === 'COST' ? 'custo' : 'despesa'} · <span className="font-mono">{item.expenseAccountCode}</span>
                            {disposedAlert && (
                              <span className="ml-1.5 text-amber-700 dark:text-amber-300 font-medium">
                                · Bem segurado baixado ({disposedAlert.asset.description})
                              </span>
                            )}
                          </p>
                        </td>
                        <td className="px-3 py-3 font-mono tabular-nums text-[12px] whitespace-nowrap">
                          {formatDateBR(item.startDate)} a {formatDateBR(prepaidEndDate(item))}
                          <span className="block text-[11px] text-stone-500 dark:text-stone-400 font-sans">{item.months} meses</span>
                        </td>
                        <td className={NUM}>{formatCurrency(item.amount)}</td>
                        <td className={NUM}>{quota ? formatCurrency(fromCents(quota)) : '—'}</td>
                        <td className={NUM}>{formatCurrency(fromCents(balance))}</td>
                        <td className="pl-3 pr-5 py-3 text-right whitespace-nowrap">
                          <button type="button" onClick={() => setEditing(item)} aria-label={`Editar ${item.description}`} className="w-8 h-8 rounded-full inline-flex items-center justify-center text-stone-400 hover:text-stone-800 hover:bg-black/5 dark:hover:bg-white/8 active:scale-[0.94] transition-all">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {!frozen && (
                            <ConfirmButton
                              ariaLabel={`Excluir ${item.description}`}
                              label={<Trash2 className="w-3.5 h-3.5" />}
                              confirmLabel="Excluir"
                              onConfirm={() => void data.remove(item).then((ok) => done(ok, 'Excluído, com o lançamento inicial'))}
                            />
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-black/2 dark:bg-white/3 border-b border-black/4 dark:border-white/6">
                          <td colSpan={6} className="px-5 py-3">
                            <div className="max-h-64 overflow-y-auto rounded-xl border border-line">
                              <table className="w-full text-left text-[12px]" aria-label={`Cotas de ${item.description}`}>
                                <thead className="sticky top-0 bg-stone-100 dark:bg-stone-900 text-[10px] uppercase tracking-wider text-stone-500">
                                  <tr>
                                    <th className="pl-3 pr-2 py-1.5">#</th>
                                    <th className="px-2 py-1.5">Competência</th>
                                    <th className="px-2 py-1.5 text-right">Cota</th>
                                    <th className="pl-2 pr-3 py-1.5 text-right">Saldo a apropriar</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {schedule.map((q, idx) => {
                                    const rem = prepaidBalanceAt(item, q.month, ctx.implantationMonth);
                                    return (
                                      <tr
                                        key={q.month}
                                        className={`border-t border-black/4 dark:border-white/6 font-mono tabular-nums ${q.month === month ? 'bg-amber-50/70 dark:bg-amber-950/20 font-medium' : ''}`}
                                      >
                                        <td className="pl-3 pr-2 py-1 text-stone-400">{idx + 1}</td>
                                        <td className="px-2 py-1">{competence(q.month)}</td>
                                        <td className="px-2 py-1 text-right">{formatCurrency(fromCents(q.cents))}</td>
                                        <td className="pl-2 pr-3 py-1 text-right">{formatCurrency(fromCents(rem))}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-black/8 dark:border-white/10 text-[13px] font-semibold">
                  <td className="pl-5 pr-3 py-3" colSpan={3}>
                    Total
                  </td>
                  <td className={NUM}>{formatCurrency(fromCents(total.quota))}</td>
                  <td className={NUM}>{formatCurrency(fromCents(total.balance))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {ctx && data.items.length > 0 && (
        <LedgerReconciliationCard
          description={`Saldo a apropriar por conta do ativo (1.1.4), cadastro × saldo contábil em ${formatMonth(month)}.`}
          divergenceNote="apólice cadastrada sem lançamento inicial, baixa manual na conta de ativo ou apropriação fora da rotina."
          loading={reconciliation.loading}
          error={reconciliation.error}
          result={reconciliation.result}
          onCheck={() => void reconciliation.check(month)}
        />
      )}

      {editing && ctx && clientId && (
        <PrepaidSheet
          key={editing === 'new' ? 'new' : editing.id}
          clientId={clientId}
          item={editing === 'new' ? null : editing}
          ctx={ctx}
          busy={data.busy}
          error={data.error}
          onClose={() => setEditing(null)}
          onSave={(item, alreadyRecognized) => data.save(item, alreadyRecognized).then((ok) => done(ok, editing === 'new' ? 'Cadastrado, com o lançamento inicial' : 'Atualizado'))}
        />
      )}

      <Toast toast={toast} />
    </main>
  );
}
