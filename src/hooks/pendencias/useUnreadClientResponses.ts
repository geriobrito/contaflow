'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClientRequest } from '@/types/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { getRepository } from '@/lib/services/data-service';
import { REQUESTS_UPDATED_EVENT, unreadSummaryByClient } from '@/lib/client-requests';

const FOCUS_THROTTLE_MS = 30_000;

/**
 * Monitora respostas novas não lidas em links de pendências (`client_requests` abertos)
 * de todo o escritório, exibindo indicadores na barra lateral e no seletor de empresas.
 */
export function useUnreadClientResponses(currentClientId?: string | null) {
  const { isAuthenticated, orgId } = useAuth();
  const [requests, setRequests] = useState<ClientRequest[]>([]);
  const lastFetchedAtRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!isAuthenticated || !orgId) {
      setRequests([]);
      return;
    }
    try {
      const openReqs = await getRepository().listOpenOrgClientRequests();
      lastFetchedAtRef.current = Date.now();
      setRequests(openReqs);
    } catch {
      // Falha silenciosa: indicador na barra lateral não bloqueia navegação.
    }
  }, [isAuthenticated, orgId]);

  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(() => (active ? refresh() : undefined))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [refresh, currentClientId]);

  useEffect(() => {
    if (!isAuthenticated || !orgId) return;

    const onUpdated = () => {
      void refresh();
    };
    const onFocus = () => {
      if (Date.now() - lastFetchedAtRef.current >= FOCUS_THROTTLE_MS) {
        void refresh();
      }
    };

    window.addEventListener(REQUESTS_UPDATED_EVENT, onUpdated);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener(REQUESTS_UPDATED_EVENT, onUpdated);
      window.removeEventListener('focus', onFocus);
    };
  }, [isAuthenticated, orgId, refresh]);

  const unreadByClient = useMemo(() => unreadSummaryByClient(requests), [requests]);
  const currentUnreadCount = currentClientId ? (unreadByClient.get(currentClientId) ?? 0) : 0;
  const totalOtherClientsUnread = useMemo(() => {
    let sum = 0;
    for (const [id, count] of unreadByClient) {
      if (id !== currentClientId) sum += count;
    }
    return sum;
  }, [unreadByClient, currentClientId]);

  return {
    currentUnreadCount,
    unreadByClient,
    totalOtherClientsUnread,
    refresh,
  };
}

