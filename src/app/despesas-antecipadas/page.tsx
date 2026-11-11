'use client';

import { TABLE_HEAD, Th } from '@/components/ui/Table';
import React, { useEffect, useState } from 'react';
import { Landmark, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import type { PrepaidExpense } from '@/types/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { usePrepaidExpenses } from '@/hooks/imobilizado/usePrepaidExpenses';
import { ControlsTabs } from '@/components/imobilizado/ControlsTabs';
import { PrepaidSheet } from '@/components/imobilizado/PrepaidSheet';
import { lockedPrepaidMonths, postedPrepaidCents, prepaidBalanceAt, prepaidEndDate, PREPAID_KIND_LABEL } from '@/lib/prepaid-expenses';
import { fromCents } from '@/lib/money';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, ConfirmButton, EmptyState, PAGE, PageHeader, SURFACE, INPUT_COMPACT } from '@/components/ui/primitives';
import { TableSkeleton } from '@/components/ui/Skeleton';

const NUM = 'px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap';
const competence = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

/**
 * Seguros e despesas antecipadas: o valor contratado vai para o ativo na data da apólice e para o
 * resultado mês a mês, pela vigência. Os pagamentos das parcelas vêm pelo extrato.
 */
export default function DespesasAntecipadasPage() {
  const { user } = useAuth();
  const { currentClient } = useClient();
  const clientId = currentClient?.id;
  const data = usePrepaidExpenses(clientId, user?.uid);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [editing, setEditing] = useState<PrepaidExpense | 'new' | null>(null);
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
  const rows = ctx
    ? [...data.items]
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
        .map((item) => ({ item, quota: postedPrepaidCents(item, month, ctx.implantationMonth), balance: prepaidBalanceAt(item, month, ctx.implantationMonth) }))
    : [];
  const total = rows.reduce((t, r) => ({ quota: t.quota + r.quota, balance: t.balance + r.balance }), { quota: 0, balance: 0 });
  const pending = data.pendingMonths;

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Seguros e despesas antecipadas"
        description="O valor contratado vai para o ativo na data da apólice e para o resultado mês a mês, pela vigência — nunca pelas parcelas pagas. Os pagamentos vêm pelo extrato."
        actions={
          <label className="flex items-center gap-2 text-[12px] text-stone-500">
            Posição no fim de
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={`${INPUT_COMPACT} w-40 font-mono tabular-nums`} />
          </label>
        }
      />
      <ControlsTabs />
      {data.error && !editing && (
        <p role="alert" className="text-[13px] text-rose-600 dark:text-rose-300">
          {data.error}
        </p>
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
        <div className="flex items-center gap-3 px-5 py-4 border-b border-black/4 dark:border-white/6">
          <ShieldCheck className="w-4 h-4 text-stone-400" />
          <h2 className="flex-1 text-[15px] font-semibold tracking-tight">Apólices e contratos</h2>
          {ctx && (
            <button type="button" onClick={() => setEditing('new')} className={`${BUTTON.secondary} h-8`}>
              <Plus className="w-3.5 h-3.5" />
              Novo seguro ou despesa
            </button>
          )}
        </div>
        {!ctx ? (
          <TableSkeleton rows={3} label="Carregando…" />
        ) : rows.length === 0 ? (
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
                  return (
                    <tr key={item.id} className="border-b border-black/4 last:border-0 text-[13px]">
                      <td className="pl-5 pr-3 py-3">
                        <p className="font-medium text-stone-900 dark:text-stone-100">{item.description}</p>
                        <p className="text-[11px] text-stone-500 dark:text-stone-400">
                          {PREPAID_KIND_LABEL[item.kind]}
                          {item.documentRef ? ` nº ${item.documentRef}` : ''} · {item.use === 'COST' ? 'custo' : 'despesa'} · <span className="font-mono">{item.expenseAccountCode}</span>
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
                        <button type="button" onClick={() => setEditing(item)} aria-label={`Editar ${item.description}`} className="w-8 h-8 rounded-full inline-flex items-center justify-center text-stone-400 hover:text-stone-800 hover:bg-black/5 active:scale-[0.94] transition-all">
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
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-black/8 text-[13px] font-semibold">
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

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full bg-stone-900/90 text-white text-[13px] shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-xl animate-sheet-in">
          {toast}
        </div>
      )}
    </main>
  );
}
