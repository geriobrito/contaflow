import type { BankTransaction } from '@/types/firestore';

/**
 * Remove acentos e converte para minúsculas para busca fonética/textual suave.
 */
export function normalizeText(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export interface AmountCriteria {
  operator: '=' | '>' | '>=' | '<' | '<=';
  value: number;
}

/**
 * Tenta interpretar a consulta como um critério monetário/numérico.
 * Exemplos:
 *  - "1500" -> { operator: '=', value: 1500 }
 *  - "1.500,50" -> { operator: '=', value: 1500.5 }
 *  - "> 500" -> { operator: '>', value: 500 }
 *  - "<= 100,20" -> { operator: '<=', value: 100.2 }
 */
export function parseAmountCriteria(query: string): AmountCriteria | null {
  const trimmed = query.trim();
  const operatorMatch = trimmed.match(/^([><]=?|=)\s*(.+)$/);
  const operator = (operatorMatch ? operatorMatch[1] : '=') as AmountCriteria['operator'];
  const rawNumber = operatorMatch ? operatorMatch[2] : trimmed;

  // Limpa prefixos de moeda ("R$", "r$") e espaços
  const cleanNumber = rawNumber.replace(/^[rR]\$\s*/, '').trim();

  // Verifica se o restante parece um formato de número
  // Formatos aceitos: "1500", "1500.50", "1500,50", "1.500,50", "1,500.50"
  if (!/^[-+]?[\d.,]+$/.test(cleanNumber)) return null;

  let normalized = cleanNumber;
  if (cleanNumber.includes(',') && cleanNumber.includes('.')) {
    if (cleanNumber.lastIndexOf(',') > cleanNumber.lastIndexOf('.')) {
      // Formato brasileiro: 1.500,50 -> remove '.', troca ',' por '.'
      normalized = cleanNumber.replace(/\./g, '').replace(',', '.');
    } else {
      // Formato americano: 1,500.50 -> remove ',', mantém '.'
      normalized = cleanNumber.replace(/,/g, '');
    }
  } else if (cleanNumber.includes(',')) {
    // 1500,50 -> 1500.50
    normalized = cleanNumber.replace(',', '.');
  }

  const num = parseFloat(normalized);
  if (isNaN(num)) return null;

  return { operator, value: num };
}

/**
 * Verifica se um valor atende aos critérios numéricos.
 */
export function matchesAmountCriteria(amount: number, criteria: AmountCriteria): boolean {
  const absAmount = Math.abs(amount);
  const target = Math.abs(criteria.value);
  const diff = Math.abs(absAmount - target);

  switch (criteria.operator) {
    case '=':
      return diff < 0.009;
    case '>':
      return absAmount > target + 0.001;
    case '>=':
      return absAmount >= target - 0.009;
    case '<':
      return absAmount < target - 0.001;
    case '<=':
      return absAmount <= target + 0.009;
    default:
      return false;
  }
}

/**
 * Filtra lançamentos bancários por texto (memo, FITID, conta, splits) ou valor/critério numérico.
 */
export function matchTransaction(t: BankTransaction, query: string): boolean {
  const q = query.trim();
  if (!q) return true;

  const normalizedQuery = normalizeText(q);

  // 1. Busca textual em campos diretos
  if (t.memo && normalizeText(t.memo).includes(normalizedQuery)) return true;
  if (t.fitid && normalizeText(t.fitid).includes(normalizedQuery)) return true;
  if (t.accountName && normalizeText(t.accountName).includes(normalizedQuery)) return true;
  if (t.accountCode && normalizeText(t.accountCode).includes(normalizedQuery)) return true;
  if (t.bankName && normalizeText(t.bankName).includes(normalizedQuery)) return true;

  // 2. Busca nos lançamentos rateados (splits)
  if (t.isSplit && t.splits?.length) {
    for (const s of t.splits) {
      if (s.memo && normalizeText(s.memo).includes(normalizedQuery)) return true;
      if (s.accountName && normalizeText(s.accountName).includes(normalizedQuery)) return true;
      if (s.accountCode && normalizeText(s.accountCode).includes(normalizedQuery)) return true;
    }
  }

  // 3. Busca por critério de valor (ex.: "1500", "1.500,00", "> 500")
  const amountCriteria = parseAmountCriteria(q);
  if (amountCriteria && matchesAmountCriteria(t.amount, amountCriteria)) {
    return true;
  }

  // 4. Também permite buscar pelo valor exato dentro dos splits
  if (amountCriteria && t.isSplit && t.splits?.length) {
    if (t.splits.some((s) => matchesAmountCriteria(s.amount, amountCriteria))) {
      return true;
    }
  }

  return false;
}
