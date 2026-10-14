'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getRepository } from '@/lib/services/data-service';
import type { AuditEntry, BankTransaction, ClassificationRule, PeriodLock } from '@/types/firestore';
import { useClassification, type ClassificationActions } from '@/hooks/reconciliation/useClassification';
import { usePeriodClosing, type PeriodClosingActions } from '@/hooks/reconciliation/usePeriodClosing';
import { useStatementImport, type StatementImportActions } from '@/hooks/reconciliation/useStatementImport';
import {
  describeError,
  type ReconciliationMetrics,
  type ReconciliationStore,
  type UseReconciliationParams,
} from '@/hooks/reconciliation/types';

export { normalizePattern, buildTransactionId } from '@/lib/reconciliation';
export type {
  ClassifyManyResult,
  ClassifyOptions,
  ClassifyResult,
  ImportableTransaction,
  ImportResult,
  MemoUpdate,
  PreImportCheck,
  ReconciliationMetrics,
  StatementMeta,
  UseReconciliationParams,
} from '@/hooks/reconciliation/types';

export interface UseReconciliationReturn extends StatementImportActions, ClassificationActions, PeriodClosingActions {
  transactions: BankTransaction[];
  rules: ClassificationRule[];
  locks: PeriodLock[];
  lockedMonths: ReadonlySet<string>;
  metrics: ReconciliationMetrics;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  loadAudit: (transactionId: string) => Promise<AuditEntry[]>;
  reload: () => Promise<void>;
}

/**
 * Conciliação bancária de um cliente num período.
 *
 * Este hook guarda o estado (lançamentos, regras e fechamentos carregados) e o entrega aos
 * três que fazem o trabalho, em src/hooks/reconciliation/:
 *   - `useStatementImport`: importação de extratos;
 *   - `useClassification`: classificar, ratear, transferir, desfazer, aprovar, perguntar ao cliente;
 *   - `usePeriodClosing`: fechar e reabrir competência.
 * As telas continuam consumindo tudo por aqui.
 */
export function useReconciliation({ clientId, accounts, range }: UseReconciliationParams): UseReconciliationReturn {
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [rules, setRules] = useState<ClassificationRule[]>([]);
  const [locks, setLocks] = useState<PeriodLock[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a] as const)), [accounts]);
  const lockedMonths = useMemo(() => new Set(locks.map((l) => l.month)), [locks]);
  const rangeStart = range?.start;
  const rangeEnd = range?.end;

  const reload = useCallback(async (): Promise<void> => {
    if (!clientId || !rangeStart || !rangeEnd) {
      setTransactions([]);
      setRules([]);
      setLocks([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const repo = getRepository();
      const [loadedRules, loadedTxs, loadedLocks] = await Promise.all([
        repo.listRules(clientId),
        repo.listTransactions(clientId, { start: rangeStart, end: rangeEnd }),
        repo.listPeriodLocks(clientId),
      ]);
      setRules(loadedRules);
      setTransactions(loadedTxs);
      setLocks(loadedLocks);
    } catch (e) {
      console.error('[useReconciliation] Falha ao carregar dados:', e);
      setError(`Não foi possível carregar os lançamentos (${describeError(e)}).`);
    } finally {
      setIsLoading(false);
    }
  }, [clientId, rangeStart, rangeEnd]);

  // Recarrega ao trocar cliente ou período (adiado um microtask para não setar estado no corpo do effect).
  useEffect(() => {
    let active = true;
    const run = async (): Promise<void> => {
      await Promise.resolve();
      if (active) await reload();
    };
    void run();
    return () => {
      active = false;
    };
  }, [reload]);

  /** Envolve uma operação de escrita com estado de gravação e mensagem de erro. */
  const mutate = useCallback(async <T,>(failure: string, op: () => Promise<T>): Promise<T> => {
    setIsSaving(true);
    setError(null);
    try {
      return await op();
    } catch (e) {
      console.error(`[useReconciliation] ${failure}:`, e);
      setError(`${failure} (${describeError(e)}).`);
      throw e;
    } finally {
      setIsSaving(false);
    }
  }, []);

  /** Substitui lançamentos no estado local (apenas os que estão carregados). */
  const replaceLoaded = useCallback((updated: readonly BankTransaction[]) => {
    if (!updated.length) return;
    const byId = new Map(updated.map((t) => [t.id, t] as const));
    setTransactions((prev) => prev.map((t) => byId.get(t.id) ?? t));
  }, []);

  const store: ReconciliationStore = {
    clientId,
    accounts,
    accountsById,
    range,
    transactions,
    rules,
    locks,
    lockedMonths,
    setTransactions,
    setRules,
    setLocks,
    setError,
    mutate,
    replaceLoaded,
  };
  const statementImport = useStatementImport(store);
  const classification = useClassification(store);
  const closing = usePeriodClosing(store);

  const loadAudit = useCallback(
    (transactionId: string) => (clientId ? getRepository().listAudit(clientId, { transactionId }) : Promise.resolve([])),
    [clientId]
  );

  /* ------------------------------------------------------------------ */
  /* Métricas do período                                                 */
  /* ------------------------------------------------------------------ */
  const metrics = useMemo<ReconciliationMetrics>(() => {
    let pending = 0;
    let autoClassified = 0;
    let reconciled = 0;
    let credits = 0;
    let debits = 0;
    for (const t of transactions) {
      if (t.status === 'PENDING') pending++;
      else if (t.status === 'AUTO_CLASSIFIED') autoClassified++;
      else reconciled++;
      if (t.amount >= 0) credits += t.amount;
      else debits += Math.abs(t.amount);
    }
    const total = transactions.length;
    return {
      total,
      pending,
      autoClassified,
      reconciled,
      reconciledPercent: total ? Math.round((reconciled / total) * 100) : 0,
      credits,
      debits,
    };
  }, [transactions]);

  return {
    transactions,
    rules,
    locks,
    lockedMonths,
    metrics,
    isLoading,
    isSaving,
    error,
    ...statementImport,
    ...classification,
    ...closing,
    loadAudit,
    reload,
  };
}
