import type { BankAccount, ChartAccount } from '@/types/firestore';
import { OPENING_ACCOUNT_CODE, accountKind, isContraAccount, openingSign, type AccountKind } from '@/lib/ledger';
import { buildTree, type TreeNode } from '@/lib/chart/tree';
import type { OpeningPlug } from '@/lib/opening';
import { round2 } from '@/lib/money';

/**
 * Balanço de abertura em duas colunas, como o balanço patrimonial: Ativo de um lado, Passivo e
 * PL do outro, na hierarquia do plano (seção › grupo › conta) e com subtotais. Os bancos entram
 * no lugar da conta contábil vinculada a eles, e a contrapartida automática na 2.3.3.04.
 *
 * Todo valor é guardado como contribuição à coluna em que aparece: as partidas são assinadas
 * pelo débito (positivo = débito) e, na coluna do Passivo e PL, o sinal se inverte. Assim um
 * cartão vinculado a uma conta do passivo, ou uma retificadora, somam certo sem caso especial.
 */

export type OpeningSide = 'ASSETS' | 'CLAIMS';

export interface OpeningAccountRow {
  type: 'account';
  key: string;
  account: ChartAccount;
  /** Valor informado, sempre positivo (0 quando vazio). */
  amount: number;
  /** Retificadora: o valor informado reduz o grupo. */
  contra: boolean;
  /** Contribuição à coluna (retificadora negativa). */
  value: number;
}

export interface OpeningBankRow {
  type: 'bank';
  key: string;
  bank: BankAccount;
  /** Conta contábil do banco no plano, se vinculada e patrimonial. */
  ledger: ChartAccount | null;
  /** Contribuição à coluna: saldo inicial no Ativo, o oposto no Passivo. */
  value: number;
}

export interface OpeningPlugRow {
  type: 'plug';
  key: string;
  /** A 2.3.3.04 no plano, ou null quando ainda vai ser criada ao salvar. */
  account: ChartAccount | null;
  plug: OpeningPlug;
  /** Contribuição ao PL: credora soma, devedora reduz. */
  value: number;
}

export type OpeningRow = OpeningAccountRow | OpeningBankRow | OpeningPlugRow;

export interface OpeningGroup {
  key: string;
  /** Conta sintética do grupo (ex.: 1.1.1 Disponibilidades); null nas contas soltas da seção. */
  account: ChartAccount | null;
  title: string | null;
  /** Linhas que passam no filtro. */
  rows: OpeningRow[];
  /** Soma de todas as linhas do grupo, inclusive as fora do filtro. */
  subtotal: number;
}

export interface OpeningSection {
  key: string;
  /** Conta sintética da seção (ex.: 1.1 Ativo Circulante); null em "Outras contas". */
  account: ChartAccount | null;
  title: string;
  kind: AccountKind;
  /** Grupos com ao menos uma linha no filtro. */
  groups: OpeningGroup[];
  /** Linhas da seção que existem, dentro ou fora do filtro (para "nenhuma conta neste filtro"). */
  hasRows: boolean;
  /** Contas que aceitam saldo e estão fora do filtro: as que o "+ adicionar conta" oferece. */
  addable: ChartAccount[];
  subtotal: number;
}

export interface OpeningSheet {
  assets: OpeningSection[];
  claims: OpeningSection[];
  totals: {
    assets: number;
    liabilities: number;
    /** PL com a contrapartida automática. */
    equity: number;
    /** Ativo − (passivo + PL), já com a contrapartida: zero quando a abertura fecha. */
    difference: number;
  };
}

export interface OpeningSheetInput {
  accounts: readonly ChartAccount[];
  /** Bancos como ficam ao salvar (saldo digitado). */
  banks: readonly BankAccount[];
  /** Valor informado por conta (positivo); as que não estão no mapa valem 0. */
  amounts: ReadonlyMap<string, number>;
  /** Contrapartida na 2.3.3.04 (só no balanço sem contabilidade anterior). */
  plug: OpeningPlug | null;
  /** Quais linhas aparecem; o subtotal conta todas. Padrão: todas. */
  showAccount?: (account: ChartAccount, amount: number) => boolean;
  showBank?: (bank: BankAccount) => boolean;
}

const sideOf = (kind: AccountKind): OpeningSide => (kind === 'ASSET' ? 'ASSETS' : 'CLAIMS');
/** Partida assinada pelo débito → contribuição à coluna. */
const toColumn = (debit: number, side: OpeningSide) => (side === 'ASSETS' ? debit : -debit);

