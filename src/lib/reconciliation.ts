import type { BankTransaction, ClassificationRule, RuleMatchType } from '@/types/firestore';
import { toCents } from '@/lib/money';

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

/* =========================================================================
   Condições além do termo: sentido, conta bancária e faixa de valor
   ========================================================================= */

/** Condições de uma regra, já sem os valores neutros ('ANY', '', 0). */
export interface RuleConditions {
  direction?: 'IN' | 'OUT';
  bankAccountKey?: string;
  /** Faixa do valor absoluto, em centavos. */
  minCents?: number;
  maxCents?: number;
}

export type ConditionFields = Pick<ClassificationRule, 'direction' | 'bankAccountKey' | 'minAmount' | 'maxAmount'>;

/** Condições em vigor na regra (campo ausente ou com valor neutro não é condição). */
export function ruleConditions(rule: ConditionFields): RuleConditions {
  const out: RuleConditions = {};
  if (rule.direction === 'IN' || rule.direction === 'OUT') out.direction = rule.direction;
  if (rule.bankAccountKey) out.bankAccountKey = rule.bankAccountKey;
  if (rule.minAmount && rule.minAmount > 0) out.minCents = toCents(rule.minAmount);
  if (rule.maxAmount && rule.maxAmount > 0) out.maxCents = toCents(rule.maxAmount);
  return out;
}

/** Quantas condições a regra tem: mais condições, mais específica. */
export const conditionCount = (rule: ConditionFields): number => {
  const c = ruleConditions(rule);
  return Number(Boolean(c.direction)) + Number(Boolean(c.bankAccountKey)) + Number(c.minCents !== undefined || c.maxCents !== undefined);
};

/**
 * Campos de condição para gravar: os informados e, no lugar dos retirados, o valor neutro. A
 * gravação mescla campos (não apaga os ausentes), então é o neutro que desliga a condição.
 */
export function conditionFields(c: RuleConditions): Required<ConditionFields> {
  return {
    direction: c.direction ?? 'ANY',
    bankAccountKey: c.bankAccountKey ?? '',
    minAmount: c.minCents ? c.minCents / 100 : 0,
    maxAmount: c.maxCents ? c.maxCents / 100 : 0,
  };
}

/** Campos de condição de uma regra nova: só os que estão em vigor (nada a desligar ainda). */
export function activeConditionFields(c: RuleConditions): ConditionFields {
  return {
    ...(c.direction ? { direction: c.direction } : {}),
    ...(c.bankAccountKey ? { bankAccountKey: c.bankAccountKey } : {}),
    ...(c.minCents ? { minAmount: c.minCents / 100 } : {}),
    ...(c.maxCents ? { maxAmount: c.maxCents / 100 } : {}),
  };
}

/** O que a regra precisa do lançamento: o histórico e, para as condições, valor e conta bancária. */
export type RuleTarget = Pick<BankTransaction, 'memo'> & Partial<Pick<BankTransaction, 'amount' | 'accountKey'>>;

/** Sentido do lançamento pelo sinal do valor (saída negativa). */
const directionOf = (amount: number): 'IN' | 'OUT' => (amount < 0 ? 'OUT' : 'IN');

/** Sentido comum a todos os lançamentos, ou null quando há entradas e saídas (ou nenhum). */
export function sharedDirection(transactions: readonly Pick<BankTransaction, 'amount'>[]): 'IN' | 'OUT' | null {
  const directions = new Set(transactions.map((t) => directionOf(t.amount)));
  return directions.size === 1 ? [...directions][0] : null;
}

/** O lançamento atende às condições da regra (sem olhar o termo). Dado ausente não atende à condição que depende dele. */
export function meetsConditions(tx: RuleTarget, rule: ConditionFields): boolean {
  const c = ruleConditions(rule);
  if (c.direction && (tx.amount === undefined || directionOf(tx.amount) !== c.direction)) return false;
  if (c.bankAccountKey && tx.accountKey !== c.bankAccountKey) return false;
  if (c.minCents !== undefined || c.maxCents !== undefined) {
    if (tx.amount === undefined) return false;
    const cents = Math.abs(toCents(tx.amount));
    if (c.minCents !== undefined && cents < c.minCents) return false;
    if (c.maxCents !== undefined && cents > c.maxCents) return false;
  }
  return true;
}

/** A regra vale para o lançamento: o termo casa com o histórico e as condições são atendidas. */
export const ruleApplies = (tx: RuleTarget, rule: Pick<ClassificationRule, 'pattern' | 'matchType'> & ConditionFields): boolean =>
  matchesRule(tx.memo, rule) && meetsConditions(tx, rule);

/**
 * Ordem de precedência entre regras que valem para o mesmo lançamento (resolução de conflito):
 *   1. regra específica do cliente > regra modelo global ('global');
 *   2. tipo mais restritivo (exato > começa com > contém > regex);
 *   3. mais condições (sentido, conta bancária, faixa de valor);
 *   4. padrão mais longo (mais específico);
 *   5. regra mais recente (updatedAt/createdAt);
 *   6. id (desempate estável).
 */
