import type { AccountType, BankAccount, BankTransaction, ChartAccount } from '@/types/firestore';
import type { DateRange } from '@/lib/data/repository';

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
  [VIRTUAL.OPENING]: 'Saldos de abertura dos bancos (a detalhar)',
  [VIRTUAL.PRIOR_RESULTS]: 'Resultados de exercícios anteriores',
  [VIRTUAL.CURRENT_RESULT]: 'Resultado do exercício',
};

export interface Posting {
  accountId: string;
  date: string;
  /** Positivo = débito, negativo = crédito. */
  value: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

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
 * Partidas de todos os lançamentos (e dos saldos iniciais dos bancos) até `until`.
 */
export function buildPostings(
  transactions: readonly BankTransaction[],
  bankAccounts: readonly BankAccount[],
  accounts: readonly ChartAccount[],
  until?: string
): Posting[] {
  const known = new Set(accounts.map((a) => a.id));
  const ledgerByKey = new Map(
    bankAccounts.filter((b) => b.ledgerAccountId && known.has(b.ledgerAccountId)).map((b) => [b.accountKey, b.ledgerAccountId!] as const)
  );
  const out: Posting[] = [];

  for (const b of bankAccounts) {
    if (!b.openingBalance || !b.openingDate || (until && b.openingDate > until)) continue;
    const bank = ledgerByKey.get(b.accountKey) ?? VIRTUAL.BANK_UNLINKED;
    out.push({ accountId: bank, date: b.openingDate, value: b.openingBalance });
    out.push({ accountId: VIRTUAL.OPENING, date: b.openingDate, value: -b.openingBalance });
  }

  for (const t of transactions) {
    if (until && t.date > until) continue;
    // Movimento anterior ao saldo inicial informado já está contido nele.
    const opening = bankAccounts.find((b) => b.accountKey === t.accountKey)?.openingDate;
    if (opening && t.date <= opening) continue;
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
      .sort((a, b) => (a.code && b.code ? byCode(a, b) : a.code ? -1 : b.code ? 1 : 0));

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

/** Contas patrimoniais (para validações de tela). */
export const isPatrimonial = (a: Pick<ChartAccount, 'type'>) => PATRIMONIAL.has(a.type);
