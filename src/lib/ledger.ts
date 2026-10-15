import type { AccountType, BankAccount, BankTransaction, ChartAccount, JournalEntry, OpeningBalances } from '@/types/firestore';
import type { DateRange } from '@/lib/data/repository';
import { round2 } from '@/lib/money';

/**
 * Razão por partidas dobradas a partir do extrato, balancete de verificação e balanço
 * patrimonial.
 *
 * Cada lançamento bancário gera duas partidas de mesmo valor:
 *   - na conta contábil do banco (vínculo em Contas bancárias): entrada debita, saída credita;
 *   - na contrapartida: a conta classificada (ou as contas do rateio) em sentido oposto.
 * Lançamentos ainda não conciliados (pendentes ou aguardando aprovação) vão para a conta
 * virtual "Lançamentos a classificar", para que o saldo dos bancos bata com o extrato e o
 * balanço feche. Valores são assinados: positivo = devedor, negativo = credor.
 */

/** Contas virtuais: não existem no plano, mas aparecem no balancete/balanço para fechá-lo. */
export const VIRTUAL = {
  BANK_UNLINKED: '__bank_unlinked__',
  SUSPENSE: '__suspense__',
  OPENING: '__opening__',
  PRIOR_RESULTS: '__prior_results__',
  CURRENT_RESULT: '__current_result__',
} as const;

type VirtualId = (typeof VIRTUAL)[keyof typeof VIRTUAL];

export const VIRTUAL_LABEL: Record<VirtualId, string> = {
  [VIRTUAL.BANK_UNLINKED]: 'Bancos sem vínculo contábil',
  [VIRTUAL.SUSPENSE]: 'Lançamentos a classificar',
  [VIRTUAL.OPENING]: 'Saldos de abertura (a detalhar)',
  [VIRTUAL.PRIOR_RESULTS]: 'Resultados de exercícios anteriores',
  [VIRTUAL.CURRENT_RESULT]: 'Resultado do exercício',
};

export interface Posting {
  accountId: string;
  date: string;
  /** Positivo = débito, negativo = crédito. */
  value: number;
}


const PATRIMONIAL: ReadonlySet<AccountType> = new Set(['ASSET', 'ATIVO', 'LIABILITY', 'PASSIVO', 'EQUITY']);
const ASSET: ReadonlySet<AccountType> = new Set(['ASSET', 'ATIVO']);
const LIABILITY: ReadonlySet<AccountType> = new Set(['LIABILITY', 'PASSIVO']);

export type AccountKind = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'RESULT';

export function accountKind(account: Pick<ChartAccount, 'type'>): AccountKind {
  if (ASSET.has(account.type)) return 'ASSET';
  if (LIABILITY.has(account.type)) return 'LIABILITY';
  if (account.type === 'EQUITY') return 'EQUITY';
  return 'RESULT';
}

const VIRTUAL_KIND: Record<VirtualId, AccountKind> = {
  [VIRTUAL.BANK_UNLINKED]: 'ASSET',
  [VIRTUAL.SUSPENSE]: 'ASSET',
  [VIRTUAL.OPENING]: 'EQUITY',
  [VIRTUAL.PRIOR_RESULTS]: 'EQUITY',
  [VIRTUAL.CURRENT_RESULT]: 'EQUITY',
};

export const isVirtual = (id: string): id is VirtualId => id in VIRTUAL_LABEL;

/**
 * Retificadora (saldo contrário ao do grupo): marcada no plano (`isContra`) ou reconhecida pelo
 * nome, para planos montados à mão: "(-) Capital a Integralizar", "Depreciação Acumulada"…
 */
export function isContraAccount(account: Pick<ChartAccount, 'isContra'> & { name?: string }): boolean {
  if (account.isContra) return true;
  const name = account.name?.trim() ?? '';
  return /^\(-\)/.test(name) || /(deprecia|amortiza|exaust)\S*\s+acumulad/i.test(name);
}

/**
 * Sinal da partida de um saldo de abertura informado no lado natural da conta:
 * +1 débito, -1 crédito. Ativo é devedor; passivo e PL, credores; retificadoras invertem
 * (depreciação acumulada a crédito, capital a integralizar a débito).
 */
export function openingSign(account: Pick<ChartAccount, 'type' | 'isContra'> & { name?: string }): 1 | -1 {
  const debitNature = accountKind(account) === 'ASSET';
  return debitNature !== isContraAccount(account) ? 1 : -1;
}

