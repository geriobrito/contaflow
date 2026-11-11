'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowRight, CalendarCheck, CalendarRange, CheckCircle2, Landmark, ListChecks, Lock, MessageCircleQuestion, ShieldCheck } from 'lucide-react';
import type { BankAccount, BankTransaction, ChartAccount, ClientRequest, ImportBatch, JournalEntry, MonthCounts, OpeningBalances, OrgSettings, PeriodLock } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { isFirebaseConfigured } from '@/lib/firebase-config';
import { loadLedgerWindow } from '@/lib/services/ledger-loader';
import { useClient } from '@/contexts/ClientContext';
import { buildDashboard, type Alert, type MonthState, type MonthStatus } from '@/lib/dashboard';
import { formatMonth } from '@/lib/periods';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BalanceCheckBadge } from '@/components/conciliacao/StatementPanel';
import { CardHeader, EmptyState, PAGE, PageHeader, SegmentedControl, StatCard, SURFACE } from '@/components/ui/primitives';
import { CardsSkeleton, TableSkeleton } from '@/components/ui/Skeleton';
import { PortfolioView } from '@/components/painel/PortfolioView';
import { ReadQuotaMeter } from '@/components/painel/ReadQuotaMeter';
import { ExecutiveDashboard } from '@/components/painel/ExecutiveDashboard';
import { buildExecutiveSummary, type ExecutiveSummary } from '@/lib/executive-metrics';
import { usePortfolio } from '@/hooks/painel/usePortfolio';

const describe = (e: unknown) => (e instanceof Error && e.message ? e.message : 'erro desconhecido');

/** Aba do Painel: a carteira inteira (ponto de partida do dia), operacional da empresa ou visão executiva para o cliente. */
type PanelView = 'carteira' | 'empresa' | 'gerencial';
const VIEW_KEY = 'contaflow_painel_view';
const VIEWS: readonly { value: PanelView; label: string }[] = [
  { value: 'carteira', label: 'Carteira' },
  { value: 'empresa', label: 'Empresa atual' },
  { value: 'gerencial', label: 'Visão Executiva' },
];
const SINGLE_VIEWS: readonly { value: PanelView; label: string }[] = [
  { value: 'empresa', label: 'Operacional' },
  { value: 'gerencial', label: 'Visão Executiva' },
];

function readView(): PanelView | null {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'carteira' || v === 'empresa' || v === 'gerencial' ? v : null;
  } catch {
    return null;
  }
}
const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

