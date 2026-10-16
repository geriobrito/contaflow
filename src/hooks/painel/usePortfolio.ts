'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ClientCompany } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { buildPortfolioRow, type PortfolioRow } from '@/lib/portfolio';
import { describeError } from '@/lib/utils/errors';

export type PortfolioEntry = { status: 'loading' } | { status: 'ready'; row: PortfolioRow } | { status: 'error'; message: string };

/** Empresas carregadas ao mesmo tempo: rápido sem disparar dezenas de consultas de uma vez. */
const CONCURRENCY = 4;
/** Resumo reaproveitado ao voltar ao Painel ou trocar de aba; "Atualizar" descarta. */
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; row: PortfolioRow }>();

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Resumo de uma empresa só com leituras baratas: contagens no servidor e cadastros pequenos. */
async function loadRow(client: ClientCompany): Promise<PortfolioRow> {
  const repo = getRepository();
  const [pending, auto, locks, batches, banks, openQueries, requests] = await Promise.all([
    repo.countTransactionsByStatus(client.id, 'PENDING'),
    repo.countTransactionsByStatus(client.id, 'AUTO_CLASSIFIED'),
    repo.listPeriodLocks(client.id),
    repo.listImportBatches(client.id),
    repo.listBankAccounts(client.id),
    repo.listOpenQueries(client.id),
    repo.listClientRequests(client.id),
  ]);
  // Só quando há o que procurar; sem o índice publicado (ou com falha), o atalho cai no primeiro mês aberto.
  const oldest = (count: number, status: 'PENDING' | 'AUTO_CLASSIFIED') =>
    count > 0 ? repo.oldestTransactionDate(client.id, status).catch(() => null) : Promise.resolve(null);
  const [oldestPending, oldestAuto] = await Promise.all([oldest(pending, 'PENDING'), oldest(auto, 'AUTO_CLASSIFIED')]);
  return buildPortfolioRow({ client, pending, auto, oldestPending, oldestAuto, locks, batches, banks, openQueries, requests, today: localToday(), nowMs: Date.now() });
}

/**
 * Situação de cada empresa da carteira para o Painel. Carrega só com `enabled` (aba Carteira
 * aberta); cada empresa aparece assim que fica pronta.
 */
export function usePortfolio(clients: readonly ClientCompany[], enabled: boolean) {
  const [entries, setEntries] = useState<Record<string, PortfolioEntry>>({});
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const list = clients.filter((c) => !c.deletingAt);
    const now = Date.now();
    const initial: Record<string, PortfolioEntry> = {};
    const queue: ClientCompany[] = [];
    for (const c of list) {
      const hit = cache.get(c.id);
      if (hit && now - hit.at < CACHE_MS) initial[c.id] = { status: 'ready', row: hit.row };
      else {
        initial[c.id] = { status: 'loading' };
        queue.push(c);
      }
    }
    void Promise.resolve().then(() => active && setEntries(initial));

    const worker = async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        const id = c.id;
        try {
          const row = await loadRow(c);
          cache.set(id, { at: Date.now(), row });
          if (active) setEntries((prev) => ({ ...prev, [id]: { status: 'ready', row } }));
        } catch (e) {
          console.error('Falha ao resumir a empresa no painel:', e);
          if (active) setEntries((prev) => ({ ...prev, [id]: { status: 'error', message: describeError(e) } }));
        }
      }
    };
    for (let i = 0; i < CONCURRENCY; i++) void worker();
    return () => {
      active = false;
    };
  }, [clients, enabled, reloads]);

  const refresh = useCallback(() => {
    cache.clear();
    setReloads((n) => n + 1);
  }, []);

  return { entries, refresh };
}
