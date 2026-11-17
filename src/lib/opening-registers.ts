import type { ChartAccount, FinancingContract, FixedAsset, InvestmentAccount, PrepaidExpense, StockControl } from '@/types/firestore';
import { assetAccounts, assetCostCents, contraCodeFor, depreciationSchedule } from '@/lib/fixed-assets';
import { prepaidSchedule } from '@/lib/prepaid-expenses';
import { installmentSchedule, shortTermLimitAt } from '@/lib/financing';
import { monthOf } from '@/lib/periods';
import { toCents } from '@/lib/money';

/**
 * Conferência do balanço de abertura com os cadastros de Bens e Contratos. Tudo o que o cadastro
 * diz ser anterior à data da abertura precisa estar nos saldos dela: o custo dos bens e a
 * depreciação acumulada até o mês anterior, o saldo a apropriar das apólices, o saldo devedor dos
 * contratos (curto e longo prazo, com os encargos a transcorrer) e o saldo das aplicações e do
 * estoque no fim do mês anterior. Divergência aqui vira diferença na conciliação com o balancete
 * de cada controle, meses depois.
 */

export type RegisterControl = 'depreciation' | 'prepaid' | 'financing' | 'investment' | 'stock';

export const REGISTER_CONTROL_LABEL: Record<RegisterControl, string> = {
  depreciation: 'Imobilizado',
  prepaid: 'Seguros e despesas antecipadas',
  financing: 'Empréstimos e financiamentos',
  investment: 'Aplicações financeiras',
  stock: 'Estoque',
};

export const REGISTER_CONTROL_HREF: Record<RegisterControl, string> = {
  depreciation: '/imobilizado',
  prepaid: '/despesas-antecipadas',
  financing: '/financiamentos',
  investment: '/aplicacoes',
  stock: '/estoque',
};

export interface OpeningRegisters {
  assets: readonly FixedAsset[];
  prepaid: readonly PrepaidExpense[];
  contracts: readonly FinancingContract[];
  investments: readonly InvestmentAccount[];
  stock: StockControl | null;
}

export interface RegisterExpectation {
  /** Conta do plano (null quando o código esperado não existe no plano da empresa). */
  accountId: string | null;
  accountCode: string;
  control: RegisterControl;
  /** Saldo esperado na abertura, no lado natural da conta (retificadora positiva), em centavos. */
  cents: number;
  /** De onde vem o valor (ex.: "2 bem(ns)", "saldo de 02/2026"). */
  parts: string[];
}

/** Mês anterior (YYYY-MM). */
function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

const mmYYYY = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;

