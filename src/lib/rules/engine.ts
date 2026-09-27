import { ClassificationRule, ChartAccount } from '@/types/firestore';

/**
 * Normaliza um texto para comparação de regras (letras maiúsculas, sem acentos, sem pontuações supérfluas)
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toUpperCase()
    .replace(/[^\w\s*]/g, ' ') // substitui pontuações por espaço
    .replace(/\s+/g, ' ')
    .trim();
}

export interface MatchResult {
  matched: boolean;
  rule?: ClassificationRule;
  confidence: number;
}

/**
 * Encontra a melhor regra correspondente para uma descrição bancária (MEMO)
 * Ordena por especificidade (tamanho do pattern decrescente) e por taxa de uso (usageCount)
 */
export function matchTransactionWithRules(
  memo: string,
  rules: ClassificationRule[],
  clientId?: string
): MatchResult {
  if (!memo || !rules || rules.length === 0) {
    return { matched: false, confidence: 0 };
  }

  const normalizedMemo = normalizeText(memo);

  // Filtrar regras do cliente + regras globais
  const applicableRules = rules.filter(
    (r) => !clientId || r.clientId === clientId || r.clientId === 'global'
  );

  // Ordenar regras: tamanho do pattern decrescente (mais específico primeiro) e depois por uso
  const sortedRules = [...applicableRules].sort((a, b) => {
    if (b.pattern.length !== a.pattern.length) {
      return b.pattern.length - a.pattern.length;
    }
    return (b.usageCount || 0) - (a.usageCount || 0);
  });

  for (const rule of sortedRules) {
    const normalizedPattern = normalizeText(rule.pattern);
    if (!normalizedPattern) continue;

    let isMatch = false;

    switch (rule.matchType) {
      case 'EXACT':
        isMatch = normalizedMemo === normalizedPattern;
        break;
      case 'STARTS_WITH':
        isMatch = normalizedMemo.startsWith(normalizedPattern);
        break;
      case 'REGEX':
        try {
          const regex = new RegExp(rule.pattern, 'i');
          isMatch = regex.test(memo);
        } catch {
          isMatch = false;
        }
        break;
      case 'CONTAINS':
      default:
        isMatch = normalizedMemo.includes(normalizedPattern);
        break;
    }

    if (isMatch) {
      return {
        matched: true,
        rule,
        confidence: rule.confidence || 90,
      };
    }
  }

  return { matched: false, confidence: 0 };
}

/**
 * Sugere um padrão/termo de aprendizado inteligente a partir da descrição de um extrato
 * Remove dados variáveis como datas, horários e números de documento
 */
export function suggestRulePattern(memo: string): string {
  if (!memo) return '';

  const normalized = normalizeText(memo);

  // Palavras de parada bancárias comuns que não devem ser o padrão único
  const stopWords = new Set([
    'PIX', 'TRANSF', 'TRANSFERENCIA', 'PAGTO', 'PAGAMENTO', 'DOC', 'TED',
    'ENVIO', 'RECEBIMENTO', 'DEBITO', 'CREDITO', 'COMPRA', 'CARTAO',
    'ELETRON', 'SISBR', 'AUTOATEND', 'TERMINAL', 'CONTA', 'AGENCIA'
  ]);

  const tokens = normalized.split(/\s+/).filter(t => t.length > 2 && !/^\d+$/.test(t));

  // Tenta achar o nome principal (ex: UBER, NETFLIX, ALUGUEL, COPEL, ENEL)
  const meaningfulTokens = tokens.filter(t => !stopWords.has(t));

  if (meaningfulTokens.length > 0) {
    // Retorna o primeiro termo relevante ou os dois primeiros se forem curtos
    if (meaningfulTokens.length >= 2 && meaningfulTokens[0].length <= 4) {
      return `${meaningfulTokens[0]} ${meaningfulTokens[1]}`;
    }
    return meaningfulTokens[0];
  }

  // Se só houver termos comuns, junta os 2 primeiros
  return tokens.slice(0, 2).join(' ') || normalized;
}

/**
 * Cria ou atualiza uma regra de classificação para aprendizado contínuo
 */
export function buildLearnedRule(
  pattern: string,
  account: ChartAccount,
  clientId: string = 'global',
  existingRule?: ClassificationRule
): ClassificationRule {
  const now = new Date().toISOString();
  const cleanPattern = normalizeText(pattern);

  if (existingRule) {
    return {
      ...existingRule,
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name,
      usageCount: (existingRule.usageCount || 0) + 1,
      confidence: Math.min(100, (existingRule.confidence || 90) + 2),
      updatedAt: now,
    };
  }

  return {
    id: `rule-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    clientId,
    pattern: cleanPattern,
    matchType: 'CONTAINS',
    accountId: account.id,
    accountCode: account.code,
    accountName: account.name,
    confidence: 90,
    usageCount: 1,
    createdAt: now,
    updatedAt: now,
  };
}
