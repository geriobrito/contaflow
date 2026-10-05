'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { AuditAction, AuditEntry } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { useClient } from '@/contexts/ClientContext';
import { AUDIT_LABEL } from '@/lib/audit';
import { AuditTimeline } from '@/components/conciliacao/AuditTimeline';
import { PAGE, PageHeader, SearchField, SegmentedControl, SURFACE } from '@/components/ui/primitives';

type Filter = 'ALL' | 'MANUAL' | 'AUTO' | 'PERIOD';

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'Tudo' },
  { value: 'MANUAL', label: 'Classificações' },
  { value: 'AUTO', label: 'Automáticas' },
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
  OPENING_SAVE: 'PERIOD',
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

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (loadedFor === clientId ? (entries ?? []) : []).filter(
      (e) =>
        (filter === 'ALL' || GROUP[e.action] === filter) &&
        (!term ||
          [e.transactionMemo, e.actorEmail, e.note, AUDIT_LABEL[e.action], e.before?.accountName, e.after?.accountName]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(term)))
    );
  }, [entries, loadedFor, clientId, filter, search]);

  const loading = Boolean(clientId) && loadedFor !== clientId && !error;

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.name}
        title="Auditoria"
        description={`Registro imutável das alterações de classificação e dos fechamentos de competência (últimos ${LIMIT}).`}
      />
      <div className="flex flex-col md:flex-row gap-3 md:items-center">
        <SegmentedControl ariaLabel="Filtrar ações" value={filter} onChange={setFilter} options={FILTERS} />
        <SearchField value={search} onChange={setSearch} placeholder="Buscar por histórico, usuário, conta ou motivo" className="flex-1" />
      </div>
      {error && <p role="alert" className="text-[13px] text-rose-600">Não foi possível carregar a auditoria: {error}</p>}
      <section className={`${SURFACE} rounded-[22px] p-5 sm:p-6`}>
        {loading ? (
          <p className="py-8 text-center text-[13px] text-stone-400">Carregando…</p>
        ) : (
          <AuditTimeline entries={visible} showTransaction emptyText="Nenhum registro encontrado." />
        )}
      </section>
    </main>
  );
}
