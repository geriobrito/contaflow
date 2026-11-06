import type { ChartAccount, JournalEntry } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import type { Posting } from '@/lib/ledger';
import { buildPostings } from '@/lib/ledger';
import { toCents } from '@/lib/money';
import { lastDayOf } from '@/lib/fixed-assets';
import { loadLedgerWindow } from '@/lib/services/ledger-loader';

export interface MonthLedger {
  /** Saldo de cada conta no último dia da competência (positivo = devedor), em centavos. */
  balanceCents: (accountId: string) => number;
  /** Partidas da própria competência (para movimentos do mês, ex.: lucros distribuídos). */
  monthPostings: Posting[];
  /** O lançamento deixado de fora (o da rotina do mês), se houver. */
  excluded: JournalEntry | null;
}

/**
 * Razão até o fim da competência sem um lançamento (o que a rotina do mês gera e vai comparar):
 * extrato desde o último consolidado, lançamentos manuais e saldos de abertura.
 */
export async function monthLedgerWithout(
  clientId: string,
  month: string,
  accounts: readonly ChartAccount[],
  exclude: (entry: JournalEntry) => boolean,
  repo: DataRepository
): Promise<MonthLedger> {
  const end = lastDayOf(month);
  const [banks, openings, journal] = await Promise.all([repo.listBankAccounts(clientId), repo.getOpeningBalances(clientId), repo.listJournalEntries(clientId)]);
  const window = await loadLedgerWindow({ clientId, accounts, banks, from: `${month}-01`, until: end }, repo);
  const excluded = journal.find(exclude) ?? null;
  const postings = buildPostings(window.transactions, banks, accounts, end, openings, journal.filter((e) => e !== excluded), window.carry);
  const cents = new Map<string, number>();
  for (const p of postings) if (p.date <= end) cents.set(p.accountId, (cents.get(p.accountId) ?? 0) + toCents(p.value));
  return {
    balanceCents: (id) => cents.get(id) ?? 0,
    monthPostings: postings.filter((p) => p.date >= `${month}-01` && p.date <= end),
    excluded,
  };
}
