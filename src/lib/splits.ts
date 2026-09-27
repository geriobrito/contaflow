import type { BankTransaction, ChartAccount, TransactionSplit } from '@/types/firestore';

/** Valores monetários são comparados em centavos inteiros para evitar erro de ponto flutuante. */
export const toCents = (value: number): number => Math.round(value * 100);
export const fromCents = (cents: number): number => cents / 100;

export interface SplitDraft {
  id: string;
  accountId: string;
  memo: string;
  /** Valor absoluto em centavos, como digitado pelo usuário. */
  cents: number;
}

export interface SplitSummary {
  totalCents: number;
  allocatedCents: number;
  remainingCents: number;
  /** Soma igual ao total (|diferença| < R$ 0,01) e todas as linhas completas. */
  isBalanced: boolean;
  isComplete: boolean;
  errors: string[];
}

/** Resume e valida um rascunho de rateio contra o valor absoluto do lançamento. */
export function summarizeSplits(
  transactionAmount: number,
  drafts: readonly SplitDraft[],
  accountsById?: ReadonlyMap<string, ChartAccount>
): SplitSummary {
  const totalCents = Math.abs(toCents(transactionAmount));
  const allocatedCents = drafts.reduce((sum, d) => sum + d.cents, 0);
  const remainingCents = totalCents - allocatedCents;
  const errors: string[] = [];

  if (drafts.length < 2) errors.push('Um rateio precisa de pelo menos duas linhas.');
  drafts.forEach((d, i) => {
    const n = i + 1;
    if (!d.accountId) errors.push(`Linha ${n}: selecione a conta.`);
    else if (accountsById && accountsById.get(d.accountId)?.nature === 'SYNTHETIC')
      errors.push(`Linha ${n}: conta sintética não recebe lançamentos.`);
    if (d.cents <= 0) errors.push(`Linha ${n}: informe um valor maior que zero.`);
  });

  const isBalanced = Math.abs(remainingCents) < 1;
  return {
    totalCents,
    allocatedCents,
    remainingCents,
    isBalanced,
    isComplete: errors.length === 0,
    errors,
  };
}

/**
 * Converte o rascunho em `TransactionSplit[]` com o sinal do lançamento original,
 * de modo que a soma dos splits reproduza exatamente `transaction.amount`.
 */
export function draftsToSplits(
  transaction: Pick<BankTransaction, 'amount'>,
  drafts: readonly SplitDraft[],
  accountsById: ReadonlyMap<string, ChartAccount>
): TransactionSplit[] {
  const sign = transaction.amount < 0 ? -1 : 1;
  return drafts.map((d) => {
    const account = accountsById.get(d.accountId);
    return {
      id: d.id,
      accountId: d.accountId,
      amount: fromCents(sign * d.cents),
      memo: d.memo.trim(),
      accountCode: account?.code,
      accountName: account?.name,
    };
  });
}

/** Converte splits gravados de volta em rascunho editável. */
export function splitsToDrafts(splits: readonly TransactionSplit[]): SplitDraft[] {
  return splits.map((s) => ({ id: s.id, accountId: s.accountId, memo: s.memo, cents: Math.abs(toCents(s.amount)) }));
}

let seq = 0;
export const newSplitId = (): string => `split_${Date.now().toString(36)}_${(seq++).toString(36)}`;
