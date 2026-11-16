'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuditAction, AuditEntry } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { useClient } from '@/contexts/ClientContext';
import { AUDIT_LABEL } from '@/lib/audit';
import { AuditTimeline, formatDateTime } from '@/components/conciliacao/AuditTimeline';
import { BUTTON, INPUT_COMPACT, PAGE, PageHeader, SearchField, SegmentedControl, SURFACE } from '@/components/ui/primitives';
import { describeError } from '@/lib/utils/errors';
import { reportError } from '@/lib/monitoring';
import { TableSkeleton } from '@/components/ui/Skeleton';

type Filter = 'ALL' | 'MANUAL' | 'AUTO' | 'JOURNAL' | 'SETUP' | 'PERIOD';

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'Tudo' },
  { value: 'MANUAL', label: 'Classificações' },
  { value: 'AUTO', label: 'Automáticas' },
  { value: 'JOURNAL', label: 'Lançamentos manuais' },
  { value: 'SETUP', label: 'Cadastros' },
  { value: 'PERIOD', label: 'Fechamentos e extratos' },
];

const GROUP: Record<AuditAction, Filter> = {
  CLASSIFY: 'MANUAL',
  RECLASSIFY: 'MANUAL',
  SPLIT: 'MANUAL',
  UNRECONCILE: 'MANUAL',
  APPROVE: 'MANUAL',
  AUTO_CLASSIFY: 'AUTO',
  PERIOD_CLOSE: 'PERIOD',
  PERIOD_REOPEN: 'PERIOD',
  TRANSFER: 'MANUAL',
  BATCH_DELETE: 'PERIOD',
  MEMO_REPAIR: 'PERIOD',
  OPENING_SAVE: 'SETUP',
  ACCOUNT_DELETE: 'SETUP',
  QUERY_ASK: 'MANUAL',
  QUERY_RESOLVE: 'MANUAL',
  JOURNAL_CREATE: 'JOURNAL',
  JOURNAL_UPDATE: 'JOURNAL',
  JOURNAL_DELETE: 'JOURNAL',
  YEAR_CLOSE: 'PERIOD',
  YEAR_REOPEN: 'PERIOD',
  ASSET_SAVE: 'SETUP',
  PREPAID_SAVE: 'SETUP',
  FINANCING_SAVE: 'SETUP',
  INVESTMENT_SAVE: 'SETUP',
  STOCK_SAVE: 'SETUP',
  PAYROLL_SAVE: 'SETUP',
  CLIENT_RESTORE: 'SETUP',
};

/** Registros por página: a primeira carga e cada "Carregar mais". */
const PAGE_SIZE = 300;

/** Início do dia (hora local) como instante ISO, para o intervalo de datas. */
const startOfDay = (date: string) => new Date(`${date}T00:00:00`).toISOString();
/** Início do dia seguinte: o limite (exclusivo) de um "até" que inclui o dia inteiro. */
const startOfNextDay = (date: string) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
};