/** Saldos que os cadastros esperam na abertura de `date` (YYYY-MM-DD, início do dia), por conta. */
export function registerExpectations(reg: OpeningRegisters, date: string, accounts: readonly ChartAccount[]): RegisterExpectation[] {
  const month = monthOf(date);
  const before = previousMonth(month);
  const byCode = new Map(accounts.map((a) => [a.code, a] as const));
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const out = new Map<string, RegisterExpectation & { count: number; unit: string }>();

  const add = (control: RegisterControl, ref: { id?: string; code?: string }, cents: number, unit: string, part?: string) => {
    if (cents <= 0) return;
    const account = (ref.id ? byId.get(ref.id) : undefined) ?? (ref.code ? byCode.get(ref.code) : undefined);
    const code = account?.code ?? ref.code ?? '';
    const key = `${control}|${account?.id ?? code}`;
    const cur = out.get(key) ?? { accountId: account?.id ?? null, accountCode: code, control, cents: 0, parts: [], count: 0, unit };
    cur.cents += cents;
    cur.count += 1;
    if (part && !cur.parts.includes(part)) cur.parts.push(part);
    out.set(key, cur);
  };

  // Imobilizado: bens adquiridos antes da abertura e ainda não baixados; depreciação até o mês anterior.
  for (const a of reg.assets) {
    if (!a.acquisitionDate || a.acquisitionDate >= date || (a.disposal && a.disposal.date < date)) continue;
    add('depreciation', { id: a.accountId, code: a.accountCode }, assetCostCents(a), 'bem(ns)');
    const accumulated = depreciationSchedule(a, null)
      .filter((q) => q.month < month)
      .reduce((s, q) => s + q.cents, 0);
    add('depreciation', { code: contraCodeFor(a.accountCode) }, accumulated, 'bem(ns)', `até ${mmYYYY(before)}`);
  }

  // Despesas antecipadas: o que falta apropriar das apólices contratadas antes da abertura.
  for (const p of reg.prepaid) {
    if (!p.startDate || p.startDate >= date) continue;
    const used = prepaidSchedule(p, null)
      .filter((q) => q.month < month)
      .reduce((s, q) => s + q.cents, 0);
    add('prepaid', { id: p.assetAccountId, code: p.assetAccountCode }, toCents(p.amount) - used, 'apólice(s)/contrato(s)');
  }

  // Contratos: parcelas que vencem a partir da abertura, separadas pelo limite do curto prazo.
  for (const c of reg.contracts) {
    if (!c.date || c.date >= date) continue;
    const open = installmentSchedule(c).filter((r) => r.dueDate >= date);
    if (!open.length) continue;
    const limit = shortTermLimitAt(c, before);
    const short = open.filter((r) => r.dueDate <= limit);
    const long = open.filter((r) => r.dueDate > limit);
    const sum = (list: typeof open, k: 'payment' | 'interest') => list.reduce((s, r) => s + r[k], 0);
    const unit = 'contrato(s)';
    add('financing', { id: c.shortTermAccountId, code: c.shortTermAccountCode }, sum(short, 'payment'), unit, `${short.length} parcela(s) no curto prazo`);
    add('financing', { id: c.longTermAccountId, code: c.longTermAccountCode }, sum(long, 'payment'), unit, `${long.length} parcela(s) no longo prazo`);
    if (c.interestMode === 'PREFIXED') {
      if (c.chargesShortAccountId) add('financing', { id: c.chargesShortAccountId, code: c.chargesShortAccountCode }, sum(short, 'interest'), unit, 'juros a transcorrer');
      if (c.chargesLongAccountId) add('financing', { id: c.chargesLongAccountId, code: c.chargesLongAccountCode }, sum(long, 'interest'), unit, 'juros a transcorrer');
    }
  }

  // Aplicações e estoque: o saldo informado no fim do mês anterior à abertura.
  for (const inv of reg.investments) {
    if (inv.startMonth > before || (inv.closedMonth && inv.closedMonth < before)) continue;
    const balance = inv.balances[before];
    if (balance === undefined) continue;
    add('investment', { id: inv.ledgerAccountId, code: inv.ledgerAccountCode }, toCents(balance), 'aplicação(ões)', `saldo de ${mmYYYY(before)}`);
  }
  const stock = reg.stock;
  if (stock && stock.startMonth <= before && stock.counts[before] !== undefined) {
    add('stock', { id: stock.stockAccountId, code: stock.stockAccountCode }, toCents(stock.counts[before]), 'contagem', `estoque de ${mmYYYY(before)}`);
  }

  return [...out.values()]
    .map(({ count, unit, ...e }) => ({ ...e, parts: [`${count} ${unit}`, ...e.parts] }))
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode, undefined, { numeric: true }));
}

export type CheckStatus = 'ok' | 'diverges' | 'missing-account' | 'unregistered';

export interface OpeningRegisterCheck {
  key: string;
  accountId: string | null;
  accountCode: string;
  control: RegisterControl;
  /** Esperado pelo cadastro (centavos; zero em `unregistered`). */
  expectedCents: number;
  /** Informado na abertura (centavos). */
  enteredCents: number;
  parts: string[];
  status: CheckStatus;
}

/**
 * Cadastro × abertura, por conta. Além das contas que os cadastros esperam, aponta as contas do
 * imobilizado com saldo na abertura e nenhum bem cadastrado: sem o cadastro, a depreciação delas
 * nunca é lançada.
 */
export function checkOpeningAgainstRegisters(args: {
  expectations: readonly RegisterExpectation[];
  /** Valores informados na abertura, por conta (reais, positivos). */
  amounts: ReadonlyMap<string, number>;
  accounts: readonly ChartAccount[];
}): OpeningRegisterCheck[] {
  const out: OpeningRegisterCheck[] = args.expectations.map((e) => {
    const entered = e.accountId ? toCents(args.amounts.get(e.accountId) ?? 0) : 0;
    return {
      key: `${e.control}|${e.accountId ?? e.accountCode}`,
      accountId: e.accountId,
      accountCode: e.accountCode,
      control: e.control,
      expectedCents: e.cents,
      enteredCents: entered,
      parts: e.parts,
      status: !e.accountId ? 'missing-account' : entered === e.cents ? 'ok' : 'diverges',
    };
  });
  const covered = new Set(args.expectations.filter((e) => e.control === 'depreciation').map((e) => e.accountId));
  for (const a of assetAccounts(args.accounts)) {
    const entered = toCents(args.amounts.get(a.id) ?? 0);
    if (entered <= 0 || covered.has(a.id)) continue;
    out.push({ key: `unregistered|${a.id}`, accountId: a.id, accountCode: a.code, control: 'depreciation', expectedCents: 0, enteredCents: entered, parts: [], status: 'unregistered' });
  }
  return out.sort((a, b) => a.accountCode.localeCompare(b.accountCode, undefined, { numeric: true }));
}
