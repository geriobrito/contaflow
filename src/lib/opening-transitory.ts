import type { BankAccount, ChartAccount, JournalEntry, OpeningBalances } from '@/types/firestore';
import { OPENING_ACCOUNT_CODE, openingJournals, type Posting } from '@/lib/ledger';
import { fromCents, toCents } from '@/lib/money';
import { formatCurrency } from '@/lib/utils/formatters';

/**
 * Conta transitória 2.3.3.04 Balanço de Abertura. No balanço de abertura sem contabilidade
 * anterior ela recebe a diferença entre débitos e créditos; não pode ficar no balanço de
 * encerramento: o encerramento do exercício (src/lib/year-closing.ts) a zera contra Lucros
 * Acumulados (saldo credor) ou Prejuízos Acumulados (saldo devedor). Aqui ficam o saldo dela e
 * o lembrete de zerar.
 */

/** Centavos devedores → valor credor positivo (sem -0). */
const credit = (debitCents: number) => (debitCents === 0 ? 0 : fromCents(-debitCents));

const openingAccountOf = (accounts: readonly ChartAccount[]) => accounts.find((a) => a.code === OPENING_ACCOUNT_CODE);

/** Saldo da 2.3.3.04 em `date`, a partir das partidas do razão; credor positivo. */
export function transitoryBalanceAt(postings: readonly Posting[], accounts: readonly ChartAccount[], date: string): number {
  const acc = openingAccountOf(accounts);
  if (!acc) return 0;
  const debit = postings.reduce((s, p) => (p.accountId === acc.id && p.date <= date ? s + toCents(p.value) : s), 0);
  return credit(debit);
}

/**
 * Saldo atual da 2.3.3.04 sem montar o razão inteiro (painel): a contrapartida da abertura mais
 * os lançamentos manuais nela, inclusive o encerramento que a zera. Credor positivo.
 */
export function transitoryBalance(
  openings: OpeningBalances | null | undefined,
  banks: readonly BankAccount[],
  accounts: readonly ChartAccount[],
  journalEntries: readonly JournalEntry[]
): number {
  const acc = openingAccountOf(accounts);
  if (!acc) return 0;
  let debit = 0;
  for (const j of openingJournals(openings, banks, accounts)) {
    for (const l of j.lines) if (l.accountId === acc.id) debit += toCents(l.value);
  }
  for (const e of journalEntries) {
    for (const l of e.lines) if (l.accountId === acc.id && l.amount) debit += (l.type === 'DEBIT' ? 1 : -1) * toCents(l.amount);
  }
  return credit(debit);
}

export interface TransitoryReminder {
  /** Saldo da conta, credor positivo. */
  balance: number;
  /** Exercício cujo encerramento deve zerá-la: o primeiro ainda não encerrado, a partir da implantação. */
  year: string;
  /** O exercício já terminou e a conta segue com saldo. */
  overdue: boolean;
}

/**
 * Lembrete de zerar a 2.3.3.04, ou null quando ela não tem saldo. `closedYears` são os
 * exercícios já encerrados (lançamentos com `yearClosing`); `today`, YYYY-MM-DD.
 */
export function transitoryReminder(args: { balance: number; implantation: string | null; closedYears: Iterable<string>; today: string }): TransitoryReminder | null {
  const { balance, implantation, today } = args;
  if (Math.abs(balance) < 0.005) return null;
  const closed = new Set(args.closedYears);
  let year = Number((implantation ?? today).slice(0, 4));
  while (closed.has(String(year))) year++;
  return { balance, year: String(year), overdue: today > `${year}-12-31` };
}

/** Exercícios com encerramento lançado. */
export const closedYearsOf = (entries: readonly Pick<JournalEntry, 'yearClosing'>[]): Set<string> =>
  new Set(entries.map((e) => e.yearClosing).filter((y): y is string => Boolean(y)));

/** "credor de R$ 500,00" / "devedor de R$ 500,00". */
export const describeTransitory = (balance: number): string => `${balance > 0 ? 'credor' : 'devedor'} de ${formatCurrency(Math.abs(balance))}`;
