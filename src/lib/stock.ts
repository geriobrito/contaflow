import type { ChartAccount, JournalEntry, JournalEntryLine, StockControl } from '@/types/firestore';
import { fromCents, toCents } from '@/lib/money';
import { journalEntryProblem, journalTotals } from '@/lib/journal';
import { lastDayOf, monthLabel, sameDepreciation } from '@/lib/fixed-assets';
import { accountKind } from '@/lib/ledger';

/**
 * Estoque e CMV (NBC TG 1002 e 1001, seção 13): o cliente controla o estoque (Bling, planilha)
 * e manda o estoque final; o contador calcula o CMV = estoque inicial + compras − estoque final.
 * No último dia da competência, o lançamento leva o saldo contábil do estoque ao valor informado:
 * - compras lançadas no estoque: D CMV / C Estoque pela diferença (o custo das vendas);
 * - compras lançadas direto no CMV (como sugere a importação de NF-e): o estoque que sobrou
 *   volta ao ativo, D Estoque / C CMV.
 * Nos dois casos, o CMV do mês fica igual a estoque inicial + compras − estoque final.
 */

export const STOCK_DEFAULT_CODE = '1.1.3.01';
export const COST_DEFAULT_CODE = '3.2.1.01';
/** Lucros distribuídos no mês sem o CMV lançado: o lucro que serviu de base está superavaliado. */
export const DISTRIBUTED_PROFIT_CODE = '2.3.3.03';

const competence = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;
const MONTH = /^\d{4}-\d{2}$/;
const money = (cents: number) => fromCents(cents).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const STOCK_FREQUENCY_LABEL: Record<StockControl['frequency'], string> = {
  MONTHLY: 'Todo mês',
  QUARTERLY: 'Por trimestre (março, junho, setembro e dezembro)',
};

/** A competência pede o estoque final (mensal: todas; trimestral: o fim de cada trimestre). */
export function countDue(control: Pick<StockControl, 'startMonth' | 'frequency'>, month: string): boolean {
  if (month < control.startMonth) return false;
  return control.frequency === 'MONTHLY' || ['03', '06', '09', '12'].includes(month.slice(5, 7));
}

/** Competências abertas, até `untilMonth`, que pedem o estoque final e estão sem ele. */
export function missingCountMonths(control: StockControl, untilMonth: string, lockedMonths: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (let m = control.startMonth; m <= untilMonth; ) {
    if (countDue(control, m) && control.counts[m] === undefined && !lockedMonths.has(m)) out.push(m);
    const [y, mm] = m.split('-').map(Number);
    m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
  }
  return out;
}

/** Contas de estoque possíveis: analíticas do ativo circulante (1.1.3) ou qualquer analítica do ativo. */
export function stockAccounts(accounts: readonly ChartAccount[]): ChartAccount[] {
  return accounts
    .filter((a) => a.nature === 'ANALYTIC' && accountKind(a) === 'ASSET' && !a.isContra)
    .sort((a, b) => (a.code.startsWith('1.1.3') === b.code.startsWith('1.1.3') ? a.code.localeCompare(b.code, undefined, { numeric: true }) : a.code.startsWith('1.1.3') ? -1 : 1));
}

/** Contas de custo possíveis: analíticas de resultado devedoras (custos primeiro). */
export function costAccounts(accounts: readonly ChartAccount[]): ChartAccount[] {
  return accounts
    .filter((a) => a.nature === 'ANALYTIC' && (a.type === 'COST' || a.type === 'EXPENSE'))
    .sort((a, b) => (a.type === b.type ? a.code.localeCompare(b.code, undefined, { numeric: true }) : a.type === 'COST' ? -1 : 1));
}

