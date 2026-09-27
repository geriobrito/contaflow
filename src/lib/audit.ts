import type { AuditAction, AuditEntry, BankTransaction, ClassificationSnapshot } from '@/types/firestore';

/** Quem executa a ação (usuário autenticado). */
export interface Actor {
  uid: string;
  email?: string;
}

let seq = 0;
/** ID único e ordenável por tempo para registros de auditoria. */
export const newAuditId = (): string =>
  `audit_${Date.now().toString(36)}_${(seq++).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** Fotografia do estado de classificação de um lançamento. */
export function snapshotOf(tx: BankTransaction): ClassificationSnapshot {
  const snap: ClassificationSnapshot = { status: tx.status };
  if (tx.isSplit && tx.splits?.length) {
    snap.isSplit = true;
    snap.splits = tx.splits.map((s) => ({
      accountId: s.accountId,
      amount: s.amount,
      ...(s.accountCode ? { accountCode: s.accountCode } : {}),
      ...(s.accountName ? { accountName: s.accountName } : {}),
    }));
    return snap;
  }
  if (tx.accountId) snap.accountId = tx.accountId;
  if (tx.accountCode) snap.accountCode = tx.accountCode;
  if (tx.accountName) snap.accountName = tx.accountName;
  if (tx.matchedRuleId) snap.matchedRuleId = tx.matchedRuleId;
  return snap;
}

/** Registro de auditoria de uma mudança num lançamento (antes → depois). */
export function transactionAudit(
  action: AuditAction,
  actor: Actor,
  before: BankTransaction,
  after: BankTransaction,
  at: string,
  extra: Partial<AuditEntry> = {}
): AuditEntry {
  return {
    id: newAuditId(),
    clientId: before.clientId,
    action,
    actorUid: actor.uid,
    ...(actor.email ? { actorEmail: actor.email } : {}),
    at,
    transactionId: before.id,
    transactionDate: before.date,
    transactionMemo: before.memo,
    transactionAmount: before.amount,
    before: snapshotOf(before),
    after: snapshotOf(after),
    ...extra,
  };
}

/** Classificar um lançamento pendente é CLASSIFY; alterar um já classificado é RECLASSIFY. */
export const classifyAction = (before: BankTransaction): AuditAction =>
  before.status === 'PENDING' ? 'CLASSIFY' : 'RECLASSIFY';

/** Rótulo em português para exibição. */
export const AUDIT_LABEL: Record<AuditAction, string> = {
  CLASSIFY: 'Classificou',
  RECLASSIFY: 'Reclassificou',
  SPLIT: 'Rateou',
  UNRECONCILE: 'Desfez a conciliação',
  APPROVE: 'Aprovou',
  AUTO_CLASSIFY: 'Classificação automática',
  PERIOD_CLOSE: 'Fechou a competência',
  PERIOD_REOPEN: 'Reabriu a competência',
};

/** Descrição curta de um estado de classificação. */
export function describeSnapshot(s?: ClassificationSnapshot): string {
  if (!s) return '—';
  const status = { PENDING: 'Pendente', AUTO_CLASSIFIED: 'Auto', RECONCILED: 'Conciliado' }[s.status];
  if (s.isSplit && s.splits?.length) return `${status} · rateado em ${s.splits.length} contas`;
  if (s.accountCode || s.accountName) return `${status} · ${[s.accountCode, s.accountName].filter(Boolean).join(' ')}`;
  return status;
}
