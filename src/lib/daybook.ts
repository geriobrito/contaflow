import type { BankAccount, BankTransaction, ChartAccount, JournalEntry, OpeningBalances } from '@/types/firestore';
import type { DateRange } from '@/lib/data/repository';
import { VIRTUAL, VIRTUAL_LABEL, accountKind, isVirtual, openingSign } from '@/lib/ledger';
import { toCents } from '@/lib/money';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

/**
 * Livro Diário: todos os lançamentos do período em ordem cronológica, cada um com as suas
 * partidas a débito e a crédito — os do extrato (banco × conta classificada ou rateio), os
 * manuais e os saldos de abertura. Usa as mesmas contas de `buildPostings` (src/lib/ledger.ts),
 * de modo que os totais do Diário são os do balancete do mesmo período.
 */

export type DaybookOrigin = 'OPENING' | 'BANK' | 'MANUAL';

export interface DaybookLine {
  accountId: string;
  code: string;
  name: string;
  debit: number;
  credit: number;
  memo?: string;
}

export interface DaybookEntry {
  id: string;
  /** Número de ordem, contado desde o início da numeração (normalmente 1º de janeiro). */
  number: number;
  date: string;
  origin: DaybookOrigin;
  /** Documento de origem: identificador do extrato, número do lançamento manual… */
  document: string;
  memo: string;
  /** Débitos primeiro, depois créditos. */
  lines: DaybookLine[];
  total: number;
  /** Tem partida em "Lançamentos a classificar" (pendente, sem aprovação ou conta removida). */
  unclassified: boolean;
}

export interface Daybook {
  range: DateRange;
  entries: DaybookEntry[];
  totals: { debits: number; credits: number };
  balanced: boolean;
  /** Lançamentos do período ainda a classificar: enquanto houver, o livro é provisório. */
  unclassified: number;
}

const ORIGIN_ORDER: Record<DaybookOrigin, number> = { OPENING: 0, BANK: 1, MANUAL: 2 };

interface Draft {
  id: string;
  date: string;
  origin: DaybookOrigin;
  document: string;
  memo: string;
  /** Desempate estável dentro do mesmo dia e origem. */
  order: string;
  /** Partidas assinadas: positivo = débito. */
  postings: { accountId: string; value: number; memo?: string }[];
}

