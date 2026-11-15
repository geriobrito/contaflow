'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileSpreadsheet, FileText, HandCoins, Landmark, Pencil, Plus, Trash2 } from 'lucide-react';
import type { FinancingContract } from '@/types/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { useFinancingContracts, useFinancingReconciliation } from '@/hooks/imobilizado/useFinancingContracts';
import { useMonthQueryState } from '@/hooks/imobilizado/useMonthQueryState';
import { ControlsErrorBanner, ControlsTabs } from '@/components/imobilizado/ControlsTabs';
import { LedgerReconciliationCard } from '@/components/imobilizado/LedgerReconciliationCard';
import { FinancingSheet } from '@/components/imobilizado/FinancingSheet';
import { contractMonths, contractPositionAt, FINANCING_KIND_LABEL, installmentSchedule } from '@/lib/financing';
import { fromCents } from '@/lib/money';
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

const NUM = 'px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap';
const competence = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
type FinancingStatusFilter = 'ALL' | 'ACTIVE' | 'SETTLED';

/**
 * Empréstimos, financiamentos e parcelamentos: o lançamento inicial separa curto e longo prazo,
 * os juros prefixados saem dos encargos a transcorrer no mês de cada parcela e, em dezembro, as
 * parcelas do ano seguinte passam para o curto prazo. Os pagamentos vêm pelo extrato.
 */