interface Loaded {
  id: string;
  accounts: ChartAccount[];
  /** Lançamentos do período aberto; os meses fechados chegam consolidados em `carriedMonths`. */
  transactions: BankTransaction[];
  carriedMonths: MonthCounts[];
  openQueries: BankTransaction[];
  batches: ImportBatch[];
  banks: BankAccount[];
  locks: PeriodLock[];
  requests: ClientRequest[];
  org: OrgSettings | null;
  openings: OpeningBalances | null;
  /** Só no balanço de abertura com contrapartida (lembrete de zerar a 2.3.3.04). */
  journalEntries?: JournalEntry[];
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
  READY: { box: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200/70 dark:border-emerald-500/25', text: 'text-emerald-700 dark:text-emerald-400', label: 'Pronto p/ fechar' },
  OPEN: { box: 'bg-amber-50 dark:bg-amber-950/20 border-amber-200/70 dark:border-amber-500/25', text: 'text-amber-700 dark:text-amber-400', label: 'Em aberto' },
  EMPTY: { box: 'bg-black/3 dark:bg-white/4 border-dashed border-black/10', text: 'text-stone-400', label: 'Sem movimento' },
};

function MonthCard({ m }: { m: MonthStatus }) {
  const s = STATE_STYLE[m.state];
  const [, mm] = m.month.split('-');
  const inner = (
    <div className={`rounded-2xl border px-3.5 py-3 h-full transition-all duration-150 hover:shadow-[0_4px_14px_rgba(0,0,0,0.08)] ${s.box}`}>
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-semibold tracking-tight capitalize">{MONTH_SHORT[Number(mm) - 1]}</span>
        {m.state === 'LOCKED' && <Lock className="w-3.5 h-3.5" />}
        {m.state === 'READY' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-300" />}
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
  const router = useRouter();
  const { clients, currentClient, selectClient, isLoading: clientsLoading } = useClient();
  const clientId = currentClient?.id;
  const [data, setData] = useState<Loaded | null>(null);
  const [execData, setExecData] = useState<{ id: string; summary: ExecutiveSummary } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Com uma empresa só, a carteira é ela mesma: vai direto ao detalhe operacional ou executivo.
  const [chosenView, setChosenView] = useState<PanelView | null>(readView);
  const multiple = clients.filter((c) => !c.deletingAt).length > 1;
  const view: PanelView = multiple ? (chosenView ?? 'carteira') : chosenView === 'gerencial' ? 'gerencial' : 'empresa';
  const chooseView = (v: PanelView) => {
    setChosenView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* armazenamento indisponível */
    }
  };
  const portfolio = usePortfolio(clients, view === 'carteira');

  useEffect(() => {
    // O detalhe (razão do período aberto) só é lido na aba da empresa.
    if (!clientId || view !== 'empresa') return;
    let active = true;
    const repo = getRepository();
    Promise.all([
      repo.listAccounts(clientId),
      repo.listImportBatches(clientId),
      repo.listBankAccounts(clientId),
      repo.listPeriodLocks(clientId),
      repo.listClientRequests(clientId),
      repo.getOrgSettings(),
      repo.getOpeningBalances(clientId),
      repo.listOpenQueries(clientId),
    ])
      .then(async ([accounts, batches, banks, locks, requests, org, openings, openQueries]) => {
        // Meses fechados entram pelas contagens consolidadas; só o período aberto é lido lançamento a lançamento.
        // Lançamentos manuais só no balanço de abertura com contrapartida: lembrete de zerar a 2.3.3.04.
        const [ledger, journalEntries] = await Promise.all([
          loadLedgerWindow({ clientId, accounts, banks, locks }),
          openings?.mode === 'OPENING_BALANCE' ? repo.listJournalEntries(clientId) : Promise.resolve(undefined),
        ]);
        if (!active) return;
        setData({
          id: clientId,
          accounts,
          transactions: ledger.transactions,
          carriedMonths: ledger.carriedMonths,
          openQueries,
          batches,
          banks,
          locks,
          requests,
          org,
          openings,
          journalEntries,
          today: new Date().toISOString().slice(0, 10),
          nowMs: Date.now(),
        });
        setError(null);
      })
      .catch((e: unknown) => active && setError(describe(e)));
    return () => {
      active = false;
    };
  }, [clientId, view]);

  useEffect(() => {
    if (!clientId || view !== 'gerencial') return;
    let active = true;
    const repo = getRepository();
    Promise.all([repo.listAccounts(clientId), repo.listTransactions(clientId), repo.listJournalEntries(clientId)])
      .then(([accounts, transactions, journalEntries]) => {
        if (!active) return;
        const summary = buildExecutiveSummary({ transactions, accounts, journalEntries });
        setExecData({ id: clientId, summary });
        setError(null);
      })
      .catch((e: unknown) => active && setError(describe(e)));
    return () => {
      active = false;
    };
  }, [clientId, view]);

  const ready = data?.id === clientId ? data : null;
  const readyExec = execData && execData.id === clientId ? execData.summary : null;
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
          <EmptyState title="Nenhuma empresa cadastrada" description="Cadastre a primeira empresa para acompanhar pendências, meses e extratos." action={<Link href="/clientes" className="text-accent-ink text-[14px] font-medium">Cadastrar empresa</Link>} />
        </section>
      </main>
    );
  }

  const viewSwitch = (
    <SegmentedControl
      ariaLabel="Visão do painel"
      value={view}
      onChange={chooseView}
      options={multiple ? VIEWS : SINGLE_VIEWS}
    />
  );
  // Só o Firestore tem cota diária; no modo local não há o que medir.
  const readMeter = isFirebaseConfigured() ? <ReadQuotaMeter /> : null;

  if (view === 'carteira') {
    return (
      <main className={PAGE}>
        <PageHeader title="Painel" description="Ponto de partida do dia: o que falta fazer em cada empresa da carteira." actions={viewSwitch} />
        {readMeter}
        <PortfolioView
          clients={clients}
          entries={portfolio.entries}
          currentClientId={clientId ?? null}
          onOpenClient={(c) => {
            selectClient(c);
            chooseView('empresa');
            window.scrollTo({ top: 0 });
          }}
          onTask={(c, href) => {
            selectClient(c);
            router.push(href);
          }}
          onRefresh={portfolio.refresh}
        />
      </main>
    );
  }

