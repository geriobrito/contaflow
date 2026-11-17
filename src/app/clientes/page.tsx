'use client';

import { useMemo, useState } from 'react';
import { LayoutGrid, List, Plus, Upload } from 'lucide-react';
import type { ClientCompany, TaxRegime } from '@/types/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { SetupProgress } from '@/components/layout/SetupProgress';
import { filterClients } from '@/lib/client-record';
import { blockingIssues, clientIssues, duplicateCnpjs, sortClients, type ClientFormTab, type ClientIssue, type ClientSort } from '@/lib/client-health';
import { todayISO } from '@/lib/business-days';
import { getRepository } from '@/lib/services/data-service';
import { useClientMaintenance, type MaintenanceResult } from '@/hooks/clientes/useClientMaintenance';
import { useClientsView } from '@/hooks/clientes/useClientsView';
import { ClientCard } from '@/components/clientes/ClientCard';
import { ClientList } from '@/components/clientes/ClientList';
import { ClientSheet } from '@/components/clientes/ClientSheet';
import { DeleteClientSheet } from '@/components/clientes/DeleteClientSheet';
import { RestoreClientSheet } from '@/components/clientes/RestoreClientSheet';
import { REGIMES } from '@/components/clientes/options';
import { BUTTON, EmptyState, INPUT_COMPACT, PAGE, PageHeader, SearchField, SegmentedControl } from '@/components/ui/primitives';
import { CardsSkeleton } from '@/components/ui/Skeleton';
import { Toast, useToast } from '@/components/ui/Toast';

const GRID = 'grid grid-cols-1 @2xl:grid-cols-2 @5xl:grid-cols-3 @7xl:grid-cols-4 gap-6';

/** Recorte pelo estado do cadastro: com pendência que afeta documentos ou a rotina, ou sem. */
type HealthFilter = 'all' | 'issues' | 'ok';

const SORTS: readonly { value: ClientSort; label: string }[] = [
  { value: 'name', label: 'Nome' },
  { value: 'issues', label: 'Mais pendências' },
  { value: 'since', label: 'Cliente há mais tempo' },
  { value: 'recent', label: 'Alterado por último' },
];

const NO_ISSUES: readonly ClientIssue[] = [];

