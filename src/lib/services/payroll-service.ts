import type {
  AuditEntry,
  BankTransaction,
  ChartAccount,
  JournalEntry,
  PayrollRegister,
  PayrollSummary,
} from '@/types/firestore';
import type { DataRepository, FixedAssetJournalChange, RegisterSaveOptions } from '@/lib/data/repository';
import { getRepository } from '@/lib/services/data-service';
import { getActor, peekActor } from '@/lib/data/scope';
import { classifyAction, journalAudit, newAuditId, transactionAudit } from '@/lib/audit';
import { implantationDate, implantationProblem } from '@/lib/opening';
import { formatMonth, isMonthLocked, monthOf } from '@/lib/periods';
import { lastDayOf } from '@/lib/fixed-assets';
import { ensureTemplateAccounts } from '@/lib/services/prepaid-service';
import { partnerResetChange } from '@/lib/services/accounting-service';
import { classifyTransition } from '@/lib/transitions';
import {
  buildPayrollJournalDraft,
  buildPayrollSummary,
  missingPayrollCodes,
  nextMonthOf,
  payrollCloseProblem,
  payrollProblem,
  payrollRoutineStatus,
  requiredPayrollAccountCodes,
  resolvePayrollMapping,
  type PayrollInput,
  type PayrollObligationMatch,
  type PayrollRoutineStatus,
} from '@/lib/payroll';

export interface PayrollContext {
  register: PayrollRegister | null;
  accounts: ChartAccount[];
  lockedMonths: Set<string>;
  implantationMonth: string | null;
  implantation: string | null;
  monthEntries: JournalEntry[];
  windowTransactions: BankTransaction[];
}

export async function loadPayrollContext(
  clientId: string,
  month: string,
  repo: DataRepository = getRepository()
): Promise<PayrollContext> {
  const windowStart = `${month}-01`;
  const windowEnd = lastDayOf(nextMonthOf(month));
  const [register, accounts, locks, openings, banks, monthEntries, windowTransactions] = await Promise.all([
    repo.getPayrollRegister(clientId),
    repo.listAccounts(clientId),
    repo.listPeriodLocks(clientId),
    repo.getOpeningBalances(clientId),
    repo.listBankAccounts(clientId),
    repo.listJournalEntries(clientId, { start: `${month}-01`, end: lastDayOf(month) }),
    repo.listTransactions(clientId, { start: windowStart, end: windowEnd }),
  ]);
  const implantation = implantationDate(openings, banks);
  return {
    register,
    accounts,
    lockedMonths: new Set(locks.map((l) => l.month)),
    implantationMonth: implantation ? monthOf(implantation) : null,
    implantation,
    monthEntries,
    windowTransactions,
  };
}

const payrollAudit = (clientId: string, note: string): AuditEntry => {
  const actor = getActor();
  return {
    id: newAuditId(),
    clientId,
    action: 'PAYROLL_SAVE',
    actorUid: actor.uid,
    ...(actor.email ? { actorEmail: actor.email } : {}),
    at: new Date().toISOString(),
    note,
  };
};

const emptyRegister = (clientId: string): PayrollRegister => ({
  id: clientId,
  clientId,
  summaries: [],
  updatedAt: '',
});

const optimistic = (register: PayrollRegister | null): RegisterSaveOptions => ({
  expectedVersion: register?.version ?? null,
  expectedUpdatedAt: register?.updatedAt ?? null,
});