export default function FinanciamentosPage() {
  const { user } = useAuth();
  const { currentClient } = useClient();
  const clientId = currentClient?.id;
  const data = useFinancingContracts(clientId, user?.uid);
  const reconciliation = useFinancingReconciliation(clientId, data.ctx);
  const [month, setMonth] = useMonthQueryState();
  const [editing, setEditing] = useState<FinancingContract | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<FinancingStatusFilter>('ALL');
  const [query, setQuery] = useState('');
  const [toast, setToast] = useToast();

  const done = (ok: boolean, message: string) => {
    if (ok) {
      setToast(message);
      reconciliation.clear();
    }
    return ok;
  };

  const ctx = data.ctx;
  const pending = data.pendingMonths;

  const exportReport = async (kind: 'pdf' | 'xlsx') => {
    if (!currentClient || !ctx) return;
    try {
      const [{ downloadBlob }, mod] = await Promise.all([import('@/lib/export/dre-rows'), import('@/lib/export/controls-export')]);
      const rows = mod.financingReportRows(data.contracts, month);
      const exportCtx = { client: currentClient, rows, month, issuedAt: new Date() };
      const file = kind === 'pdf' ? mod.generateFinancingPdf(exportCtx) : await mod.generateFinancingExcel(exportCtx);
      downloadBlob(file.blob, file.fileName);
    } catch (e) {
      reportError(e, { area: 'financiamentos', op: `exportar ${kind}` });
      setToast(`Não foi possível gerar o relatório (${e instanceof Error ? e.message : 'erro'}).`);
    }
  };

  const allRows = useMemo(
    () => [...data.contracts].sort((a, b) => a.date.localeCompare(b.date)).map((c) => ({ c, pos: contractPositionAt(c, month) })),
    [data.contracts, month]
  );

  const summary = useMemo(() => {
    let active = 0;
    let settled = 0;
    let shortNetCents = 0;
    let longNetCents = 0;
    let balanceCents = 0;
    let interestCents = 0;
    for (const { pos } of allRows) {
      if (pos.balance > 0) active++;
      else settled++;
      shortNetCents += pos.shortPayments - pos.shortInterest;
      longNetCents += pos.longPayments - pos.longInterest;
      balanceCents += pos.balance;
      interestCents += pos.shortInterest + pos.longInterest;
    }
    return {
      all: allRows.length,
      active,
      settled,
      shortNet: fromCents(shortNetCents),
      longNet: fromCents(longNetCents),
      balance: fromCents(balanceCents),
      unappropriatedInterest: fromCents(interestCents),
    };
  }, [allRows]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows.filter(({ c, pos }) => {
      if (statusFilter === 'ACTIVE' && pos.balance <= 0) return false;
      if (statusFilter === 'SETTLED' && pos.balance > 0) return false;
      if (q) {
        const hay = `${c.description} ${c.lender ?? ''} ${c.documentRef ?? ''} ${FINANCING_KIND_LABEL[c.kind]}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allRows, statusFilter, query]);

  const filteredTotals = useMemo(
    () =>
      rows.reduce(
        (t, { pos }) => ({
          shortNet: t.shortNet + (pos.shortPayments - pos.shortInterest),
          longNet: t.longNet + (pos.longPayments - pos.longInterest),
          balance: t.balance + pos.balance,
        }),
        { shortNet: 0, longNet: 0, balance: 0 }
      ),
    [rows]
  );

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Empréstimos, financiamentos e parcelamentos"
        description="O lançamento inicial separa curto e longo prazo; os juros prefixados (tabela Price) vão para a despesa no mês de cada parcela e, em dezembro, as parcelas do ano seguinte passam para o curto prazo."
        actions={
          <>
            <label className="flex items-center gap-2 text-[12px] text-stone-500">
              Posição no fim de
              <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={`${INPUT_COMPACT} w-40 font-mono tabular-nums`} />
            </label>
            {data.contracts.length > 0 && (
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
      {data.error && !editing && <ControlsErrorBanner message={data.error} />}

      {data.contracts.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Saldo devedor" value={formatCurrency(summary.balance)} caption={`${summary.active} contrato(s) em aberto`} />
          <StatCard label="Curto prazo (líq.)" value={formatCurrency(summary.shortNet)} caption="passivo circulante" />
          <StatCard label="Longo prazo (líq.)" value={formatCurrency(summary.longNet)} caption="passivo não circulante" />
          <StatCard label="Encargos a transcorrer" value={formatCurrency(summary.unappropriatedInterest)} caption="juros prefixados futuros" />
        </div>
      )}

      {pending.length > 0 && (
        <section role="status" className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200/70 bg-amber-50/80 dark:bg-amber-950/25 dark:border-amber-800/40 px-4 py-3 text-[13px] text-amber-900 dark:text-amber-200">
          <Landmark className="w-4 h-4 shrink-0" />
          <p className="flex-1 min-w-0">
            Juros ou reclassificação a lançar em {pending.length} competência(s) aberta(s): {pending.map(competence).join(', ')}.
          </p>
          <button
            type="button"
            disabled={data.busy}
            onClick={() => void data.postPending(pending).then((ok) => done(ok, `Juros lançados em ${pending.length} competência(s)`))}
            className={`${BUTTON.accent} h-8`}
          >
            {data.busy ? 'Lançando…' : 'Lançar agora'}
          </button>
        </section>
      )}

      <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
        <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-black/4 dark:border-white/6">
          <HandCoins className="w-4 h-4 text-stone-400" />
          <h2 className="flex-1 text-[15px] font-semibold tracking-tight">Contratos</h2>
          {ctx && (
            <button type="button" onClick={() => setEditing('new')} className={`${BUTTON.secondary} h-8`}>
              <Plus className="w-3.5 h-3.5" />
              Novo contrato
            </button>
          )}
        </div>

        {ctx && allRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2.5 px-5 py-3 border-b border-black/4 dark:border-white/6 bg-stone-50/50 dark:bg-white/[0.01]">
            <SegmentedControl<FinancingStatusFilter>
              ariaLabel="Filtrar por situação"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'ALL', label: `Todos (${summary.all})` },
                { value: 'ACTIVE', label: `Em aberto (${summary.active})` },
                { value: 'SETTLED', label: `Quitados (${summary.settled})` },
              ]}
            />
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Buscar contrato, credor ou nº…"
              className="flex-1 min-w-[180px] max-w-xs ml-auto"
            />
          </div>
        )}

        {!ctx ? (
          <TableSkeleton rows={3} label="Carregando contratos…" />
        ) : allRows.length === 0 ? (
          <EmptyState
            title="Nenhum empréstimo, financiamento ou parcelamento"
            description="Cadastre o contrato com o valor, as parcelas e a taxa: o sistema separa curto e longo prazo e lança os juros de cada mês."
            action={
              <button type="button" onClick={() => setEditing('new')} className={BUTTON.accent}>
                <Plus className="w-4 h-4" />
                Cadastrar o primeiro contrato
              </button>
            }
          />
        ) : rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-stone-500">Nenhum contrato corresponde ao filtro selecionado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className={TABLE_HEAD}>
                  <Th className="w-10" />
                  <Th className="pr-3 py-2.5">Contrato</Th>
                  <Th align="right">Parcelas</Th>
                  <Th align="right">Curto prazo</Th>
                  <Th align="right">Longo prazo</Th>
                  <Th align="right">Saldo devedor</Th>
                  <Th edge="end" className="w-20"><span className="sr-only">Ações</span></Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ c, pos }) => {
                  const frozen = contractMonths(c, ctx.implantationMonth).some((m) => ctx.lockedMonths.has(m));
                  const expanded = open === c.id;
                  return (
                    <React.Fragment key={c.id}>
                      <tr className="border-b border-black/4 dark:border-white/6 text-[13px]">
                        <td className="pl-3 py-3 text-center">
                          <button type="button" onClick={() => setOpen(expanded ? null : c.id)} aria-label={expanded ? 'Recolher parcelas' : `Ver parcelas de ${c.description}`} className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-stone-400 hover:text-stone-700 hover:bg-black/5 dark:hover:bg-white/8">
                            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                        </td>
                        <td className="pr-3 py-3">
                          <p className="font-medium text-stone-900 dark:text-stone-100">{c.description}</p>
                          <p className="text-[11px] text-stone-500 dark:text-stone-400">
                            {FINANCING_KIND_LABEL[c.kind]}
                            {c.lender ? ` · ${c.lender}` : ''} · {formatDateBR(c.date)} · {c.interestMode === 'PREFIXED' ? `prefixado${c.monthlyRate ? ` ${c.monthlyRate.toLocaleString('pt-BR')}% a.m.` : ''}` : 'pós-fixado (Selic)'}
                          </p>
                        </td>
                        <td className={NUM}>
                          {pos.paidCount}/{c.installments}
                          <span className="block text-[11px] text-stone-500 dark:text-stone-400 font-sans">{formatCurrency(c.installmentAmount)}</span>
                        </td>
                        <td className={NUM}>{formatCurrency(fromCents(pos.shortPayments - pos.shortInterest))}</td>
                        <td className={NUM}>{formatCurrency(fromCents(pos.longPayments - pos.longInterest))}</td>
                        <td className={NUM}>{formatCurrency(fromCents(pos.balance))}</td>
                        <td className="pl-3 pr-5 py-3 text-right whitespace-nowrap">
                          <button type="button" onClick={() => setEditing(c)} aria-label={`Editar ${c.description}`} className="w-8 h-8 rounded-full inline-flex items-center justify-center text-stone-400 hover:text-stone-800 hover:bg-black/5 dark:hover:bg-white/8 active:scale-[0.94] transition-all">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {!frozen && (
                            <ConfirmButton ariaLabel={`Excluir ${c.description}`} label={<Trash2 className="w-3.5 h-3.5" />} confirmLabel="Excluir" onConfirm={() => void data.remove(c).then((ok) => done(ok, 'Contrato excluído, com o lançamento inicial'))} />
                          )}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-b border-black/4 dark:border-white/6 bg-black/2 dark:bg-white/2">
                          <td colSpan={7} className="px-5 py-3">
                            <table aria-label={`Parcelas de ${c.description}`} className="w-full text-left text-[12px]">
                              <thead>
                                <tr className={TABLE_HEAD}>
                                  <Th className="py-1.5">Parcela</Th>
                                  <Th className="py-1.5">Vencimento</Th>
                                  <Th align="right" className="py-1.5">Valor</Th>
                                  <Th align="right" className="py-1.5">Juros</Th>
                                  <Th align="right" className="py-1.5">Amortização</Th>
                                  <Th align="right" className="py-1.5">Saldo devedor</Th>
                                </tr>
                              </thead>
                              <tbody>
                                {installmentSchedule(c).map((r) => (
                                  <tr
                                    key={r.n}
                                    className={`border-t border-black/4 dark:border-white/6 ${r.dueDate.slice(0, 7) === month ? 'bg-amber-50/70 dark:bg-amber-950/20 font-medium' : ''}`}
                                  >
                                    <td className="py-1.5 font-mono tabular-nums">
                                      {r.n}/{c.installments}
                                    </td>
                                    <td className="py-1.5 font-mono tabular-nums">{formatDateBR(r.dueDate)}</td>
                                    <td className="py-1.5 text-right font-mono tabular-nums">{formatCurrency(fromCents(r.payment))}</td>
                                    <td className="py-1.5 text-right font-mono tabular-nums">{c.interestMode === 'PREFIXED' ? formatCurrency(fromCents(r.interest)) : 'Selic'}</td>
                                    <td className="py-1.5 text-right font-mono tabular-nums">{formatCurrency(fromCents(r.amortization))}</td>
                                    <td className="py-1.5 text-right font-mono tabular-nums">{formatCurrency(fromCents(r.balance))}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-black/8 dark:border-white/10 text-[13px] font-semibold">
                  <td className="pl-5 pr-3 py-3" colSpan={3}>
                    Total
                  </td>
                  <td className={NUM}>{formatCurrency(fromCents(filteredTotals.shortNet))}</td>
                  <td className={NUM}>{formatCurrency(fromCents(filteredTotals.longNet))}</td>
                  <td className={NUM}>{formatCurrency(fromCents(filteredTotals.balance))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {ctx && data.contracts.length > 0 && (
        <LedgerReconciliationCard
          description={`Passivo de curto e longo prazo e encargos a transcorrer, cadastro × saldo contábil em ${formatMonth(month)}.`}
          divergenceNote="parcela paga no extrato e não baixada no passivo de curto prazo, juros não apropriados ou contrato sem lançamento inicial."
          loading={reconciliation.loading}
          error={reconciliation.error}
          result={reconciliation.result}
          onCheck={() => void reconciliation.check(month)}
        >
          {reconciliation.result && reconciliation.result.installments.length > 0 && (
            <div className="border-t border-black/6 dark:border-white/8 px-5 py-3.5 space-y-2 text-[12px]">
              <p className="font-medium text-stone-700 dark:text-stone-200">
                Parcelas vencendo em {formatMonth(reconciliation.result.month)} × baixas por pagamento no curto prazo:
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className={TABLE_HEAD}>
                      <Th className="py-1.5">Conta (curto prazo)</Th>
                      <Th className="py-1.5">Contrato / Parcela</Th>
                      <Th align="right" className="py-1.5">Previsto no mês</Th>
                      <Th align="right" className="py-1.5">Baixado no mês</Th>
                      <Th align="right" className="py-1.5">Diferença</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {reconciliation.result.installments.map((item) => (
                      <tr key={`${item.contractId}-${item.installmentNumber}`} className="border-t border-black/4 dark:border-white/6">
                        <td className="py-1.5 font-mono">{item.shortTermAccountCode}</td>
                        <td className="py-1.5 text-stone-600 dark:text-stone-300">
                          {item.description} · {item.installmentNumber}/{item.installmentsTotal} ({formatDateBR(item.dueDate)})
                        </td>
                        <td className="py-1.5 text-right font-mono tabular-nums">{formatCurrency(fromCents(item.expectedCents))}</td>
                        <td className="py-1.5 text-right font-mono tabular-nums">{formatCurrency(fromCents(item.reconciledCents))}</td>
                        <td
                          className={`py-1.5 text-right font-mono tabular-nums ${
                            Math.abs(item.differenceCents) >= 1 ? 'text-amber-700 dark:text-amber-300 font-medium' : 'text-stone-400'
                          }`}
                        >
                          {formatCurrency(fromCents(item.differenceCents))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </LedgerReconciliationCard>
      )}

      {editing && ctx && clientId && (
        <FinancingSheet
          key={editing === 'new' ? 'new' : editing.id}
          clientId={clientId}
          contract={editing === 'new' ? null : editing}
          ctx={ctx}
          busy={data.busy}
          error={data.error}
          onClose={() => setEditing(null)}
          onSave={(c, alreadyRecognized) => data.save(c, alreadyRecognized).then((ok) => done(ok, editing === 'new' ? 'Contrato cadastrado, com o lançamento inicial' : 'Contrato atualizado'))}
        />
      )}

      <Toast toast={toast} />
    </main>
  );
}
