'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ClientCompany } from '@/types/firestore';
import { getClients } from '@/lib/services/data-service';
import { useAuth } from '@/contexts/AuthContext';

const STORAGE_KEY = 'contaflow_active_client';

export interface ClientContextType {
  clients: ClientCompany[];
  currentClient: ClientCompany | null;
  isLoading: boolean;
  selectClient: (client: ClientCompany) => void;
  refreshClients: () => Promise<ClientCompany[]>;
}

const ClientContext = createContext<ClientContextType | undefined>(undefined);

function readStoredId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function ClientProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [clients, setClients] = useState<ClientCompany[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshClients = useCallback(async (): Promise<ClientCompany[]> => {
    const list = await getClients();
    setClients(list);
    setCurrentId((prev) => {
      const wanted = prev ?? readStoredId();
      return list.some((c) => c.id === wanted) ? wanted : (list[0]?.id ?? null);
    });
    setIsLoading(false);
    return list;
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    Promise.resolve()
      .then(refreshClients)
      .catch((e) => {
        console.error('Erro ao carregar clientes:', e);
        setIsLoading(false);
      });
  }, [isAuthenticated, refreshClients]);

  const selectClient = useCallback((client: ClientCompany) => {
    setClients((prev) => (prev.some((c) => c.id === client.id) ? prev : [client, ...prev]));
    setCurrentId(client.id);
    try {
      localStorage.setItem(STORAGE_KEY, client.id);
    } catch {
      /* armazenamento indisponível */
    }
  }, []);

  const value = useMemo<ClientContextType>(
    () => ({
      clients,
      currentClient: clients.find((c) => c.id === currentId) ?? null,
      isLoading,
      selectClient,
      refreshClients,
    }),
    [clients, currentId, isLoading, selectClient, refreshClients]
  );

  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>;
}

export function useClient(): ClientContextType {
  const ctx = useContext(ClientContext);
  if (!ctx) throw new Error('useClient deve ser utilizado dentro de um <ClientProvider>');
  return ctx;
}