/** Conta do PL que recebe a diferença do balanço de abertura sem contabilidade anterior. */
export const OPENING_ACCOUNT_CODE = '2.3.3.04';
export const DEFAULT_OPENING_MEMO = 'Balanço de abertura conforme documentação suporte';

/**
 * Contrapartida dos saldos de abertura: no balanço de abertura (modo OPENING_BALANCE), a conta
 * 2.3.3.04 do plano; na implantação com balanço anterior (ou sem a conta no plano), a virtual
 * "Saldos de abertura (a detalhar)", que zera quando ativo = passivo + PL.
 */
export function openingContraId(openings: Pick<OpeningBalances, 'mode'> | null | undefined, accounts: readonly ChartAccount[]): string {
  if (openings?.mode !== 'OPENING_BALANCE') return VIRTUAL.OPENING;
  return accounts.find((a) => a.code === OPENING_ACCOUNT_CODE && a.nature === 'ANALYTIC')?.id ?? VIRTUAL.OPENING;
}

/** Lançamento gerado pela abertura (saldo inicial de banco ou saldos das demais contas). */
export interface OpeningJournal {
  id: string;
  date: string;
  /** 'SALDO INICIAL' (banco) ou 'ABERTURA'. */
  document: string;
  memo: string;
  /** Desempate estável no mesmo dia. */
  order: string;
  /** Partidas assinadas (positivo = débito), que somam zero. */
  lines: { accountId: string; value: number; memo?: string }[];
  /** No lançamento composto do balanço de abertura: a conta 2.3.3.04, que recebe a diferença. */
  plugAccountId?: string;
}

/**
 * Lançamentos da abertura, usados igualmente pelo razão, pelo balancete e pelo Diário.
 * - Balanço de abertura (contrapartida 2.3.3.04): um lançamento composto na data da abertura,
 *   com os bancos dessa data e as demais contas, e a 2.3.3.04 pela diferença (credora quando o
 *   ativo supera passivo + PL). Bancos com saldo inicial em outra data saem à parte.
 * - Demais casos: um lançamento por banco e por conta, contra "Saldos de abertura (a detalhar)".
 */
export function openingJournals(
  openings: OpeningBalances | null | undefined,
  bankAccounts: readonly BankAccount[],
  accounts: readonly ChartAccount[]
): OpeningJournal[] {
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const ledgerOf = (b: BankAccount) => (b.ledgerAccountId && byId.has(b.ledgerAccountId) ? b.ledgerAccountId : VIRTUAL.BANK_UNLINKED);
  const contra = openingContraId(openings, accounts);
  const composite = openings && contra !== VIRTUAL.OPENING ? openings : null;
  const out: OpeningJournal[] = [];
  const main: OpeningJournal['lines'] = [];

  for (const b of bankAccounts) {
    if (!b.openingBalance || !b.openingDate) continue;
    const label = b.nickname || b.accountNumber || 'conta bancária';
    if (composite && b.openingDate === composite.date) {
      main.push({ accountId: ledgerOf(b), value: b.openingBalance, memo: `Saldo inicial — ${label}` });
      continue;
    }
    out.push({
      id: `opening_bank_${b.id}`,
      date: b.openingDate,
      document: 'SALDO INICIAL',
      memo: `Saldo inicial — ${label}`,
      order: `0_${b.id}`,
      lines: [
        { accountId: ledgerOf(b), value: b.openingBalance },
        { accountId: contra, value: -b.openingBalance },
      ],
    });
  }

  if (openings) {
    for (const e of openings.entries) {
      const acc = byId.get(e.accountId);
      if (!acc || !e.amount || accountKind(acc) === 'RESULT') continue;
      const value = openingSign(acc) * e.amount;
      if (composite) {
        main.push({ accountId: acc.id, value });
        continue;
      }
      out.push({
        id: `opening_${acc.id}`,
        date: openings.date,
        document: 'ABERTURA',
        memo: `Saldo de abertura — ${acc.name}`,
        order: `1_${acc.code}`,
        lines: [
          { accountId: acc.id, value },
          { accountId: contra, value: -value },
        ],
      });
    }
  }

  if (composite && main.length > 0) {
    const net = main.reduce((s, l) => s + Math.round(l.value * 100), 0);
    out.push({
      id: `opening_${composite.clientId}`,
      date: composite.date,
      document: 'ABERTURA',
      memo: composite.memo?.trim() || DEFAULT_OPENING_MEMO,
      order: '0',
      lines: net === 0 ? main : [...main, { accountId: contra, value: -net / 100 }],
      plugAccountId: contra,
    });
  }
  return out;
}

