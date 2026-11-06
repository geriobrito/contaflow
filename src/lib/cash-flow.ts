import type { BankAccount, BankTransaction, CashFlowActivity, ChartAccount, JournalEntry, OpeningBalances } from '@/types/firestore';
import type { DateRange } from '@/lib/data/repository';
import { accountKind, isVirtual, ledgerEntries, VIRTUAL, type AccountKind, type Posting } from '@/lib/ledger';
import { fromCents, toCents } from '@/lib/money';

/**
 * Demonstração dos Fluxos de Caixa (DFC) pelo método direto (NBC TG 1001, seção 7; NBC TG 03).
 *
 * Caixa e equivalentes de caixa são as Disponibilidades (1.1.1) e as contas contábeis dos bancos.
 * Cada lançamento do período que movimenta caixa vira fluxo pela contrapartida: um recebimento
 * classificado em Receita Bruta é "Recebimentos de clientes", um pagamento em Imobilizado é
 * "Aquisição de imobilizado". A contrapartida decide a atividade (operacional, investimento ou
 * financiamento) e a linha, pelo código no modelo de plano de contas do CFC; o contador pode
 * trocar a atividade de uma conta (ou de um grupo) no Plano de contas.
 *
 * Ficam de fora os lançamentos sem caixa (depreciação, provisões, encerramento do exercício) e
 * as transferências entre contas de caixa. Os saldos de implantação entram no caixa inicial.
 */

export type FlowActivity = Exclude<CashFlowActivity, 'CASH'>;

export const FLOW_ACTIVITIES: readonly FlowActivity[] = ['OPERATING', 'INVESTING', 'FINANCING'];

export const CASH_FLOW_ACTIVITY_LABEL: Record<CashFlowActivity, string> = {
  OPERATING: 'Operacional',
  INVESTING: 'Investimento',
  FINANCING: 'Financiamento',
  CASH: 'Caixa e equivalentes de caixa',
};

const SECTION_TITLE: Record<FlowActivity, string> = {
  OPERATING: 'Fluxos de caixa das atividades operacionais',
  INVESTING: 'Fluxos de caixa das atividades de investimento',
  FINANCING: 'Fluxos de caixa das atividades de financiamento',
};

const ACTIVITY_NOUN: Record<FlowActivity, string> = {
  OPERATING: 'operacionais',
  INVESTING: 'de investimento',
  FINANCING: 'de financiamento',
};

/* =========================================================================
   Linhas da DFC pelo modelo de plano de contas do CFC
   ========================================================================= */

interface LineDef {
  activity: CashFlowActivity;
  /** Rótulo das entradas e das saídas (método direto: recebimentos e pagamentos brutos). */
  in: string;
  out: string;
}

/** Linhas na ordem em que aparecem (dentro de cada atividade, entradas antes das saídas). */
const LINES = {
  customers: { activity: 'OPERATING', in: 'Recebimentos de clientes', out: 'Devoluções e descontos a clientes' },
  interestReceived: { activity: 'OPERATING', in: 'Juros e rendimentos recebidos', out: 'Estornos de receitas financeiras' },
  otherOperating: { activity: 'OPERATING', in: 'Outros recebimentos operacionais', out: 'Outros pagamentos operacionais' },
  suppliers: { activity: 'OPERATING', in: 'Devoluções e reembolsos de fornecedores', out: 'Pagamentos a fornecedores' },
  employees: { activity: 'OPERATING', in: 'Reembolsos de empregados', out: 'Pagamentos a empregados, pró-labore e encargos' },
  expenses: { activity: 'OPERATING', in: 'Reembolsos de despesas operacionais', out: 'Pagamentos de despesas operacionais' },
  taxes: { activity: 'OPERATING', in: 'Tributos restituídos', out: 'Tributos pagos' },
  interestPaid: { activity: 'OPERATING', in: 'Estornos de despesas financeiras', out: 'Juros e despesas financeiras pagos' },
  fixedAssets: { activity: 'INVESTING', in: 'Recebimentos pela venda de imobilizado e intangível', out: 'Aquisição de imobilizado e intangível' },
  investments: { activity: 'INVESTING', in: 'Resgates e recebimentos de investimentos', out: 'Aplicações em investimentos' },
  partnerCredits: { activity: 'INVESTING', in: 'Recebimento de empréstimos concedidos a sócios', out: 'Empréstimos concedidos a sócios' },
  otherInvesting: { activity: 'INVESTING', in: 'Outros recebimentos de investimentos', out: 'Outros pagamentos de investimentos' },
  loans: { activity: 'FINANCING', in: 'Empréstimos e financiamentos obtidos', out: 'Pagamento de empréstimos e financiamentos' },
  partnerLoans: { activity: 'FINANCING', in: 'Empréstimos de sócios recebidos', out: 'Devolução de empréstimos a sócios' },
  capital: { activity: 'FINANCING', in: 'Integralização de capital', out: 'Redução de capital' },
  equity: { activity: 'FINANCING', in: 'Aportes dos sócios', out: 'Lucros distribuídos aos sócios' },
  otherFinancing: { activity: 'FINANCING', in: 'Outros recebimentos de financiamentos', out: 'Outros pagamentos de financiamentos' },
  cash: { activity: 'CASH', in: '', out: '' },
} as const satisfies Record<string, LineDef>;

