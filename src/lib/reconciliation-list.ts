import type { BankAccount, BankTransaction, ReconciliationStatus } from '@/types/firestore';
import { isMonthLocked } from '@/lib/periods';
import { matchTransaction } from '@/lib/utils/search';
import type { SplitDraft } from '@/lib/splits';

/**
 * Lista da Conciliação: filtros por conta e situação, busca, opções do seletor de conta e o
 * que a tela oferece para aprovar ou agrupar. Tudo sem estado, para a página só compor.
 */

export type StatusFilter = 'ALL' | ReconciliationStatus;

/** Valor do filtro de conta para os lançamentos sem conta identificada no extrato. */
export const UNLINKED_BANK = '__unlinked__';

/** Nome curto da conta bancária: apelido, banco ou a chave do extrato. */
export const bankLabel = (b: Pick<BankAccount, 'nickname' | 'bankName' | 'accountKey'>) => b.nickname || b.bankName || b.accountKey;

export function bankNamesByKey(banks: readonly BankAccount[]): Map<string, string> {
  return new Map(banks.map((b) => [b.accountKey, bankLabel(b)] as const));
}

export interface BankOption {
  value: string;
  label: string;
  count: number;
}

/**
 * Opções do filtro de conta: as contas cadastradas (com a contagem de lançamentos), as chaves
 * de extrato sem cadastro e, se houver, "Sem conta identificada".
 */
export function bankFilterOptions(banks: readonly BankAccount[], transactions: readonly BankTransaction[]): BankOption[] {
  const counts = new Map<string, number>();
  let unlinked = 0;
  for (const t of transactions) {
    if (t.accountKey) counts.set(t.accountKey, (counts.get(t.accountKey) ?? 0) + 1);
    else unlinked++;
  }
  const known = new Set(banks.map((b) => b.accountKey));
  return [
    ...banks.map((b) => ({ value: b.accountKey, label: `${b.kind === 'CARD' ? 'Cartão · ' : ''}${bankLabel(b)}`, count: counts.get(b.accountKey) ?? 0 })),
    ...[...counts].filter(([key]) => !known.has(key)).map(([key, count]) => ({ value: key, label: key, count })),
    ...(unlinked > 0 ? [{ value: UNLINKED_BANK, label: 'Sem conta identificada', count: unlinked }] : []),
  ];
}

/** Lançamentos da conta escolhida ('ALL': todos). */
export function filterByBank(transactions: readonly BankTransaction[], bankFilter: string): readonly BankTransaction[] {
  if (bankFilter === 'ALL') return transactions;
  if (bankFilter === UNLINKED_BANK) return transactions.filter((t) => !t.accountKey);
  return transactions.filter((t) => t.accountKey === bankFilter);
}

/** Lançamentos visíveis: pela situação e pela busca. */
export function visibleTransactions(transactions: readonly BankTransaction[], filter: StatusFilter, query: string): readonly BankTransaction[] {
  const byStatus = filter === 'ALL' ? transactions : transactions.filter((t) => t.status === filter);
  return query.trim() ? byStatus.filter((t) => matchTransaction(t, query)) : byStatus;
}

/** Auto-classificados com conta, em competência aberta: os que "Aprovar todos" grava. */
export function approvableIds(transactions: readonly BankTransaction[], lockedMonths: ReadonlySet<string>): Set<string> {
  return new Set(transactions.filter((t) => t.status === 'AUTO_CLASSIFIED' && t.accountId && !isMonthLocked(t.date, lockedMonths)).map((t) => t.id));
}

/** Pendentes que a visão por favorecido agrupa: fora de transferências e de competências fechadas. */
export function payeeCandidates(transactions: readonly BankTransaction[], lockedMonths: ReadonlySet<string>): BankTransaction[] {
  return transactions.filter((t) => t.status === 'PENDING' && !t.transferPairId && !isMonthLocked(t.date, lockedMonths));
}

/** Substitui a conta bancária de mesmo id, ou a acrescenta. */
export function upsertBank(banks: readonly BankAccount[], bank: BankAccount): BankAccount[] {
  return banks.some((b) => b.id === bank.id) ? banks.map((b) => (b.id === bank.id ? bank : b)) : [...banks, bank];
}

/** Conta da maior linha que soma ao lançamento: a que fica no vínculo com a nota fiscal. */
export function mainSplitAccountId(drafts: readonly SplitDraft[]): string | null {
  const main = drafts.filter((d) => !d.reduces).reduce<SplitDraft | null>((best, d) => (!best || d.cents > best.cents ? d : best), null);
  return main?.accountId || null;
}

export interface ConciliationLink {
  /** Competência AAAA-MM pedida pelo link. */
  month?: string;
  /** Só com o mês: abre a lista nesta situação. */
  filter?: 'PENDING' | 'AUTO_CLASSIFIED';
  /** Chave da conta bancária. */
  bank?: string;
}

/** Links do painel: `?mes=AAAA-MM[&filtro=PENDING|AUTO_CLASSIFIED][&conta=KEY]`. Valores inválidos são ignorados. */
export function parseConciliationLink(search: string): ConciliationLink {
  const params = new URLSearchParams(search);
  const mes = params.get('mes');
  const filtro = params.get('filtro');
  const conta = params.get('conta');
  const month = mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes) ? mes : undefined;
  return {
    ...(month ? { month } : {}),
    ...(month && (filtro === 'PENDING' || filtro === 'AUTO_CLASSIFIED') ? { filter: filtro } : {}),
    ...(conta ? { bank: conta } : {}),
  };
}