/** O movimento do extrato conta a partir do dia do saldo inicial (posição no início do dia). */
export const countsAfterOpening = (date: string, openingDate: string | undefined): boolean => !openingDate || date >= openingDate;

/**
 * Partidas de todos os lançamentos (e dos saldos iniciais dos bancos) até `until`.
 *
 * `carry` são os saldos já consolidados dos lançamentos bancários anteriores aos de
 * `transactions` (um snapshot de competência fechada; ver src/lib/snapshots.ts). Entram como
 * partidas na data do snapshot, no lugar dos lançamentos que resumem.
 */
export function buildPostings(
  transactions: readonly BankTransaction[],
  bankAccounts: readonly BankAccount[],
  accounts: readonly ChartAccount[],
  until?: string,
  openings?: OpeningBalances | null,
  journalEntries?: readonly JournalEntry[] | null,
  carry?: readonly Posting[] | null
): Posting[] {
  const known = new Set(accounts.map((a) => a.id));
  const ledgerByKey = new Map(
    bankAccounts.filter((b) => b.ledgerAccountId && known.has(b.ledgerAccountId)).map((b) => [b.accountKey, b.ledgerAccountId!] as const)
  );
  const out: Posting[] = carry ? carry.filter((p) => !until || p.date <= until) : [];

  // Saldos iniciais dos bancos e das demais contas patrimoniais (ver `openingJournals`).
  for (const j of openingJournals(openings, bankAccounts, accounts)) {
    if (until && j.date > until) continue;
    for (const l of j.lines) out.push({ accountId: l.accountId, date: j.date, value: l.value });
  }

  for (const t of transactions) {
    if (until && t.date > until) continue;
    // Movimento anterior ao saldo inicial informado já está contido nele.
    if (!countsAfterOpening(t.date, bankAccounts.find((b) => b.accountKey === t.accountKey)?.openingDate)) continue;
    const bank = (t.accountKey && ledgerByKey.get(t.accountKey)) || VIRTUAL.BANK_UNLINKED;
    out.push({ accountId: bank, date: t.date, value: t.amount });

    const counter =
      t.status !== 'RECONCILED'
        ? [{ accountId: VIRTUAL.SUSPENSE as string, amount: t.amount }]
        : t.isSplit && t.splits?.length
          ? t.splits.map((s) => ({ accountId: s.accountId, amount: s.amount }))
          : [{ accountId: t.accountId ?? VIRTUAL.SUSPENSE, amount: t.amount }];
    for (const c of counter) {
      out.push({ accountId: known.has(c.accountId) ? c.accountId : VIRTUAL.SUSPENSE, date: t.date, value: -c.amount });
    }
  }

  // Lançamentos manuais de fechamento (partidas dobradas avulsas)
  if (journalEntries) {
    for (const j of journalEntries) {
      if (until && j.date > until) continue;
      for (const line of j.lines) {
        if (!line.amount) continue;
        const targetAcc = known.has(line.accountId) ? line.accountId : VIRTUAL.SUSPENSE;
        const value = line.type === 'DEBIT' ? line.amount : -line.amount;
        out.push({ accountId: targetAcc, date: j.date, value });
      }
    }
  }

  return out;
}

/* =========================================================================
   Hierarquia do plano
   ========================================================================= */

/** Ancestrais de cada conta (pai, avô…), por `parentId` ou, na falta, pelo prefixo do código. */
function ancestorsOf(accounts: readonly ChartAccount[]): Map<string, string[]> {
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const byCode = new Map(accounts.map((a) => [a.code, a] as const));
  const parent = (a: ChartAccount): ChartAccount | undefined => {
    if (a.parentId && byId.has(a.parentId)) return byId.get(a.parentId);
    const i = a.code.lastIndexOf('.');
    return i > 0 ? byCode.get(a.code.slice(0, i)) : undefined;
  };
  const out = new Map<string, string[]>();
  for (const a of accounts) {
    const chain: string[] = [];
    const seen = new Set<string>([a.id]);
    for (let p = parent(a); p && !seen.has(p.id); p = parent(p)) {
      chain.push(p.id);
      seen.add(p.id);
    }
    out.set(a.id, chain);
  }
  return out;
}

const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code, undefined, { numeric: true });

/* =========================================================================
   Balancete de verificação
   ========================================================================= */

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  level: number;
  synthetic: boolean;
  kind: AccountKind;
  /** Saldos assinados (positivo = devedor). */
  previous: number;
  debits: number;
  credits: number;
  final: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  /** Somas das contas analíticas/virtuais (as sintéticas repetiriam valores). */
  totals: { previous: number; debits: number; credits: number; final: number };
  /** Débitos = créditos e saldos somando zero. */
  balanced: boolean;
}

