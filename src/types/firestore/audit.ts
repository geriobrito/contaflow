/** Auditoria, fechamento de competências, estado dos fechamentos e saldos consolidados (snapshots). */

import type { ReconciliationStatus } from './reconciliation';

export type AuditAction =
  | 'CLASSIFY'
  | 'RECLASSIFY'
  | 'SPLIT'
  | 'UNRECONCILE'
  | 'APPROVE'
  | 'AUTO_CLASSIFY'
  | 'PERIOD_CLOSE'
  | 'PERIOD_REOPEN'
  | 'TRANSFER'
  | 'BATCH_DELETE'
  | 'MEMO_REPAIR'
  | 'OPENING_SAVE'
  | 'ACCOUNT_DELETE'
  | 'QUERY_ASK'
  | 'QUERY_RESOLVE'
  | 'JOURNAL_CREATE'
  | 'JOURNAL_UPDATE'
  | 'JOURNAL_DELETE'
  | 'YEAR_CLOSE'
  | 'YEAR_REOPEN'
  | 'ASSET_SAVE'
  | 'PREPAID_SAVE'
  | 'FINANCING_SAVE'
  | 'INVESTMENT_SAVE'
  | 'STOCK_SAVE'
  | 'PAYROLL_SAVE'
  | 'CLIENT_RESTORE';

/** Estado de classificação de um lançamento num instante (antes/depois). */
export interface ClassificationSnapshot {
  status: ReconciliationStatus;
  accountId?: string;
  accountCode?: string;
  accountName?: string;
  matchedRuleId?: string;
  isSplit?: boolean;
  splits?: { accountId: string; accountCode?: string; accountName?: string; amount: number }[];
}

/** Registro imutável da trilha de auditoria (coleção `audit_log`, somente inclusão). */
export interface AuditEntry {
  id: string;
  orgId?: string;
  clientId: string;
  action: AuditAction;
  actorUid: string;
  actorEmail?: string;
  /** ISO. No Firestore é gravado como carimbo do servidor (as regras exigem `request.time`). */
  at: string;
  transactionId?: string;
  /** Data e histórico do lançamento, para leitura da trilha sem consultar a transação. */
  transactionDate?: string;
  transactionMemo?: string;
  transactionAmount?: number;
  /** Competência (YYYY-MM) em ações de fechamento/reabertura. */
  month?: string;
  before?: ClassificationSnapshot;
  after?: ClassificationSnapshot;
  /** Regra que motivou a ação (auto-classificação). */
  ruleId?: string;
  note?: string;
}

/** Competência fechada (coleção `period_locks`, id `${clientId}_${YYYY-MM}`). */
export interface PeriodLock {
  id: string;
  orgId?: string;
  clientId: string;
  month: string;
  /** ISO. No Firestore é gravado como carimbo do servidor (as regras exigem `request.time`). */
  lockedAt: string;
  /**
   * Valor aleatório que compõe o id dos registros de auditoria do fechamento (periodAuditId).
   * Ausente em fechamentos antigos do modo local, que usam `lockedAt` no lugar.
   */
  auditKey?: string;
  lockedByUid: string;
  lockedByEmail?: string;
}

export interface LockStateEvent {
  lockId: string;
  kind: 'close' | 'reopen' | 'year';
}

/**
 * Resumo dos fechamentos de uma empresa (coleção `lock_state`, id = clientId), mantido pelas
 * regras do Firestore: `count` é quantas competências estão fechadas agora e `seq` só cresce a
 * cada fechamento de competência ou encerramento do exercício.
 */
export interface LockState {
  id: string;
  orgId?: string;
  clientId: string;
  count: number;
  seq: number;
  lastEvent?: LockStateEvent;
}

/** Quantidade de lançamentos bancários de uma competência, por situação. */
export interface MonthCounts {
  month: string;
  total: number;
  pending: number;
  auto: number;
  reconciled: number;
}

/**
 * Saldos consolidados até o fim de uma competência fechada (coleção `period_snapshots`,
 * id `${clientId}_${YYYY-MM}`). É um cache: evita reler o histórico inteiro a cada balanço.
 * Só é usado depois de conferido (`snapshotProblem` em src/lib/snapshots.ts) — se algo que
 * ele resume mudou, é descartado e refeito a partir dos lançamentos.
 */
export interface PeriodSnapshot {
  id: string;
  orgId?: string;
  clientId: string;
  month: string;
  /** Último dia coberto (YYYY-MM-DD). */
  asOf: string;
  /** Soma das partidas dos lançamentos bancários até `asOf`, por conta (positivo = devedor). */
  balances: { accountId: string; value: number }[];
  /**
   * Movimentação de cada conta bancária (chave do extrato) até `asOf`, já descontado o que
   * veio até a data do saldo inicial dela: soma direto em `bankBalanceAt`.
   */
  bankMovements: { accountKey: string; value: number }[];
  /** Lançamentos até `asOf` sem conta bancária identificada (extratos sem banco/conta). */
  unlinkedCount: number;
  /** Lançamentos bancários até `asOf`: total e contagem por competência. */
  txCount: number;
  months: MonthCounts[];
  /** Fechamento de cada competência com lançamentos (reabrir e fechar de novo invalida). */
  locks: { month: string; lockedAt: string }[];
  /** Vínculos e datas dos bancos + contas do plano de que os saldos dependem. */
  configKey: string;
  createdAt: string;
}
