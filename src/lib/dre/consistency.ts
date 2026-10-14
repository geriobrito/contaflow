import type { BankAccount, BankTransaction, ChartAccount, JournalEntry, OpeningBalances } from '@/types/firestore';
import { buildBalanceSheet, buildPostings, VIRTUAL, type BalanceSheet, type Posting } from '@/lib/ledger';
import { buildDRE, type DateRange, type DREStatement } from '@/lib/dre/build';
import { formatCurrency } from '@/lib/utils/formatters';
import { round2 } from '@/lib/money';
import { closingTransfer } from '@/lib/year-closing';

export interface ConsistencyIssue {
  id: string;
  type: 'SUSPENSE_ENTRIES' | 'AWAITING_APPROVAL' | 'UNLINKED_BANKS' | 'UNBALANCED_LEDGER' | 'DIVERGENCE';
  severity: 'warning' | 'error' | 'info';
  title: string;
  description: string;
  amount?: number;
}

export interface ConsistencyCheck {
  /** Se o resultado da DRE bate exatamente com o Resultado do Exercício no Balanço (diferença < R$ 0.01) */
  isConsistent: boolean;
  /** Resultado líquido da DRE no período do exercício */
  dreNetResult: number;
  /** Resultado do Exercício no Balanço (PL), mais o que o encerramento do exercício já transferiu a Lucros/Prejuízos Acumulados */
  balanceCurrentResult: number;
  /** Diferença: dreNetResult - balanceCurrentResult */
  difference: number;
  /** Saldo acumulado na conta transitória 'Lançamentos a classificar' */
  suspenseAmount: number;
  /** Quantidade de lançamentos pendentes no período do exercício */
  pendingCount: number;
  /** Quantidade de lançamentos auto-classificados aguardando aprovação */
  awaitingApprovalCount: number;
  /** Quantidade de contas bancárias sem vínculo contábil */
  unlinkedBanksCount: number;
  /** Lista de diagnósticos / motivos encontrados */
  issues: ConsistencyIssue[];
  /** Balanço patrimonial calculado na data de corte */
  balanceSheet: BalanceSheet;
  /** DRE do exercício calculada */
  exerciseDRE: DREStatement;
}


/**
 * Validação cruzada contábil por partidas dobradas:
 * Compara o Resultado Líquido da DRE acumulado no exercício (desde 1º de janeiro)
 * contra o saldo de "Resultado do Exercício" no Patrimônio Líquido do Balanço Patrimonial.
 */