/** Primeiro problema que impede gravar o controle, ou null. */
export function stockProblem(control: StockControl, accounts: readonly ChartAccount[]): string | null {
  if (!stockAccounts(accounts).some((a) => a.id === control.stockAccountId)) return 'Escolha a conta do estoque: uma conta analítica do ativo (ex.: 1.1.3.01).';
  if (!costAccounts(accounts).some((a) => a.id === control.costAccountId)) return 'Escolha a conta do custo: uma conta analítica de custo (ex.: 3.2.1.01).';
  if (!MONTH.test(control.startMonth)) return 'Informe a primeira competência controlada.';
  for (const [m, v] of Object.entries(control.counts)) {
    if (!MONTH.test(m) || !Number.isFinite(v) || v < 0) return 'Estoque final inválido: informe o valor do relatório (zero ou mais).';
  }
  return null;
}

/** Motivo de recusar a alteração: estoque, contas ou início numa competência fechada já lançada. */
export function stockLockProblem(before: StockControl | null, after: StockControl, lockedMonths: ReadonlySet<string>): string | null {
  if (!before) return null;
  const accountsChanged = before.stockAccountId !== after.stockAccountId || before.costAccountId !== after.costAccountId;
  const months = [...lockedMonths]
    .filter((m) => {
      const had = before.counts[m] !== undefined && m >= before.startMonth;
      const has = after.counts[m] !== undefined && m >= after.startMonth;
      return had !== has || (had && (before.counts[m] !== after.counts[m] || accountsChanged));
    })
    .sort();
  if (!months.length) return null;
  return `A competência ${months.map(competence).join(', ')} está fechada: o estoque final e as contas dela não mudam. Reabra a competência para alterar.`;
}

/* =========================================================================
   CMV do mês
   ========================================================================= */

export type StockDraft = Pick<JournalEntry, 'date' | 'memo' | 'category' | 'lines' | 'totalAmount' | 'documentRef' | 'stockMonth'>;

export interface StockFigures {
  /** Saldo contábil do estoque no fim do mês antes do ajuste (estoque inicial + compras lançadas nele). */
  ledgerCents: number;
  /** Estoque final do relatório do cliente. */
  countCents: number;
  /** Ajuste: positivo = D custo / C estoque; negativo = D estoque / C custo. */
  adjustmentCents: number;
}

export type StockStatus =
  | { kind: 'NONE' }
  /** A competência pede o estoque final e ele não foi informado (só aviso). */
  | { kind: 'MISSING' }
  | { kind: 'BLOCKED'; problem: string }
  | { kind: 'POSTED'; entry: JournalEntry; figures: StockFigures }
  | { kind: 'PENDING'; draft: StockDraft; existing: JournalEntry | null; figures: StockFigures }
  /** Estoque informado igual ao contábil: nada a lançar. */
  | { kind: 'MATCHED'; figures: StockFigures }
  | { kind: 'REMOVE'; existing: JournalEntry };

/**
 * Situação do CMV da competência. `ledgerCents` é o saldo do estoque no último dia do mês sem o
 * lançamento de CMV do próprio mês; `existing`, esse lançamento, se houver.
 */
