import type { BankAccount, ChartAccount } from '@/types/firestore';
import { OPENING_ACCOUNT_CODE, accountKind, openingSign } from '@/lib/ledger';
import { openingAccounts, parseSignedMoneyInput } from '@/lib/opening';
import { accountMatchScore } from '@/lib/account-search';
import { normalizeText } from '@/lib/utils/search';
import { fromCents, toCents } from '@/lib/money';

/**
 * Balancete colado na tela de abertura (do Excel ou copiado de um PDF): lê cada linha (código,
 * nome e saldo), casa com as contas do plano e monta os valores a preencher. Nada é gravado
 * aqui: a tela preenche os campos e o contador salva como sempre.
 *
 * Saldo de cada linha: a coluna "Saldo atual/final" quando há cabeçalho; "Débito" − "Crédito"
 * quando só há essas colunas; sem cabeçalho, o último valor da linha (no balancete, o saldo
 * final). D/C ao lado do valor dá a natureza; sem D/C, vale o lado natural da conta, e o sinal de
 * menos ou os parênteses, o lado contrário.
 */

/** Uma linha do balancete lida do texto. */
export interface ParsedLine {
  /** Número da linha no texto colado (1 = primeira). */
  line: number;
  raw: string;
  code: string | null;
  name: string;
  /** Saldo: valor absoluto e lado. `side` null: sem D/C (lado natural, ou o contrário se `negative`). */
  amount: number | null;
  side: 'D' | 'C' | null;
  negative: boolean;
}

const CODE_RE = /^\d+(?:[.-]\d+)*$/;
/** Valor em reais: 1.234,56 · 1234,56 · (1.234,56) · -1.234,56 · 1234.56 (Excel em inglês). */
const MONEY_RE = /^\(?-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{2})\)?$|^\(?-?\d+\.\d{2}\)?$/;
/** Valor seguido de D/C colado ou separado ("1.200,00D", "1.200,00 C"). */
const MONEY_TOKEN_RE = /(\(?-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}\)?)\s*([DdCc])?(?=\s|$)/g;

interface Columns {
  code: number;
  name: number;
  balance: number;
  debit: number;
  credit: number;
  side: number;
}

function readMoney(cell: string): { amount: number; negative: boolean; side: 'D' | 'C' | null } | null {
  const t = cell.trim().replace(/\s+/g, ' ');
  const m = t.match(/^(.*?)\s*([DdCc])$/);
  const body = (m && MONEY_RE.test(m[1].trim()) ? m[1] : t).trim();
  if (!MONEY_RE.test(body)) return null;
  const parens = body.startsWith('(') && body.endsWith(')');
  const n = parseSignedMoneyInput(body.replace(/[()]/g, ''));
  if (n === null) return null;
  return { amount: Math.abs(n), negative: parens || n < 0, side: m && body !== t ? (m[2].toUpperCase() as 'D' | 'C') : null };
}

const isSideCell = (cell: string) => /^[DdCc]$/.test(cell.trim());

function headerColumns(cells: readonly string[]): Columns | null {
  const n = cells.map((c) => normalizeText(c));
  if (!n.some((c) => /saldo|debito|credito/.test(c))) return null;
  const find = (re: RegExp) => n.findIndex((c) => re.test(c));
  const balances = n.map((c, i) => (/saldo/.test(c) ? i : -1)).filter((i) => i >= 0);
  const finalBalance = balances.find((i) => /atual|final/.test(n[i])) ?? balances[balances.length - 1] ?? -1;
  return {
    code: find(/^cod|codigo|classifica|^conta$/),
    name: find(/descri|^nome|titulo|^conta contabil|^conta$/),
    balance: finalBalance,
    debit: find(/^debito/),
    credit: find(/^credito/),
    side: find(/^d\/?c$|natureza/),
  };
}

