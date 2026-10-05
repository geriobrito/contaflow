'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, Lock, MessageCircleQuestion, ShieldCheck } from 'lucide-react';
import type { BankAccount, BankTransaction, ChartAccount, ClientRequest, ImportBatch, OpeningBalances, OrgSettings, PeriodLock } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { useClient } from '@/contexts/ClientContext';
import { buildDashboard, type Alert, type MonthState, type MonthStatus } from '@/lib/dashboard';
import { formatMonth } from '@/lib/periods';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BalanceCheckBadge } from '@/components/conciliacao/StatementPanel';
import { EmptyState, PAGE, PageHeader, SURFACE } from '@/components/ui/primitives';

const describe = (e: unknown) => (e instanceof Error && e.message ? e.message : 'erro desconhecido');
const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

interface Loaded {
  id: string;
  accounts: ChartAccount[];
  transactions: BankTransaction[];
  batches: ImportBatch[];
  banks: BankAccount[];
  locks: PeriodLock[];
  requests: ClientRequest[];
  org: OrgSettings | null;
  openings: OpeningBalances | null;
  today: string;
  nowMs: number;
}

const SEVERITY_STYLE: Record<Alert['severity'], { dot: string; label: string }> = {
  high: { dot: 'bg-rose-500', label: 'Urgente' },
  medium: { dot: 'bg-amber-500', label: 'Atenção' },
  low: { dot: 'bg-sky-400', label: 'Sugestão' },
};

