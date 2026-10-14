'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ClientCompany } from '@/types/firestore';
import { deleteClient, getClients } from '@/lib/services/data-service';
import { useAuth } from '@/contexts/AuthContext';

const STORAGE_KEY = 'contaflow_active_client';

export interface ClientContextType {
  /** Toda a carteira, inclusive empresas com exclusão incompleta (`deletingAt`), que só a tela de Clientes mostra. */
  clients: ClientCompany[];
  /** Empresa ativa; nunca uma com exclusão em andamento. */
  currentClient: ClientCompany | null;
  isLoading: boolean;
  /** Falha ao carregar a carteira (ex.: regras do Firestore recusaram, rede). */
  loadError: string | null;
  selectClient: (client: ClientCompany) => void;
  refreshClients: () => Promise<ClientCompany[]>;
  /**
   * Exclui o cliente (em cascata). Se for o ativo, ativa o próximo disponível ou nenhum. Se a
   * exclusão parar no meio, a empresa continua na lista marcada com `deletingAt`: chamar de novo retoma.
   */
  removeClient: (clientId: string) => Promise<void>;
}

const ClientContext = createContext<ClientContextType | undefined>(undefined);

/** Empresas em que dá para trabalhar: as que não estão sendo excluídas. */
const usable = (list: readonly ClientCompany[]) => list.filter((c) => !c.deletingAt);

function readStoredId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function ClientProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, orgId } = useAuth();
  const [clients, setClients] = useState<ClientCompany[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshClients = useCallback(async (): Promise<ClientCompany[]> => {
    const list = await getClients();
    setLoadError(null);
    setClients(list);
    setCurrentId((prev) => {
      const wanted = prev ?? readStoredId();
      const open = usable(list);
      return open.some((c) => c.id === wanted) ? wanted : (open[0]?.id ?? null);
    });
    setIsLoading(false);
    return list;
  }, []);

  // Recarrega ao entrar ou trocar de escritório; no logout, descarta os dados em memória.
  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(() => {
        if (!active) return;
        if (!isAuthenticated || !orgId) {
          setClients([]);
          setCurrentId(null);
          return;
        }
        setIsLoading(true);
        return refreshClients();
      })
      .catch((e: unknown) => {
        console.error('Erro ao carregar clientes:', e);
        if (active) setLoadError(e instanceof Error ? e.message : 'Não foi possível carregar os clientes.');
      })
      .finally(() => active && setIsLoading(false));
    return () => {
      active = false;
    };
  }, [isAuthenticated, orgId, refreshClients]);

  const selectClient = useCallback((client: ClientCompany) => {
    setClients((prev) => (prev.some((c) => c.id === client.id) ? prev : [client, ...prev]));
    setCurrentId(client.id);
    try {
      localStorage.setItem(STORAGE_KEY, client.id);
    } catch {
      /* armazenamento indisponível */
    }
  }, []);

  const removeClient = useCallback(
    async (clientId: string): Promise<void> => {
      let failure: unknown = null;
      try {
        await deleteClient(clientId);
      } catch (e) {
        // A lista é recarregada mesmo assim: a empresa pode ter ficado marcada como "em exclusão".
        failure = e;
      }
      const list = await getClients();
      const open = usable(list);
      const keep = currentId !== clientId && open.some((c) => c.id === currentId);
      const next = keep ? currentId : (open[0]?.id ?? null);
      setClients(list);
      setCurrentId(next);
      try {
        if (next) localStorage.setItem(STORAGE_KEY, next);
        else localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* armazenamento indisponível */
      }
      if (failure) throw failure;
    },
    [currentId]
  );

  const value = useMemo<ClientContextType>(
    () => ({
      clients,
      currentClient: usable(clients).find((c) => c.id === currentId) ?? null,
      isLoading,
      loadError,
      selectClient,
      refreshClients,
      removeClient,
    }),
    [clients, currentId, isLoading, loadError, selectClient, refreshClients, removeClient]
  );

  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>;
}

export function useClient(): ClientContextType {
  const ctx = useContext(ClientContext);
  if (!ctx) throw new Error('useClient deve ser utilizado dentro de um <ClientProvider>');
  return ctx;
}
