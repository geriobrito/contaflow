import type { BankTransaction, ClassificationRule } from '@/types/firestore';
import { repairMojibake } from '@/lib/ofx/encoding';
import { isMonthLocked } from '@/lib/periods';
import { normalizePattern } from '@/lib/reconciliation';

/**
 * Plano de correção da acentuação de históricos e regras já gravados (UTF-8 lido como
 * Latin-1 em importações anteriores). Função pura: o serviço aplica o plano.
 */

export interface MemoFix {
  id: string;
  date: string;
  before: string;
  after: string;
}

export interface RuleFix {
  rule: ClassificationRule;
  before: string;
  after: string;
}

export interface TextRepairPlan {
  /** Históricos corrigíveis (competência aberta). */
  memos: MemoFix[];
  /** Históricos em competência fechada: ficam como estão até a reabertura. */
  lockedMemos: MemoFix[];
  rules: RuleFix[];
  /** Regras que passam a ser idênticas a outra (mesmo termo, tipo e conta) e podem ser removidas. */
  duplicateRuleIds: string[];
  total: number;
}

const ruleKey = (r: Pick<ClassificationRule, 'pattern' | 'matchType' | 'accountId'>, pattern: string) =>
  `${r.matchType ?? 'CONTAINS'}|${r.accountId}|${pattern}`;

export function planTextRepair(
  transactions: readonly BankTransaction[],
  rules: readonly ClassificationRule[],
  clientId: string,
  lockedMonths: ReadonlySet<string>
): TextRepairPlan {
  const memos: MemoFix[] = [];
  const lockedMemos: MemoFix[] = [];
  for (const t of transactions) {
    const after = repairMojibake(t.memo);
    if (after === t.memo) continue;
    const fix = { id: t.id, date: t.date, before: t.memo, after };
    (isMonthLocked(t.date, lockedMonths) ? lockedMemos : memos).push(fix);
  }

  // Só as regras do cliente (as globais não pertencem a esta empresa).
  const own = rules.filter((r) => r.clientId === clientId);
  const fixes: RuleFix[] = [];
  const finalPattern = new Map<string, string>();
  for (const rule of own) {
    // REGEX mantém a caixa original; os demais tipos são sempre minúsculos.
    const after =
      rule.matchType === 'REGEX' ? repairMojibake(rule.pattern) : normalizePattern(repairMojibake(rule.pattern, { lowercased: true }));
    finalPattern.set(rule.id, after);
    if (after !== rule.pattern) fixes.push({ rule, before: rule.pattern, after });
  }

  // Dois termos que ficaram iguais (o correto e o quebrado): mantém a regra mais recente.
  const duplicateRuleIds: string[] = [];
  const byKey = new Map<string, ClassificationRule>();
  for (const rule of [...own].sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '') || a.id.localeCompare(b.id))) {
    const key = ruleKey(rule, finalPattern.get(rule.id) ?? rule.pattern);
    if (byKey.has(key)) duplicateRuleIds.push(rule.id);
    else byKey.set(key, rule);
  }
  const dup = new Set(duplicateRuleIds);

  return {
    memos,
    lockedMemos,
    rules: fixes.filter((f) => !dup.has(f.rule.id)),
    duplicateRuleIds,
    total: memos.length + lockedMemos.length + fixes.length,
  };
}