export function checkAccountingConsistency({
  transactions,
  accounts,
  banks,
  date,
  openings = null,
  journalEntries = null,
  carry = null,
}: {
  transactions: readonly BankTransaction[];
  accounts: readonly ChartAccount[];
  banks: readonly BankAccount[];
  /** Data de corte da apuração (geralmente a data final do período visualizado). */
  date: string;
  openings?: OpeningBalances | null;
  journalEntries?: readonly JournalEntry[] | null;
  /** Saldos consolidados anteriores a `transactions`, sempre de antes do exercício de `date`. */
  carry?: readonly Posting[] | null;
}): ConsistencyCheck {
  const year = date.slice(0, 4);
  const exerciseStart = `${year}-01-01`;
  const exerciseRange: DateRange = { start: exerciseStart, end: date };

  // 1. DRE acumulada do exercício até a data de corte
  const exerciseDRE = buildDRE(transactions, accounts, exerciseRange, journalEntries);
  const dreNetResult = round2(exerciseDRE.netResult);

  // 2. Balanço Patrimonial em partidas dobradas até a data de corte
  const postings = buildPostings(transactions, banks, accounts, date, openings, journalEntries, carry);
  const balanceSheet = buildBalanceSheet(postings, accounts, date);

  // Exercício encerrado: o resultado saiu de "Resultado do exercício" para Lucros/Prejuízos
  // Acumulados. Soma-se o que foi transferido, para comparar com a DRE (anterior ao encerramento).
  const currentResultLine = balanceSheet.equity.find((l) => l.accountId === VIRTUAL.CURRENT_RESULT);
  const balanceCurrentResult = round2((currentResultLine?.value ?? 0) + closingTransfer(journalEntries, accounts, year, date));

  const difference = round2(dreNetResult - balanceCurrentResult);
  const isConsistent = Math.abs(difference) < 0.005;

  // 3. Levantamento de pendências no período do exercício
  const txsInExercise = transactions.filter((t) => t.date >= exerciseStart && t.date <= date);
  const pendingCount = txsInExercise.filter((t) => t.status === 'PENDING').length;
  const awaitingApprovalCount = txsInExercise.filter((t) => t.status === 'AUTO_CLASSIFIED').length;
  const suspenseAmount = round2(balanceSheet.suspense);

  const unlinkedBanks = banks.filter((b) => !b.ledgerAccountId);
  const unlinkedBanksCount = unlinkedBanks.length;

  const issues: ConsistencyIssue[] = [];

  // Diagnóstico A: Lançamentos em "Lançamentos a classificar" / pendentes
  if (Math.abs(suspenseAmount) > 0.005 || pendingCount > 0 || awaitingApprovalCount > 0) {
    const parts: string[] = [];
    if (pendingCount > 0) parts.push(`${pendingCount} lançamento(s) pendente(s)`);
    if (awaitingApprovalCount > 0) parts.push(`${awaitingApprovalCount} aguardando aprovação`);
    if (Math.abs(suspenseAmount) > 0.005) {
      parts.push(`${formatCurrency(Math.abs(suspenseAmount))} em “Lançamentos a classificar”`);
    }

    issues.push({
      id: 'suspense',
      type: 'SUSPENSE_ENTRIES',
      severity: 'warning',
      title: 'Lançamentos ainda não conciliados no exercício',
      description: `Existem ${parts.join(' e ')}. Lançamentos não conciliados afetam o saldo bancário mas não entram na DRE, ficando provisoriamente em conta transitória.`,
      amount: suspenseAmount,
    });
  }

  // Diagnóstico B: Contas bancárias sem vínculo contábil
  if (unlinkedBanksCount > 0) {
    issues.push({
      id: 'unlinked-banks',
      type: 'UNLINKED_BANKS',
      severity: 'warning',
      title: 'Contas bancárias sem conta contábil associada',
      description: `${unlinkedBanksCount} conta(s) bancária(s) (${unlinkedBanks.map((b) => b.nickname).join(', ')}) não possuem vínculo com o plano de contas. Suas movimentações foram direcionadas para “Bancos sem vínculo contábil”.`,
    });
  }

  // Diagnóstico C: Balanço desbalanceado (Ativo != Passivo + PL)
  if (Math.abs(balanceSheet.difference) > 0.005) {
    issues.push({
      id: 'unbalanced-ledger',
      type: 'UNBALANCED_LEDGER',
      severity: 'error',
      title: 'Balanço Patrimonial com diferença entre Ativo e Passivo + PL',
      description: `A soma do Ativo difere de Passivo + Patrimônio Líquido em ${formatCurrency(Math.abs(balanceSheet.difference))}. Revise os saldos de abertura na tela de Abertura.`,
      amount: balanceSheet.difference,
    });
  }

  // Diagnóstico D: Divergência entre Resultado da DRE e Resultado do Exercício no PL
  if (!isConsistent) {
    issues.push({
      id: 'divergence',
      type: 'DIVERGENCE',
      severity: 'warning',
      title: 'Divergência entre DRE e Balanço Patrimonial',
      description: `O Resultado Líquido apurado na DRE (${formatCurrency(dreNetResult)}) difere do Resultado do Exercício no Balanço (${formatCurrency(balanceCurrentResult)}) em ${formatCurrency(Math.abs(difference))}.`,
      amount: difference,
    });
  }

  return {
    isConsistent,
    dreNetResult,
    balanceCurrentResult,
    difference,
    suspenseAmount,
    pendingCount,
    awaitingApprovalCount,
    unlinkedBanksCount,
    issues,
    balanceSheet,
    exerciseDRE,
  };
}
