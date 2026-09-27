import type { ClassificationRule } from '@/types/firestore';

/** Normalização canônica usada tanto para memos quanto para padrões de regra. */
export const normalizePattern = (value: string): string => value.toLowerCase().trim();

/** ID determinístico do lançamento: impede duplicar o mesmo FITID do mesmo cliente. */
export const buildTransactionId = (clientId: string, fitid: string): string => `${clientId}_${fitid}`;

/** Retorna a regra mais específica (padrão mais longo) contida no memo, ou null. */
export function findMatchingRule(
  memo: string,
  rules: readonly ClassificationRule[]
): ClassificationRule | null {
  const normalizedMemo = normalizePattern(memo);
  let best: ClassificationRule | null = null;
  let bestLength = 0;
  for (const rule of rules) {
    const pattern = normalizePattern(rule.pattern);
    if (!pattern || !normalizedMemo.includes(pattern)) continue;
    if (pattern.length > bestLength) {
      best = rule;
      bestLength = pattern.length;
    }
  }
  return best;
}
