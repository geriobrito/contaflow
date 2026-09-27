import type { BankTransaction, ClassificationRule, RuleMatchType } from '@/types/firestore';

/** Normalização canônica de memos e padrões: minúsculas, espaços colapsados e aparados. */
export const normalizePattern = (value: string): string => value.toLowerCase().replace(/\s+/g, ' ').trim();

/** ID determinístico do lançamento: impede duplicar o mesmo FITID do mesmo cliente. */
export const buildTransactionId = (clientId: string, fitid: string): string => `${clientId}_${fitid}`;

export const MATCH_TYPE_LABEL: Record<RuleMatchType, string> = {
  EXACT: 'É exatamente',
  STARTS_WITH: 'Começa com',
  CONTAINS: 'Contém',
  REGEX: 'Expressão regular',
};

/** Precedência do tipo de comparação: quanto mais restritiva, mais prioridade. */
const TYPE_RANK: Record<RuleMatchType, number> = { EXACT: 3, STARTS_WITH: 2, CONTAINS: 1, REGEX: 0 };

const regexCache = new Map<string, RegExp | null>();
function safeRegex(pattern: string): RegExp | null {
  if (!regexCache.has(pattern)) {
    try {
      regexCache.set(pattern, new RegExp(pattern, 'i'));
    } catch {
      regexCache.set(pattern, null); // padrão inválido nunca casa
    }
  }
  return regexCache.get(pattern) ?? null;
}

/** A regra casa com o histórico, respeitando o `matchType` (padrão: CONTAINS). */
export function matchesRule(memo: string, rule: Pick<ClassificationRule, 'pattern' | 'matchType'>): boolean {
  const text = normalizePattern(memo);
  const type = rule.matchType ?? 'CONTAINS';
  if (type === 'REGEX') return safeRegex(rule.pattern.trim())?.test(memo) ?? false;
  const pattern = normalizePattern(rule.pattern);
  if (!pattern) return false;
  if (type === 'EXACT') return text === pattern;
  if (type === 'STARTS_WITH') return text.startsWith(pattern);
  return text.includes(pattern);
}

/**
 * Ordem de precedência entre regras que casam o mesmo lançamento (resolução de conflito):
 *   1. tipo mais restritivo (exato > começa com > contém > regex);
 *   2. padrão mais longo (mais específico);
 *   3. regra mais recente (updatedAt/createdAt);
 *   4. id (desempate estável).
 */
export function compareRules(a: ClassificationRule, b: ClassificationRule): number {
  const byType = TYPE_RANK[b.matchType ?? 'CONTAINS'] - TYPE_RANK[a.matchType ?? 'CONTAINS'];
  if (byType) return byType;
  const byLength = normalizePattern(b.pattern).length - normalizePattern(a.pattern).length;
  if (byLength) return byLength;
  const byDate = (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
  if (byDate) return byDate;
  return a.id.localeCompare(b.id);
}

/** Todas as regras que casam o histórico, da vencedora para a menos prioritária. */
export function findRuleCandidates(memo: string, rules: readonly ClassificationRule[]): ClassificationRule[] {
  return rules.filter((r) => matchesRule(memo, r)).sort(compareRules);
}

/** Regra vencedora para o histórico, ou null. */
export function findMatchingRule(memo: string, rules: readonly ClassificationRule[]): ClassificationRule | null {
  return findRuleCandidates(memo, rules)[0] ?? null;
}

export interface RuleConflict {
  /** Regra que perde para outra em pelo menos um lançamento, levando-o a outra conta. */
  ruleId: string;
  winnerId: string;
  /** Exemplos de históricos em disputa. */
  memos: string[];
  count: number;
}

/**
 * Conflitos reais: lançamentos em que duas ou mais regras casam e apontam para contas
 * diferentes. A resolução é determinística (`compareRules`); isto só torna visível
 * quem perde, para o contador revisar.
 */
export function detectRuleConflicts(
  memos: readonly string[],
  rules: readonly ClassificationRule[]
): Map<string, RuleConflict[]> {
  const byLoser = new Map<string, Map<string, RuleConflict>>();
  for (const memo of new Set(memos)) {
    const [winner, ...others] = findRuleCandidates(memo, rules);
    if (!winner) continue;
    for (const loser of others) {
      if (loser.accountId === winner.accountId) continue;
      const perWinner = byLoser.get(loser.id) ?? new Map<string, RuleConflict>();
      const c = perWinner.get(winner.id) ?? { ruleId: loser.id, winnerId: winner.id, memos: [], count: 0 };
      c.count += 1;
      if (c.memos.length < 3) c.memos.push(memo);
      perWinner.set(winner.id, c);
      byLoser.set(loser.id, perWinner);
    }
  }
  return new Map([...byLoser].map(([id, m]) => [id, [...m.values()]]));
}

/**
 * Pendentes que passam a ser da regra `target` quando ela entra no conjunto `rules`:
 * a regra precisa casar E vencer a resolução de conflito naquele lançamento.
 */
export function pendingWonByRule(
  pending: readonly BankTransaction[],
  rules: readonly ClassificationRule[],
  target: ClassificationRule
): BankTransaction[] {
  const pool = [...rules.filter((r) => r.id !== target.id), target];
  return pending.filter((t) => t.status === 'PENDING' && findMatchingRule(t.memo, pool)?.id === target.id);
}
