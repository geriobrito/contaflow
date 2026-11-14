'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Check, ChevronRight, Settings2 } from 'lucide-react';
import type { ClientCompany, ObligationChecks } from '@/types/firestore';
import { addCalendarDays } from '@/lib/business-days';
import { buildAgenda, toggleDone, type AgendaItem, type AgendaStatus } from '@/lib/obligations';
import type { OfficeData } from '@/hooks/agenda/useOfficeAgenda';
import { formatDateBR } from '@/lib/utils/formatters';
import { describeError } from '@/lib/utils/errors';
import { BUTTON, CardHeader, EmptyState, INPUT_COMPACT, SegmentedControl, SURFACE } from '@/components/ui/primitives';
import { ObligationSettingsSheet } from '@/components/agenda/ObligationSettingsSheet';

type Horizon = 'week' | 'month' | 'done';

const SECTIONS: readonly { status: AgendaStatus[]; title: string; tone: string }[] = [
  { status: ['overdue'], title: 'Atrasadas', tone: 'text-rose-600 dark:text-rose-400' },
  { status: ['today'], title: 'Vencem hoje', tone: 'text-amber-700 dark:text-amber-400' },
  { status: ['week'], title: 'Próximos 7 dias', tone: 'text-stone-700 dark:text-stone-200' },
  { status: ['later'], title: 'Mais adiante', tone: 'text-stone-500' },
  { status: ['done'], title: 'Cumpridas', tone: 'text-emerald-700 dark:text-emerald-400' },
];

/** Quanto do passado a agenda mostra: o que venceu nos últimos 90 dias e não foi marcado. */
const LOOKBACK_DAYS = 90;
/** Marcações guardadas: 3 anos (o documento da empresa não cresce sem fim). */
const KEEP_DAYS = 3 * 365;

const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const weekday = (date: string) => WEEKDAY[new Date(`${date}T12:00:00`).getDay()];