/** Trilha de auditoria do cliente ativo: quem classificou, reclassificou, desfez, fechou ou reabriu, e quando. */
export default function AuditoriaPage() {
  const { currentClient } = useClient();
  const clientId = currentClient?.id;
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  /** Empresa e intervalo da lista carregada: trocar qualquer um recarrega do começo. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  /** Ainda há registros mais antigos do que os carregados (a última página veio cheia). */
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const validRange = !from || !until || from <= until;
  const key = `${clientId}|${from}|${until}`;

  useEffect(() => {
    if (!clientId || !validRange) return;
    let active = true;
    getRepository()
      .listAudit(clientId, { limit: PAGE_SIZE, ...(from ? { since: startOfDay(from) } : {}), ...(until ? { before: startOfNextDay(until) } : {}) })
      .then((list) => {
        if (!active) return;
        setEntries(list);
        setHasMore(list.length >= PAGE_SIZE);
        setLoadedFor(`${clientId}|${from}|${until}`);
        setError(null);
      })
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : 'Falha ao carregar a auditoria.'));
    return () => {
      active = false;
    };
  }, [clientId, from, until, validRange]);

  /** Página seguinte: os registros anteriores ao mais antigo já carregado, dentro do mesmo intervalo. */
  const loadMore = useCallback(async () => {
    const last = entries?.[entries.length - 1];
    if (!clientId || !last) return;
    setLoadingMore(true);
    try {
      const more = await getRepository().listAudit(clientId, { limit: PAGE_SIZE, before: last.at, ...(from ? { since: startOfDay(from) } : {}) });
      // O instante vem com precisão de milissegundo: o registro do limite pode voltar repetido.
      const known = new Set(entries.map((e) => e.id));
      const fresh = more.filter((e) => !known.has(e.id));
      setEntries([...entries, ...fresh]);
      setHasMore(more.length >= PAGE_SIZE && fresh.length > 0);
      setError(null);
    } catch (e) {
      reportError(e, { area: 'auditoria', op: 'carregar mais' });
      setError(describeError(e));
    } finally {
      setLoadingMore(false);
    }
  }, [clientId, entries, from]);

  // A busca vale para todos os filtros: a contagem de cada um já a considera.
  const searched = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (loadedFor === key ? (entries ?? []) : []).filter(
      (e) =>
        !term ||
        [e.transactionMemo, e.actorEmail, e.note, AUDIT_LABEL[e.action], e.before?.accountName, e.after?.accountName, e.month]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(term))
    );
  }, [entries, loadedFor, key, search]);

  const counts = useMemo(() => {
    const by: Record<Filter, number> = { ALL: searched.length, MANUAL: 0, AUTO: 0, JOURNAL: 0, SETUP: 0, PERIOD: 0 };
    for (const e of searched) by[GROUP[e.action]]++;
    return by;
  }, [searched]);

  const visible = useMemo(() => (filter === 'ALL' ? searched : searched.filter((e) => GROUP[e.action] === filter)), [searched, filter]);
  const loadedCount = loadedFor === key ? (entries?.length ?? 0) : 0;
  const oldest = loadedFor === key ? entries?.[entries.length - 1] : undefined;

  const loading = Boolean(clientId) && validRange && loadedFor !== key && !error;

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.name}
        title="Auditoria"
        description="Registro imutável de quem classificou, lançou, alterou cadastros, fechou ou reabriu competências, e quando. Do mais recente para o mais antigo."
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="max-w-full overflow-x-auto">
          <SegmentedControl
            ariaLabel="Filtrar ações"
            value={filter}
            onChange={setFilter}
            options={FILTERS.map((f) => ({ value: f.value, label: loading ? f.label : `${f.label} (${counts[f.value]})` }))}
          />
        </div>
        <SearchField value={search} onChange={setSearch} placeholder="Buscar por histórico, usuário, conta, motivo ou competência" className="flex-1 min-w-[240px]" />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-stone-500">
        <label className="flex items-center gap-2">
          De
          <input type="date" aria-label="Data inicial" value={from} max={until || undefined} onChange={(e) => setFrom(e.target.value)} className={`${INPUT_COMPACT} w-40 font-mono tabular-nums`} />
        </label>
        <label className="flex items-center gap-2">
          até
          <input type="date" aria-label="Data final" value={until} min={from || undefined} onChange={(e) => setUntil(e.target.value)} className={`${INPUT_COMPACT} w-40 font-mono tabular-nums`} />
        </label>
        {(from || until) && (
          <button
            type="button"
            onClick={() => {
              setFrom('');
              setUntil('');
            }}
            className="font-medium text-accent-ink hover:underline"
          >
            Limpar datas
          </button>
        )}
        {!validRange && <span role="alert" className="text-rose-600 dark:text-rose-300">A data inicial é posterior à final.</span>}
      </div>
      {error && <p role="alert" className="text-[13px] text-rose-600 dark:text-rose-300">Não foi possível carregar a auditoria: {error}</p>}
      <section className={`${SURFACE} rounded-[22px] p-6`}>
        {loading ? (
          <TableSkeleton rows={6} dense label="Carregando auditoria…" />
        ) : (
          <AuditTimeline entries={visible} showTransaction emptyText="Nenhum registro encontrado." />
        )}
      </section>
      {!loading && loadedCount > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-stone-500 dark:text-stone-400">
          <p role="status">
            {loadedCount} registro(s) carregado(s){oldest ? `, até ${formatDateTime(oldest.at)}` : ''}.{' '}
            {hasMore ? 'Há registros mais antigos: as contagens e a busca valem para os carregados.' : 'Não há registros mais antigos neste intervalo.'}
          </p>
          {hasMore && (
            <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className={`${BUTTON.secondary} h-8 text-[12px]`}>
              {loadingMore ? 'Carregando…' : `Carregar mais ${PAGE_SIZE}`}
            </button>
          )}
        </div>
      )}
    </main>
  );
}