type LineKey = keyof typeof LINES;
const LINE_ORDER = Object.keys(LINES) as LineKey[];

/**
 * Código do modelo → linha. Vale o prefixo mais longo, e só se a conta tiver a natureza
 * esperada pelo modelo (um plano montado à mão com outra numeração cai na regra geral).
 */
const RULES: readonly { prefix: string; kind: AccountKind; line: LineKey }[] = [
  { prefix: '1.1.1', kind: 'ASSET', line: 'cash' },
  { prefix: '1.1.2', kind: 'ASSET', line: 'otherOperating' },
  { prefix: '1.1.2.01', kind: 'ASSET', line: 'customers' },
  { prefix: '1.1.2.02', kind: 'ASSET', line: 'customers' },
  { prefix: '1.1.2.03', kind: 'ASSET', line: 'suppliers' },
  { prefix: '1.1.2.04', kind: 'ASSET', line: 'employees' },
  { prefix: '1.1.2.05', kind: 'ASSET', line: 'taxes' },
  { prefix: '1.1.2.07', kind: 'ASSET', line: 'taxes' },
  { prefix: '1.1.2.08', kind: 'ASSET', line: 'taxes' },
  { prefix: '1.1.2.09', kind: 'ASSET', line: 'taxes' },
  { prefix: '1.1.2.10', kind: 'ASSET', line: 'taxes' },
  { prefix: '1.1.2.11', kind: 'ASSET', line: 'fixedAssets' },
  { prefix: '1.1.2.12', kind: 'ASSET', line: 'taxes' },
  { prefix: '1.1.3', kind: 'ASSET', line: 'suppliers' },
  { prefix: '1.1.4', kind: 'ASSET', line: 'expenses' },
  { prefix: '1.2.1', kind: 'ASSET', line: 'otherOperating' },
  { prefix: '1.2.1.01', kind: 'ASSET', line: 'partnerCredits' },
  { prefix: '1.2.2', kind: 'ASSET', line: 'investments' },
  { prefix: '1.2.3', kind: 'ASSET', line: 'fixedAssets' },
  { prefix: '1.2.4', kind: 'ASSET', line: 'fixedAssets' },
  { prefix: '2.1', kind: 'LIABILITY', line: 'otherOperating' },
  { prefix: '2.1.1', kind: 'LIABILITY', line: 'employees' },
  { prefix: '2.1.2', kind: 'LIABILITY', line: 'suppliers' },
  { prefix: '2.1.3', kind: 'LIABILITY', line: 'expenses' },
  { prefix: '2.1.4', kind: 'LIABILITY', line: 'loans' },
  { prefix: '2.1.5', kind: 'LIABILITY', line: 'taxes' },
  { prefix: '2.2.1', kind: 'LIABILITY', line: 'loans' },
  { prefix: '2.2.2.01', kind: 'LIABILITY', line: 'taxes' },
  { prefix: '2.2.2.02', kind: 'LIABILITY', line: 'partnerLoans' },
  { prefix: '2.3', kind: 'EQUITY', line: 'equity' },
  { prefix: '2.3.1', kind: 'EQUITY', line: 'capital' },
  { prefix: '3.1.1', kind: 'RESULT', line: 'customers' },
  { prefix: '3.1.2', kind: 'RESULT', line: 'taxes' },
  { prefix: '3.1.2.04', kind: 'RESULT', line: 'customers' },
  { prefix: '3.1.2.05', kind: 'RESULT', line: 'customers' },
  { prefix: '3.2', kind: 'RESULT', line: 'suppliers' },
  { prefix: '3.3', kind: 'RESULT', line: 'expenses' },
  { prefix: '3.3.2.01', kind: 'RESULT', line: 'employees' },
  { prefix: '3.3.2.02', kind: 'RESULT', line: 'employees' },
  { prefix: '3.3.2.03', kind: 'RESULT', line: 'employees' },
  { prefix: '3.3.2.04', kind: 'RESULT', line: 'employees' },
  { prefix: '3.3.2.05', kind: 'RESULT', line: 'employees' },
  { prefix: '3.3.9', kind: 'RESULT', line: 'otherOperating' },
  { prefix: '3.3.9.02', kind: 'RESULT', line: 'fixedAssets' },
  { prefix: '3.3.9.04', kind: 'RESULT', line: 'fixedAssets' },
  { prefix: '3.4.1.01', kind: 'RESULT', line: 'interestPaid' },
  { prefix: '3.4.1.02', kind: 'RESULT', line: 'interestReceived' },
];

