'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AuditAction, AuditEntry } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { useClient } from '@/contexts/ClientContext';
import { AUDIT_LABEL } from '@/lib/audit';
import { AuditTimeline } from '@/components/conciliacao/AuditTimeline';
import { PAGE, PageHeader, SearchField, SegmentedControl, SURFACE } from '@/components/ui/primitives';
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

const LIMIT = 300;

/** Trilha de auditoria do cliente ativo: quem classificou, reclassificou, desfez, fechou ou reabriu, e quando. */
export default function AuditoriaPage() {
  const { currentClient } = useClient();
  const clientId = currentClient?.id;
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    getRepository()
      .listAudit(clientId, { limit: LIMIT })
      .then((list) => {
        if (!active) return;
        setEntries(list);
        setLoadedFor(clientId);
        setError(null);
      })
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : 'Falha ao carregar a auditoria.'));
    return () => {
      active = false;
    };
  }, [clientId]);

  // A busca vale para todos os filtros: a contagem de cada um já a considera.
  const searched = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (loadedFor === clientId ? (entries ?? []) : []).filter(
      (e) =>
        !term ||
        [e.transactionMemo, e.actorEmail, e.note, AUDIT_LABEL[e.action], e.before?.accountName, e.after?.accountName, e.month]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(term))
    );
  }, [entries, loadedFor, clientId, search]);

  const counts = useMemo(() => {
    const by: Record<Filter, number> = { ALL: searched.length, MANUAL: 0, AUTO: 0, JOURNAL: 0, SETUP: 0, PERIOD: 0 };
    for (const e of searched) by[GROUP[e.action]]++;
    return by;
  }, [searched]);

  const visible = useMemo(() => (filter === 'ALL' ? searched : searched.filter((e) => GROUP[e.action] === filter)), [searched, filter]);
  const truncated = loadedFor === clientId && (entries?.length ?? 0) >= LIMIT;

  const loading = Boolean(clientId) && loadedFor !== clientId && !error;

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.name}
        title="Auditoria"
        description={`Registro imutável das alterações de classificação e dos fechamentos de competência (últimos ${LIMIT}).`}
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
      {error && <p role="alert" className="text-[13px] text-rose-600 dark:text-rose-300">Não foi possível carregar a auditoria: {error}</p>}
      <section className={`${SURFACE} rounded-[22px] p-6`}>
        {loading ? (
          <TableSkeleton rows={6} dense label="Carregando auditoria…" />
        ) : (
          <AuditTimeline entries={visible} showTransaction emptyText="Nenhum registro encontrado." />
        )}
      </section>
      {truncated && !loading && (
        <p className="text-[12px] text-stone-500 dark:text-stone-400">
          Mostrando os {LIMIT} registros mais recentes: as contagens e a busca valem para eles. Registros mais antigos continuam guardados.
        </p>
      )}
    </main>
  );
}
