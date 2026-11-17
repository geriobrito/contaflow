'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ArrowRight, Boxes, CalendarClock, Car, Check, HandCoins, PiggyBank, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useClient } from '@/contexts/ClientContext';
import { useControlsOverview } from '@/hooks/imobilizado/useControlsOverview';
import { useMonthQueryState } from '@/hooks/imobilizado/useMonthQueryState';
import { useMonthRoutines } from '@/hooks/imobilizado/useMonthRoutines';
import { ControlsErrorBanner, ControlsTabs } from '@/components/imobilizado/ControlsTabs';
import { controlsSummary, horizonEnd, upcomingEvents, type ControlEvent, type ControlFigure, type ControlKey, type ControlSummary } from '@/lib/controls-overview';
import type { MonthRoutines } from '@/lib/services/month-routines';
import { fromCents } from '@/lib/money';
import { formatMonth, monthOf } from '@/lib/periods';
import { formatCurrency } from '@/lib/utils/formatters';
import { BUTTON, CardHeader, INPUT_COMPACT, OVERLINE, PAGE, PageHeader, SURFACE } from '@/components/ui/primitives';
import { CardsSkeleton } from '@/components/ui/Skeleton';
import { Toast, useToast } from '@/components/ui/Toast';

const CONTROLS: Record<ControlKey, { label: string; href: string; icon: LucideIcon; register: string }> = {
  depreciation: { label: 'Imobilizado', href: '/imobilizado', icon: Car, register: 'Cadastrar bem' },
  prepaid: { label: 'Seguros e despesas antecipadas', href: '/despesas-antecipadas', icon: ShieldCheck, register: 'Cadastrar apólice' },
  financing: { label: 'Empréstimos e financiamentos', href: '/financiamentos', icon: HandCoins, register: 'Cadastrar contrato' },
  investment: { label: 'Aplicações financeiras', href: '/aplicacoes', icon: PiggyBank, register: 'Cadastrar aplicação' },
  stock: { label: 'Estoque e CMV', href: '/estoque', icon: Boxes, register: 'Configurar estoque' },
};

/** Meses mostrados na agenda de vencimentos, a competência escolhida inclusive. */
const HORIZON_MONTHS = 4;

const GRID = 'grid grid-cols-1 @2xl:grid-cols-2 @5xl:grid-cols-3 @7xl:grid-cols-5 gap-4';

const money = (figure: ControlFigure) => (figure.cents === null ? '—' : formatCurrency(fromCents(figure.cents)));
const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

type Status = { tone: 'ok' | 'pending' | 'none'; label: string; title?: string };

/** Situação do controle na competência, pela mesma conferência que libera o fechamento do mês. */
function statusOf(summary: ControlSummary, routines: MonthRoutines | null, checked: boolean): Status | null {
  if (summary.registered === 0) return { tone: 'none', label: 'Sem cadastro' };
  const problem = routines?.problemsByKey[summary.key];
  const input = routines?.inputs.find((i) => i.key === summary.key);
  if (input) return { tone: 'pending', label: 'Falta informar', title: problem ?? input.label };
  if (problem) return { tone: 'pending', label: 'A lançar', title: problem };
  return checked ? { tone: 'ok', label: 'Em dia' } : null;
}

const STATUS_STYLE: Record<Status['tone'], string> = {
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/25',
  pending: 'bg-amber-50 text-amber-800 border-amber-200/70 dark:bg-amber-950/25 dark:text-amber-300 dark:border-amber-900/50',
  none: 'bg-stone-50 text-stone-500 border-stone-200/60 dark:bg-stone-800 dark:text-stone-400 dark:border-stone-700',
};

