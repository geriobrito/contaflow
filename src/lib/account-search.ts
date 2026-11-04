import type { ChartAccount } from '@/types/firestore';
import { normalizeText } from '@/lib/utils/search';

/**
 * Busca de contas do plano por código ou nome: sem acento e sem diferenciar maiúsculas; cada
 * palavra digitada precisa achar o começo de uma palavra da conta, em qualquer ordem, tolerando
 * singular/plural ("aluguel" acha "Aluguéis"). Números com ponto buscam pelo código.
 */

type Searchable = Pick<ChartAccount, 'code' | 'name'>;

/** Singular aproximado de uma palavra em português, já sem acento (aluguéis → aluguel). */
export function singular(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('oes') || word.endsWith('aes')) return `${word.slice(0, -3)}ao`;
  if (word.endsWith('eis')) return `${word.slice(0, -3)}el`;
  if (word.endsWith('ais')) return `${word.slice(0, -3)}al`;
  if (word.endsWith('ois')) return `${word.slice(0, -3)}ol`;
  if (word.endsWith('ns')) return `${word.slice(0, -2)}m`;
  if (/[rz]es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

const words = (text: string): string[] => text.split(/[^a-z0-9]+/).filter(Boolean);
const isCodeLike = (token: string) => /^\d[\d.]*$/.test(token);

/** Grau de acerto de uma palavra digitada (menor é melhor) ou null se não casa. */
function tokenScore(token: string, code: string, name: string, nameWords: readonly string[]): number | null {
  if (isCodeLike(token)) {
    if (code.startsWith(token)) return 0;
    if (code.includes(token)) return 2;
  }
  if (nameWords.some((w) => w.startsWith(token))) return 1;
  const stem = singular(token);
  if (nameWords.some((w) => singular(w).startsWith(stem))) return 2;
  if (token.length >= 3 && name.includes(token)) return 3;
  return null;
}

/**
 * Relevância da conta para a busca (menor é melhor) ou null se não casa: código que começa com o
 * texto; nome que começa com ele; todas as palavras pelo começo; com plural; no meio da palavra.
 */
export function accountMatchScore(account: Searchable, query: string): number | null {
  const q = normalizeText(query).replace(/\s+/g, ' ');
  if (!q) return 0;
  const code = account.code.toLowerCase();
  const name = normalizeText(account.name);
  const tokens = q.split(' ');
  if (tokens.length === 1 && isCodeLike(q) && code.startsWith(q)) return code === q ? 0 : 1;
  let worst = 0;
  const nameWords = words(name);
  for (const token of tokens) {
    const score = tokenScore(token, code, name, nameWords);
    if (score === null) return null;
    worst = Math.max(worst, score);
  }
  if (name.startsWith(q)) return 2;
  return 2 + worst;
}

export const accountMatches = (account: Searchable, query: string): boolean => accountMatchScore(account, query) !== null;

/** Contas que casam com a busca, das mais relevantes para as menos (empate: a ordem recebida). */
export function searchAccounts<T extends Searchable>(accounts: readonly T[], query: string): T[] {
  if (!query.trim()) return [...accounts];
  return accounts
    .map((account, index) => ({ account, index, score: accountMatchScore(account, query) }))
    .filter((x): x is { account: T; index: number; score: number } => x.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((x) => x.account);
}
