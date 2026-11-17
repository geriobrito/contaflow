import type { ChartAccount, ClassificationRule } from '@/types/firestore';
import { activeConditionFields, keyOfRule, ruleConditions } from '@/lib/reconciliation';

/**
 * Cópia das regras de aprendizado de uma empresa para outra. As contas são casadas pelo código
 * (as empresas partem do mesmo modelo de plano de contas); o que não tem conta correspondente,
 * já existe no destino ou depende de uma conta bancária da origem fica de fora, com o motivo.
 */
export type CopySkipReason = 'duplicate' | 'no-account' | 'bank-condition';

export const COPY_SKIP_LABEL: Record<CopySkipReason, string> = {
  duplicate: 'já existe no destino',
  'no-account': 'conta sem correspondente no plano do destino',
  'bank-condition': 'vale só para uma conta bancária da origem',
};

export interface RuleCopyPlan {
  /** Regras prontas para gravar no destino. */
  create: ClassificationRule[];
  skipped: { rule: ClassificationRule; reason: CopySkipReason }[];
}

export function planRuleCopy(args: {
  /** Regras da empresa de origem (as globais não entram: já valem para todas). */
  sourceRules: readonly ClassificationRule[];
  sourceClientId: string;
  /** Plano da origem, para o código atual da conta de cada regra. */
  sourceAccounts: readonly ChartAccount[];
  targetClientId: string;
  targetRules: readonly ClassificationRule[];
  targetAccounts: readonly ChartAccount[];
  now: string;
  actorUid?: string;
  newId: () => string;
}): RuleCopyPlan {
  const sourceCode = new Map(args.sourceAccounts.map((a) => [a.id, a.code] as const));
  const targetByCode = new Map(args.targetAccounts.filter((a) => a.nature === 'ANALYTIC').map((a) => [a.code, a] as const));
  const taken = new Set(args.targetRules.map(keyOfRule));
  const plan: RuleCopyPlan = { create: [], skipped: [] };

  for (const rule of args.sourceRules) {
    if (rule.clientId !== args.sourceClientId) continue;
    const conditions = ruleConditions(rule);
    if (conditions.bankAccountKey) {
      plan.skipped.push({ rule, reason: 'bank-condition' });
      continue;
    }
    const account = targetByCode.get(sourceCode.get(rule.accountId) ?? rule.accountCode ?? '');
    if (!account) {
      plan.skipped.push({ rule, reason: 'no-account' });
      continue;
    }
    const key = keyOfRule(rule);
    if (taken.has(key)) {
      plan.skipped.push({ rule, reason: 'duplicate' });
      continue;
    }
    taken.add(key);
    plan.create.push({
      id: args.newId(),
      clientId: args.targetClientId,
      pattern: rule.pattern,
      matchType: rule.matchType ?? 'CONTAINS',
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name,
      // Só as condições em vigor: contadores e histórico da origem não acompanham a cópia.
      ...activeConditionFields(conditions),
      ...(args.actorUid ? { createdByUid: args.actorUid } : {}),
      createdAt: args.now,
      updatedAt: args.now,
    });
  }
  return plan;
}