/** Lê o texto colado: linhas com conta e saldo; cabeçalhos e linhas sem valor ficam de fora. */
export function parseTrialBalanceText(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  let columns: Columns | null = null;
  text.split(/\r?\n/).forEach((rawLine, index) => {
    const raw = rawLine.replace(/ /g, ' ');
    if (!raw.trim()) return;
    const delimiter = raw.includes('\t') ? '\t' : raw.includes(';') ? ';' : null;
    if (delimiter) {
      const cells = raw.split(delimiter).map((c) => c.trim());
      const header = cells.every((c) => !readMoney(c)) ? headerColumns(cells) : null;
      if (header) {
        columns = header;
        return;
      }
      const parsed = fromCells(cells, columns);
      if (parsed) out.push({ line: index + 1, raw: raw.trim(), ...parsed });
      return;
    }
    const parsed = fromText(raw);
    if (parsed) out.push({ line: index + 1, raw: raw.trim(), ...parsed });
  });
  return out;
}

type Parsed = Omit<ParsedLine, 'line' | 'raw'>;

/** Valor de célula do Excel: aceita também sem centavos ("1200", "1.200") e com D/C. */
function readCellMoney(cell: string): ReturnType<typeof readMoney> {
  const strict = readMoney(cell);
  if (strict) return strict;
  const t = cell.trim();
  const m = t.match(/^(.*?)\s*([DdCc])$/);
  const body = (m ? m[1] : t).trim();
  if (!/^\(?-?\d[\d.,]*\)?$/.test(body)) return null;
  const n = parseSignedMoneyInput(body.replace(/[()]/g, ''));
  if (n === null) return null;
  return { amount: Math.abs(n), negative: body.startsWith('(') || n < 0, side: m ? (m[2].toUpperCase() as 'D' | 'C') : null };
}

function fromCells(cells: readonly string[], columns: Columns | null): Parsed | null {
  const at = (i: number) => (i >= 0 ? (cells[i] ?? '') : '');
  const hasLetters = (c: string) => /[a-zà-ú]/i.test(c) && !isSideCell(c);
  // Nome: a coluna do cabeçalho ou a primeira célula com letras. O código vem antes dele; os valores, depois.
  const nameAt = columns && columns.name >= 0 && hasLetters(at(columns.name)) ? columns.name : cells.findIndex(hasLetters);
  const name = nameAt >= 0 ? cells[nameAt] : '';
  const codeAt = columns && columns.code >= 0 && CODE_RE.test(at(columns.code)) ? columns.code : cells.findIndex((c, i) => (nameAt < 0 || i < nameAt) && CODE_RE.test(c));
  const code = codeAt >= 0 ? cells[codeAt] : null;
  if (!code && !name) return null;
  const sideAfter = (i: number) => (isSideCell(at(i + 1)) ? (at(i + 1).toUpperCase() as 'D' | 'C') : null);

  let money: ReturnType<typeof readMoney> = null;
  if (columns && columns.balance >= 0) {
    money = readCellMoney(at(columns.balance));
    if (money && !money.side) money.side = (columns.side >= 0 && isSideCell(at(columns.side)) ? (at(columns.side).toUpperCase() as 'D' | 'C') : null) ?? sideAfter(columns.balance);
  } else if (columns && columns.debit >= 0 && columns.credit >= 0) {
    const d = readCellMoney(at(columns.debit))?.amount ?? 0;
    const c = readCellMoney(at(columns.credit))?.amount ?? 0;
    const net = fromCents(toCents(d) - toCents(c));
    money = { amount: Math.abs(net), negative: false, side: net >= 0 ? 'D' : 'C' };
  } else {
    // Sem cabeçalho: o último valor depois do nome é o saldo final.
    const first = Math.max(nameAt, codeAt) + 1;
    for (let i = cells.length - 1; i >= first && !money; i--) {
      const m = readCellMoney(cells[i]);
      if (!m) continue;
      if (!m.side) m.side = sideAfter(i);
      money = m;
    }
  }
  return { code, name: cleanName(name), amount: money?.amount ?? null, side: money?.side ?? null, negative: money?.negative ?? false };
}

