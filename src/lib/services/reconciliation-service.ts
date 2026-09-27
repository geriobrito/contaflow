import type { AuditEntry, BankTransaction, ChartAccount, ClassificationRule, ImportBatch, PeriodLock } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { getActor } from '@/lib/data/scope';
import { newAuditId, transactionAudit } from '@/lib/audit';
import { isMonthLocked, lockId } from '@/lib/periods';
import { pendingWonByRule } from '@/lib/reconciliation';
import { autoClassifyTransition } from '@/lib/transitions';
import { addDays, computeBalanceCheck, previousStatement } from '@/lib/statement';

/**
 * Aplica uma regra a TODOS os lançamentos pendentes do cliente no banco (não só aos
 * carregados na tela). Respeita a resolução de conflito — o lançamento só vai para a
 * regra se ela vencer as demais — e ignora competências fechadas. Grava com auditoria.
 */
export async function applyRuleToPending(args: {
  clientId: string;
  rule: ClassificationRule;
  rules: readonly ClassificationRule[];
  accountsById: ReadonlyMap<string, ChartAccount>;
  lockedMonths: ReadonlySet<string>;
  /** Pendentes que o chamador já quer excluir (ex.: o próprio lançamento sendo classificado). */
  exclude?: ReadonlySet<string>;
  now?: string;
}): Promise<BankTransaction[]> {
  const { clientId, rule, rules, accountsById, lockedMonths, exclude } = args;
  const account = accountsById.get(rule.accountId);
  if (account && account.nature !== 'ANALYTIC') return []; // regra em conta sintética não classifica
  const repo = getRepository();
  const actor = getActor();
  const now = args.now ?? new Date().toISOString();
  const pending = (await repo.listPendingTransactions(clientId)).filter(
    (t) => !exclude?.has(t.id) && !isMonthLocked(t.date, lockedMonths)
  );
  const won = pendingWonByRule(pending, rules, rule);
  if (!won.length) return [];

  const ref = {
    accountId: rule.accountId,
    accountCode: account?.code ?? rule.accountCode ?? '',
    accountName: account?.name ?? rule.accountName ?? '',
  };
  const transitions = won.map((tx) => ({ tx, ...autoClassifyTransition(tx, ref, rule.id) }));
  await repo.commitChanges({
    patches: transitions.map((t) => t.patch),
    audits: transitions.map((t) => transactionAudit('AUTO_CLASSIFY', actor, t.tx, t.after, now, { ruleId: rule.id })),
  });
  return transitions.map((t) => t.after);
}

/* =========================================================================
   Fechamento de competência
   ========================================================================= */

export async function closeMonth(clientId: string, month: string, note?: string): Promise<PeriodLock> {
  const actor = getActor();
  const now = new Date().toISOString();
  const lock: PeriodLock = {
    id: lockId(clientId, month),
    clientId,
    month,
    lockedAt: now,
    lockedByUid: actor.uid,
    ...(actor.email ? { lockedByEmail: actor.email } : {}),
  };
  const audit: AuditEntry = {
    id: newAuditId(),
    clientId,
    action: 'PERIOD_CLOSE',
    actorUid: actor.uid,
    ...(actor.email ? { actorEmail: actor.email } : {}),
    at: now,
    month,
    ...(note ? { note } : {}),
  };
  await getRepository().closePeriod(lock, audit);
  return lock;
}

export async function reopenMonth(lock: PeriodLock, reason: string): Promise<void> {
  const actor = getActor();
  const audit: AuditEntry = {
    id: newAuditId(),
    clientId: lock.clientId,
    action: 'PERIOD_REOPEN',
    actorUid: actor.uid,
    ...(actor.email ? { actorEmail: actor.email } : {}),
    at: new Date().toISOString(),
    month: lock.month,
    note: reason,
  };
  await getRepository().reopenPeriod(lock, audit);
}

/* =========================================================================
   Conferência de saldo do extrato
   ========================================================================= */

/**
 * Confere o saldo final (LEDGERBAL) de um extrato contra o extrato anterior da mesma
 * conta + a movimentação registrada entre as duas datas (inclui lançamentos já
 * existentes, então extratos sobrepostos não distorcem a conta).
 */
export async function checkStatementBalance(args: {
  clientId: string;
  batch: Pick<ImportBatch, 'accountKey' | 'ledgerBalance' | 'ledgerDate'>;
  batches: readonly ImportBatch[];
  /** Lançamentos recém-importados ainda não gravados (entram na movimentação). */
  pendingInsert?: readonly BankTransaction[];
}) {
  const { clientId, batch, batches, pendingInsert = [] } = args;
  if (!batch.accountKey || batch.ledgerBalance === undefined || !batch.ledgerDate) {
    return computeBalanceCheck({ reported: batch.ledgerBalance, movement: 0 });
  }
  const previous = previousStatement(batches, batch.accountKey, batch.ledgerDate);
  if (!previous?.ledgerDate) return computeBalanceCheck({ reported: batch.ledgerBalance, movement: 0 });

  const range = { start: addDays(previous.ledgerDate, 1), end: batch.ledgerDate };
  const stored = await getRepository().listTransactions(clientId, range);
  const seen = new Set(stored.map((t) => t.id));
  const inRange = (t: BankTransaction) => t.date >= range.start && t.date <= range.end && t.accountKey === batch.accountKey;
  const movement = [...stored.filter(inRange), ...pendingInsert.filter((t) => inRange(t) && !seen.has(t.id))].reduce(
    (sum, t) => sum + t.amount,
    0
  );
  return computeBalanceCheck({ reported: batch.ledgerBalance, previous, movement });
}
