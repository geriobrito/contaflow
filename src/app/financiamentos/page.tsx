'use client';

import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, HandCoins, Landmark, Pencil, Plus, Trash2 } from 'lucide-react';
import type { FinancingContract } from '@/types/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { useFinancingContracts } from '@/hooks/imobilizado/useFinancingContracts';
import { ControlsTabs } from '@/components/imobilizado/ControlsTabs';
import { FinancingSheet } from '@/components/imobilizado/FinancingSheet';
import { contractMonths, contractPositionAt, FINANCING_KIND_LABEL, installmentSchedule } from '@/lib/financing';
import { fromCents } from '@/lib/money';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, ConfirmButton, EmptyState, INPUT, PAGE, PageHeader, SURFACE } from '@/components/ui/primitives';
import { TableSkeleton } from '@/components/ui/Skeleton';

const NUM = 'px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap';
const competence = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

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
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [editing, setEditing] = useState<FinancingContract | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const done = (ok: boolean, message: string) => {
    if (ok) setToast(message);
    return ok;
  };

  const ctx = data.ctx;
  const pending = data.pendingMonths;
  const rows = [...data.contracts].sort((a, b) => a.date.localeCompare(b.date)).map((c) => ({ c, pos: contractPositionAt(c, month) }));

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Empréstimos, financiamentos e parcelamentos"
        description="O lançamento inicial separa curto e longo prazo; os juros prefixados (tabela Price) vão para a despesa no mês de cada parcela e, em dezembro, as parcelas do ano seguinte passam para o curto prazo."
        actions={
          <label className="flex items-center gap-2 text-[12px] text-stone-500">
            Posição no fim de
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={`${INPUT} h-9 w-40 font-mono tabular-nums text-[13px]`} />
          </label>
        }
      />
      <ControlsTabs />
      {data.error && !editing && (
        <p role="alert" className="text-[13px] text-rose-600">
          {data.error}
        </p>
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
        <div className="flex items-center gap-3 px-5 py-4 border-b border-black/4 dark:border-white/6">
          <HandCoins className="w-4 h-4 text-stone-400" />
          <h2 className="flex-1 text-[15px] font-semibold tracking-tight">Contratos</h2>
          {ctx && (
            <button type="button" onClick={() => setEditing('new')} className={`${BUTTON.secondary} h-8`}>
              <Plus className="w-3.5 h-3.5" />
              Novo contrato
            </button>
          )}
        </div>
        {!ctx ? (
          <TableSkeleton rows={3} label="Carregando contratos…" />
        ) : rows.length === 0 ? (
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
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-stone-400 border-b border-black/4">
                  <th className="w-10" />
                  <th className="font-medium pr-3 py-2.5">Contrato</th>
                  <th className="font-medium px-3 py-2.5 text-right">Parcelas</th>
                  <th className="font-medium px-3 py-2.5 text-right">Curto prazo</th>
                  <th className="font-medium px-3 py-2.5 text-right">Longo prazo</th>
                  <th className="font-medium px-3 py-2.5 text-right">Saldo devedor</th>
                  <th className="pl-3 pr-5 py-2.5 w-20"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ c, pos }) => {
                  const frozen = contractMonths(c, ctx.implantationMonth).some((m) => ctx.lockedMonths.has(m));
                  const expanded = open === c.id;
                  return (
                    <React.Fragment key={c.id}>
                      <tr className="border-b border-black/4 text-[13px]">
                        <td className="pl-3 py-3 text-center">
                          <button type="button" onClick={() => setOpen(expanded ? null : c.id)} aria-label={expanded ? 'Recolher parcelas' : `Ver parcelas de ${c.description}`} className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-stone-400 hover:text-stone-700 hover:bg-black/5">
                            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                        </td>
                        <td className="pr-3 py-3">
                          <p className="font-medium text-stone-900 dark:text-stone-100">{c.description}</p>
                          <p className="text-[11px] text-stone-400">
                            {FINANCING_KIND_LABEL[c.kind]}
                            {c.lender ? ` · ${c.lender}` : ''} · {formatDateBR(c.date)} · {c.interestMode === 'PREFIXED' ? `prefixado${c.monthlyRate ? ` ${c.monthlyRate.toLocaleString('pt-BR')}% a.m.` : ''}` : 'pós-fixado (Selic)'}
                          </p>
                        </td>
                        <td className={NUM}>
                          {pos.paidCount}/{c.installments}
                          <span className="block text-[11px] text-stone-400 font-sans">{formatCurrency(c.installmentAmount)}</span>
                        </td>
                        <td className={NUM}>{formatCurrency(fromCents(pos.shortPayments - pos.shortInterest))}</td>
                        <td className={NUM}>{formatCurrency(fromCents(pos.longPayments - pos.longInterest))}</td>
                        <td className={NUM}>{formatCurrency(fromCents(pos.balance))}</td>
                        <td className="pl-3 pr-5 py-3 text-right whitespace-nowrap">
                          <button type="button" onClick={() => setEditing(c)} aria-label={`Editar ${c.description}`} className="w-8 h-8 rounded-full inline-flex items-center justify-center text-stone-400 hover:text-stone-800 hover:bg-black/5 active:scale-[0.94] transition-all">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {!frozen && (
                            <ConfirmButton ariaLabel={`Excluir ${c.description}`} label={<Trash2 className="w-3.5 h-3.5" />} confirmLabel="Excluir" onConfirm={() => void data.remove(c).then((ok) => done(ok, 'Contrato excluído, com o lançamento inicial'))} />
                          )}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-b border-black/4 bg-black/2 dark:bg-white/2">
                          <td colSpan={7} className="px-5 py-3">
                            <table aria-label={`Parcelas de ${c.description}`} className="w-full text-left text-[12px]">
                              <thead>
                                <tr className="text-[10px] uppercase tracking-wider text-stone-400">
                                  <th className="font-medium py-1.5">Parcela</th>
                                  <th className="font-medium py-1.5">Vencimento</th>
                                  <th className="font-medium py-1.5 text-right">Valor</th>
                                  <th className="font-medium py-1.5 text-right">Juros</th>
                                  <th className="font-medium py-1.5 text-right">Amortização</th>
                                  <th className="font-medium py-1.5 text-right">Saldo devedor</th>
                                </tr>
                              </thead>
                              <tbody>
                                {installmentSchedule(c).map((r) => (
                                  <tr key={r.n} className="border-t border-black/4">
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
            </table>
          </div>
        )}
      </section>

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

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full bg-stone-900/90 text-white text-[13px] shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-xl animate-sheet-in">
          {toast}
        </div>
      )}
    </main>
  );
}