export function buildDaybook(args: {
  transactions: readonly BankTransaction[];
  bankAccounts: readonly BankAccount[];
  accounts: readonly ChartAccount[];
  range: DateRange;
  openings?: OpeningBalances | null;
  journalEntries?: readonly JournalEntry[] | null;
  /** Primeiro dia que conta para o número de ordem (padrão: início do período). */
  numberFrom?: string;
}): Daybook {
  const { transactions, bankAccounts, accounts, range, openings, journalEntries } = args;
  const from = args.numberFrom && args.numberFrom < range.start ? args.numberFrom : range.start;
  const inWindow = (date: string) => date >= from && date <= range.end;

  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const bankByKey = new Map(bankAccounts.map((b) => [b.accountKey, b] as const));
  const ledgerOf = (accountKey?: string): string => {
    const ledger = accountKey ? bankByKey.get(accountKey)?.ledgerAccountId : undefined;
    return ledger && byId.has(ledger) ? ledger : VIRTUAL.BANK_UNLINKED;
  };
  /** Conta fora do plano vai para "a classificar", como no razão. */
  const known = (accountId: string | undefined): string => (accountId && byId.has(accountId) ? accountId : VIRTUAL.SUSPENSE);

  const drafts: Draft[] = [];

  for (const b of bankAccounts) {
    if (!b.openingBalance || !b.openingDate || !inWindow(b.openingDate)) continue;
    drafts.push({
      id: `opening_bank_${b.id}`,
      date: b.openingDate,
      origin: 'OPENING',
      document: 'SALDO INICIAL',
      memo: `Saldo inicial — ${b.nickname || b.accountNumber || 'conta bancária'}`,
      order: `0_${b.id}`,
      postings: [
        { accountId: ledgerOf(b.accountKey), value: b.openingBalance },
        { accountId: VIRTUAL.OPENING, value: -b.openingBalance },
      ],
    });
  }

  if (openings && inWindow(openings.date)) {
    for (const e of openings.entries) {
      const acc = byId.get(e.accountId);
      if (!acc || !e.amount || accountKind(acc) === 'RESULT') continue;
      const value = openingSign(acc) * e.amount;
      drafts.push({
        id: `opening_${acc.id}`,
        date: openings.date,
        origin: 'OPENING',
        document: 'ABERTURA',
        memo: `Saldo de abertura — ${acc.name}`,
        order: `1_${acc.code}`,
        postings: [
          { accountId: acc.id, value },
          { accountId: VIRTUAL.OPENING, value: -value },
        ],
      });
    }
  }

  for (const t of transactions) {
    if (!inWindow(t.date)) continue;
    // Movimento anterior ao saldo inicial informado já está contido nele.
    const opening = t.accountKey ? bankByKey.get(t.accountKey)?.openingDate : undefined;
    if (opening && t.date <= opening) continue;
    const counter =
      t.status !== 'RECONCILED'
        ? [{ accountId: VIRTUAL.SUSPENSE as string, value: -t.amount }]
        : t.isSplit && t.splits?.length
          ? t.splits.map((s) => ({ accountId: known(s.accountId), value: -s.amount, ...(s.memo ? { memo: s.memo } : {}) }))
          : [{ accountId: known(t.accountId), value: -t.amount }];
    drafts.push({
      id: `tx_${t.id}`,
      date: t.date,
      origin: 'BANK',
      document: t.fitid,
      memo: t.memo,
      order: t.id,
      postings: [{ accountId: ledgerOf(t.accountKey), value: t.amount }, ...counter],
    });
  }

  for (const j of journalEntries ?? []) {
    if (!inWindow(j.date)) continue;
    drafts.push({
      id: `j_${j.id}`,
      date: j.date,
      origin: 'MANUAL',
      document: [j.entryNumber ? `L${j.entryNumber}` : 'MANUAL', j.documentRef].filter(Boolean).join(' · '),
      memo: j.memo,
      order: String(j.entryNumber ?? 0).padStart(9, '0'),
      postings: j.lines
        .filter((l) => l.amount)
        .map((l) => ({ accountId: known(l.accountId), value: l.type === 'DEBIT' ? l.amount : -l.amount, ...(l.memo ? { memo: l.memo } : {}) })),
    });
  }

  drafts.sort((a, b) => a.date.localeCompare(b.date) || ORIGIN_ORDER[a.origin] - ORIGIN_ORDER[b.origin] || a.order.localeCompare(b.order));

  const entries: DaybookEntry[] = [];
  let debits = 0;
  let credits = 0;
  let unclassified = 0;
  let number = 0;
  for (const d of drafts) {
    const lines = d.postings
      .filter((p) => toCents(p.value) !== 0)
      .map((p): DaybookLine => {
        const acc = byId.get(p.accountId);
        return {
          accountId: p.accountId,
          code: acc?.code ?? '',
          name: acc?.name ?? (isVirtual(p.accountId) ? VIRTUAL_LABEL[p.accountId] : 'Conta removida'),
          debit: p.value > 0 ? toCents(p.value) / 100 : 0,
          credit: p.value < 0 ? toCents(-p.value) / 100 : 0,
          ...(p.memo ? { memo: p.memo } : {}),
        };
      });
    if (!lines.length) continue;
    number++;
    if (d.date < range.start) continue;
    lines.sort((a, b) => Number(b.debit > 0) - Number(a.debit > 0));
    const entryDebits = lines.reduce((s, l) => s + toCents(l.debit), 0);
    debits += entryDebits;
    credits += lines.reduce((s, l) => s + toCents(l.credit), 0);
    const pending = lines.some((l) => l.accountId === VIRTUAL.SUSPENSE);
    if (pending) unclassified++;
    entries.push({ id: d.id, number, date: d.date, origin: d.origin, document: d.document, memo: d.memo, lines, total: entryDebits / 100, unclassified: pending });
  }

  return { range, entries, totals: { debits: debits / 100, credits: credits / 100 }, balanced: debits === credits, unclassified };
}

/* =========================================================================
   Termos de abertura e de encerramento
   ========================================================================= */

export interface DaybookBookInfo {
  /** Número de ordem do livro (Diário nº 1, 2…). */
  number: string;
  /** Município/UF da sede. */
  city?: string;
  /** NIRE ou número de registro no cartório. */
  registry?: string;
}

/** Texto dos termos de abertura e de encerramento do livro, para a quantidade de páginas emitida. */
export function daybookTerms(args: {
  clientName: string;
  cnpj: string;
  book: DaybookBookInfo;
  range: DateRange;
  pages: number;
  entryCount: number;
  total: number;
}): { opening: string; closing: string } {
  const { clientName, cnpj, book, range, pages, entryCount, total } = args;
  const sheets = `Contém este livro ${pages} página(s), numeradas de 1 a ${pages}, emitidas por processamento eletrônico de dados`;
  const company = [
    cnpj ? `${clientName}, inscrita no CNPJ sob o nº ${cnpj}` : `${clientName}, CNPJ não informado`,
    book.registry?.trim() && `registrada sob o nº ${book.registry.trim()}`,
    book.city?.trim() && `com sede em ${book.city.trim()}`,
  ]
    .filter(Boolean)
    .join(', ');
  const period = `de ${formatDateBR(range.start)} a ${formatDateBR(range.end)}`;
  const number = book.number.trim() || '1';
  return {
    opening: `${sheets}, e servirá de Livro Diário nº ${number} de ${company}, para a escrituração dos lançamentos do período ${period}.`,
    closing: `${sheets}, e serviu de Livro Diário nº ${number} de ${company}, no qual foram escriturados ${entryCount} lançamento(s) do período ${period}, que totalizam ${formatCurrency(total)} a débito e a crédito.`,
  };
}