function fromText(raw: string): Parsed | null {
  const text = raw.trim();
  const tokens = [...text.matchAll(MONEY_TOKEN_RE)];
  const codeMatch = text.match(/^(\d+(?:[.-]\d+)*)\s+/);
  const code = codeMatch ? codeMatch[1] : null;
  const start = codeMatch ? codeMatch[0].length : 0;
  const end = tokens.length ? (tokens[0].index ?? text.length) : text.length;
  const name = cleanName(text.slice(start, end));
  if (!code && !/[a-zà-ú]/i.test(name)) return null;
  const last = tokens[tokens.length - 1];
  if (!last) return { code, name, amount: null, side: null, negative: false };
  const money = readMoney(last[1]);
  return { code, name, amount: money?.amount ?? null, side: last[2] ? (last[2].toUpperCase() as 'D' | 'C') : null, negative: money?.negative ?? false };
}

/** Nome sem pontilhado de preenchimento ("Caixa ........") e sem espaços repetidos. */
const cleanName = (name: string) => name.replace(/\.{2,}|_{2,}/g, ' ').replace(/\s+/g, ' ').replace(/[\s:–-]+$/, '').trim();

/* =========================================================================
   Casamento com o plano
   ========================================================================= */

export type ImportStatus = 'matched' | 'suggested' | 'unmatched' | 'ignored';

export interface ImportRow extends ParsedLine {
  status: ImportStatus;
  /** Conta do plano escolhida (a conta do banco, quando a linha é um banco). */
  accountId: string | null;
  /** Como a conta foi achada, ou por que a linha ficou de fora. */
  reason: string;
}