export function stockStatus(args: {
  control: StockControl;
  month: string;
  accounts: readonly ChartAccount[];
  ledgerCents: number;
  existing: JournalEntry | null;
}): StockStatus {
  const { control, month, accounts, existing } = args;
  const count = month >= control.startMonth ? control.counts[month] : undefined;
  if (count === undefined) {
    if (existing) return { kind: 'REMOVE', existing };
    return countDue(control, month) ? { kind: 'MISSING' } : { kind: 'NONE' };
  }
  const figures: StockFigures = { ledgerCents: args.ledgerCents, countCents: toCents(count), adjustmentCents: args.ledgerCents - toCents(count) };
  if (figures.adjustmentCents === 0) return existing ? { kind: 'REMOVE', existing } : { kind: 'MATCHED', figures };

  const stock = accounts.find((a) => a.id === control.stockAccountId);
  const cost = accounts.find((a) => a.id === control.costAccountId);
  if (!stock || !cost) return { kind: 'BLOCKED', problem: 'A conta do estoque ou do custo não está mais no plano: ajuste o controle em Bens e Contratos › Estoque e CMV.' };
  const cents = Math.abs(figures.adjustmentCents);
  const sold = figures.adjustmentCents > 0;
  const memo = sold
    ? `CMV de ${monthLabel(month)}: estoque contábil ${money(figures.ledgerCents)} − estoque final ${money(figures.countCents)}`
    : `Estoque final de ${monthLabel(month)} (${money(figures.countCents)}) acima do contábil (${money(figures.ledgerCents)}): compras lançadas no custo voltam ao estoque`;
  const line = (a: ChartAccount, type: 'DEBIT' | 'CREDIT', i: number): JournalEntryLine => ({ id: `s${i}`, accountId: a.id, accountCode: a.code, accountName: a.name, type, amount: fromCents(cents), memo });
  const lines = sold ? [line(cost, 'DEBIT', 1), line(stock, 'CREDIT', 2)] : [line(stock, 'DEBIT', 1), line(cost, 'CREDIT', 2)];
  const draft: StockDraft = {
    date: lastDayOf(month),
    memo: `Custo das mercadorias vendidas pelo estoque final - competência ${competence(month)}${control.notes?.[month] ? ` (${control.notes[month]})` : ''}`,
    category: 'ADJUSTMENT',
    lines,
    totalAmount: journalTotals(lines).debit,
    documentRef: `CMV-${month}`,
    stockMonth: month,
  };
  const problem = journalEntryProblem(draft);
  if (problem) return { kind: 'BLOCKED', problem };
  if (existing && sameDepreciation(existing, draft)) return { kind: 'POSTED', entry: existing, figures };
  return { kind: 'PENDING', draft, existing, figures };
}

/**
 * Para o fechamento: o motivo de recusar, ou null. Estoque informado e não lançado trava (é um
 * clique); estoque não informado só avisa (`stockWarning`), porque há cliente que manda por trimestre.
 */
export function stockCloseProblem(status: StockStatus, month: string): string | null {
  switch (status.kind) {
    case 'PENDING':
      return status.existing
        ? `O estoque final de ${competence(month)} mudou depois do lançamento do CMV: atualize-o antes de fechar.`
        : `Lance o CMV de ${competence(month)} pelo estoque final informado (${money(Math.abs(status.figures.adjustmentCents))}) antes de fechar a competência.`;
    case 'REMOVE':
      return `O lançamento de CMV de ${competence(month)} não confere mais com o estoque informado: atualize-o antes de fechar.`;
    case 'BLOCKED':
      return status.problem;
    default:
      return null;
  }
}

/** Avisos que não travam: estoque final não informado e lucros distribuídos sem o CMV do mês. */
export function stockWarnings(status: StockStatus, month: string, distributedCents: number): string[] {
  const out: string[] = [];
  const withoutCost = status.kind === 'MISSING' || status.kind === 'NONE';
  if (status.kind === 'MISSING') out.push(`Estoque final de ${competence(month)} não informado: sem ele o CMV do mês não é lançado e o lucro fica superavaliado.`);
  if (withoutCost && distributedCents > 0) {
    out.push(`Houve distribuição de lucros em ${competence(month)} (${money(distributedCents)}) sem o CMV do mês: o lucro que serviu de base pode não existir. Peça o estoque final ao cliente.`);
  }
  return out;
}

/** Texto pronto para pedir o estoque final ao cliente (WhatsApp ou e-mail). */
export function stockRequestText(clientName: string, month: string): string {
  const day = lastDayOf(month).split('-').reverse().join('/');
  return `Olá! Para fecharmos a contabilidade de ${competence(month)} de ${clientName}, precisamos do valor total do estoque em ${day}, pelo custo de compra (sem os impostos recuperáveis), conforme o relatório do sistema de estoque (Bling, planilha ou outro). Se puder, mande também a quantidade de itens. Obrigado!`;
}