export default function ClientesPage() {
  const { user } = useAuth();
  const { clients, currentClient, selectClient, refreshClients, removeClient, isLoading } = useClient();
  const { backingUpId, deletingId, restoring, exportBackup, restoreBackup, deleteClient } = useClientMaintenance(removeClient);
  const [confirmDelete, setConfirmDelete] = useState<ClientCompany | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [health, setHealth] = useState<HealthFilter>('all');
  const [regime, setRegime] = useState<TaxRegime | 'all'>('all');
  const [sort, setSort] = useState<ClientSort>('name');
  const [view, setView] = useClientsView();
  const [editing, setEditing] = useState<ClientCompany | null>(null);
  const [editTab, setEditTab] = useState<ClientFormTab>('cadastro');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, flash] = useToast(3500);

  const actor = useMemo(
    () => ({ uid: user?.uid || 'local', ...(user?.email ? { email: user.email } : {}) }),
    [user]
  );
  const repoMode = useMemo(() => {
    try {
      return getRepository().mode;
    } catch {
      return 'local' as const;
    }
  }, []);

  const today = todayISO();
  /** Pendências do cadastro de cada empresa (só do que já está em memória). */
  const issuesById = useMemo(() => {
    const duplicates = duplicateCnpjs(clients);
    return new Map(clients.map((c) => [c.id, clientIssues(c, { today, duplicates })] as const));
  }, [clients, today]);
  const issuesOf = (c: ClientCompany) => issuesById.get(c.id) ?? NO_ISSUES;
  const hasBlocking = (c: ClientCompany) => blockingIssues(issuesById.get(c.id) ?? NO_ISSUES).length > 0;

  const usable = useMemo(() => clients.filter((c) => !c.deletingAt), [clients]);
  const withIssues = usable.filter(hasBlocking).length;
  const regimesInUse = REGIMES.filter((r) => usable.some((c) => c.regime === r.value));
  // O regime escolhido pode sair da carteira (edição, exclusão): o filtro volta a "todos".
  const regimeFilter = regime !== 'all' && regimesInUse.some((r) => r.value === regime) ? regime : 'all';

  const visible = useMemo(() => {
    const found = filterClients(clients, search).filter((c) => {
      // Exclusão incompleta aparece sempre: precisa ser retomada.
      if (c.deletingAt) return true;
      if (regimeFilter !== 'all' && c.regime !== regimeFilter) return false;
      const blocking = blockingIssues(issuesById.get(c.id) ?? NO_ISSUES).length > 0;
      return health === 'all' || (health === 'issues') === blocking;
    });
    return sortClients(found, sort, (c) => issuesById.get(c.id) ?? NO_ISSUES);
  }, [clients, search, regimeFilter, health, sort, issuesById]);

  const filtering = Boolean(search.trim()) || health !== 'all' || regimeFilter !== 'all';
  const clearFilters = () => {
    setSearch('');
    setHealth('all');
    setRegime('all');
  };

  const openNew = () => {
    setEditing(null);
    setEditTab('cadastro');
    setSheetOpen(true);
  };

  const openEdit = (client: ClientCompany, tab: ClientFormTab = 'cadastro') => {
    setEditing(client);
    setEditTab(tab);
    setSheetOpen(true);
  };

  const activate = (client: ClientCompany) => {
    selectClient(client);
    flash(`${client.tradeName || client.name} definido como ativo`);
  };

  const backup = async (client: ClientCompany): Promise<MaintenanceResult> => {
    const result = await exportBackup(client);
    flash(result.message);
    return result;
  };

  const handleDelete = async (client: ClientCompany) => {
    setConfirmDelete(null);
    flash((await deleteClient(client)).message);
  };

  const handleSaved = async (client: ClientCompany) => {
    const isNew = !editing;
    setSheetOpen(false);
    setEditing(null);
    await refreshClients();
    if (isNew) selectClient(client);
    flash(isNew ? 'Cliente cadastrado e definido como ativo' : 'Alterações salvas');
  };

  return (
    <main className={`${PAGE} @container`}>
      <PageHeader
        title="Clientes"
        description={
          <>
            <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{clients.length}</span> empresa(s) na carteira
            {withIssues > 0 && (
              <>
                , <span className="font-mono tabular-nums text-amber-800 dark:text-amber-300">{withIssues}</span> com pendência de cadastro
              </>
            )}
            . O cliente ativo define os dados exibidos em todo o sistema.
          </>
        }
        actions={
          <>
            <button type="button" onClick={() => setRestoreOpen(true)} className={BUTTON.secondary}>
              <Upload className="w-4 h-4" strokeWidth={2} />
              Restaurar backup
            </button>
            <button type="button" onClick={openNew} className={BUTTON.primary}>
              <Plus className="w-4 h-4" strokeWidth={2} />
              Novo cliente
            </button>
          </>
        }
      />
      <SetupProgress />

      <div className="space-y-3">
        <SearchField value={search} onChange={setSearch} placeholder="Buscar por razão social, nome fantasia ou CNPJ" />
        {usable.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <SegmentedControl
              ariaLabel="Estado do cadastro"
              value={health}
              onChange={setHealth}
              options={[
                { value: 'all', label: `Todas · ${usable.length}` },
                { value: 'issues', label: `Com pendência · ${withIssues}`, title: 'Cadastro com falta ou divergência que afeta as demonstrações, os livros ou a agenda' },
                { value: 'ok', label: `Em ordem · ${usable.length - withIssues}` },
              ]}
            />
            {regimesInUse.length > 1 && (
              <select aria-label="Regime tributário" value={regimeFilter} onChange={(e) => setRegime(e.target.value as TaxRegime | 'all')} className={INPUT_COMPACT}>
                <option value="all">Todos os regimes</option>
                {regimesInUse.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label} · {usable.filter((c) => c.regime === r.value).length}
                  </option>
                ))}
              </select>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
              <label className="flex items-center gap-2 text-[12px] text-stone-500 dark:text-stone-400">
                Ordenar por
                <select value={sort} onChange={(e) => setSort(e.target.value as ClientSort)} className={INPUT_COMPACT}>
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <SegmentedControl
                ariaLabel="Visão da carteira"
                value={view}
                onChange={setView}
                options={[
                  { value: 'cards', label: <LayoutGrid aria-label="Cartões" className="w-4 h-4" strokeWidth={1.9} />, title: 'Cartões' },
                  { value: 'list', label: <List aria-label="Lista" className="w-4 h-4" strokeWidth={1.9} />, title: 'Lista' },
                ]}
              />
            </div>
          </div>
        )}
      </div>

      {isLoading ? (
        <CardsSkeleton count={3} className={GRID} label="Carregando clientes…" />
      ) : visible.length === 0 ? (
        <div className="rounded-[22px] border border-dashed border-black/10 dark:border-white/12">
          <EmptyState
            title={clients.length === 0 ? 'Nenhum cliente cadastrado' : 'Nenhum cliente encontrado'}
            description={
              clients.length === 0
                ? 'Cadastre a primeira empresa para começar.'
                : search.trim()
                  ? `Nada corresponde a “${search}”${health !== 'all' || regimeFilter !== 'all' ? ' com os filtros escolhidos' : ''}.`
                  : 'Nenhuma empresa nos filtros escolhidos.'
            }
            action={
              clients.length === 0 ? (
                <button type="button" onClick={openNew} className={BUTTON.accent}>
                  <Plus className="w-4 h-4" />
                  Novo cliente
                </button>
              ) : filtering ? (
                <button type="button" onClick={clearFilters} className={BUTTON.secondary}>
                  Limpar filtros
                </button>
              ) : undefined
            }
          />
        </div>
      ) : view === 'list' ? (
        <ClientList
          clients={visible}
          activeId={currentClient?.id ?? null}
          issuesOf={issuesOf}
          deletingId={deletingId}
          backingUpId={backingUpId}
          onActivate={activate}
          onEdit={(c) => openEdit(c)}
          onIssue={(c, issue) => openEdit(c, issue.tab)}
          onBackup={(c) => void backup(c)}
          onAskDelete={setConfirmDelete}
          onDelete={(c) => void handleDelete(c)}
        />
      ) : (
        <div className={GRID}>
          {visible.map((c) => (
            <ClientCard
              key={c.id}
              client={c}
              active={c.id === currentClient?.id}
              issues={issuesOf(c)}
              onIssue={(issue) => openEdit(c, issue.tab)}
              onActivate={() => activate(c)}
              deleting={deletingId === c.id}
              backingUp={backingUpId === c.id}
              onBackup={() => void backup(c)}
              onAskDelete={() => setConfirmDelete(c)}
              onDelete={() => void handleDelete(c)}
              onEdit={() => openEdit(c)}
            />
          ))}
        </div>
      )}

      {sheetOpen && (
        <ClientSheet
          key={editing?.id ?? 'new'}
          client={editing}
          initialTab={editTab}
          onClose={() => {
            setSheetOpen(false);
            setEditing(null);
          }}
          onSaved={(c) => void handleSaved(c)}
        />
      )}

      {confirmDelete && (
        <DeleteClientSheet
          key={confirmDelete.id}
          client={confirmDelete}
          backingUp={backingUpId === confirmDelete.id}
          onBackup={() => backup(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => void handleDelete(confirmDelete)}
        />
      )}

      {restoreOpen && (
        <RestoreClientSheet
          repoMode={repoMode}
          restoring={restoring}
          onRestore={(b, opts) => restoreBackup(b, { ...opts, actor })}
          onClose={() => setRestoreOpen(false)}
          onRestored={async (client, message) => {
            setRestoreOpen(false);
            await refreshClients();
            selectClient(client);
            flash(message);
          }}
        />
      )}

      <Toast toast={toast} onDismiss={() => flash(null)} />
    </main>
  );
}
