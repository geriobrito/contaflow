'use client';

import { useMemo, useState } from 'react';
import { BadgePercent, ChevronRight, Wallet } from 'lucide-react';
import type { ClientCompany, FeeRegister } from '@/types/firestore';
import { feeArrears, feeCharges, feeDue, feePortfolio, pendingAdjustment, rateFor } from '@/lib/fees';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { CardHeader, SURFACE, StatCard } from '@/components/ui/primitives';
import { TABLE_HEAD, Th } from '@/components/ui/Table';
import { FeeSheet } from '@/components/agenda/FeeSheet';

const STATUS: Record<string, { label: string; className: string }> = {
  paid: { label: 'Pago', className: 'text-emerald-700 dark:text-emerald-400' },
  partial: { label: 'Parcial', className: 'text-amber-700 dark:text-amber-400' },
  overdue: { label: 'Atrasado', className: 'text-rose-600 dark:text-rose-400' },
  open: { label: 'A vencer', className: 'text-stone-500' },
};

/** Honorários da carteira: o mês, o que está em atraso e os reajustes pendentes. */
export function FeesBoard({
  clients,
  fees,
  today,
  onSave,
}: {
  clients: readonly ClientCompany[];
  fees: Map<string, FeeRegister>;
  today: string;
  onSave: (next: FeeRegister) => Promise<void>;
}) {
  const month = today.slice(0, 7);
  const [editing, setEditing] = useState<ClientCompany | null>(null);
  const registers = useMemo(() => [...fees.values()].filter((r) => clients.some((c) => c.id === r.clientId)), [fees, clients]);
  const totals = useMemo(() => feePortfolio(registers, month, today), [registers, month, today]);

  const rows = useMemo(
    () =>
      clients
        .map((client) => {
          const r = fees.get(client.id) ?? null;
          if (!r) return { client, r, rate: null, current: null, arrears: { count: 0, amount: 0 }, adjustment: null };
          const charges = feeCharges(r, month, today);
          return {
            client,
            r,
            rate: rateFor(r, month),
            current: charges.find((c) => c.month === month) ?? null,
            arrears: feeArrears(charges, today),
            adjustment: pendingAdjustment(r, today),
          };
        })
        // Atrasados primeiro, depois quem tem contrato, depois quem ainda não tem.
        .sort((a, b) => b.arrears.amount - a.arrears.amount || Number(Boolean(b.r)) - Number(Boolean(a.r)) || (a.client.tradeName || a.client.name).localeCompare(b.client.tradeName || b.client.name)),
    [clients, fees, month, today]
  );
  const adjustments = rows.filter((r) => r.adjustment).length;

  return (
    <div className="space-y-6">
      <section aria-label="Resumo dos honorários" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Wallet} label="Honorários do mês" value={formatCurrency(totals.monthly)} caption={`${registers.length} contrato(s)`} />
        <StatCard label="Recebido no mês" value={formatCurrency(totals.received)} tone={totals.received > 0 ? 'good' : 'neutral'} />
        <StatCard label="Em atraso" value={formatCurrency(totals.arrears)} tone={totals.arrears > 0 ? 'alert' : 'good'} caption={`${totals.lateClients} empresa(s)`} />
        <StatCard icon={BadgePercent} label="Reajustes pendentes" value={String(adjustments)} tone={adjustments > 0 ? 'warn' : 'neutral'} />
      </section>

      <section className={`${SURFACE} rounded-[22px] overflow-hidden`} aria-label="Honorários por empresa">
        <CardHeader title="Por empresa" meta="Clique para registrar recebimentos, reajustar ou editar o contrato" />
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className={TABLE_HEAD}>
                <Th edge="start">Empresa</Th>
                <Th align="right">Honorário</Th>
                <Th>Vencimento</Th>
                <Th>Mês atual</Th>
                <Th align="right">Em atraso</Th>
                <Th edge="end">{''}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ client, r, rate, current, arrears, adjustment }) => (
                <tr
                  key={client.id}
                  onClick={() => setEditing(client)}
                  className="border-b border-black/4 dark:border-white/5 last:border-0 text-[13px] cursor-pointer hover:bg-black/2 dark:hover:bg-white/3"
                >
                  <td className="pl-5 pr-3 py-3">
                    <p className="font-medium">{client.tradeName || client.name}</p>
                    {adjustment && <p className="text-[11.5px] text-amber-700 dark:text-amber-400">Reajuste de {adjustment.month.slice(5)}/{adjustment.month.slice(0, 4)} pendente</p>}
                    {!r && <p className="text-[11.5px] text-stone-500">Sem honorário cadastrado</p>}
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">{rate !== null ? formatCurrency(rate) : '—'}</td>
                  <td className="px-3 py-3 font-mono tabular-nums text-[12px]">{r ? formatDateBR(feeDue(r, month)) : '—'}</td>
                  <td className={`px-3 py-3 text-[12.5px] font-medium ${current ? STATUS[current.status].className : 'text-stone-400'}`}>{current ? STATUS[current.status].label : '—'}</td>
                  <td className={`px-3 py-3 text-right font-mono tabular-nums ${arrears.amount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-stone-400'}`}>
                    {arrears.count > 0 ? (
                      <>
                        {formatCurrency(arrears.amount)} <span className="text-[11px]">({arrears.count})</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="pl-3 pr-5 py-3 text-right">
                    <ChevronRight className="inline w-4 h-4 text-stone-300 dark:text-stone-600" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editing && <FeeSheet client={editing} register={fees.get(editing.id) ?? null} today={today} onSave={onSave} onClose={() => setEditing(null)} />}
    </div>
  );
}
