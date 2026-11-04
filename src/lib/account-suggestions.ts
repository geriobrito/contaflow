import type { AccountType, BankTransaction, ChartAccount } from '@/types/firestore';
import { extractPayee, payeeKey, type FlowDirection } from '@/lib/payee';

/**
 * Contas sugeridas ao classificar e ordem da lista pelo sentido do lançamento. Só usa o que a
 * tela já carregou (lançamentos do período, nota casada) e as recentes guardadas no navegador:
 * nenhuma leitura extra no banco.
 */

/** Conta sugerida e o motivo mostrado ao lado (ex.: "da nota fiscal", "recente"). */
export interface AccountSuggestion {
  accountId: string;
  reason: string;
}

export const directionOf = (amount: number): FlowDirection => (amount < 0 ? 'OUT' : 'IN');

/** Saída: despesas e custos primeiro; entrada: receitas primeiro. Nada fica de fora. */
const TYPE_ORDER: Record<FlowDirection, readonly AccountType[]> = {
  OUT: ['EXPENSE', 'COST', 'LIABILITY', 'ASSET', 'EQUITY', 'REVENUE'],
  IN: ['REVENUE', 'ASSET', 'LIABILITY', 'EQUITY', 'EXPENSE', 'COST'],
};

/** Contas na ordem do sentido (por tipo), mantendo a ordem recebida dentro de cada tipo. */
export function orderAccountsByDirection<T extends Pick<ChartAccount, 'type'>>(accounts: readonly T[], direction: FlowDirection | null): T[] {
  if (!direction) return [...accounts];
  const rank = new Map(TYPE_ORDER[direction].map((type, i) => [type, i] as const));
  return accounts
    .map((account, index) => ({ account, index }))
    .sort((a, b) => (rank.get(a.account.type) ?? 99) - (rank.get(b.account.type) ?? 99) || a.index - b.index)
    .map((x) => x.account);
}

/** Contas de um lançamento já classificado: a única ou as do rateio. */
const accountsOf = (t: BankTransaction): string[] => (t.isSplit && t.splits?.length ? t.splits.map((s) => s.accountId) : t.accountId ? [t.accountId] : []);

/** Contas mais usadas nos lançamentos (empate: a usada mais recentemente). */
function byUse(transactions: readonly BankTransaction[]): string[] {
  const stats = new Map<string, { count: number; last: string }>();
  for (const t of transactions) {
    for (const id of accountsOf(t)) {
      const s = stats.get(id) ?? { count: 0, last: '' };
      s.count += 1;
      if (t.date > s.last) s.last = t.date;
      stats.set(id, s);
    }
  }
  return [...stats.entries()].sort((a, b) => b[1].count - a[1].count || b[1].last.localeCompare(a[1].last)).map(([id]) => id);
}

const shorten = (text: string, max = 32) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export interface SuggestAccountsInput {
  /** Histórico do lançamento (ou do grupo), para achar o mesmo favorecido; null se forem vários. */
  memo: string | null;
  /** Sentido do que está sendo classificado; null se misturar entradas e saídas. */
  direction: FlowDirection | null;
  accounts: readonly ChartAccount[];
  /** Lançamentos carregados na tela. */
  history: readonly BankTransaction[];
  /** Lançamentos sendo classificados agora (não contam como histórico). */
  excludeIds?: ReadonlySet<string>;
  /** Conta sugerida pela nota fiscal casada. */
  invoiceAccountId?: string | null;
  /** Últimas contas escolhidas nesta empresa (mais recente primeiro). */
  recent?: readonly string[];
  limit?: number;
}

/**
 * Até `limit` contas analíticas, nesta ordem: da nota fiscal; usadas antes com o mesmo
 * favorecido (até 2); recentes (até 2); mais usadas no período no mesmo sentido.
 */
export function suggestAccounts({
  memo,
  direction,
  accounts,
  history,
  excludeIds,
  invoiceAccountId,
  recent = [],
  limit = 5,
}: SuggestAccountsInput): AccountSuggestion[] {
  const usable = new Set(accounts.filter((a) => a.nature === 'ANALYTIC').map((a) => a.id));
  const out: AccountSuggestion[] = [];
  const add = (ids: readonly string[], reason: string, max = limit) => {
    let added = 0;
    for (const id of ids) {
      if (out.length >= limit || added >= max) return;
      if (!usable.has(id) || out.some((s) => s.accountId === id)) continue;
      out.push({ accountId: id, reason });
      added += 1;
    }
  };

  if (invoiceAccountId) add([invoiceAccountId], 'da nota fiscal');
  const classified = history.filter((t) => t.status !== 'PENDING' && !excludeIds?.has(t.id) && (!direction || directionOf(t.amount) === direction));
  if (memo) {
    const key = payeeKey(memo);
    add(byUse(classified.filter((t) => payeeKey(t.memo) === key)), `usada antes com ${shorten(extractPayee(memo) ?? memo)}`, 2);
  }
  add(recent, 'usada recentemente', 2);
  add(byUse(classified), 'mais usada no período');
  return out;
}