const normalizedName = (name: string) =>
  normalizeText(name)
    .replace(/^\(\s*[-−]\s*\)\s*/, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Casa cada linha com uma conta do plano: pelo código igual; senão, pelo nome igual; senão, a
 * conta de nome mais parecido fica como sugestão. Linhas de grupo (código que é prefixo de
 * outra linha, ou conta sintética do plano), totais, contas de resultado e saldos zerados ficam
 * de fora, com o motivo.
 */
export function matchTrialBalance(lines: readonly ParsedLine[], accounts: readonly ChartAccount[], banks: readonly BankAccount[]): ImportRow[] {
  const targets = importTargets(accounts, banks);
  const targetIds = new Set(targets.map((a) => a.id));
  const byCode = new Map(accounts.map((a) => [a.code, a] as const));
  const byName = new Map<string, ChartAccount[]>();
  for (const a of accounts) {
    const key = normalizedName(a.name);
    byName.set(key, [...(byName.get(key) ?? []), a]);
  }
  const codes = lines.map((l) => l.code).filter((c): c is string => Boolean(c));
  const isGroupCode = (code: string) => codes.some((c) => c !== code && c.startsWith(`${code}.`));

  return lines.map((l): ImportRow => {
    const ignore = (reason: string): ImportRow => ({ ...l, status: 'ignored', accountId: null, reason });
    if (/^total\b/i.test(normalizeText(l.name))) return ignore('Linha de total.');
    if (l.code && isGroupCode(l.code)) return ignore('Grupo: as contas dele vêm nas linhas abaixo.');
    if (l.amount === null) return ignore('Sem saldo na linha.');

    const verdict = (acc: ChartAccount, how: string, status: 'matched' | 'suggested'): ImportRow => {
      if (acc.nature !== 'ANALYTIC') return ignore(`Grupo do plano (${acc.code} ${acc.name}): as contas dele vêm nas linhas abaixo.`);
      if (accountKind(acc) === 'RESULT') return { ...ignore(`Conta de resultado (${acc.code} ${acc.name}).`), accountId: null };
      if (acc.code === OPENING_ACCOUNT_CODE) return ignore('Balanço de Abertura: recebe só a contrapartida automática.');
      if (!targetIds.has(acc.id)) return ignore(`${acc.code} ${acc.name} não recebe saldo de abertura.`);
      if (l.amount === 0) return { ...ignore('Saldo zerado.'), accountId: acc.id };
      return { ...l, status, accountId: acc.id, reason: how };
    };

    const coded = l.code ? byCode.get(l.code) : undefined;
    if (coded) return verdict(coded, 'Código igual ao do plano.', 'matched');
    const named = byName.get(normalizedName(l.name));
    if (named?.length === 1) return verdict(named[0], 'Nome igual ao do plano.', 'matched');
    if (l.amount === 0) return ignore('Saldo zerado.');
    const best = bestByName(targets, l.name);
    if (best) return { ...l, status: 'suggested', accountId: best.id, reason: 'Nome parecido: confira a conta.' };
    return { ...l, status: 'unmatched', accountId: null, reason: 'Nenhuma conta parecida: escolha a conta.' };
  });
}

/** Contas que podem receber valor do balancete: as que aceitam saldo de abertura e as dos bancos. */
export function importTargets(accounts: readonly ChartAccount[], banks: readonly BankAccount[]): ChartAccount[] {
  const bankLedger = new Set(banks.map((b) => b.ledgerAccountId).filter(Boolean));
  const editable = new Set(openingAccounts(accounts, banks).map((a) => a.id));
  return accounts.filter((a) => editable.has(a.id) || bankLedger.has(a.id));
}

function bestByName(targets: readonly ChartAccount[], name: string): ChartAccount | null {
  const query = normalizedName(name);
  if (query.length < 3) return null;
  let best: { account: ChartAccount; score: number } | null = null;
  for (const account of targets) {
    const score = accountMatchScore({ code: account.code, name: account.name }, query);
    if (score !== null && (!best || score < best.score)) best = { account, score };
  }
  return best?.account ?? null;
}

/* =========================================================================
   Valores a preencher
   ========================================================================= */

export interface ImportResult {
  /** Valor por conta, positivo no lado natural (como o campo da tela). */
  values: Map<string, number>;
  /** Saldo por banco, devedor positivo (como o campo do banco). */
  bankValues: Map<string, number>;
  /** Linhas incluídas. */
  used: number;
  /** Débitos e créditos das linhas incluídas, para conferir se o balancete fecha. */
  debits: number;
  credits: number;
  /** Contas que ficariam com saldo contrário à natureza (não dá para informar na abertura). */
  inverted: { accountId: string; amount: number }[];
}

/** Partida da linha assinada pelo débito, no lado da conta `acc`. */
function debitValue(row: Pick<ParsedLine, 'amount' | 'side' | 'negative'>, acc: ChartAccount): number {
  const amount = row.amount ?? 0;
  if (row.side) return row.side === 'D' ? amount : -amount;
  // Sem D/C: lado natural da conta; negativo ou entre parênteses, o contrário.
  return (row.negative ? -1 : 1) * openingSign(acc) * amount;
}

/**
 * Soma as linhas incluídas (status diferente de ignorado e com conta) por conta e por banco.
 * Várias linhas na mesma conta somam (ex.: três bancos do plano antigo numa conta só).
 */
export function buildImport(rows: readonly ImportRow[], accounts: readonly ChartAccount[], banks: readonly BankAccount[]): ImportResult {
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const bankOf = new Map<string, BankAccount>();
  for (const b of banks) if (b.ledgerAccountId && !bankOf.has(b.ledgerAccountId)) bankOf.set(b.ledgerAccountId, b);
  const debitCents = new Map<string, number>();
  let used = 0;
  let debits = 0;
  let credits = 0;
  for (const r of rows) {
    if (r.status === 'ignored' || !r.accountId || !r.amount) continue;
    const acc = byId.get(r.accountId);
    if (!acc) continue;
    const cents = toCents(debitValue(r, acc));
    debitCents.set(acc.id, (debitCents.get(acc.id) ?? 0) + cents);
    used++;
    if (cents > 0) debits += cents;
    else credits -= cents;
  }
  const values = new Map<string, number>();
  const bankValues = new Map<string, number>();
  const inverted: ImportResult['inverted'] = [];
  for (const [accountId, cents] of debitCents) {
    const acc = byId.get(accountId)!;
    const bank = bankOf.get(accountId);
    if (bank) {
      bankValues.set(bank.id, fromCents(cents));
      continue;
    }
    const natural = cents * openingSign(acc);
    if (natural < 0) inverted.push({ accountId, amount: fromCents(-natural) });
    else values.set(accountId, fromCents(natural));
  }
  return { values, bankValues, used, debits: fromCents(debits), credits: fromCents(credits), inverted };
}
