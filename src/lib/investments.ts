import type { ChartAccount, InvestmentAccount, JournalEntry, JournalEntryLine, TaxRegime } from '@/types/firestore';
import { fromCents, toCents } from '@/lib/money';
import { journalEntryProblem, journalTotals } from '@/lib/journal';
import { lastDayOf, monthLabel, sameDepreciation } from '@/lib/fixed-assets';
import { accountKind } from '@/lib/ledger';
import type { RetentionPreset } from '@/lib/splits';

/**
 * Aplicações financeiras: aplicações e resgates vêm pelo extrato da conta corrente (a aplicação
 * é D aplicação / C banco; o resgate, D banco pelo líquido, D IR e IOF / C aplicação pelo
 * bruto). O rendimento é lançado todo mês, por competência: no último dia, a diferença entre o
 * saldo bruto do extrato da aplicação, informado pelo contador, e o saldo contábil da conta.
 */

export const INVESTMENT_DEFAULT_CODE = '1.1.1.03';
export const YIELD_CODE = '3.4.1.02.001';
/** IR do resgate no Simples Nacional (e no MEI): definitivo, despesa. */
export const REDEMPTION_IR_EXPENSE_CODE = '3.3.2.19';
/** IR do resgate no Lucro Presumido e no Real: abate o IRPJ. */
export const REDEMPTION_IR_RECOVERABLE_CODE = '1.1.2.12';
export const IOF_CODE = '3.4.1.01.003';

const competence = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;
const MONTH = /^\d{4}-\d{2}$/;

/** No Simples (e no MEI) o IR das aplicações não se recupera. */
export const irIsExpense = (regime: TaxRegime | undefined): boolean => regime === 'SIMPLES_NACIONAL' || regime === 'MEI';

/** A competência exige o saldo da aplicação. */
export const isActiveIn = (a: Pick<InvestmentAccount, 'startMonth' | 'closedMonth'>, month: string): boolean =>
  month >= a.startMonth && (!a.closedMonth || month <= a.closedMonth);

/** Contas que podem representar a aplicação: analíticas do ativo, sem as retificadoras. */
export function investmentLedgerAccounts(accounts: readonly ChartAccount[]): ChartAccount[] {
  return accounts
    .filter((a) => a.nature === 'ANALYTIC' && accountKind(a) === 'ASSET' && !a.isContra && (a.code.startsWith('1.1.') || a.code.startsWith('1.2.')))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

/** Primeiro problema que impede gravar a aplicação, ou null. */
export function investmentProblem(a: InvestmentAccount, accounts: readonly ChartAccount[]): string | null {
  if (!a.description.trim()) return 'Informe o nome da aplicação (ex.: Caixinha Nubank, CDB Itaú).';
  if (!investmentLedgerAccounts(accounts).some((x) => x.id === a.ledgerAccountId)) return 'Escolha a conta da aplicação: uma conta analítica do ativo (ex.: 1.1.1.03).';
  if (!MONTH.test(a.startMonth)) return 'Informe a primeira competência controlada.';
  if (a.closedMonth && (!MONTH.test(a.closedMonth) || a.closedMonth < a.startMonth)) return 'O encerramento não pode ser antes da primeira competência.';
  for (const [m, v] of Object.entries(a.balances)) {
    if (!MONTH.test(m) || !Number.isFinite(v) || v < 0) return 'Saldo inválido: informe o saldo bruto do extrato (zero ou mais).';
  }
  return null;
}

/** Competências fechadas em que a aplicação muda (saldo, início ou encerramento). */
function lockedChanges(before: InvestmentAccount | null, after: InvestmentAccount | null, lockedMonths: ReadonlySet<string>): string[] {
  return [...lockedMonths].filter((m) => {
    const was = before ? isActiveIn(before, m) : false;
    const is = after ? isActiveIn(after, m) : false;
    if (was !== is) return true;
    return (before?.balances[m] ?? null) !== (after?.balances[m] ?? null) && (was || is);
  });
}

/** Motivo de recusar a alteração (ou a exclusão, com `after` null), ou null. */
export function investmentLockProblem(before: InvestmentAccount | null, after: InvestmentAccount | null, lockedMonths: ReadonlySet<string>): string | null {
  const months = lockedChanges(before, after, lockedMonths).sort();
  if (!months.length) return null;
  return `A competência ${months.map(competence).join(', ')} está fechada: o saldo da aplicação nela não muda. Reabra a competência para alterar.`;
}

/** Competências abertas, até `untilMonth`, sem o saldo informado de alguma aplicação. */
export function missingBalanceMonths(investments: readonly InvestmentAccount[], untilMonth: string, lockedMonths: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const a of investments) {
    for (let m = a.startMonth; m <= untilMonth && (!a.closedMonth || m <= a.closedMonth); m = nextMonthOf(m)) {
      if (!lockedMonths.has(m) && a.balances[m] === undefined) out.add(m);
    }
  }
  return [...out].sort();
}

function nextMonthOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/* =========================================================================
   Rendimento do mês
   ========================================================================= */

export type InvestmentDraft = Pick<JournalEntry, 'date' | 'memo' | 'category' | 'lines' | 'totalAmount' | 'documentRef' | 'investmentMonth'>;

export interface YieldRow {
  ledgerAccountId: string;
  label: string;
  /** Saldo bruto informado (soma das aplicações da conta), em centavos. */
  informedCents: number;
  /** Saldo contábil sem o rendimento do mês, em centavos. */
  ledgerCents: number;
  /** Rendimento do mês (informado − contábil). */
  yieldCents: number;
}

export type InvestmentStatus =
  | { kind: 'NONE' }
  | { kind: 'MISSING'; missing: InvestmentAccount[] }
  | { kind: 'BLOCKED'; problem: string; rows: YieldRow[] }
  | { kind: 'POSTED'; entry: JournalEntry; rows: YieldRow[] }
  | { kind: 'PENDING'; draft: InvestmentDraft; existing: JournalEntry | null; rows: YieldRow[] }
  | { kind: 'REMOVE'; existing: JournalEntry };

/** Por conta do plano: saldo informado × contábil das aplicações ativas na competência. */
export function yieldRows(investments: readonly InvestmentAccount[], month: string, ledgerCents: (accountId: string) => number): YieldRow[] {
  const byAccount = new Map<string, InvestmentAccount[]>();
  for (const a of investments.filter((x) => isActiveIn(x, month))) byAccount.set(a.ledgerAccountId, [...(byAccount.get(a.ledgerAccountId) ?? []), a]);
  return [...byAccount].map(([ledgerAccountId, list]) => {
    const informedCents = list.reduce((s, a) => s + toCents(a.balances[month] ?? 0), 0);
    const ledger = ledgerCents(ledgerAccountId);
    return { ledgerAccountId, label: list.map((a) => a.description).join(', '), informedCents, ledgerCents: ledger, yieldCents: informedCents - ledger };
  });
}

/**
 * Situação do rendimento da competência. `ledgerCents` é o saldo contábil da conta no último dia
 * do mês sem o lançamento de rendimento do próprio mês; `existing`, esse lançamento, se houver.
 * - MISSING: falta o saldo de alguma aplicação;
 * - BLOCKED: o saldo contábil passa do informado (resgate, IR ou IOF não lançados) ou falta conta;
 * - PENDING / POSTED / REMOVE / NONE: como a depreciação.
 */
