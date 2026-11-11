'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, Landmark, Pencil, PiggyBank, Plus, Trash2 } from 'lucide-react';
import type { InvestmentAccount } from '@/types/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { useInvestments } from '@/hooks/imobilizado/useInvestments';
import { ControlsTabs } from '@/components/imobilizado/ControlsTabs';
import { InvestmentSheet } from '@/components/imobilizado/InvestmentSheet';
import { investmentCloseProblem, isActiveIn } from '@/lib/investments';
import { fromCents } from '@/lib/money';
import { parseMoneyInput } from '@/lib/opening';
import { formatCurrency } from '@/lib/utils/formatters';
import { BUTTON, ConfirmButton, EmptyState, INPUT, PAGE, PageHeader, SURFACE } from '@/components/ui/primitives';
import { TableSkeleton } from '@/components/ui/Skeleton';

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
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const data = useInvestments(clientId, user?.uid, month);
  const [editing, setEditing] = useState<InvestmentAccount | 'new' | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
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

  const done = (ok: boolean, message: string) => {
    if (ok) setToast(message);
    return ok;
  };

  const ctx = data.ctx;
  const locked = Boolean(ctx?.lockedMonths.has(month));
  const status = data.month?.status;
  const rows = status && 'rows' in status ? status.rows : [];
  const problem = status ? investmentCloseProblem(status, month) : null;
  const draftKey = (inv: InvestmentAccount) => `${inv.id}|${month}`;
  const textOf = (inv: InvestmentAccount) => drafts[draftKey(inv)] ?? moneyText(inv.balances[month]);

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
          <label className="flex items-center gap-2 text-[12px] text-stone-500">
            Competência
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={`${INPUT} h-9 w-40 font-mono tabular-nums text-[13px]`} />
          </label>
        }
      />
      <ControlsTabs />
      {data.error && !editing && (
        <p role="alert" className="text-[13px] text-rose-600 dark:text-rose-300">
          {data.error}
        </p>
      )}

      {data.missingMonths.length > 0 && (
        <section role="status" className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200/70 bg-amber-50/80 dark:bg-amber-950/25 dark:border-amber-800/40 px-4 py-3 text-[13px] text-amber-900 dark:text-amber-200">
          <Landmark className="w-4 h-4 shrink-0" />
          <span>Saldo do extrato a informar em:</span>
          {data.missingMonths.map((m) => (
            <button key={m} type="button" onClick={() => setMonth(m)} className="rounded-lg border border-amber-600/40 px-2 py-0.5 font-mono tabular-nums text-[12px] hover:bg-amber-100 dark:hover:bg-amber-900/40">
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
                <tr className="text-[10.5px] uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400 bg-surface-2 border-b border-line">
                  <th className="font-semibold pl-5 pr-3 py-2.5">Aplicação</th>
                  <th className="font-semibold px-3 py-2.5 text-right w-56">Saldo bruto do extrato em {competence(month)}</th>
                  <th className="pl-3 pr-5 py-2.5 w-20">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.investments.map((inv) => {
                  const active = isActiveIn(inv, month);
                  return (
                    <tr key={inv.id} className="border-b border-black/4 last:border-0 text-[13px]">
                      <td className="pl-5 pr-3 py-3">
                        <p className="font-medium text-stone-900 dark:text-stone-100">{inv.description}</p>
                        <p className="text-[11px] text-stone-400">
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
                              className={`${INPUT} h-9 w-36 text-right font-mono tabular-nums`}
                            />
                            {drafts[draftKey(inv)] !== undefined && (
                              <button type="button" disabled={data.busy} onClick={() => saveBalance(inv)} className={`${BUTTON.accent} h-9`}>
                                Gravar
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-[12px] text-stone-400">fora do período</span>
                        )}
                      </td>
                      <td className="pl-3 pr-5 py-3 text-right whitespace-nowrap">
                        <button type="button" onClick={() => setEditing(inv)} aria-label={`Editar ${inv.description}`} className="w-8 h-8 rounded-full inline-flex items-center justify-center text-stone-400 hover:text-stone-800 hover:bg-black/5 active:scale-[0.94] transition-all">
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
              <button type="button" disabled={data.busy} onClick={() => void data.postMonth().then((ok) => done(ok, `Rendimento de ${competence(month)} lançado`))} className={`${BUTTON.accent} h-8`}>
                {data.busy ? 'Lançando…' : status.kind === 'REMOVE' || status.existing ? 'Atualizar o lançamento' : 'Lançar o rendimento'}
              </button>
            )}
          </div>
          {data.month === undefined ? (
            <TableSkeleton rows={2} label="Conferindo com o razão…" />
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
                    <tr className="text-[10.5px] uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400 bg-surface-2 border-y border-line">
                      <th className="font-semibold pl-5 pr-3 py-2.5">Conta</th>
                      <th className="font-semibold px-3 py-2.5 text-right">Extrato</th>
                      <th className="font-semibold px-3 py-2.5 text-right">Contábil antes do rendimento</th>
                      <th className="font-semibold pl-3 pr-5 py-2.5 text-right">Rendimento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.ledgerAccountId} className="border-b border-black/4 last:border-0 text-[13px]">
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

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full bg-stone-900/90 text-white text-[13px] shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-xl animate-sheet-in">
          {toast}
        </div>
      )}
    </main>
  );
}