const underPrefix = (code: string, prefix: string) => code === prefix || code.startsWith(`${prefix}.`);

/** Linha sugerida pelo código (modelo do CFC) ou, fora do modelo, pela natureza e pelo nome. */
function suggestedLine(account: Pick<ChartAccount, 'code' | 'name' | 'type'>): LineKey {
  const kind = accountKind(account);
  let best: (typeof RULES)[number] | undefined;
  for (const r of RULES) {
    if (r.kind === kind && underPrefix(account.code, r.prefix) && (!best || r.prefix.length > best.prefix.length)) best = r;
  }
  if (best) return best.line;
  switch (kind) {
    case 'RESULT':
      return 'otherOperating';
    case 'EQUITY':
      return 'equity';
    case 'LIABILITY':
      return /empr[eé]stim|financiament|m[uú]tuo/i.test(account.name) ? 'loans' : 'otherOperating';
    default:
      return underPrefix(account.code, '1.2') ? 'otherInvesting' : 'otherOperating';
  }
}

/** Atividade sugerida para a conta, sem considerar a escolha do contador. */
export function suggestedCashFlowActivity(account: Pick<ChartAccount, 'code' | 'name' | 'type'>): CashFlowActivity {
  return LINES[suggestedLine(account)].activity;
}

/** Escolha do contador na própria conta ou no grupo mais próximo acima dela. */
function chosenActivity(account: ChartAccount, byId: Map<string, ChartAccount>, byCode: Map<string, ChartAccount>): CashFlowActivity | undefined {
  const seen = new Set<string>();
  for (let a: ChartAccount | undefined = account; a && !seen.has(a.id); ) {
    if (a.cashFlowActivity) return a.cashFlowActivity;
    seen.add(a.id);
    const i = a.code.lastIndexOf('.');
    a = a.parentId && byId.has(a.parentId) ? byId.get(a.parentId) : i > 0 ? byCode.get(a.code.slice(0, i)) : undefined;
  }
  return undefined;
}

/**
 * Atividade que a conta tem quando ela mesma não traz escolha: a do grupo mais próximo com
 * escolha do contador ou, sem nenhuma, a sugerida pelo código. Mostrada como padrão na edição.
 */
export function defaultCashFlowActivity(account: ChartAccount, accounts: readonly ChartAccount[]): CashFlowActivity {
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const byCode = new Map(accounts.map((a) => [a.code, a] as const));
  const own = byId.get(account.id) ?? account;
  return chosenActivity({ ...own, cashFlowActivity: undefined }, byId, byCode) ?? suggestedCashFlowActivity(account);
}

/** Onde a conta entra na DFC: caixa, uma linha do modelo, ou uma linha própria (atividade trocada). */
type Placement = { cash: true } | { cash: false; activity: FlowActivity; key: string; in: string; out: string; order: number };

function placementOf(account: ChartAccount, byId: Map<string, ChartAccount>, byCode: Map<string, ChartAccount>): Placement {
  const line = suggestedLine(account);
  const chosen = chosenActivity(account, byId, byCode);
  const activity = chosen ?? LINES[line].activity;
  if (activity === 'CASH') return { cash: true };
  if (activity === LINES[line].activity) {
    return { cash: false, activity, key: line, in: LINES[line].in, out: LINES[line].out, order: LINE_ORDER.indexOf(line) };
  }
  // Atividade trocada pelo contador: a conta sai numa linha com o próprio nome, no fim da atividade.
  return { cash: false, activity, key: `account:${account.id}`, in: account.name, out: account.name, order: LINE_ORDER.length };
}

/* =========================================================================
   Demonstração
   ========================================================================= */