export function investmentStatus(args: {
  investments: readonly InvestmentAccount[];
  month: string;
  accounts: readonly ChartAccount[];
  ledgerCents: (accountId: string) => number;
  existing: JournalEntry | null;
}): InvestmentStatus {
  const { investments, month, accounts, existing } = args;
  const active = investments.filter((a) => isActiveIn(a, month));
  if (!active.length) return existing ? { kind: 'REMOVE', existing } : { kind: 'NONE' };
  const missing = active.filter((a) => a.balances[month] === undefined);
  if (missing.length) return { kind: 'MISSING', missing };

  const rows = yieldRows(active, month, args.ledgerCents);
  const over = rows.filter((r) => r.yieldCents < 0);
  if (over.length) {
    const r = over[0];
    return {
      kind: 'BLOCKED',
      rows,
      problem: `O saldo contábil de ${r.label} (${money(r.ledgerCents)}) passa do extrato da aplicação (${money(r.informedCents)}) em ${competence(month)}: falta lançar resgate, IR ou IOF, ou o saldo informado está errado. Perda da aplicação vai à mão em Lançamentos Manuais.`,
    };
  }
  const yieldAccount = accounts.find((a) => a.code === YIELD_CODE && a.nature === 'ANALYTIC');
  const positive = rows.filter((r) => r.yieldCents > 0);
  if (!positive.length) return existing ? { kind: 'REMOVE', existing } : { kind: 'NONE' };
  if (!yieldAccount) return { kind: 'BLOCKED', rows, problem: `Falta no plano, como analítica, a conta ${YIELD_CODE} Rendimentos de Aplicações Financeiras: complete o plano com o modelo.` };

  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const label = monthLabel(month);
  const lines: JournalEntryLine[] = [];
  for (const r of positive) {
    const acc = byId.get(r.ledgerAccountId);
    if (!acc) return { kind: 'BLOCKED', rows, problem: `A conta da aplicação ${r.label} não está mais no plano.` };
    const memo = `Rendimento de ${r.label} - ${label}`;
    const push = (a: ChartAccount, type: 'DEBIT' | 'CREDIT') =>
      lines.push({ id: `r${lines.length + 1}`, accountId: a.id, accountCode: a.code, accountName: a.name, type, amount: fromCents(r.yieldCents), memo });
    push(acc, 'DEBIT');
    push(yieldAccount, 'CREDIT');
  }
  const draft: InvestmentDraft = {
    date: lastDayOf(month),
    memo: `Rendimento das aplicações financeiras - competência ${competence(month)}`,
    category: 'ADJUSTMENT',
    lines,
    totalAmount: journalTotals(lines).debit,
    documentRef: `APLIC-${month}`,
    investmentMonth: month,
  };
  const problem = journalEntryProblem(draft);
  if (problem) return { kind: 'BLOCKED', rows, problem };
  if (existing && sameDepreciation(existing, draft)) return { kind: 'POSTED', entry: existing, rows };
  return { kind: 'PENDING', draft, existing, rows };
}

const money = (cents: number) => fromCents(cents).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Para o fechamento da competência: o motivo de recusar, ou null. */
export function investmentCloseProblem(status: InvestmentStatus, month: string): string | null {
  switch (status.kind) {
    case 'MISSING':
      return `Informe o saldo do extrato de ${status.missing.map((a) => a.description).join(', ')} em ${competence(month)} (Bens e Contratos › Aplicações financeiras) antes de fechar.`;
    case 'BLOCKED':
      return status.problem;
    case 'PENDING': {
      const total = status.rows.reduce((s, r) => s + Math.max(0, r.yieldCents), 0);
      return status.existing
        ? `O saldo das aplicações mudou depois do lançamento do rendimento de ${competence(month)}: atualize-o antes de fechar.`
        : `Lance o rendimento das aplicações de ${competence(month)} (${money(total)}) antes de fechar a competência.`;
    }
    case 'REMOVE':
      return `O lançamento de rendimento de ${competence(month)} não tem mais o que lançar: atualize-o antes de fechar.`;
    default:
      return null;
  }
}

/* =========================================================================
   Resgate: bruto × líquido
   ========================================================================= */

/**
 * Linhas do resgate entre o bruto que sai da aplicação e o líquido que cai na conta corrente: o
 * IR retido (despesa no Simples, a recuperar no Presumido e no Real) e o IOF (despesa).
 */
export function redemptionPresets(regime: TaxRegime | undefined): readonly RetentionPreset[] {
  return [
    irIsExpense(regime)
      ? { key: 'ir', label: 'IR retido no resgate', options: [{ code: REDEMPTION_IR_EXPENSE_CODE, hint: 'Despesa: no Simples o IR das aplicações não se recupera' }] }
      : {
          key: 'ir',
          label: 'IR retido no resgate',
          options: [
            { code: REDEMPTION_IR_RECOVERABLE_CODE, hint: 'IRRF sobre aplicações a recuperar (abate o IRPJ)' },
            { code: '1.1.2.05', hint: 'Tributos a recuperar' },
          ],
        },
    { key: 'iof', label: 'IOF', options: [{ code: IOF_CODE, hint: 'Despesa financeira' }] },
  ];
}
