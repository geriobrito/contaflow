import type { BankTransaction, TransactionSplit } from '@/types/firestore';
import type { AccountRef, TransactionPatch } from '@/lib/data/repository';

/**
 * Transições de estado de um lançamento, como funções puras.
 * Cada uma devolve o patch a gravar e o lançamento resultante (para auditoria e tela).
 */

type Field = keyof BankTransaction;
const CLASSIFICATION_FIELDS: readonly Field[] = ['accountId', 'accountCode', 'accountName', 'matchedRuleId', 'splits'];

/** Aplica um patch em memória (mesma semântica do banco: `set` sobrescreve, `remove` apaga). */
export function applyPatch(tx: BankTransaction, patch: TransactionPatch): BankTransaction {
  const next = { ...tx, ...patch.set } as BankTransaction;
  for (const f of patch.remove ?? []) delete next[f];
  return next;
}

export interface Transition {
  patch: TransactionPatch;
  after: BankTransaction;
}

function make(tx: BankTransaction, set: Partial<BankTransaction>, remove: readonly Field[]): Transition {
  const patch: TransactionPatch = { id: tx.id, date: tx.date, set, remove: remove.filter((f) => !(f in set)) };
  return { patch, after: applyPatch(tx, patch) };
}

/** Conta única (manual). Sobrescreve rateio anterior; vincula ou desvincula a regra. */
export const classifyTransition = (tx: BankTransaction, account: AccountRef, ruleId: string | null, now: string) =>
  make(
    tx,
    { status: 'RECONCILED', ...account, reconciledAt: now, isSplit: false, ...(ruleId ? { matchedRuleId: ruleId } : {}) },
    CLASSIFICATION_FIELDS
  );

/** Auto-classificação por regra (fica aguardando aprovação). */
export const autoClassifyTransition = (tx: BankTransaction, account: AccountRef, ruleId: string) =>
  make(tx, { status: 'AUTO_CLASSIFIED', ...account, matchedRuleId: ruleId, isSplit: false }, CLASSIFICATION_FIELDS);

/** Rateio em várias contas: substitui a conta única. */
export const splitTransition = (tx: BankTransaction, splits: readonly TransactionSplit[], now: string) =>
  make(tx, { status: 'RECONCILED', isSplit: true, splits: [...splits], reconciledAt: now }, CLASSIFICATION_FIELDS);

/** Desfazer: volta para PENDING e limpa conta, rateio, regra e data de conciliação. */
export const resetTransition = (tx: BankTransaction) =>
  make(tx, { status: 'PENDING', isSplit: false }, [...CLASSIFICATION_FIELDS, 'reconciledAt']);

/** Aprovação de auto-classificado: mantém a conta e marca como conciliado. */
export const approveTransition = (tx: BankTransaction, now: string) => make(tx, { status: 'RECONCILED', reconciledAt: now }, []);