export interface CashFlowLineAccount {
  accountId: string;
  code: string;
  name: string;
  value: number;
}

export interface CashFlowLine {
  key: string;
  label: string;
  /** Positivo = entrada; negativo = saída. */
  value: number;
  /** Contas que formam a linha (contrapartidas dos lançamentos de caixa), por código. */
  accounts: CashFlowLineAccount[];
}

export interface CashFlowSection {
  activity: FlowActivity;
  title: string;
  lines: CashFlowLine[];
  total: number;
}

export interface CashFlowStatement {
  start: string;
  end: string;
  sections: CashFlowSection[];
  /** Movimento de caixa ainda sem classificação (lançamentos pendentes ou aguardando aprovação). */
  unclassified: number;
  netChange: number;
  /** Caixa no início, incluídos os saldos de implantação lançados dentro do período. */
  openingCash: number;
  /** Parte do caixa inicial que vem de saldos de implantação lançados dentro do período. */
  implantationCash: number;
  closingCash: number;
  /** Saldo final das contas de caixa pelo razão; deve ser igual a `closingCash`. */
  ledgerClosingCash: number;
  /** `ledgerClosingCash − closingCash`; zero quando a DFC fecha com o balanço. */
  difference: number;
  /** Contas analíticas tratadas como caixa e equivalentes, por código. */
  cashAccounts: { accountId: string; code: string; name: string }[];
}

export interface BuildCashFlowArgs {
  transactions: readonly BankTransaction[];
  banks: readonly BankAccount[];
  accounts: readonly ChartAccount[];
  range: DateRange;
  openings?: OpeningBalances | null;
  journalEntries?: readonly JournalEntry[] | null;
  /** Saldos consolidados anteriores (snapshot); precisam terminar antes de `range.start`. */
  carry?: readonly Posting[] | null;
}

/** Contas de caixa e equivalentes: as de atividade CASH e as contas contábeis dos bancos. */
export function cashAccountIds(accounts: readonly ChartAccount[], banks: readonly Pick<BankAccount, 'ledgerAccountId'>[]): Set<string> {
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const byCode = new Map(accounts.map((a) => [a.code, a] as const));
  const ids = new Set<string>([VIRTUAL.BANK_UNLINKED]);
  for (const a of accounts) if (placementOf(a, byId, byCode).cash) ids.add(a.id);
  for (const b of banks) if (b.ledgerAccountId && byId.has(b.ledgerAccountId)) ids.add(b.ledgerAccountId);
  return ids;
}

