'use client';

import { useMemo, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import type { ClientCompany } from '@/types/firestore';
import { useClient } from '@/contexts/ClientContext';
import { filterClients } from '@/lib/client-record';
import { useClientMaintenance } from '@/hooks/clientes/useClientMaintenance';
import { ClientCard } from '@/components/clientes/ClientCard';
import { ClientSheet } from '@/components/clientes/ClientSheet';
import { DeleteClientSheet } from '@/components/clientes/DeleteClientSheet';
import { BUTTON, EmptyState, PAGE, PageHeader, SearchField } from '@/components/ui/primitives';
import { CardsSkeleton } from '@/components/ui/Skeleton';

const GRID = 'grid grid-cols-1 @2xl:grid-cols-2 @5xl:grid-cols-3 @7xl:grid-cols-4 gap-6';

export default function ClientesPage() {
  const { clients, currentClient, selectClient, refreshClients, removeClient, isLoading } = useClient();
  const { backingUpId, deletingId, exportBackup, deleteClient } = useClientMaintenance(removeClient);
  const [confirmDelete, setConfirmDelete] = useState<ClientCompany | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ClientCompany | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const visible = useMemo(() => filterClients(clients, search), [clients, search]);

  const openNew = () => {
    setEditing(null);
    setSheetOpen(true);
  };

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? null : t)), 2800);
  };

  const backup = async (client: ClientCompany): Promise<boolean> => {
    const result = await exportBackup(client);
    flash(result.message);
    return result.ok;
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
            <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{clients.length}</span> empresa(s) na carteira. O
            cliente ativo define os dados exibidos em todo o sistema.
          </>
        }
        actions={
          <button type="button" onClick={openNew} className={BUTTON.primary}>
            <Plus className="w-4 h-4" strokeWidth={2} />
            Novo cliente
          </button>
        }
      />

      <SearchField value={search} onChange={setSearch} placeholder="Buscar por razão social, nome fantasia ou CNPJ" />

      {isLoading ? (
        <CardsSkeleton count={3} className={GRID} label="Carregando clientes…" />
      ) : visible.length === 0 ? (
        <div className="rounded-[22px] border border-dashed border-black/10">
          <EmptyState
            title={clients.length === 0 ? 'Nenhum cliente cadastrado' : 'Nenhum cliente encontrado'}
            description={clients.length === 0 ? 'Cadastre a primeira empresa para começar.' : `Nada corresponde a “${search}”.`}
            action={
              clients.length === 0 ? (
                <button type="button" onClick={openNew} className={BUTTON.accent}>
                  <Plus className="w-4 h-4" />
                  Novo cliente
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className={GRID}>
          {visible.map((c) => (
            <ClientCard
              key={c.id}
              client={c}
              active={c.id === currentClient?.id}
              onActivate={() => {
                selectClient(c);
                flash(`${c.tradeName || c.name} definido como ativo`);
              }}
              deleting={deletingId === c.id}
              backingUp={backingUpId === c.id}
              onBackup={() => void backup(c)}
              onAskDelete={() => setConfirmDelete(c)}
              onDelete={() => void handleDelete(c)}
              onEdit={() => {
                setEditing(c);
                setSheetOpen(true);
              }}
            />
          ))}
        </div>
      )}

      {sheetOpen && (
        <ClientSheet
          key={editing?.id ?? 'new'}
          client={editing}
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

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-stone-900/90 dark:bg-stone-100/90 text-white dark:text-stone-900 text-[13px] tracking-tight shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-xl animate-sheet-in"
        >
          <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
          {toast}
        </div>
      )}
    </main>
  );
}