const newJournalId = () => `je_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

/**
 * Grava o resumo da folha de pagamento da competência e cria/atualiza o lançamento contábil
 * de provisão no último dia do mês. Garante antes as contas necessárias do modelo CFC.
 */
export async function savePayrollMonth(
  clientId: string,
  input: PayrollInput,
  ctx: PayrollContext,
  authorUid: string
): Promise<PayrollSummary> {
  if (ctx.lockedMonths.has(input.month)) {
    throw new Error(`A competência ${formatMonth(input.month)} está fechada: reabra-a para lançar ou alterar a folha de pagamento.`);
  }
  const entryDate = lastDayOf(input.month);
  const priorProblem = implantationProblem(entryDate, ctx.implantation);
  if (priorProblem) throw new Error(priorProblem);

  const problem = payrollProblem(input);
  if (problem) throw new Error(problem);

  const register = ctx.register ?? emptyRegister(clientId);
  const mapping = resolvePayrollMapping(register.defaultMapping, input.mappedAccounts);
  const requiredCodes = requiredPayrollAccountCodes(input, mapping);
  const accounts = await ensureTemplateAccounts(clientId, requiredCodes, ctx.accounts);

  const draft = buildPayrollJournalDraft(input, accounts, mapping);
  const repo = getRepository();
  const now = new Date().toISOString();

  const existingSummary = register.summaries.find((s) => s.month === input.month) ?? null;
  const existingEntry =
    ctx.monthEntries.find((e) => e.payrollMonth === input.month) ??
    (existingSummary?.journalEntryIds[0]
      ? ctx.monthEntries.find((e) => e.id === existingSummary.journalEntryIds[0])
      : undefined);

  const journalId = existingEntry?.id ?? newJournalId();
  const journal: FixedAssetJournalChange = existingEntry
    ? {
        replace: {
          id: existingEntry.id,
          draft: {
            ...existingEntry,
            ...draft,
            id: existingEntry.id,
            clientId,
            createdAt: existingEntry.createdAt,
            createdByUid: existingEntry.createdByUid,
            updatedAt: now,
          },
        },
      }
    : {
        create: {
          ...draft,
          id: journalId,
          clientId,
          createdAt: now,
          updatedAt: now,
          createdByUid: authorUid || 'local',
        },
      };

  const summary = buildPayrollSummary(clientId, input, [journalId], now, authorUid || getActor().uid);
  const summaries = existingSummary
    ? register.summaries.map((s) => (s.month === input.month ? summary : s))
    : [...register.summaries, summary].sort((a, b) => a.month.localeCompare(b.month));

  const comp = formatMonth(input.month);
  const totalFormatted = draft.totalAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  await repo.savePayrollRegister(
    {
      ...register,
      summaries,
      updatedAt: now,
      updatedByUid: getActor().uid,
    },
    payrollAudit(clientId, `${existingSummary ? 'Atualizou' : 'Contabilizou'} a folha de pagamento de ${comp} (${totalFormatted})`),
    journal,
    optimistic(ctx.register)
  );

  return summary;
}

/** Exclui o resumo da folha de pagamento da competência (mês aberto) e seu lançamento de provisão de forma atômica. */
export async function deletePayrollMonth(clientId: string, month: string, ctx: PayrollContext): Promise<void> {
  if (ctx.lockedMonths.has(month)) {
    throw new Error(`A competência ${formatMonth(month)} está fechada: reabra-a para excluir a folha de pagamento.`);
  }
  const register = ctx.register ?? emptyRegister(clientId);
  const existingSummary = register.summaries.find((s) => s.month === month);
  const existingEntry =
    ctx.monthEntries.find((e) => e.payrollMonth === month) ??
    (existingSummary?.journalEntryIds[0]
      ? ctx.monthEntries.find((e) => e.id === existingSummary.journalEntryIds[0])
      : undefined);

  const repo = getRepository();
  const deleteIds = existingEntry
    ? [existingEntry.id]
    : existingSummary?.journalEntryIds.length
      ? existingSummary.journalEntryIds
      : [];

  if (!existingSummary) {
    if (existingEntry) {
      const now = new Date().toISOString();
      await repo.deleteJournalEntry(
        existingEntry.id,
        journalAudit('JOURNAL_DELETE', getActor(), clientId, now, existingEntry, {
          note: `Excluiu lançamento avulso da folha de ${formatMonth(month)}`,
        })
      );
    }
    return;
  }

  const now = new Date().toISOString();
  await repo.savePayrollRegister(
    {
      ...register,
      summaries: register.summaries.filter((s) => s.month !== month),
      updatedAt: now,
      updatedByUid: getActor().uid,
    },
    payrollAudit(clientId, `Excluiu a folha de pagamento de ${formatMonth(month)}`),
    deleteIds.length ? { deleteIds } : {},
    optimistic(ctx.register)
  );
}

/**
 * Concilia em 1 clique um débito do extrato bancário diretamente na conta de passivo da obrigação
 * da folha (Salários a Pagar, Pró-Labore a Pagar, INSS a Recolher, FGTS a Recolher ou IRRF a Recolher).
 */
export async function reconcilePayrollBankTransaction(params: {
  clientId: string;
  transaction: BankTransaction;
  obligation: PayrollObligationMatch;
  ctx: PayrollContext;
}): Promise<BankTransaction> {
  const { clientId, transaction, obligation, ctx } = params;
  if (isMonthLocked(transaction.date, ctx.lockedMonths)) {
    throw new Error(
      `O lançamento bancário está em ${formatMonth(monthOf(transaction.date))}, competência fechada. Reabra-a para conciliar.`
    );
  }
  const accounts = await ensureTemplateAccounts(clientId, [obligation.accountCode], ctx.accounts);
  const targetAccount =
    accounts.find((a) => a.id === obligation.accountId && a.nature === 'ANALYTIC') ??
    accounts.find((a) => a.code === obligation.accountCode && a.nature === 'ANALYTIC');
  if (!targetAccount) {
    throw new Error(`Conta ${obligation.accountCode} (${obligation.accountName}) não encontrada no plano de contas.`);
  }

  const now = new Date().toISOString();
  const actor = getActor();
  const partnerReset = await partnerResetChange(
    transaction,
    ctx.windowTransactions,
    ctx.lockedMonths,
    now,
    `Reclassificado na conciliação da folha (${obligation.label})`
  );

  const { patch, after } = classifyTransition(
    transaction,
    {
      accountId: targetAccount.id,
      accountCode: targetAccount.code,
      accountName: targetAccount.name,
    },
    null,
    now
  );
  const audit = transactionAudit(classifyAction(transaction), actor, transaction, after, now, {
    note: `Baixa de obrigação da folha: ${obligation.label}`,
  });

  await getRepository().commitChanges({
    patches: [...(partnerReset ? [partnerReset.patch] : []), patch],
    audits: [...(partnerReset ? [partnerReset.audit] : []), audit],
  });

  return after;
}

/* =========================================================================
   Integração com Rotinas do Mês (month-routines.ts)
   ========================================================================= */

export interface MonthPayroll {
  status: PayrollRoutineStatus;
  closeProblem: string | null;
}

export async function loadMonthPayroll(
  clientId: string,
  month: string,
  repo: DataRepository = getRepository()
): Promise<MonthPayroll | null> {
  const register = await repo.getPayrollRegister(clientId);
  if (!register || register.summaries.length === 0) return null;
  const [accounts, entries] = await Promise.all([
    repo.listAccounts(clientId),
    repo.listJournalEntries(clientId, { start: `${month}-01`, end: lastDayOf(month) }),
  ]);
  const existing = entries.find((e) => e.payrollMonth === month);
  const status = payrollRoutineStatus({ register, month, accounts, existing });
  if (!status) return null;
  return { status, closeProblem: payrollCloseProblem(status, month) };
}

export async function postMonthPayroll(
  clientId: string,
  month: string,
  authorUid: string
): Promise<'created' | 'updated' | 'none'> {
  const repo = getRepository();
  const register = await repo.getPayrollRegister(clientId);
  if (!register || register.summaries.length === 0) return 'none';
  const summary = register.summaries.find((s) => s.month === month);
  if (!summary) return 'none';

  const locks = await repo.listPeriodLocks(clientId);
  if (locks.some((l) => l.month === month)) {
    throw new Error('A competência está fechada: reabra-a para lançar a folha de pagamento.');
  }

  let accounts = await repo.listAccounts(clientId);
  const mapping = resolvePayrollMapping(register.defaultMapping, summary.mappedAccounts);
  const missing = missingPayrollCodes(summary, accounts, mapping);
  if (missing.length) accounts = await ensureTemplateAccounts(clientId, missing, accounts);

  const entries = await repo.listJournalEntries(clientId, { start: `${month}-01`, end: lastDayOf(month) });
  const existing = entries.find((e) => e.payrollMonth === month);
  const status = payrollRoutineStatus({ register, month, accounts, existing });
  if (!status) return 'none';

  const now = new Date().toISOString();
  const actor = peekActor() ?? { uid: authorUid || 'local' };
  const routineNote = `Provisão da folha de pagamento (${formatMonth(month)})`;
  switch (status.kind) {
    case 'BLOCKED':
      throw new Error(status.problem);
    case 'PENDING': {
      if (status.existing) {
        const e = status.existing;
        const updated: JournalEntry = {
          ...e,
          ...status.draft,
          id: e.id,
          clientId,
          entryNumber: e.entryNumber,
          createdAt: e.createdAt,
          createdByUid: e.createdByUid,
          updatedAt: now,
        };
        await repo.updateJournalEntry(updated, journalAudit('JOURNAL_UPDATE', actor, clientId, now, updated, { note: routineNote }));
        return 'updated';
      }
      const draft = {
        ...status.draft,
        id: newJournalId(),
        clientId,
        createdAt: now,
        updatedAt: now,
        createdByUid: authorUid || 'local',
      };
      await repo.createJournalEntry(draft, journalAudit('JOURNAL_CREATE', actor, clientId, now, draft, { note: routineNote }));
      return 'created';
    }
    default:
      return 'none';
  }
}