export function buildCashFlow({ transactions, banks, accounts, range, openings, journalEntries, carry }: BuildCashFlowArgs): CashFlowStatement {
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const byCode = new Map(accounts.map((a) => [a.code, a] as const));
  const cash = cashAccountIds(accounts, banks);
  const placements = new Map<string, Placement>();
  const placement = (id: string): Placement | null => {
    const acc = byId.get(id);
    if (!acc) return null;
    let p = placements.get(id);
    if (!p) placements.set(id, (p = placementOf(acc, byId, byCode)));
    return p;
  };

  let opening = 0;
  let implantation = 0;
  let unclassified = 0;
  let ledgerClosing = 0;
  const lines = new Map<string, { activity: FlowActivity; label: string; order: number; inflow: boolean; cents: number; accounts: Map<string, number> }>();

  for (const p of carry ?? []) {
    if (p.date > range.end || !cash.has(p.accountId)) continue;
    const c = toCents(p.value);
    ledgerClosing += c;
    // O consolidado não diz a contrapartida: o que caísse dentro do período fica "não classificado".
    if (p.date < range.start) opening += c;
    else unclassified += c;
  }

  for (const e of ledgerEntries(transactions, banks, accounts, range.end, openings, journalEntries)) {
    const cashCents = e.lines.reduce((s, l) => s + (cash.has(l.accountId) ? toCents(l.value) : 0), 0);
    ledgerClosing += cashCents;
    if (e.date < range.start) {
      opening += cashCents;
      continue;
    }
    if (e.source === 'opening') {
      opening += cashCents;
      implantation += cashCents;
      continue;
    }
    // Sem efeito no caixa: lançamento sem conta de caixa ou transferência entre contas de caixa.
    if (cashCents === 0) continue;

    for (const l of e.lines) {
      if (cash.has(l.accountId)) continue;
      const flow = -toCents(l.value);
      if (!flow) continue;
      const p = isVirtual(l.accountId) ? null : placement(l.accountId);
      if (!p || p.cash) {
        unclassified += flow;
        continue;
      }
      const inflow = flow > 0;
      const key = `${p.key}:${inflow ? 'in' : 'out'}`;
      let line = lines.get(key);
      if (!line) {
        line = { activity: p.activity, label: inflow ? p.in : p.out, order: p.order, inflow, cents: 0, accounts: new Map() };
        lines.set(key, line);
      }
      line.cents += flow;
      line.accounts.set(l.accountId, (line.accounts.get(l.accountId) ?? 0) + flow);
    }
  }

  const byAccountCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code, undefined, { numeric: true });
  const sections: CashFlowSection[] = FLOW_ACTIVITIES.map((activity) => {
    const list = [...lines.entries()]
      .filter(([, l]) => l.activity === activity && l.cents !== 0)
      .sort(([ka, a], [kb, b]) => Number(b.inflow) - Number(a.inflow) || a.order - b.order || ka.localeCompare(kb))
      .map(([key, l]): CashFlowLine => ({
        key,
        label: l.label,
        value: fromCents(l.cents),
        accounts: [...l.accounts]
          .filter(([, v]) => v !== 0)
          .map(([id, v]) => ({ accountId: id, code: byId.get(id)?.code ?? '', name: byId.get(id)?.name ?? 'Conta removida', value: fromCents(v) }))
          .sort(byAccountCode),
      }));
    const totalCents = list.reduce((s, l) => s + toCents(l.value), 0);
    return { activity, title: SECTION_TITLE[activity], lines: list, total: fromCents(totalCents) };
  });

  const netCents = sections.reduce((s, sec) => s + toCents(sec.total), 0) + unclassified;
  const closing = opening + netCents;
  return {
    start: range.start,
    end: range.end,
    sections,
    unclassified: fromCents(unclassified),
    netChange: fromCents(netCents),
    openingCash: fromCents(opening),
    implantationCash: fromCents(implantation),
    closingCash: fromCents(closing),
    ledgerClosingCash: fromCents(ledgerClosing),
    difference: fromCents(ledgerClosing - closing),
    cashAccounts: [...cash]
      .filter((id) => byId.has(id) && byId.get(id)!.nature !== 'SYNTHETIC')
      .map((id) => ({ accountId: id, code: byId.get(id)!.code, name: byId.get(id)!.name }))
      .sort(byAccountCode),
  };
}

/* =========================================================================
   Linhas para tela e exportação
   ========================================================================= */

export type CashFlowRowKind = 'section' | 'line' | 'detail' | 'subtotal' | 'total' | 'balance';

export interface CashFlowRow {
  kind: CashFlowRowKind;
  label: string;
  /** Ausente nos títulos de seção. */
  value?: number;
  /** Código da conta, nas linhas de detalhe. */
  code?: string;
}

/** Linhas da DFC na ordem de apresentação; com `detail`, as contas de cada linha logo abaixo dela. */
export function cashFlowRows(statement: CashFlowStatement, options: { detail?: boolean } = {}): CashFlowRow[] {
  const rows: CashFlowRow[] = [];
  for (const s of statement.sections) {
    rows.push({ kind: 'section', label: s.title });
    if (s.lines.length === 0) rows.push({ kind: 'line', label: 'Sem movimentação no período', value: 0 });
    for (const l of s.lines) {
      rows.push({ kind: 'line', label: l.label, value: l.value });
      if (options.detail) for (const a of l.accounts) rows.push({ kind: 'detail', label: a.name, code: a.code, value: a.value });
    }
    rows.push({
      kind: 'subtotal',
      label: `Caixa líquido ${s.total >= 0 ? 'gerado pelas' : 'consumido nas'} atividades ${ACTIVITY_NOUN[s.activity]}`,
      value: s.total,
    });
  }
  if (statement.unclassified !== 0) {
    rows.push({ kind: 'subtotal', label: 'Movimentos bancários ainda não classificados', value: statement.unclassified });
  }
  rows.push({
    kind: 'total',
    label: `${statement.netChange >= 0 ? 'Aumento líquido' : 'Redução líquida'} de caixa e equivalentes de caixa`,
    value: statement.netChange,
  });
  rows.push({
    kind: 'balance',
    label: `Caixa e equivalentes de caixa no início do período${statement.implantationCash !== 0 ? ' (inclui saldos de implantação)' : ''}`,
    value: statement.openingCash,
  });
  rows.push({ kind: 'balance', label: 'Caixa e equivalentes de caixa no fim do período', value: statement.closingCash });
  return rows;
}
