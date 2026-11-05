import type { BankAccount, ChartAccount, OpeningBalances } from '@/types/firestore';
import { openingJournals, type BalanceSheet, type BalanceSheetLine, type Posting } from '@/lib/ledger';
import { fromCents, toCents } from '@/lib/money';

/**
 * Conferências do balanço patrimonial para a tela: contas com saldo contrário à natureza do
 * grupo e capital social sem saldo.
 */

/** Retificadoras (saldo contrário ao grupo por natureza): "(-) ...", depreciação e amortização acumuladas. */
const CONTRA = /\(-\)|deprecia|amortiza/i;

/** Grupos de natureza conferida: ativo devedor; passivo exigível (circulante e não circulante) credor. */
const CHECKED: { prefix: string; side: 'ASSET' | 'LIABILITY' }[] = [
  { prefix: '1.', side: 'ASSET' },
  { prefix: '2.1.', side: 'LIABILITY' },
  { prefix: '2.2.', side: 'LIABILITY' },
];

export interface InvertedBalance {
  line: BalanceSheetLine;
  /** ASSET com saldo credor ou LIABILITY com saldo devedor. */
  side: 'ASSET' | 'LIABILITY';
}

/**
 * Contas analíticas de ativo com saldo credor e de passivo exigível com saldo devedor. No
 * balanço, cada lado já vem na natureza do grupo: saldo invertido é valor negativo.
 */
export function invertedBalances(bs: Pick<BalanceSheet, 'assets' | 'liabilities'>): InvertedBalance[] {
  const out: InvertedBalance[] = [];
  for (const line of [...bs.assets, ...bs.liabilities]) {
    if (line.synthetic || !line.code || line.value > -0.005 || CONTRA.test(line.name)) continue;
    const group = CHECKED.find((g) => line.code.startsWith(g.prefix));
    if (group) out.push({ line, side: group.side });
  }
  return out;
}

/** Grupo do capital social no plano do CFC. */
export const CAPITAL_GROUP_CODE = '2.3.1';

/** Balanço com algum saldo, mas o capital social (2.3.1) zerado: falta registrá-lo na abertura ou por lançamento. */
export function missingShareCapital(bs: Pick<BalanceSheet, 'assets' | 'liabilities' | 'equity'>): boolean {
  const hasBalances = bs.assets.length + bs.liabilities.length + bs.equity.length > 0;
  const capital = bs.equity.find((l) => l.code === CAPITAL_GROUP_CODE)?.value ?? 0;
  return hasBalances && Math.abs(capital) < 0.005;
}

/** Grupos do PL cujo movimento exige a DMPL na pequena empresa: Capital Social e Reservas. */
export const DMPL_GROUP_CODES = ['2.3.1', '2.3.2'] as const;

export interface EquityMovement {
  accountId: string;
  code: string;
  name: string;
  /** Movimento líquido no período, credor positivo (aumento de capital ou de reserva). */
  value: number;
  /** Partidas no período (um aumento e uma redução somam zero, mas ainda são movimento). */
  count: number;
}

/**
 * Movimento em Capital Social (2.3.1) e Reservas (2.3.2) entre `start` e `end`, sem os saldos de
 * abertura. Pela NBC TG 1001, a pequena empresa só pode apresentar a DLPA no lugar da DMPL quando
 * o PL se mexe apenas em Lucros ou Prejuízos Acumulados; movimento nesses grupos exige a DMPL.
 * `openingLines` são as partidas da abertura (`openingJournals`): cada uma tira da conta a partida
 * igual (mesma data e valor), porque é saldo inicial e não mutação.
 */
export function equityMovements(
  postings: readonly Posting[],
  openingLines: readonly Posting[],
  accounts: readonly ChartAccount[],
  range: { start: string; end: string }
): EquityMovement[] {
  const inGroup = (code: string) => DMPL_GROUP_CODES.some((g) => code === g || code.startsWith(`${g}.`));
  const targets = new Map(accounts.filter((a) => inGroup(a.code)).map((a) => [a.id, a] as const));
  const key = (p: Posting) => `${p.accountId}|${p.date}|${toCents(p.value)}`;
  const opening = new Map<string, number>();
  for (const l of openingLines) if (targets.has(l.accountId)) opening.set(key(l), (opening.get(key(l)) ?? 0) + 1);

  const sums = new Map<string, { cents: number; count: number }>();
  for (const p of postings) {
    if (!targets.has(p.accountId) || p.date < range.start || p.date > range.end || toCents(p.value) === 0) continue;
    const k = key(p);
    const left = opening.get(k) ?? 0;
    if (left > 0) {
      opening.set(k, left - 1);
      continue;
    }
    const s = sums.get(p.accountId) ?? { cents: 0, count: 0 };
    sums.set(p.accountId, { cents: s.cents - toCents(p.value), count: s.count + 1 });
  }
  return [...sums]
    .map(([accountId, s]) => {
      const a = targets.get(accountId)!;
      return { accountId, code: a.code, name: a.name, value: fromCents(s.cents), count: s.count };
    })
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

/** Partidas da abertura (bancos e demais contas), no formato das partidas do razão. */
export function openingPostings(openings: OpeningBalances | null | undefined, banks: readonly BankAccount[], accounts: readonly ChartAccount[]): Posting[] {
  return openingJournals(openings, banks, accounts).flatMap((j) => j.lines.map((l) => ({ accountId: l.accountId, date: j.date, value: l.value })));
}
