'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarClock } from 'lucide-react';
import type { ClientCompany } from '@/types/firestore';
import type { OfficeData } from '@/hooks/agenda/useOfficeAgenda';
import { addCalendarDays } from '@/lib/business-days';
import { buildAgenda } from '@/lib/obligations';
import { feeArrears, feeCharges } from '@/lib/fees';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { CardHeader, SURFACE } from '@/components/ui/primitives';

/** Quantos itens o cartão mostra antes do "ver todos". */
const VISIBLE = 6;

/** Cartão da carteira: obrigações atrasadas e da semana, e honorários em atraso. */
export function WeekAgenda({ clients, data, today }: { clients: readonly ClientCompany[]; data: OfficeData; today: string }) {
  const byId = useMemo(() => new Map(clients.map((c) => [c.id, c] as const)), [clients]);
  const items = useMemo(
    () =>
      buildAgenda({
        clients: clients.map((c) => ({ client: c, profile: data.profiles.get(c.id) ?? { hasPayroll: false, hasEmployees: false }, checks: data.checks.get(c.id) ?? null })),
        today,
        from: addCalendarDays(today, -90),
        to: addCalendarDays(today, 7),
      }).filter((i) => i.status !== 'done'),
    [clients, data, today]
  );
  const lateFees = useMemo(() => {
    let amount = 0;
    let count = 0;
    for (const r of data.fees.values()) {
      if (!byId.has(r.clientId)) continue;
      const late = feeArrears(feeCharges(r, today.slice(0, 7), today), today);
      amount += late.amount;
      if (late.count) count++;
    }
    return { amount, count };
  }, [data.fees, byId, today]);
  const overdue = items.filter((i) => i.status === 'overdue').length;

  if (items.length === 0 && lateFees.count === 0) return null;
  return (
    <section className={`${SURFACE} rounded-[22px] overflow-hidden`} aria-label="Vence esta semana">
      <CardHeader
        icon={CalendarClock}
        iconClassName={overdue > 0 ? 'text-rose-500' : 'text-stone-400'}
        title="Vence esta semana"
        meta={`${overdue} atrasada(s) · ${items.length - overdue} até ${formatDateBR(addCalendarDays(today, 7)).slice(0, 5)}`}
        actions={
          <Link href="/agenda" className="inline-flex items-center gap-1 text-[12px] font-medium text-accent-ink hover:underline">
            Abrir agenda <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        }
      />
      <ul className="divide-y divide-line">
        {items.slice(0, VISIBLE).map((i) => {
          const c = byId.get(i.clientId);
          return (
            <li key={`${i.clientId}|${i.key}`} className="flex items-center gap-3 px-5 py-2 text-[13px]">
              <span className={`w-2 h-2 rounded-full shrink-0 ${i.status === 'overdue' ? 'bg-rose-500' : i.status === 'today' ? 'bg-amber-500' : 'bg-sky-400'}`} />
              <span className="w-12 font-mono tabular-nums text-[12px] text-stone-500">{formatDateBR(i.due).slice(0, 5)}</span>
              <span className="flex-1 min-w-0 truncate">
                <span className="font-medium text-stone-900 dark:text-stone-100">{i.label}</span>
                <span className="text-stone-500"> · {c?.tradeName || c?.name} · {i.periodLabel}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {(items.length > VISIBLE || lateFees.count > 0) && (
        <p className="px-5 py-2.5 border-t border-line text-[12px] text-stone-500">
          {items.length > VISIBLE && <>+ {items.length - VISIBLE} na agenda. </>}
          {lateFees.count > 0 && (
            <span className="text-rose-600 dark:text-rose-400">
              Honorários em atraso: {formatCurrency(lateFees.amount)} em {lateFees.count} empresa(s).
            </span>
          )}
        </p>
      )}
    </section>
  );
}