export function compareRules(a: ClassificationRule, b: ClassificationRule): number {
  const aGlobal = a.clientId === 'global';
  const bGlobal = b.clientId === 'global';
  if (aGlobal !== bGlobal) {
    return aGlobal ? 1 : -1;
  }
  const byType = TYPE_RANK[b.matchType ?? 'CONTAINS'] - TYPE_RANK[a.matchType ?? 'CONTAINS'];
  if (byType) return byType;
  const byConditions = conditionCount(b) - conditionCount(a);
  if (byConditions) return byConditions;
  const byLength = normalizePattern(b.pattern).length - normalizePattern(a.pattern).length;
  if (byLength) return byLength;
  const byDate = (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
  if (byDate) return byDate;
  return a.id.localeCompare(b.id);
}

/** Todas as regras que valem para o lançamento, da vencedora para a menos prioritária. */
export function findRuleCandidates(tx: RuleTarget, rules: readonly ClassificationRule[]): ClassificationRule[] {
  return rules.filter((r) => ruleApplies(tx, r)).sort(compareRules);
}

/** Regra vencedora para o lançamento, ou null. */
export function findMatchingRule(tx: RuleTarget, rules: readonly ClassificationRule[]): ClassificationRule | null {
  return findRuleCandidates(tx, rules)[0] ?? null;
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
 * Conflitos reais: lançamentos em que duas ou mais regras valem e apontam para contas
 * diferentes. A resolução é determinística (`compareRules`); isto só torna visível
 * quem perde, para o contador revisar. Regras que as condições separam (uma só de entradas,
 * outra só de saídas) não disputam o mesmo lançamento.
 */
export function detectRuleConflicts(
  transactions: readonly RuleTarget[],
  rules: readonly ClassificationRule[]
): Map<string, RuleConflict[]> {
  const byLoser = new Map<string, Map<string, RuleConflict>>();
  // Lançamentos iguais no que as regras olham (histórico, valor e conta) contam uma vez só.
  const distinct = new Map<string, RuleTarget>();
  for (const t of transactions) distinct.set(`${t.memo}|${t.amount ?? ''}|${t.accountKey ?? ''}`, t);
  for (const tx of distinct.values()) {
    const memo = tx.memo;
    const [winner, ...others] = findRuleCandidates(tx, rules);
    if (!winner) continue;
    for (const loser of others) {
      if (loser.accountId === winner.accountId) continue;
      const perWinner = byLoser.get(loser.id) ?? new Map<string, RuleConflict>();
      const c = perWinner.get(winner.id) ?? { ruleId: loser.id, winnerId: winner.id, memos: [], count: 0 };
      c.count += 1;
      if (c.memos.length < 3 && !c.memos.includes(memo)) c.memos.push(memo);
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
  return pending.filter((t) => t.status === 'PENDING' && findMatchingRule(t, pool)?.id === target.id);
}

/**
 * Chave de unicidade de uma regra: tipo de comparação + termo + condições (duas regras iguais
 * nisso são a mesma). O mesmo termo pode ter uma regra para entradas e outra para saídas.
 */
export function ruleKey(pattern: string, type: RuleMatchType | undefined, conditions: ConditionFields = {}): string {
  const c = ruleConditions(conditions);
  const suffix = [c.direction ?? '', c.bankAccountKey ?? '', c.minCents ?? '', c.maxCents ?? ''].join('|');
  return `${type ?? 'CONTAINS'}:${pattern}${suffix === '|||' ? '' : `#${suffix}`}`;
}

/** Chave de unicidade da regra já gravada (termo normalizado como na criação). */
export const keyOfRule = (r: Pick<ClassificationRule, 'pattern' | 'matchType'> & ConditionFields): string =>
  ruleKey(r.matchType === 'REGEX' ? r.pattern.trim() : normalizePattern(r.pattern), r.matchType, r);

/** Lançamentos afetados por uma regra: os vinculados a ela ou para os quais ela vale. */
export const countAffected = (rule: ClassificationRule, transactions: readonly (RuleTarget & Pick<BankTransaction, 'matchedRuleId'>)[]): number =>
  transactions.filter((t) => t.matchedRuleId === rule.id || ruleApplies(t, rule)).length;

/** Texto curto das condições, para a etiqueta da regra ("só saídas", "de R$ 100,00 a R$ 500,00"). */
export function conditionLabels(rule: ConditionFields, bankName?: (key: string) => string | undefined): string[] {
  const c = ruleConditions(rule);
  const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const out: string[] = [];
  if (c.direction) out.push(c.direction === 'IN' ? 'só entradas' : 'só saídas');
  if (c.bankAccountKey) out.push(`conta ${bankName?.(c.bankAccountKey) ?? c.bankAccountKey}`);
  if (c.minCents !== undefined && c.maxCents !== undefined) out.push(`de ${brl(c.minCents)} a ${brl(c.maxCents)}`);
  else if (c.minCents !== undefined) out.push(`a partir de ${brl(c.minCents)}`);
  else if (c.maxCents !== undefined) out.push(`até ${brl(c.maxCents)}`);
  return out;
}