const OTHER_TITLE: Record<Exclude<AccountKind, 'RESULT'>, string> = {
  ASSET: 'Outras contas do ativo',
  LIABILITY: 'Outras contas do passivo',
  EQUITY: 'Outras contas do patrimônio líquido',
};

const UNLINKED_BANKS_KEY = 'unlinked-banks';

interface DraftGroup {
  key: string;
  account: ChartAccount | null;
  title: string | null;
  all: OpeningRow[];
  shown: OpeningRow[];
  hidden: ChartAccount[];
}

interface DraftSection {
  key: string;
  account: ChartAccount | null;
  title: string;
  kind: AccountKind;
  side: OpeningSide;
  groups: DraftGroup[];
}

/** Contas analíticas abaixo de `node`, na ordem do plano. */
function analyticsUnder(node: TreeNode): ChartAccount[] {
  const out: ChartAccount[] = [];
  const walk = (n: TreeNode) => {
    if (n.account.nature === 'ANALYTIC') out.push(n.account);
    n.children.forEach(walk);
  };
  node.children.forEach(walk);
  return out;
}

export function buildOpeningSheet({ accounts, banks, amounts, plug, showAccount = () => true, showBank = () => true }: OpeningSheetInput): OpeningSheet {
  const patrimonial = accounts.filter((a) => accountKind(a) !== 'RESULT');
  const byId = new Map(patrimonial.map((a) => [a.id, a] as const));
  const banksByLedger = new Map<string, BankAccount[]>();
  const unplacedBanks: BankAccount[] = [];
  for (const b of banks) {
    const ledger = b.ledgerAccountId ? byId.get(b.ledgerAccountId) : undefined;
    if (ledger && ledger.nature === 'ANALYTIC') banksByLedger.set(ledger.id, [...(banksByLedger.get(ledger.id) ?? []), b]);
    else unplacedBanks.push(b);
  }

  let plugPlaced = false;

  /** Linhas de uma conta analítica: o(s) banco(s) vinculado(s), a contrapartida ou a própria conta. */
  const rowsOf = (account: ChartAccount, side: OpeningSide): { row: OpeningRow; shown: boolean }[] => {
    const amount = amounts.get(account.id) ?? 0;
    const out: { row: OpeningRow; shown: boolean }[] = [];
    const linked = banksByLedger.get(account.id);
    if (account.code === OPENING_ACCOUNT_CODE && plug) {
      plugPlaced = true;
      out.push({ row: plugRow(account, plug, side), shown: true });
    }
    for (const bank of linked ?? []) {
      out.push({ row: { type: 'bank', key: `bank-${bank.id}`, bank, ledger: account, value: toColumn(bank.openingBalance ?? 0, side) }, shown: showBank(bank) });
    }
    // A conta do banco e a 2.3.3.04 não recebem saldo digitado; um valor salvo antes ainda aparece, para poder ser apagado.
    const editable = !linked && account.code !== OPENING_ACCOUNT_CODE;
    if (editable || amount > 0) {
      out.push({
        row: { type: 'account', key: `acc-${account.id}`, account, amount, contra: isContraAccount(account), value: toColumn(openingSign(account) * amount, side) },
        shown: showAccount(account, amount),
      });
    }
    return out;
  };

  const group = (key: string, account: ChartAccount | null, title: string | null, list: { row: OpeningRow; shown: boolean }[]): DraftGroup => ({
    key,
    account,
    title,
    all: list.map((r) => r.row),
    shown: list.filter((r) => r.shown).map((r) => r.row),
    hidden: list.filter((r) => !r.shown && r.row.type === 'account').map((r) => (r.row as OpeningAccountRow).account),
  });

  const sections: DraftSection[] = [];
  const loose: Record<Exclude<AccountKind, 'RESULT'>, ChartAccount[]> = { ASSET: [], LIABILITY: [], EQUITY: [] };
  const pushLoose = (a: ChartAccount) => {
    const kind = accountKind(a);
    if (kind !== 'RESULT') loose[kind].push(a);
  };

  for (const root of buildTree(patrimonial)) {
    if (root.account.nature === 'ANALYTIC') {
      pushLoose(root.account);
      continue;
    }
    for (const child of root.children) {
      if (child.account.nature === 'ANALYTIC') {
        pushLoose(child.account);
        continue;
      }
      const kind = accountKind(child.account);
      const side = sideOf(kind);
      const direct: { row: OpeningRow; shown: boolean }[] = [];
      const groups: DraftGroup[] = [];
      for (const n of child.children) {
        if (n.account.nature === 'ANALYTIC') direct.push(...rowsOf(n.account, side));
        else groups.push(group(n.account.id, n.account, n.account.name, analyticsUnder(n).flatMap((a) => rowsOf(a, side))));
      }
      sections.push({
        key: child.account.id,
        account: child.account,
        title: child.account.name,
        kind,
        side,
        groups: [group(`${child.account.id}-direct`, null, null, direct), ...groups],
      });
    }
  }

  for (const kind of ['ASSET', 'LIABILITY', 'EQUITY'] as const) {
    if (!loose[kind].length) continue;
    const side = sideOf(kind);
    sections.push({ key: `other-${kind}`, account: null, title: OTHER_TITLE[kind], kind, side, groups: [group(`other-${kind}-direct`, null, null, loose[kind].flatMap((a) => rowsOf(a, side)))] });
  }

  const ensureSection = (kind: Exclude<AccountKind, 'RESULT'>): DraftSection => {
    const found = sections.find((s) => s.kind === kind);
    if (found) return found;
    const created: DraftSection = { key: `other-${kind}`, account: null, title: OTHER_TITLE[kind], kind, side: sideOf(kind), groups: [group(`other-${kind}-direct`, null, null, [])] };
    sections.push(created);
    return created;
  };

  // Bancos sem conta contábil (ou com uma que não está no plano): no topo do ativo, à vista.
  if (unplacedBanks.length) {
    const section = ensureSection('ASSET');
    const rows = unplacedBanks.map((bank) => ({ row: { type: 'bank', key: `bank-${bank.id}`, bank, ledger: null, value: bank.openingBalance ?? 0 } as OpeningBankRow, shown: showBank(bank) }));
    section.groups.unshift(group(UNLINKED_BANKS_KEY, null, 'Bancos sem conta contábil vinculada', rows));
  }

  // A 2.3.3.04 ainda não está no plano (é criada ao salvar): a contrapartida aparece no grupo de lucros ou prejuízos, ou no fim do PL.
  if (plug && !plugPlaced) {
    const section = ensureSection('EQUITY');
    const parentCode = OPENING_ACCOUNT_CODE.split('.').slice(0, -1).join('.');
    const target = section.groups.find((g) => g.account?.code === parentCode) ?? section.groups[section.groups.length - 1];
    const row = plugRow(null, plug, section.side);
    target.all.push(row);
    target.shown.push(row);
  }

  const sum = (rows: readonly OpeningRow[]) => round2(rows.reduce((s, r) => s + r.value, 0));
  const finish = (s: DraftSection): OpeningSection => {
    const groups = s.groups.map((g): OpeningGroup => ({ key: g.key, account: g.account, title: g.title, rows: g.shown, subtotal: sum(g.all) }));
    return {
      key: s.key,
      account: s.account,
      title: s.title,
      kind: s.kind,
      groups: groups.filter((g) => g.rows.length > 0),
      hasRows: s.groups.some((g) => g.all.length > 0),
      addable: s.groups.flatMap((g) => g.hidden),
      subtotal: round2(groups.reduce((t, g) => t + g.subtotal, 0)),
    };
  };

  const done = sections.map((s) => ({ side: s.side, section: finish(s) }));
  const assets = done.filter((d) => d.side === 'ASSETS').map((d) => d.section);
  const claims = done.filter((d) => d.side === 'CLAIMS').map((d) => d.section);
  const total = (list: readonly OpeningSection[], kind?: AccountKind) => round2(list.filter((s) => !kind || s.kind === kind).reduce((t, s) => t + s.subtotal, 0));
  const totals = {
    assets: total(assets),
    liabilities: total(claims, 'LIABILITY'),
    equity: round2(total(claims) - total(claims, 'LIABILITY')),
    difference: 0,
  };
  totals.difference = round2(totals.assets - totals.liabilities - totals.equity);
  return { assets, claims, totals };
}

function plugRow(account: ChartAccount | null, plug: OpeningPlug, side: OpeningSide): OpeningPlugRow {
  const debit = plug.nature === 'D' ? plug.amount : -plug.amount;
  return { type: 'plug', key: 'plug', account, plug, value: toColumn(debit, side) };
}
