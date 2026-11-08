'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { BankTransaction, ClassificationRule } from '@/types/firestore';
import { groupByPayee, type PayeeGroup } from '@/lib/payee';
import type { RuleConflict } from '@/lib/reconciliation';
import {
  evaluateRulesBatch,
  processRulesWorkerMessage,
  type EvaluateRulesPayload,
  type EvaluateRulesResult,
  type RuleEvaluationMetrics,
  type RulesWorkerRequest,
  type RulesWorkerResponse,
} from '@/workers/rules.worker';

/** Interface mínima compatível com a API nativa `Worker` do navegador. */
export interface WorkerLike {
  postMessage(message: RulesWorkerRequest): void;
  onmessage: ((event: MessageEvent<RulesWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent | Event) => void) | null;
  terminate(): void;
}

export interface RulesWorkerClient {
  groupPayees(transactions: readonly BankTransaction[]): Promise<PayeeGroup[]>;
  evaluateRules(payload: EvaluateRulesPayload): Promise<EvaluateRulesResult>;
  terminate(): void;
}

/**
 * Cria um cliente assíncrono para o Web Worker de regras e favorecidos.
 * Se `workerFactory` não for fornecido ou falhar (ex.: SSR/Node.js), executa as mesmas
 * rotinas de forma transparente via `processRulesWorkerMessage`.
 */
export function createRulesWorkerClient(workerFactory?: () => WorkerLike | null): RulesWorkerClient {
  let worker: WorkerLike | null = null;
  let workerBroken = false;
  let nextId = 1;

  const pending = new Map<
    number,
    {
      resolve: (res: RulesWorkerResponse) => void;
      reject: (err: Error) => void;
    }
  >();

  function getWorker(): WorkerLike | null {
    if (workerBroken) return null;
    if (worker) return worker;
    try {
      const created =
        workerFactory !== undefined
          ? workerFactory()
          : typeof window !== 'undefined' && typeof Worker !== 'undefined'
            ? (new Worker(new URL('../workers/rules.worker.ts', import.meta.url)) as unknown as WorkerLike)
            : null;
      if (!created) {
        workerBroken = true;
        return null;
      }
      created.onmessage = (event: MessageEvent<RulesWorkerResponse>) => {
        const msg = event.data;
        const entry = pending.get(msg.id);
        if (!entry) return;
        pending.delete(msg.id);
        if (msg.type === 'ERROR') {
          entry.reject(new Error(msg.error));
        } else {
          entry.resolve(msg);
        }
      };
      created.onerror = () => {
        workerBroken = true;
        for (const [, entry] of pending) {
          entry.reject(new Error('Falha na execução do Web Worker.'));
        }
        pending.clear();
      };
      worker = created;
      return worker;
    } catch {
      workerBroken = true;
      return null;
    }
  }

  async function dispatch(req: RulesWorkerRequest): Promise<RulesWorkerResponse> {
    const w = getWorker();
    if (!w) {
      return processRulesWorkerMessage(req);
    }
    try {
      return await new Promise<RulesWorkerResponse>((resolve, reject) => {
        pending.set(req.id, { resolve, reject });
        w.postMessage(req);
      });
    } catch {
      // Fallback imediato caso o Worker sofra erro em tempo de execução
      return processRulesWorkerMessage(req);
    }
  }

  return {
    async groupPayees(transactions) {
      const id = nextId++;
      const res = await dispatch({ id, type: 'GROUP_PAYEES', payload: { transactions } });
      if (res.type === 'GROUP_PAYEES_RESULT') return res.payload;
      throw new Error(res.type === 'ERROR' ? res.error : 'Resposta inesperada do Worker.');
    },

    async evaluateRules(payload) {
      const id = nextId++;
      const res = await dispatch({ id, type: 'EVALUATE_RULES', payload });
      if (res.type === 'EVALUATE_RULES_RESULT') return res.payload;
      throw new Error(res.type === 'ERROR' ? res.error : 'Resposta inesperada do Worker.');
    },

    terminate() {
      worker?.terminate();
      worker = null;
      pending.clear();
    },
  };
}

