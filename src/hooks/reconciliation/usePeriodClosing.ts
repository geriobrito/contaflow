'use client';

import { useCallback } from 'react';
import { closeMonth, reopenMonth } from '@/lib/services/reconciliation-service';
import type { ReconciliationStore } from '@/hooks/reconciliation/types';

export interface PeriodClosingActions {
  closeMonth: (month: string) => Promise<void>;
  reopenMonth: (month: string, reason: string) => Promise<void>;
}

/** Fechamento e reabertura de competência (ambos auditados e exigidos pelas regras do Firestore). */
export function usePeriodClosing(store: ReconciliationStore): PeriodClosingActions {
  const { clientId, locks, setLocks, mutate } = store;

  const close = useCallback(
    (month: string): Promise<void> =>
      mutate('Não foi possível fechar a competência', async () => {
        if (!clientId) throw new Error('Nenhum cliente selecionado.');
        const lock = await closeMonth(clientId, month);
        setLocks((prev) => [...prev.filter((l) => l.id !== lock.id), lock]);
      }),
    [clientId, mutate, setLocks]
  );

  const reopen = useCallback(
    (month: string, reason: string): Promise<void> =>
      mutate('Não foi possível reabrir a competência', async () => {
        const lock = locks.find((l) => l.month === month);
        if (!lock) throw new Error('Competência não está fechada.');
        if (!reason.trim()) throw new Error('Informe o motivo da reabertura.');
        await reopenMonth(lock, reason.trim());
        setLocks((prev) => prev.filter((l) => l.id !== lock.id));
      }),
    [locks, mutate, setLocks]
  );

  return { closeMonth: close, reopenMonth: reopen };
}