const yearStart = (date: string) => `${date.slice(0, 4)}-01-01`;

/**
 * Balancete do período: saldo anterior, débitos, créditos e saldo atual por conta.
 * Contas de resultado acumulam só dentro do exercício (desde 1º de janeiro); o resultado
 * de exercícios anteriores aparece numa linha própria do patrimônio líquido.
 */
export function buildTrialBalance(postings: readonly Posting[], accounts: readonly ChartAccount[], range: DateRange): TrialBalance {
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const exercise = yearStart(range.start);
  const kindOf = (id: string): AccountKind => (isVirtual(id) ? VIRTUAL_KIND[id] : byId.has(id) ? accountKind(byId.get(id)!) : 'ASSET');

  const leaf = new Map<string, { previous: number; debits: number; credits: number }>();
  const bucket = (id: string) => {
    let b = leaf.get(id);
    if (!b) leaf.set(id, (b = { previous: 0, debits: 0, credits: 0 }));
    return b;
  };

  for (const p of postings) {
    if (p.date > range.end) continue;
    const result = kindOf(p.accountId) === 'RESULT';
    if (p.date < range.start) {
      // Resultado de exercícios encerrados é transferido ao PL.
      if (result && p.date < exercise) bucket(VIRTUAL.PRIOR_RESULTS).previous += p.value;
      else bucket(p.accountId).previous += p.value;
    } else if (p.value >= 0) bucket(p.accountId).debits += p.value;
    else bucket(p.accountId).credits += -p.value;
  }

  const ancestors = ancestorsOf(accounts);
  const parents = new Set([...ancestors.values()].flat());
  const agg = new Map<string, { previous: number; debits: number; credits: number }>();
  for (const [id, v] of leaf) {
    for (const target of [id, ...(ancestors.get(id) ?? [])]) {
      const a = agg.get(target) ?? { previous: 0, debits: 0, credits: 0 };
      a.previous += v.previous;
      a.debits += v.debits;
      a.credits += v.credits;
      agg.set(target, a);
    }
  }

  const rows: TrialBalanceRow[] = [];
  for (const [id, v] of agg) {
    const final = round2(v.previous + v.debits - v.credits);
    if (!round2(v.previous) && !round2(v.debits) && !round2(v.credits)) continue;
    const acc = byId.get(id);
    rows.push({
      accountId: id,
      code: acc?.code ?? '',
      name: acc?.name ?? (isVirtual(id) ? VIRTUAL_LABEL[id] : 'Conta removida'),
      level: acc?.level ?? acc?.code.split('.').length ?? 4,
      synthetic: acc ? acc.nature === 'SYNTHETIC' || parents.has(id) : false,
      kind: kindOf(id),
      previous: round2(v.previous),
      debits: round2(v.debits),
      credits: round2(v.credits),
      final,
    });
  }
  rows.sort((a, b) => (a.code && b.code ? byCode(a, b) : a.code ? -1 : b.code ? 1 : a.name.localeCompare(b.name)));

  const leaves = rows.filter((r) => !r.synthetic);
  const totals = {
    previous: round2(leaves.reduce((s, r) => s + r.previous, 0)),
    debits: round2(leaves.reduce((s, r) => s + r.debits, 0)),
    credits: round2(leaves.reduce((s, r) => s + r.credits, 0)),
    final: round2(leaves.reduce((s, r) => s + r.final, 0)),
  };
  return { rows, totals, balanced: Math.abs(totals.debits - totals.credits) < 0.005 && Math.abs(totals.final) < 0.005 };
}

/* =========================================================================
   Balanço patrimonial
   ========================================================================= */

export interface BalanceSheetLine {
  accountId: string;
  code: string;
  name: string;
  level: number;
  synthetic: boolean;
  /** Na natureza do lado: ativo devedor positivo; passivo/PL credor positivo. Retificadoras ficam negativas. */
  value: number;
}

