import type { BankTransaction, ClassificationRule } from '@/types/firestore';
import { assessRuleTerm, groupByPayee } from '@/lib/payee';
import { findMatchingRule } from '@/lib/reconciliation';

/**
 * Favorecidos recorrentes sem regra: quem aparece várias vezes nos lançamentos já conciliados à
 * mão, sempre (ou quase) na mesma conta, e que nenhuma regra classifica hoje. Cada um vira uma
 * sugestão de regra pronta, no sentido em que os lançamentos ocorreram.
 */
export interface RuleSuggestion {
  /** `${sentido}|${favorecido}` (o id do grupo de favorecido). */
  id: string;
  /** Termo sugerido para a regra. */
  term: string;
  /** Favorecido, para exibição. */
  label: string;
  direction: 'IN' | 'OUT';
  /** Conta em que esses lançamentos foram conciliados. */
  accountId: string;
  /** Lançamentos do favorecido nessa conta. */
  count: number;
  /** Lançamentos do favorecido, em qualquer conta. */
  outOf: number;
  /** Soma com sinal dos lançamentos na conta sugerida. */
  total: number;
}

/** Vezes que o favorecido precisa aparecer para valer uma regra. */
export const SUGGESTION_MIN_COUNT = 3;
/** Fração mínima dos lançamentos do favorecido que foi para a mesma conta. */
const DOMINANT_SHARE = 0.8;

export function suggestRules(
  transactions: readonly BankTransaction[],
  rules: readonly ClassificationRule[],
  { minCount = SUGGESTION_MIN_COUNT, limit = 6 }: { minCount?: number; limit?: number } = {}
): RuleSuggestion[] {
  // Só o que foi decidido à mão numa conta única: rateio e transferência não cabem numa regra.
  const manual = transactions.filter((t) => t.status === 'RECONCILED' && t.accountId && !t.isSplit && !t.transferPairId && !findMatchingRule(t, rules));
  const memos = transactions.map((t) => t.memo);
  const out: RuleSuggestion[] = [];
  for (const group of groupByPayee(manual)) {
    if (group.transactions.length < minCount) continue;
    const byAccount = new Map<string, BankTransaction[]>();
    for (const t of group.transactions) byAccount.set(t.accountId!, [...(byAccount.get(t.accountId!) ?? []), t]);
    const [accountId, list] = [...byAccount].sort((a, b) => b[1].length - a[1].length)[0];
    if (list.length < minCount || list.length / group.transactions.length < DOMINANT_SHARE) continue;
    // Termo que só descreve a operação ("pix enviado") classificaria gente sem relação.
    if (assessRuleTerm({ pattern: group.term, matchType: 'CONTAINS' }, memos).level === 'generic') continue;
    out.push({
      id: group.id,
      term: group.term,
      label: group.label,
      direction: group.direction,
      accountId,
      count: list.length,
      outOf: group.transactions.length,
      total: list.reduce((s, t) => s + t.amount, 0),
    });
  }
  return out.sort((a, b) => b.count - a.count || Math.abs(b.total) - Math.abs(a.total) || a.label.localeCompare(b.label)).slice(0, limit);
}