  if (view === 'gerencial') {
    return (
      <main className={PAGE}>
        <PageHeader
          eyebrow={currentClient?.tradeName || currentClient?.name}
          title="Painel Gerencial Executivo"
          description="Análise gráfica de faturamento, rentabilidade, EBITDA e composição de gastos dos últimos 12 meses."
          actions={viewSwitch}
        />
        {readMeter}
        {error && <p role="alert" className="text-[13px] text-rose-600 dark:text-rose-300">Não foi possível carregar o painel executivo: {error}</p>}
        {!readyExec || !currentClient ? (
          !error && (
            <>
              <CardsSkeleton count={4} className="grid grid-cols-4 gap-3" cardClassName="h-[92px] rounded-[18px]" label="Carregando visão executiva…" />
              <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
                <TableSkeleton rows={5} />
              </section>
            </>
          )
        ) : (
          <ExecutiveDashboard client={currentClient} summary={readyExec} />
        )}
      </main>
    );
  }

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Painel"
        description="O que precisa de atenção nesta empresa: classificação, meses, extratos, perguntas ao cliente e cadastros."
        actions={viewSwitch}
      />
      {readMeter}
      {error &&<p role="alert" className="text-[13px] text-rose-600 dark:text-rose-300">Não foi possível carregar o painel: {error}</p>}
      {!dash ? (
        !error && (
          <>
            <CardsSkeleton count={4} className="grid grid-cols-4 gap-3" cardClassName="h-[92px] rounded-[18px]" label="Carregando painel…" />
            <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
              <TableSkeleton rows={4} />
            </section>
          </>
        )
      ) : (
        <>
          <section aria-label="Resumo" className="grid grid-cols-4 gap-3">
            <StatCard
              icon={ListChecks}
              label="Pendentes de classificação"
              value={String(dash.totals.pending)}
              tone={dash.totals.pending > 0 ? 'alert' : 'good'}
              caption={dash.totals.auto > 0 ? `+ ${dash.totals.auto} aguardando aprovação` : `${dash.totals.reconciled} conciliados`}
              href={dash.alerts.find((a) => a.id === 'pending')?.href ?? '/'}
            />
            <StatCard icon={CalendarCheck} label="Meses fechados" value={`${dash.totals.monthsLocked}/${dash.totals.monthsWithData}`} caption={dash.totals.monthsReady > 0 ? `${dash.totals.monthsReady} pronto(s) para fechar` : `${dash.totals.monthsOpen} em aberto`} />
            <StatCard
              icon={MessageCircleQuestion}
              label="Perguntas ao cliente"
              value={String(dash.queries.notSent + dash.queries.waiting + dash.queries.answered)}
              tone={dash.queries.answered > 0 ? 'alert' : 'neutral'}
              caption={`${dash.queries.answered} respondida(s) · ${dash.queries.waiting} aguardando · ${dash.queries.notSent} sem link`}
              href="/pendencias"
            />
            <StatCard
              icon={Landmark}
              label="Extratos"
              value={String(dash.accounts.length)}
              tone={dash.accounts.some((a) => a.gaps.length || a.mismatches.length) ? 'alert' : 'neutral'}
              caption={`${dash.accounts.reduce((s, a) => s + a.gaps.length, 0)} lacuna(s) · ${dash.accounts.reduce((s, a) => s + a.mismatches.length, 0)} divergência(s)`}
              href="/contas"
            />
          </section>

          {/* Atenção */}
          <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            <CardHeader
              icon={dash.allClear ? ShieldCheck : AlertTriangle}
              iconClassName={dash.allClear ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}
              title={dash.allClear ? 'Tudo em dia' : 'Precisa de atenção'}
              meta={dash.alerts.length > 0 ? `${dash.alerts.length} item(ns)` : undefined}
            />
            {dash.alerts.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-stone-500">Nada pendente: os lançamentos estão classificados, os extratos conferem e os cadastros estão completos.</p>
            ) : (
              <ul className="divide-y divide-black/4 dark:divide-white/5">
                {dash.alerts.map((a) => (
                  <li key={a.id}>
                    <Link href={a.href} className="flex items-center gap-3 px-5 py-3 hover:bg-black/2 dark:hover:bg-white/3 transition-colors">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${SEVERITY_STYLE[a.severity].dot}`} title={SEVERITY_STYLE[a.severity].label} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14px] font-medium tracking-tight text-stone-900 dark:text-stone-100">{a.title}</span>
                        {a.detail && <span className="block text-[12px] text-stone-500">{a.detail}</span>}
                      </span>
                      <ArrowRight className="w-4 h-4 shrink-0 text-stone-300 dark:text-stone-600" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Meses */}
          <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            <CardHeader
              icon={CalendarRange}
              title="Meses"
              meta={
                <span className="flex flex-wrap gap-x-3">
                  {(['OPEN', 'READY', 'LOCKED', 'EMPTY'] as MonthState[]).map((s) => (
                    <span key={s}>{STATE_STYLE[s].label}</span>
                  ))}
                </span>
              }
            />
            <div className="p-5 space-y-4">
            {years.length === 0 ? (
              <p className="text-[13px] text-stone-500">Nenhum lançamento importado ainda.</p>
            ) : (
              years.map(([year, list]) => (
                <div key={year} className="space-y-2">
                  <p className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-stone-500">{year}<span aria-hidden className="flex-1 border-t border-line" /></p>
                  <div className="grid grid-cols-6 xl:grid-cols-12 gap-2">
                    {list.map((m) => (
                      <MonthCard key={m.month} m={m} />
                    ))}
                  </div>
                </div>
              ))
            )}
            </div>
          </section>

          {/* Extratos */}
          <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            <CardHeader
              icon={Landmark}
              title="Extratos por conta"
              actions={<Link href="/contas" className="text-[12px] font-medium text-accent-ink hover:underline">Contas e extratos</Link>}
            />
            {dash.accounts.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-stone-500">Nenhum extrato importado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[10.5px] uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400 bg-surface-2 border-b border-line">
                      <th className="font-semibold pl-5 pr-3 py-2.5">Conta</th>
                      <th className="font-semibold px-3 py-2.5">Último extrato até</th>
                      <th className="font-semibold px-3 py-2.5 text-right">Último saldo</th>
                      <th className="font-semibold pl-3 pr-5 py-2.5">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dash.accounts.map((a) => {
                      const lastBatch = ready!.batches.filter((b) => b.accountKey === a.accountKey).sort((x, y) => (y.endDate ?? '').localeCompare(x.endDate ?? ''))[0];
                      return (
                        <tr key={a.accountKey} className="border-b border-black/4 last:border-0 text-[13px] align-top">
                          <td className="pl-5 pr-3 py-3">
                            <p className="font-medium">{a.nickname}</p>
                            <p className="font-mono text-[11px] text-stone-400">{a.accountKey}</p>
                          </td>
                          <td className="px-3 py-3 font-mono tabular-nums text-[12px]">{a.lastEnd ? formatDateBR(a.lastEnd) : '—'}</td>
                          <td className="px-3 py-3 text-right font-mono tabular-nums">{a.lastLedgerBalance !== undefined ? formatCurrency(a.lastLedgerBalance) : '—'}</td>
                          <td className="pl-3 pr-5 py-3 space-y-1">
                            <BalanceCheckBadge check={lastBatch?.balanceCheck} />
                            {a.mismatches.length > 0 && <p className="text-[11px] text-rose-700 dark:text-rose-300">{a.mismatches.length} divergência(s) de saldo</p>}
                            {a.gaps.map((g) => (
                              <p key={g.from} className="text-[11px] text-rose-700 dark:text-rose-300">Faltam extratos de {formatDateBR(g.from)} a {formatDateBR(g.to)}</p>
                            ))}
                            {a.missingSince && a.gaps.length === 0 && <p className="text-[11px] text-amber-700 dark:text-amber-300">Desatualizado desde {formatDateBR(a.missingSince)}</p>}
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
              <Link href="/pendencias" className="text-accent-ink hover:underline">Pendências do cliente</Link>.
            </p>
          )}
        </>
      )}
    </main>
  );
}