/** Limiar de lançamentos a partir do qual o processamento é despachado ao Web Worker. */
const WORKER_TX_THRESHOLD = 150;

/**
 * Hook que calcula o agrupamento por favorecido (`groupByPayee`).
 * Para extratos pequenos (< 150 transações), calcula de forma síncrona imediata.
 * Para extratos volumosos, delega ao Web Worker em segundo plano para não bloquear a UI.
 */
export function usePayeeGroupsWorker(candidates: readonly BankTransaction[]): PayeeGroup[] {
  const shouldOffload =
    typeof window !== 'undefined' && typeof Worker !== 'undefined' && candidates.length >= WORKER_TX_THRESHOLD;

  const syncGroups = useMemo(
    () => (shouldOffload ? null : groupByPayee(candidates)),
    [candidates, shouldOffload]
  );

  const [asyncGroups, setAsyncGroups] = useState<PayeeGroup[]>([]);
  const clientRef = useRef<RulesWorkerClient | null>(null);

  useEffect(() => {
    if (!shouldOffload) return;
    if (!clientRef.current) {
      clientRef.current = createRulesWorkerClient();
    }
    let active = true;
    clientRef.current
      .groupPayees(candidates)
      .then((res) => {
        if (active) setAsyncGroups(res);
      })
      .catch(() => {
        if (active) setAsyncGroups(groupByPayee(candidates));
      });
    return () => {
      active = false;
    };
  }, [candidates, shouldOffload]);

  useEffect(() => {
    return () => {
      clientRef.current?.terminate();
      clientRef.current = null;
    };
  }, []);

  return syncGroups ?? asyncGroups;
}

export interface UseRulesEvaluationReturn {
  conflicts: Map<string, RuleConflict[]>;
  metricsByRuleId: Record<string, RuleEvaluationMetrics>;
}

/**
 * Hook que avalia conflitos, termos e contagens de todas as regras.
 * Em bases volumosas, processa no Web Worker mantendo a digitação e filtros 100% fluidos.
 */
export function useRulesEvaluationWorker(
  rules: readonly ClassificationRule[],
  transactions: readonly BankTransaction[],
  openPending: readonly BankTransaction[]
): UseRulesEvaluationReturn {
  const shouldOffload =
    typeof window !== 'undefined' &&
    typeof Worker !== 'undefined' &&
    transactions.length * Math.max(1, rules.length) >= 1500;

  const syncResult = useMemo(
    () => (shouldOffload ? null : evaluateRulesBatch({ rules, transactions, openPending })),
    [rules, transactions, openPending, shouldOffload]
  );

  const [asyncResult, setAsyncResult] = useState<EvaluateRulesResult | null>(null);
  const clientRef = useRef<RulesWorkerClient | null>(null);

  useEffect(() => {
    if (!shouldOffload) return;
    if (!clientRef.current) {
      clientRef.current = createRulesWorkerClient();
    }
    let active = true;
    clientRef.current
      .evaluateRules({ rules, transactions, openPending })
      .then((res) => {
        if (active) setAsyncResult(res);
      })
      .catch(() => {
        if (active) setAsyncResult(evaluateRulesBatch({ rules, transactions, openPending }));
      });
    return () => {
      active = false;
    };
  }, [rules, transactions, openPending, shouldOffload]);

  useEffect(() => {
    return () => {
      clientRef.current?.terminate();
      clientRef.current = null;
    };
  }, []);

  const effective = syncResult ?? asyncResult;

  return useMemo(() => {
    if (!effective) {
      return {
        conflicts: new Map<string, RuleConflict[]>(),
        metricsByRuleId: {},
      };
    }
    return {
      conflicts: new Map(effective.conflictEntries),
      metricsByRuleId: effective.metricsByRuleId,
    };
  }, [effective]);
}