export interface BalanceSheet {
  date: string;
  assets: BalanceSheetLine[];
  liabilities: BalanceSheetLine[];
  equity: BalanceSheetLine[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  /** Ativo − (Passivo + PL); zero quando o balanço fecha. */
  difference: number;
  /** Saldo em "Lançamentos a classificar" (pendências que ainda afetam o balanço). */
  suspense: number;
  unlinkedBanks: number;
}

/**
 * Balanço em `date`: contas patrimoniais com saldo acumulado, mais o resultado do
 * exercício (1º de janeiro até a data) e o de exercícios anteriores no PL.
 */
export function buildBalanceSheet(postings: readonly Posting[], accounts: readonly ChartAccount[], date: string): BalanceSheet {
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const exercise = yearStart(date);
  const balances = new Map<string, number>();
  const add = (id: string, v: number) => balances.set(id, (balances.get(id) ?? 0) + v);

  for (const p of postings) {
    if (p.date > date) continue;
    const acc = byId.get(p.accountId);
    const kind = isVirtual(p.accountId) ? VIRTUAL_KIND[p.accountId] : acc ? accountKind(acc) : 'ASSET';
    if (kind === 'RESULT') add(p.date < exercise ? VIRTUAL.PRIOR_RESULTS : VIRTUAL.CURRENT_RESULT, p.value);
    else add(p.accountId, p.value);
  }

  const suspense = round2(balances.get(VIRTUAL.SUSPENSE) ?? 0);
  const ancestors = ancestorsOf(accounts);
  const parents = new Set([...ancestors.values()].flat());
  const sides = { assets: new Map<string, number>(), liabilities: new Map<string, number>(), equity: new Map<string, number>() };

  for (const [id, raw] of balances) {
    if (!round2(raw)) continue;
    let side: keyof typeof sides;
    if (id === VIRTUAL.SUSPENSE) side = raw >= 0 ? 'assets' : 'liabilities';
    else {
      const kind = isVirtual(id) ? VIRTUAL_KIND[id] : byId.has(id) ? accountKind(byId.get(id)!) : 'ASSET';
      side = kind === 'ASSET' ? 'assets' : kind === 'LIABILITY' ? 'liabilities' : 'equity';
    }
    const value = side === 'assets' ? raw : -raw;
    for (const target of [id, ...(isVirtual(id) ? [] : (ancestors.get(id) ?? []))]) {
      sides[side].set(target, (sides[side].get(target) ?? 0) + value);
    }
  }

  const lines = (m: Map<string, number>): BalanceSheetLine[] =>
    [...m]
      .filter(([, v]) => round2(v) !== 0)
      .map(([id, v]) => {
        const acc = byId.get(id);
        return {
          accountId: id,
          code: acc?.code ?? '',
          name: acc?.name ?? (isVirtual(id) ? VIRTUAL_LABEL[id] : 'Conta removida'),
          level: acc?.level ?? 4,
          synthetic: parents.has(id),
          value: round2(v),
        };
      })
      // Linhas sem código (contas virtuais) em ordem fixa, e não na ordem em que as partidas chegaram.
      .sort((a, b) => (a.code && b.code ? byCode(a, b) : a.code ? -1 : b.code ? 1 : a.name.localeCompare(b.name)));

  // Total do lado: só as contas-folha (as sintéticas já somam as filhas).
  const total = (m: Map<string, number>) => round2([...m].filter(([id]) => !parents.has(id)).reduce((s, [, v]) => s + v, 0));

  const totalAssets = total(sides.assets);
  const totalLiabilities = total(sides.liabilities);
  const totalEquity = total(sides.equity);
  return {
    date,
    assets: lines(sides.assets),
    liabilities: lines(sides.liabilities),
    equity: lines(sides.equity),
    totalAssets,
    totalLiabilities,
    totalEquity,
    difference: round2(totalAssets - totalLiabilities - totalEquity),
    suspense,
    unlinkedBanks: round2(balances.get(VIRTUAL.BANK_UNLINKED) ?? 0),
  };
}

/** Grupo do patrimônio líquido no plano do CFC: vira o título da seção do PL nos relatórios. */
export const EQUITY_GROUP_CODE = '2.3';

/**
 * Linhas de um lado do balanço sem as que os relatórios já mostram como título de seção: as
 * raízes (1 Ativo; 2 Passivo e PL, que se repetiria no passivo e no PL) e o grupo da seção.
 */
export function sectionLines(lines: readonly BalanceSheetLine[], sectionCode?: string): BalanceSheetLine[] {
  return lines.filter((l) => !l.code || (l.code.includes('.') && l.code !== sectionCode));
}

/** Contas patrimoniais (para validações de tela). */
export const isPatrimonial = (a: Pick<ChartAccount, 'type'>) => PATRIMONIAL.has(a.type);

/* =========================================================================
   Livro Razão Analítico (Ficha de Conta com Saldo Progressivo)
   ========================================================================= */

export interface AccountLedgerEntry {
  id: string;
  date: string;
  documentId?: string;
  memo: string;
  contraAccountId?: string;
  contraAccountCode?: string;
  contraAccountName?: string;
  debit: number;
  credit: number;
  /** Saldo absoluto acumulado linha a linha */
  balance: number;
  /** Natureza do saldo acumulado: 'D' (devedor) ou 'C' (credor) */
  balanceNature: 'D' | 'C';
}

export interface AccountLedger {
  accountId: string;
  code: string;
  name: string;
  kind: AccountKind;
  level: number;
  synthetic: boolean;
  isContra?: boolean;
  range: DateRange;
  /** Saldo anterior do período (absoluto) */
  openingBalance: number;
  /** Natureza do saldo anterior: 'D' ou 'C' */
  openingNature: 'D' | 'C';
  entries: AccountLedgerEntry[];
  totals: {
    debits: number;
    credits: number;
    netMovement: number;
    closingBalance: number;
    closingNature: 'D' | 'C';
  };
}

/**
 * Retorna o lado natural esperado do saldo de uma conta ('D' devedora, 'C' credora).
 * Ativo, Custos e Despesas são normalmente devedores (exceto contas retificadoras).
 * Passivo, Patrimônio Líquido e Receitas são normalmente credores (exceto retificadoras).
 */
export function accountNaturalNature(
  account: (Pick<ChartAccount, 'type' | 'isContra'> & { name?: string }) | VirtualId
): 'D' | 'C' {
  if (typeof account === 'string') {
    if (account === VIRTUAL.BANK_UNLINKED || account === VIRTUAL.SUSPENSE) return 'D';
    return 'C';
  }
  const kind = accountKind(account);
  if (kind === 'ASSET') return isContraAccount(account) ? 'C' : 'D';
  if (kind === 'LIABILITY' || kind === 'EQUITY') return isContraAccount(account) ? 'D' : 'C';
  if (account.type === 'REVENUE' || account.type === 'RECEITA') return 'C';
  return 'D';
}

export interface BuildAccountLedgerOptions {
  accountId: string;
  accounts: readonly ChartAccount[];
  bankAccounts: readonly BankAccount[];
  transactions: readonly BankTransaction[];
  range: DateRange;
  openings?: OpeningBalances | null;
  journalEntries?: readonly JournalEntry[] | null;
  /** Saldos consolidados anteriores a `transactions` (ver `buildPostings`); precisam ser anteriores ao exercício de `range.start`. */
  carry?: readonly Posting[] | null;
}

/**
 * Gera a ficha do Livro Razão analítico de uma conta contábil específica ou virtual.
 * Calcula o saldo anterior no corte inicial, detalha débitos e créditos com suas contrapartidas,
 * e gera o saldo progressivo cumulativo linha a linha respeitando a natureza D/C da conta.
 */
export function buildAccountLedger({
  accountId,
  accounts,
  bankAccounts,
  transactions,
  range,
  openings,
  journalEntries,
  carry,
}: BuildAccountLedgerOptions): AccountLedger {
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const known = new Set(accounts.map((a) => a.id));
  const ledgerByKey = new Map(
    bankAccounts
      .filter((b) => b.ledgerAccountId && known.has(b.ledgerAccountId))
      .map((b) => [b.accountKey, b.ledgerAccountId!] as const)
  );

  const virtual = isVirtual(accountId);
  const target = virtual ? null : byId.get(accountId);

  const ancestors = ancestorsOf(accounts);
  const parents = new Set([...ancestors.values()].flat());
  const isSynth = target ? target.nature === 'SYNTHETIC' || parents.has(target.id) : false;

  // Se a conta for sintética, agrega os movimentos dela e de todas as suas filhas analíticas.
  const targetAccountIds = new Set<string>();
  targetAccountIds.add(accountId);
  if (isSynth && target) {
    for (const [id, chain] of ancestors) {
      if (chain.includes(target.id)) {
        targetAccountIds.add(id);
      }
    }
  }

  const kind: AccountKind = virtual ? VIRTUAL_KIND[accountId as VirtualId] : target ? accountKind(target) : 'ASSET';
  const orientation: 'D' | 'C' = virtual
    ? accountNaturalNature(accountId as VirtualId)
    : target
      ? accountNaturalNature(target)
      : 'D';

  const exercise = yearStart(range.start);

  // 1. Saldo anterior acumulado antes de range.start
  const allPostings = buildPostings(transactions, bankAccounts, accounts, undefined, openings, journalEntries, carry);
  let previousSigned = 0;
  for (const p of allPostings) {
    if (!targetAccountIds.has(p.accountId)) continue;
    if (p.date < range.start) {
      const pKind = isVirtual(p.accountId) ? VIRTUAL_KIND[p.accountId as VirtualId] : byId.has(p.accountId) ? accountKind(byId.get(p.accountId)!) : 'ASSET';
      if (pKind === 'RESULT' && p.date < exercise) {
        // Resultado de exercícios anteriores não compõe saldo de resultado do ano atual
      } else {
        previousSigned += p.value;
      }
    }
  }

  const openingBalance = Math.abs(round2(previousSigned));
  const openingNature: 'D' | 'C' =
    orientation === 'D'
      ? previousSigned >= 0 ? 'D' : 'C'
      : previousSigned <= 0 ? 'C' : 'D';

  // 2. Coleta de lançamentos individuais do período
  interface RawEntry {
    id: string;
    date: string;
    documentId?: string;
    memo: string;
    contraAccountId?: string;
    contraAccountCode?: string;
    contraAccountName?: string;
    debit: number;
    credit: number;
  }
  const rawEntries: RawEntry[] = [];

  // 2.1. Saldos de abertura (bancos e demais contas) no período
  const nameOf = (id: string) => byId.get(id)?.name ?? (isVirtual(id) ? VIRTUAL_LABEL[id] : 'Conta removida');
  for (const j of openingJournals(openings, bankAccounts, accounts)) {
    if (j.date < range.start || j.date > range.end) continue;
    j.lines.forEach((l, i) => {
      if (!targetAccountIds.has(l.accountId)) return;
      const others = j.lines.filter((_, k) => k !== i);
      // Duas partidas: a outra. No lançamento composto, a 2.3.3.04 (ou "Diversos", para ela própria).
      const plug = j.plugAccountId && others.some((o) => o.accountId === j.plugAccountId) ? j.plugAccountId : null;
      const contraId = others.length === 1 ? others[0].accountId : plug;
      rawEntries.push({
        id: `${j.id}_${i}`,
        date: j.date,
        documentId: j.document,
        memo: l.memo ?? j.memo,
        contraAccountId: contraId ?? 'SPLIT',
        contraAccountCode: contraId ? (byId.get(contraId)?.code ?? '') : '',
        contraAccountName: contraId ? nameOf(contraId) : `Diversos (${others.length} contas)`,
        debit: l.value > 0 ? l.value : 0,
        credit: l.value < 0 ? -l.value : 0,
      });
    });
  }

  // 2.2. Transações bancárias
  for (const t of transactions) {
    if (t.date < range.start || t.date > range.end) continue;
    if (!countsAfterOpening(t.date, bankAccounts.find((b) => b.accountKey === t.accountKey)?.openingDate)) continue;

    const bankLedgerId = (t.accountKey && ledgerByKey.get(t.accountKey)) || VIRTUAL.BANK_UNLINKED;
    const bankAcc = byId.get(bankLedgerId);
    const bankName = bankAcc?.name ?? (bankAccounts.find((b) => b.accountKey === t.accountKey)?.nickname || 'Conta bancária');
    const bankCode = bankAcc?.code ?? '';

    // Lado do Banco
    if (targetAccountIds.has(bankLedgerId)) {
      let contraId: string;
      let contraCode = '';
      let contraName = '';
      if (t.status !== 'RECONCILED') {
        contraId = VIRTUAL.SUSPENSE;
        contraName = VIRTUAL_LABEL[VIRTUAL.SUSPENSE];
      } else if (t.isSplit && t.splits && t.splits.length > 0) {
        contraId = 'SPLIT';
        contraName = `Desdobrado (${t.splits.length} contas)`;
      } else {
        contraId = t.accountId ?? VIRTUAL.SUSPENSE;
        const cAcc = byId.get(contraId);
        contraCode = cAcc?.code ?? '';
        contraName = cAcc?.name ?? (isVirtual(contraId) ? VIRTUAL_LABEL[contraId as VirtualId] : 'Conta classificada');
      }

      rawEntries.push({
        id: `tx_${t.id}_bank`,
        date: t.date,
        documentId: t.fitid,
        memo: t.memo,
        contraAccountId: contraId,
        contraAccountCode: contraCode,
        contraAccountName: contraName,
        debit: t.amount > 0 ? t.amount : 0,
        credit: t.amount < 0 ? -t.amount : 0,
      });
    }

    // Lado da Contrapartida
    if (t.status !== 'RECONCILED') {
      if (targetAccountIds.has(VIRTUAL.SUSPENSE)) {
        rawEntries.push({
          id: `tx_${t.id}_suspense`,
          date: t.date,
          documentId: t.fitid,
          memo: t.memo,
          contraAccountId: bankLedgerId,
          contraAccountCode: bankCode,
          contraAccountName: bankName,
          debit: t.amount < 0 ? -t.amount : 0,
          credit: t.amount > 0 ? t.amount : 0,
        });
      }
    } else if (t.isSplit && t.splits && t.splits.length > 0) {
      for (const s of t.splits) {
        const sAccId = known.has(s.accountId) ? s.accountId : VIRTUAL.SUSPENSE;
        if (targetAccountIds.has(sAccId)) {
          rawEntries.push({
            id: `tx_${t.id}_split_${s.id}`,
            date: t.date,
            documentId: t.fitid,
            memo: s.memo || t.memo,
            contraAccountId: bankLedgerId,
            contraAccountCode: bankCode,
            contraAccountName: bankName,
            debit: s.amount < 0 ? -s.amount : 0,
            credit: s.amount > 0 ? s.amount : 0,
          });
        }
      }
    } else {
      const singleAccId = t.accountId && known.has(t.accountId) ? t.accountId : VIRTUAL.SUSPENSE;
      if (targetAccountIds.has(singleAccId)) {
        rawEntries.push({
          id: `tx_${t.id}_counter`,
          date: t.date,
          documentId: t.fitid,
          memo: t.memo,
          contraAccountId: bankLedgerId,
          contraAccountCode: bankCode,
          contraAccountName: bankName,
          debit: t.amount < 0 ? -t.amount : 0,
          credit: t.amount > 0 ? t.amount : 0,
        });
      }
    }
  }

  // 2.4. Lançamentos manuais de fechamento (Journal Entries)
  if (journalEntries) {
    for (const j of journalEntries) {
      if (j.date < range.start || j.date > range.end) continue;
      for (const line of j.lines) {
        const lineAcc = known.has(line.accountId) ? line.accountId : VIRTUAL.SUSPENSE;
        if (targetAccountIds.has(lineAcc)) {
          const others = j.lines.filter((o) => o.id !== line.id);
          let contraCode = '';
          let contraName = '';
          let contraId = '';
          if (others.length === 1) {
            contraId = others[0].accountId;
            const oAcc = byId.get(others[0].accountId);
            contraCode = oAcc?.code ?? '';
            contraName = oAcc?.name ?? 'Conta contrapartida';
          } else if (others.length > 1) {
            contraId = 'MULTIPLE';
            contraName = `Várias contas (${others.length} partidas)`;
          }

          rawEntries.push({
            id: `j_${j.id}_${line.id}`,
            date: j.date,
            documentId: j.entryNumber ? `L${j.entryNumber}` : 'MANUAL',
            memo: line.memo || j.memo,
            contraAccountId: contraId,
            contraAccountCode: contraCode,
            contraAccountName: contraName,
            debit: line.type === 'DEBIT' ? line.amount : 0,
            credit: line.type === 'CREDIT' ? line.amount : 0,
          });
        }
      }
    }
  }

  // Ordenação cronológica estável
  rawEntries.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  // 3. Saldo progressivo cumulativo linha a linha
  let runningSigned = previousSigned;
  const entries: AccountLedgerEntry[] = rawEntries.map((e) => {
    runningSigned += e.debit - e.credit;
    const balance = Math.abs(round2(runningSigned));
    const balanceNature: 'D' | 'C' =
      orientation === 'D'
        ? runningSigned >= 0 ? 'D' : 'C'
        : runningSigned <= 0 ? 'C' : 'D';

    return {
      ...e,
      debit: round2(e.debit),
      credit: round2(e.credit),
      balance,
      balanceNature,
    };
  });

  const totalDebits = round2(entries.reduce((s, e) => s + e.debit, 0));
  const totalCredits = round2(entries.reduce((s, e) => s + e.credit, 0));
  const closingBalance = Math.abs(round2(runningSigned));
  const closingNature: 'D' | 'C' =
    orientation === 'D'
      ? runningSigned >= 0 ? 'D' : 'C'
      : runningSigned <= 0 ? 'C' : 'D';

  return {
    accountId,
    code: target?.code ?? '',
    name: target?.name ?? (virtual ? VIRTUAL_LABEL[accountId as VirtualId] : 'Conta não encontrada'),
    kind,
    level: target?.level ?? (target ? target.code.split('.').length : 4),
    synthetic: isSynth,
    isContra: target?.isContra,
    range,
    openingBalance,
    openingNature,
    entries,
    totals: {
      debits: totalDebits,
      credits: totalCredits,
      netMovement: round2(totalDebits - totalCredits),
      closingBalance,
      closingNature,
    },
  };
}
