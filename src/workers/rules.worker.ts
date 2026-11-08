import type { BankTransaction, ClassificationRule } from '@/types/firestore';
import { assessRuleTerm, groupByPayee, type PayeeGroup, type TermAssessment } from '@/lib/payee';
import {
  countAffected,
  detectRuleConflicts,
  findMatchingRule,
  type RuleConflict,
} from '@/lib/reconciliation';

export interface RuleEvaluationMetrics {
  assessment: TermAssessment;
  affected: number;
  pending: number;
}

export interface EvaluateRulesPayload {
  rules: readonly ClassificationRule[];
  transactions: readonly BankTransaction[];
  openPending: readonly BankTransaction[];
}

export interface EvaluateRulesResult {
  conflictEntries: [string, RuleConflict[]][];
  metricsByRuleId: Record<string, RuleEvaluationMetrics>;
}

export type RulesWorkerRequest =
  | { id: number; type: 'GROUP_PAYEES'; payload: { transactions: readonly BankTransaction[] } }
  | { id: number; type: 'EVALUATE_RULES'; payload: EvaluateRulesPayload };

export type RulesWorkerResponse =
  | { id: number; type: 'GROUP_PAYEES_RESULT'; payload: PayeeGroup[] }
  | { id: number; type: 'EVALUATE_RULES_RESULT'; payload: EvaluateRulesResult }
  | { id: number; type: 'ERROR'; error: string };

/**
 * Executa a avaliação completa de regras (conflitos, avaliação de termos, lançamentos afetados
 * e pendentes vencidos por cada regra) em uma única passagem otimizada.
 */
export function evaluateRulesBatch({
  rules,
  transactions,
  openPending,
}: EvaluateRulesPayload): EvaluateRulesResult {
  const memos = transactions.map((t) => t.memo);
  const conflictsMap = detectRuleConflicts(memos, rules);

  // Pré-calcula a regra vencedora para cada lançamento pendente em aberto (O(P * R) em vez de O(R² * P))
  const pendingWinsByRule = new Map<string, number>();
  for (const tx of openPending) {
    if (tx.status !== 'PENDING') continue;
    const winner = findMatchingRule(tx.memo, rules);
    if (winner) {
      pendingWinsByRule.set(winner.id, (pendingWinsByRule.get(winner.id) ?? 0) + 1);
    }
  }

  const metricsByRuleId: Record<string, RuleEvaluationMetrics> = {};
  for (const rule of rules) {
    metricsByRuleId[rule.id] = {
      assessment: assessRuleTerm(rule, memos),
      affected: countAffected(rule, transactions),
      pending: pendingWinsByRule.get(rule.id) ?? 0,
    };
  }

  return {
    conflictEntries: [...conflictsMap.entries()],
    metricsByRuleId,
  };
}

/**
 * Processador puro de mensagens do Web Worker.
 * Exportado para uso direto pelo fallback síncrono (SSR/Node.js) e pelos testes unitários.
 */
export function processRulesWorkerMessage(req: RulesWorkerRequest): RulesWorkerResponse {
  try {
    if (req.type === 'GROUP_PAYEES') {
      const groups = groupByPayee(req.payload.transactions);
      return { id: req.id, type: 'GROUP_PAYEES_RESULT', payload: groups };
    }
    if (req.type === 'EVALUATE_RULES') {
      const result = evaluateRulesBatch(req.payload);
      return { id: req.id, type: 'EVALUATE_RULES_RESULT', payload: result };
    }
    return { id: (req as { id: number }).id, type: 'ERROR', error: 'Tipo de tarefa desconhecido no Worker.' };
  } catch (err) {
    return {
      id: req.id,
      type: 'ERROR',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Registra o listener apenas quando executado num contexto de Web Worker real no navegador
if (
  typeof self !== 'undefined' &&
  typeof (self as unknown as { postMessage?: unknown }).postMessage === 'function' &&
  typeof window === 'undefined'
) {
  self.onmessage = (event: MessageEvent<RulesWorkerRequest>) => {
    const response = processRulesWorkerMessage(event.data);
    self.postMessage(response);
  };
}