function ControlCard({ summary, status, month }: { summary: ControlSummary; status: Status | null; month: string }) {
  const meta = CONTROLS[summary.key];
  const Icon = meta.icon;
  const href = `${meta.href}?mes=${month}`;
  const unused = summary.registered === 0;
  return (
    <article aria-label={meta.label} className={`${SURFACE} rounded-[20px] p-4 flex flex-col gap-3 min-w-0`}>
      <div className="flex items-start gap-2.5">
        <span className="shrink-0 w-8 h-8 rounded-[10px] flex items-center justify-center bg-stone-900/6 text-stone-600 dark:bg-white/8 dark:text-stone-300">
          <Icon className="w-4 h-4" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13.5px] font-semibold tracking-tight leading-snug text-stone-900 dark:text-stone-100">{meta.label}</h3>
          <p className="text-[12px] text-stone-500 dark:text-stone-400">
            {unused ? 'Nada cadastrado' : `${summary.active} ${summary.activeLabel}`}
          </p>
        </div>
      </div>

      {unused ? (
        <p className="flex-1 text-[12px] leading-relaxed text-stone-500 dark:text-stone-400">Sem uso nesta empresa. Cadastre para a rotina do mês passar a gerar o lançamento.</p>
      ) : (
        <dl className="flex-1 space-y-2 text-[12px]">
          {[summary.position, summary.monthly, ...(summary.extra ? [summary.extra] : [])].map((figure) => (
            <div key={figure.label} className="flex items-baseline justify-between gap-3">
              <dt className="min-w-0 text-stone-500 dark:text-stone-400">{figure.label}</dt>
              {/* Linha só de texto (ex.: "2 de 3 saldos informados") não tem valor ao lado. */}
              {(figure.cents !== null || figure === summary.position) && (
                <dd className="shrink-0 font-mono tabular-nums text-[13px] text-stone-900 dark:text-stone-100">{money(figure)}</dd>
              )}
            </div>
          ))}
        </dl>
      )}

      <div className="pt-3 border-t border-line flex items-center justify-between gap-2">
        {status ? (
          <span title={status.title} className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[11px] font-medium ${STATUS_STYLE[status.tone]}`}>
            {status.tone === 'ok' && <Check className="w-3 h-3" strokeWidth={2.5} />}
            {status.label}
          </span>
        ) : (
          <span />
        )}
        <Link href={href} className="inline-flex items-center gap-1 text-[12px] font-medium text-accent-ink hover:underline whitespace-nowrap">
          {unused ? meta.register : 'Abrir'} <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </article>
  );
}

function EventRow({ event, month }: { event: ControlEvent; month: string }) {
  const meta = CONTROLS[event.control];
  const Icon = meta.icon;
  return (
    <li className="flex items-center gap-3 px-5 py-2.5">
      <span className="shrink-0 w-12 font-mono tabular-nums text-[13px] text-stone-700 dark:text-stone-300">{dayMonth(event.date)}</span>
      <Icon aria-hidden className={`shrink-0 w-4 h-4 ${event.attention ? 'text-amber-600 dark:text-amber-400' : 'text-stone-400'}`} strokeWidth={1.9} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium tracking-tight text-stone-900 dark:text-stone-100">{event.title}</p>
        {event.detail && <p className="truncate text-[12px] text-stone-500 dark:text-stone-400">{event.detail}</p>}
      </div>
      {event.cents !== undefined && <span className="shrink-0 font-mono tabular-nums text-[13px] text-stone-900 dark:text-stone-100">{formatCurrency(fromCents(event.cents))}</span>}
      <Link
        href={`${meta.href}?mes=${month}`}
        aria-label={`Abrir ${meta.label}`}
        className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/8 transition-colors"
      >
        <ArrowRight className="w-4 h-4" />
      </Link>
    </li>
  );
}

/**
 * Resumo de Bens e Contratos: os cinco controles na competência (saldo, o que a rotina do mês
 * lança e a situação de cada um), o botão que lança as rotinas pendentes e a agenda do que vence
 * nos próximos meses. Os números saem dos cadastros; a situação, de `loadMonthRoutines`.
 */
export default function BensEContratosPage() {
  const { currentClient } = useClient();
  const clientId = currentClient?.id;
  const [month, setMonth] = useMonthQueryState();
  const { registers, error, loading } = useControlsOverview(clientId);
  const routine = useMonthRoutines(clientId, month, false);
  const [toast, setToast] = useToast();

  const summaries = useMemo(() => (registers ? controlsSummary(registers, month) : []), [registers, month]);
  const until = horizonEnd(month, HORIZON_MONTHS);
  const events = useMemo(() => (registers ? upcomingEvents(registers, month, until) : []), [registers, month, until]);
  /** Vencimentos por competência, na ordem. */
  const eventsByMonth = useMemo(() => {
    const groups = new Map<string, ControlEvent[]>();
    for (const e of events) groups.set(monthOf(e.date), [...(groups.get(monthOf(e.date)) ?? []), e]);
    return [...groups];
  }, [events]);

  const routines = routine.routines;
  const anyRegistered = summaries.some((s) => s.registered > 0);
  // Sem nada cadastrado a conferência devolve null: aí não há o que marcar como "em dia".
  const checked = routines !== null;
  const pendingCount = routines?.pending.length ?? 0;
  const inputs = routines?.inputs ?? [];
  const attention = events.filter((e) => e.attention).length;

  const postAll = async () => {
    const message = await routine.post();
    if (message) setToast(message);
  };

  return (
    <main className={`${PAGE} @container`}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Bens e Contratos"
        description="Os cadastros que geram lançamentos todo mês, numa tela só: o saldo de cada um, o que a rotina da competência lança e o que vence nos próximos meses."
        actions={
          <label className="flex items-center gap-2 text-[12px] text-stone-500">
            Competência
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={`${INPUT_COMPACT} w-40 font-mono tabular-nums`} />
          </label>
        }
      />
      <ControlsTabs month={month} routines={routines} />
      {(error || routine.error) && <ControlsErrorBanner message={error ?? routine.error ?? ''} />}

      {(pendingCount > 0 || inputs.length > 0) && (
        <section role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-amber-200/70 bg-amber-50/80 dark:bg-amber-950/25 dark:border-amber-800/40 px-4 py-3 text-[13px] text-amber-900 dark:text-amber-200">
          <CalendarClock className="w-4 h-4 shrink-0" />
          <div className="flex-1 min-w-[240px] space-y-1">
            {routines?.problems.map((p) => <p key={p}>{p}</p>)}
          </div>
          {inputs.map((i) => (
            <Link key={i.key} href={i.href} className={`${BUTTON.secondary} h-8`}>
              {i.label}
            </Link>
          ))}
          {pendingCount > 0 && (
            <button
              type="button"
              disabled={routine.busy}
              onClick={() => void postAll()}
              title="Lança (ou atualiza) de uma vez as rotinas pendentes da competência, inclusive a da folha, se houver"
              className={`${BUTTON.accent} h-8`}
            >
              {routine.busy ? 'Lançando…' : routines?.updates ? 'Lançar e atualizar rotinas do mês' : 'Lançar rotinas do mês'}
            </button>
          )}
        </section>
      )}

      {loading ? (
        <CardsSkeleton count={5} className={GRID} label="Carregando bens e contratos…" />
      ) : (
        registers && (
          <>
            <section aria-label={`Controles em ${formatMonth(month)}`} className="space-y-3">
              <p className={OVERLINE}>Posição no fim de {formatMonth(month)}</p>
              <div className={GRID}>
                {summaries.map((s) => (
                  <ControlCard key={s.key} summary={s} status={statusOf(s, routines, checked)} month={month} />
                ))}
              </div>
            </section>

            {anyRegistered && (
              <section aria-label="Próximos vencimentos" className={`${SURFACE} rounded-[22px] overflow-hidden`}>
                <CardHeader
                  icon={CalendarClock}
                  title="Próximos vencimentos"
                  meta={`${formatMonth(month)} a ${formatMonth(until)}${attention ? ` · ${attention} pede(m) atenção` : ''}`}
                />
                {events.length === 0 ? (
                  <p className="px-5 py-6 text-[13px] text-stone-500 dark:text-stone-400">
                    Nada vence no período: nenhuma parcela, fim de vigência ou última cota de depreciação.
                  </p>
                ) : (
                  eventsByMonth.map(([m, list]) => (
                    <div key={m}>
                      <p className={`${OVERLINE} px-5 py-2 bg-surface-2 border-y border-line first:border-t-0`}>{formatMonth(m)}</p>
                      <ul className="divide-y divide-black/4 dark:divide-white/5">
                        {list.map((e) => (
                          <EventRow key={e.id} event={e} month={m} />
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </section>
            )}
          </>
        )
      )}

      <Toast toast={toast} />
    </main>
  );
}