export function ObligationsAgenda({
  clients,
  data,
  today,
  saveChecks,
  checksOf,
  onOpen,
}: {
  clients: readonly ClientCompany[];
  data: OfficeData;
  today: string;
  saveChecks: (next: ObligationChecks) => Promise<void>;
  checksOf: (clientId: string) => ObligationChecks;
  /** Seleciona a empresa e abre a tela que ajuda a cumprir a obrigação. */
  onOpen: (client: ClientCompany, href: string) => void;
}) {
  const [horizon, setHorizon] = useState<Horizon>('week');
  const [clientFilter, setClientFilter] = useState<string>('');
  const [settingsFor, setSettingsFor] = useState<ClientCompany | null>(null);
  const [error, setError] = useState<string | null>(null);
  const byId = useMemo(() => new Map(clients.map((c) => [c.id, c] as const)), [clients]);

  const items = useMemo(() => {
    const to = addCalendarDays(today, horizon === 'week' ? 7 : 31);
    const from = addCalendarDays(today, -LOOKBACK_DAYS);
    const all = buildAgenda({
      clients: clients
        .filter((c) => !clientFilter || c.id === clientFilter)
        .map((c) => ({ client: c, profile: data.profiles.get(c.id) ?? { hasPayroll: false, hasEmployees: false }, checks: data.checks.get(c.id) ?? null })),
      today,
      from,
      to,
    });
    if (horizon === 'done') return all.filter((i) => i.status === 'done').reverse();
    // Cumpridas continuam à vista se ainda vão vencer ou se foram marcadas agora (retorno do clique).
    const recent = addCalendarDays(today, -1);
    return all.filter((i) => i.status !== 'done' || i.due >= today || (i.doneAt ?? '').slice(0, 10) >= recent);
  }, [clients, clientFilter, data, today, horizon]);

  const toggle = async (item: AgendaItem) => {
    setError(null);
    const keepFrom = addCalendarDays(today, -KEEP_DAYS);
    const next = toggleDone(checksOf(item.clientId), item.key, item.status === 'done' ? null : new Date().toISOString(), keepFrom);
    try {
      await saveChecks(next);
    } catch (e) {
      setError(`Não foi possível gravar (${describeError(e)}).`);
    }
  };

  const overdue = items.filter((i) => i.status === 'overdue').length;
  const week = items.filter((i) => i.status === 'today' || i.status === 'week').length;

  return (
    <section className={`${SURFACE} rounded-[22px] overflow-hidden`} aria-label="Agenda de obrigações">
      <CardHeader
        icon={overdue > 0 ? AlertTriangle : CalendarClock}
        iconClassName={overdue > 0 ? 'text-rose-500' : 'text-stone-400'}
        title="Obrigações"
        meta={horizon === 'done' ? `${items.length} cumprida(s) nos últimos ${LOOKBACK_DAYS} dias` : `${overdue} atrasada(s) · ${week} nos próximos 7 dias`}
      />
      <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-line">
        <SegmentedControl
          ariaLabel="Período da agenda"
          value={horizon}
          onChange={setHorizon}
          options={[
            { value: 'week', label: 'Semana' },
            { value: 'month', label: '30 dias' },
            { value: 'done', label: 'Cumpridas' },
          ]}
        />
        <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className={`${INPUT_COMPACT} max-w-[260px]`} aria-label="Empresa">
          <option value="">Todas as empresas</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.tradeName || c.name}
            </option>
          ))}
        </select>
        <div className="ml-auto">
          <button
            type="button"
            className={BUTTON.secondary}
            onClick={() => setSettingsFor(byId.get(clientFilter) ?? clients[0] ?? null)}
            disabled={clients.length === 0}
            title="Escolher as obrigações de cada empresa"
          >
            <Settings2 className="w-4 h-4" strokeWidth={1.75} />
            Obrigações por empresa
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="px-5 pt-3 text-[13px] text-rose-600 dark:text-rose-300">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <EmptyState
          title={horizon === 'done' ? 'Nada marcado como cumprido' : 'Nada vencendo'}
          description={horizon === 'done' ? 'Marque as obrigações na agenda quando entregar ou pagar.' : 'Nenhuma obrigação atrasada nem vencendo no período.'}
        />
      ) : (
        <div className="divide-y divide-line">
          {SECTIONS.map((section) => {
            const list = items.filter((i) => section.status.includes(i.status));
            if (list.length === 0) return null;
            return (
              <div key={section.title}>
                <p className={`px-5 pt-3 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] ${section.tone}`}>
                  {section.title} <span className="text-stone-400 font-normal">({list.length})</span>
                </p>
                <ul>
                  {list.map((item) => {
                    const client = byId.get(item.clientId);
                    const done = item.status === 'done';
                    return (
                      <li key={`${item.clientId}|${item.key}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-black/2 dark:hover:bg-white/3">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={done}
                          aria-label={`${done ? 'Desmarcar' : 'Marcar como cumprida'}: ${item.label} de ${client?.tradeName || client?.name}`}
                          onClick={() => void toggle(item)}
                          className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center transition-colors ${
                            done ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-line-strong hover:border-stone-500'
                          }`}
                        >
                          {done && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                        </button>
                        <span className="w-[86px] shrink-0 font-mono tabular-nums text-[12px] text-stone-600 dark:text-stone-300">
                          {formatDateBR(item.due).slice(0, 5)} <span className="text-stone-400">{weekday(item.due)}</span>
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className={`block text-[13.5px] font-medium tracking-tight ${done ? 'line-through text-stone-400' : 'text-stone-900 dark:text-stone-100'}`}>
                            {item.label}
                            <span className="ml-2 text-[11px] font-normal text-stone-500">{item.periodLabel}</span>
                          </span>
                          <span className="block text-[12px] text-stone-500 truncate">{client?.tradeName || client?.name}</span>
                        </span>
                        <span className="hidden sm:inline text-[10.5px] uppercase tracking-[0.08em] text-stone-400">{item.kind}</span>
                        {item.href && client && (
                          <button type="button" onClick={() => onOpen(client, item.href!)} className="text-stone-300 hover:text-stone-600 dark:text-stone-600 dark:hover:text-stone-300" aria-label="Abrir tela relacionada">
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      <p className="px-5 py-3 border-t border-line text-[11.5px] text-stone-500">
        Prazos federais da legislação vigente, já deslocados para dia útil (feriados nacionais). Confira a agenda tributária da Receita a cada ano e os prazos
        estaduais e municipais (ICMS, ISS), que não entram aqui.
      </p>

      {settingsFor && (
        <ObligationSettingsSheet
          clients={clients}
          client={settingsFor}
          onClientChange={setSettingsFor}
          profile={data.profiles.get(settingsFor.id) ?? { hasPayroll: false, hasEmployees: false }}
          checks={checksOf(settingsFor.id)}
          onSave={saveChecks}
          onClose={() => setSettingsFor(null)}
        />
      )}
    </section>
  );
}