const STATE_STYLE: Record<MonthState, { box: string; text: string; label: string }> = {
  LOCKED: { box: 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 border-transparent', text: 'text-white/70 dark:text-stone-600', label: 'Fechado' },
  READY: { box: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200/70', text: 'text-emerald-700 dark:text-emerald-400', label: 'Pronto p/ fechar' },
  OPEN: { box: 'bg-amber-50 dark:bg-amber-950/20 border-amber-200/70', text: 'text-amber-700 dark:text-amber-400', label: 'Em aberto' },
  EMPTY: { box: 'bg-black/[0.03] dark:bg-white/[0.04] border-dashed border-black/[0.10]', text: 'text-stone-400', label: 'Sem movimento' },
};

function Tile({ label, value, caption, href, tone = 'neutral' }: { label: string; value: string; caption?: string; href?: string; tone?: 'neutral' | 'alert' | 'good' }) {
  const body = (
    <div className="px-5 py-4 min-w-0 h-full backdrop-blur-xl bg-white/80 dark:bg-stone-900/80 hover:bg-white transition-colors">
      <p className="text-[12px] font-medium text-stone-500">{label}</p>
      <p
        className={`mt-1.5 text-[26px] leading-none font-semibold tracking-tight font-mono tabular-nums ${
          tone === 'alert' ? 'text-rose-600' : tone === 'good' ? 'text-emerald-600' : 'text-stone-900 dark:text-stone-100'
        }`}
      >
        {value}
      </p>
      {caption && <p className="mt-2 text-[11px] text-stone-400 truncate">{caption}</p>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

function MonthCard({ m }: { m: MonthStatus }) {
  const s = STATE_STYLE[m.state];
  const [, mm] = m.month.split('-');
  const inner = (
    <div className={`rounded-2xl border px-3.5 py-3 h-full transition-all duration-150 hover:shadow-[0_4px_14px_rgba(0,0,0,0.08)] ${s.box}`}>
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-semibold tracking-tight capitalize">{MONTH_SHORT[Number(mm) - 1]}</span>
        {m.state === 'LOCKED' && <Lock className="w-3.5 h-3.5" />}
        {m.state === 'READY' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
      </div>
      <p className={`mt-1 text-[11px] ${s.text}`}>{s.label}</p>
      {m.state !== 'EMPTY' && (
        <p className={`mt-1.5 font-mono tabular-nums text-[11px] ${m.state === 'LOCKED' ? 'text-white/80 dark:text-stone-700' : 'text-stone-600 dark:text-stone-300'}`}>
          {m.pending > 0 && <span className="block" title={`${m.pending} pendente(s)`}>{m.pending} pend.</span>}
          {m.auto > 0 && <span className="block" title={`${m.auto} aguardando aprovação`}>{m.auto} aprov.</span>}
          {m.pending === 0 && m.auto === 0 && <span className="block" title={`${m.total} lançamento(s)`}>{m.total} lanç.</span>}
        </p>
      )}
    </div>
  );
  return m.state === 'EMPTY' ? (
    <div title="Sem lançamentos neste mês: pode faltar o extrato">{inner}</div>
  ) : (
    <Link href={`/?mes=${m.month}`} aria-label={`${formatMonth(m.month)}: ${s.label}`}>
      {inner}
    </Link>
  );
}

export default function PainelPage() {
  const { currentClient, isLoading: clientsLoading } = useClient();
  const clientId = currentClient?.id;
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    const repo = getRepository();
    Promise.all([
      repo.listAccounts(clientId),
      repo.listTransactions(clientId),
      repo.listImportBatches(clientId),
      repo.listBankAccounts(clientId),
      repo.listPeriodLocks(clientId),
      repo.listClientRequests(clientId),
      repo.getOrgSettings(),
      repo.getOpeningBalances(clientId),
    ])
      .then(([accounts, transactions, batches, banks, locks, requests, org, openings]) => {
        if (!active) return;
        setData({ id: clientId, accounts, transactions, batches, banks, locks, requests, org, openings, today: new Date().toISOString().slice(0, 10), nowMs: Date.now() });
        setError(null);
      })
      .catch((e: unknown) => active && setError(describe(e)));
    return () => {
      active = false;
    };
  }, [clientId]);

  const ready = data?.id === clientId ? data : null;
  const dash = useMemo(
    () => (ready && currentClient ? buildDashboard({ client: currentClient, ...ready }) : null),
    [ready, currentClient]
  );

  const years = useMemo(() => {
    const map = new Map<string, MonthStatus[]>();
    for (const m of dash?.months ?? []) map.set(m.month.slice(0, 4), [...(map.get(m.month.slice(0, 4)) ?? []), m]);
    return [...map].sort(([a], [b]) => b.localeCompare(a));
  }, [dash]);

  if (!clientsLoading && !currentClient) {
    return (
      <main className={PAGE}>
        <PageHeader title="Painel" />
        <section className={`${SURFACE} rounded-[22px]`}>
          <EmptyState title="Nenhuma empresa cadastrada" description="Cadastre a primeira empresa para acompanhar pendências, meses e extratos." action={<Link href="/clientes" className="text-[#0071E3] text-[14px] font-medium">Cadastrar empresa</Link>} />
        </section>
      </main>
    );
  }

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Painel"
        description="O que precisa de atenção nesta empresa: classificação, meses, extratos, perguntas ao cliente e cadastros."
      />
      {error && <p role="alert" className="text-[13px] text-rose-600">Não foi possível carregar o painel: {error}</p>}
      {!dash ? (
        !error && <p className="py-16 text-center text-[13px] text-stone-400">Carregando…</p>
      ) : (
        <>
          <section aria-label="Resumo" className="rounded-[22px] overflow-hidden grid grid-cols-2 lg:grid-cols-4 gap-px bg-black/[0.05] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
            <Tile
              label="Pendentes de classificação"
              value={String(dash.totals.pending)}
              tone={dash.totals.pending > 0 ? 'alert' : 'good'}
              caption={dash.totals.auto > 0 ? `+ ${dash.totals.auto} aguardando aprovação` : `${dash.totals.reconciled} conciliados`}
              href={dash.alerts.find((a) => a.id === 'pending')?.href ?? '/'}
            />
            <Tile label="Meses fechados" value={`${dash.totals.monthsLocked}/${dash.totals.monthsWithData}`} caption={dash.totals.monthsReady > 0 ? `${dash.totals.monthsReady} pronto(s) para fechar` : `${dash.totals.monthsOpen} em aberto`} />
            <Tile
              label="Perguntas ao cliente"
              value={String(dash.queries.notSent + dash.queries.waiting + dash.queries.answered)}
              tone={dash.queries.answered > 0 ? 'alert' : 'neutral'}
              caption={`${dash.queries.answered} respondida(s) · ${dash.queries.waiting} aguardando · ${dash.queries.notSent} sem link`}
              href="/pendencias"
            />
            <Tile
              label="Extratos"
              value={String(dash.accounts.length)}
              tone={dash.accounts.some((a) => a.gaps.length || a.mismatches.length) ? 'alert' : 'neutral'}
              caption={`${dash.accounts.reduce((s, a) => s + a.gaps.length, 0)} lacuna(s) · ${dash.accounts.reduce((s, a) => s + a.mismatches.length, 0)} divergência(s)`}
              href="/contas"
            />
          </section>

          {/* Atenção */}
          <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-black/[0.04] dark:border-white/[0.06]">
              {dash.allClear ? <ShieldCheck className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-amber-600" />}
              <h2 className="text-[15px] font-semibold tracking-tight">{dash.allClear ? 'Tudo em dia' : 'Precisa de atenção'}</h2>
              <span className="text-[12px] text-stone-500">{dash.alerts.length > 0 && `${dash.alerts.length} item(ns)`}</span>
            </div>
            {dash.alerts.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-stone-500">Nada pendente: os lançamentos estão classificados, os extratos conferem e os cadastros estão completos.</p>
            ) : (
              <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
                {dash.alerts.map((a) => (
                  <li key={a.id}>
                    <Link href={a.href} className="flex items-center gap-3 px-5 py-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${SEVERITY_STYLE[a.severity].dot}`} title={SEVERITY_STYLE[a.severity].label} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14px] font-medium tracking-tight text-stone-900 dark:text-stone-100">{a.title}</span>
                        {a.detail && <span className="block text-[12px] text-stone-500">{a.detail}</span>}
                      </span>
                      <ArrowRight className="w-4 h-4 shrink-0 text-stone-300" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Meses */}
          <section className={`${SURFACE} rounded-[22px] p-5 space-y-4`}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <h2 className="text-[15px] font-semibold tracking-tight">Meses</h2>
              <p className="text-[12px] text-stone-500 flex flex-wrap gap-x-3">
                {(['OPEN', 'READY', 'LOCKED', 'EMPTY'] as MonthState[]).map((s) => (
                  <span key={s}>{STATE_STYLE[s].label}</span>
                ))}
              </p>
            </div>
            {years.length === 0 ? (
              <p className="text-[13px] text-stone-500">Nenhum lançamento importado ainda.</p>
            ) : (
              years.map(([year, list]) => (
                <div key={year} className="space-y-2">
                  <p className="text-[12px] font-medium text-stone-500">{year}</p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-12 gap-2">
                    {list.map((m) => (
                      <MonthCard key={m.month} m={m} />
                    ))}
                  </div>
                </div>
              ))
            )}
          </section>

          {/* Extratos */}
          <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            <div className="flex items-center px-5 py-3.5 border-b border-black/[0.04] dark:border-white/[0.06]">
              <h2 className="flex-1 text-[15px] font-semibold tracking-tight">Extratos por conta</h2>
              <Link href="/contas" className="text-[12px] text-[#0071E3] hover:underline">Contas e extratos</Link>
            </div>
            {dash.accounts.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-stone-500">Nenhum extrato importado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-stone-400 border-b border-black/[0.04]">
                      <th className="font-medium pl-5 pr-3 py-2.5">Conta</th>
                      <th className="font-medium px-3 py-2.5">Último extrato até</th>
                      <th className="font-medium px-3 py-2.5 text-right">Último saldo</th>
                      <th className="font-medium pl-3 pr-5 py-2.5">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dash.accounts.map((a) => {
                      const lastBatch = ready!.batches.filter((b) => b.accountKey === a.accountKey).sort((x, y) => (y.endDate ?? '').localeCompare(x.endDate ?? ''))[0];
                      return (
                        <tr key={a.accountKey} className="border-b border-black/[0.04] last:border-0 text-[13px] align-top">
                          <td className="pl-5 pr-3 py-3">
                            <p className="font-medium">{a.nickname}</p>
                            <p className="font-mono text-[11px] text-stone-400">{a.accountKey}</p>
                          </td>
                          <td className="px-3 py-3 font-mono tabular-nums text-[12px]">{a.lastEnd ? formatDateBR(a.lastEnd) : '—'}</td>
                          <td className="px-3 py-3 text-right font-mono tabular-nums">{a.lastLedgerBalance !== undefined ? formatCurrency(a.lastLedgerBalance) : '—'}</td>
                          <td className="pl-3 pr-5 py-3 space-y-1">
                            <BalanceCheckBadge check={lastBatch?.balanceCheck} />
                            {a.mismatches.length > 0 && <p className="text-[11px] text-rose-700">{a.mismatches.length} divergência(s) de saldo</p>}
                            {a.gaps.map((g) => (
                              <p key={g.from} className="text-[11px] text-rose-700">Faltam extratos de {formatDateBR(g.from)} a {formatDateBR(g.to)}</p>
                            ))}
                            {a.missingSince && a.gaps.length === 0 && <p className="text-[11px] text-amber-700">Desatualizado desde {formatDateBR(a.missingSince)}</p>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {dash.queries.answered + dash.queries.waiting + dash.queries.notSent > 0 && (
            <p className="text-[12px] text-stone-500 flex items-center gap-1.5">
              <MessageCircleQuestion className="w-3.5 h-3.5" /> Perguntas ao cliente em aberto: veja em{' '}
              <Link href="/pendencias" className="text-[#0071E3] hover:underline">Pendências do cliente</Link>.
            </p>
          )}
        </>
      )}
    </main>
  );
}
