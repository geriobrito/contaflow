import type { AuditEntry, ChartAccount, InvestmentAccount, InvestmentRegister, JournalEntry } from '@/types/firestore';
import type { DataRepository, RegisterSaveOptions } from '@/lib/data/repository';
import { getRepository } from '@/lib/services/data-service';
import { getActor, peekActor } from '@/lib/data/scope';
import { journalAudit, newAuditId } from '@/lib/audit';
import { monthLedgerWithout } from '@/lib/services/month-ledger';
import { formatMonth } from '@/lib/periods';
import { ensureTemplateAccounts } from '@/lib/services/prepaid-service';
import { investmentCloseProblem, investmentLockProblem, investmentProblem, investmentStatus, YIELD_CODE, type InvestmentStatus } from '@/lib/investments';

export interface InvestmentContext {
  register: InvestmentRegister | null;
  accounts: ChartAccount[];
  lockedMonths: Set<string>;
}

export async function loadInvestmentContext(clientId: string, repo: DataRepository = getRepository()): Promise<InvestmentContext> {
  const [register, accounts, locks] = await Promise.all([repo.getInvestments(clientId), repo.listAccounts(clientId), repo.listPeriodLocks(clientId)]);
  return { register, accounts, lockedMonths: new Set(locks.map((l) => l.month)) };
}

const audit = (clientId: string, note: string): AuditEntry => {
  const actor = getActor();
  return {
    id: newAuditId(),
    clientId,
    action: 'INVESTMENT_SAVE',
    actorUid: actor.uid,
    ...(actor.email ? { actorEmail: actor.email } : {}),
    at: new Date().toISOString(),
    note,
  };
};

const emptyRegister = (clientId: string): InvestmentRegister => ({ id: clientId, clientId, accounts: [], updatedAt: '' });
const optimistic = (register: InvestmentRegister | null): RegisterSaveOptions => ({
  expectedVersion: register?.version ?? null,
  expectedUpdatedAt: register?.updatedAt ?? null,
});

/** Grava uma aplicação nova ou alterada (inclusive os saldos informados). */
export async function saveInvestment(clientId: string, investment: InvestmentAccount, ctx: InvestmentContext, note?: string): Promise<void> {
  const problem = investmentProblem(investment, ctx.accounts);
  if (problem) throw new Error(problem);
  const register = ctx.register ?? emptyRegister(clientId);
  const before = register.accounts.find((a) => a.id === investment.id) ?? null;
  const lock = investmentLockProblem(before, investment, ctx.lockedMonths);
  if (lock) throw new Error(lock);
  const now = new Date().toISOString();
  const ledger = ctx.accounts.find((a) => a.id === investment.ledgerAccountId);
  const next: InvestmentAccount = {
    ...investment,
    ledgerAccountCode: ledger?.code ?? investment.ledgerAccountCode,
    ...(ledger ? { ledgerAccountName: ledger.name } : {}),
    createdAt: before?.createdAt ?? now,
    updatedAt: now,
  };
  const accounts = before ? register.accounts.map((a) => (a.id === next.id ? next : a)) : [...register.accounts, next];
  await getRepository().saveInvestments(
    { ...register, accounts, updatedAt: now, updatedByUid: getActor().uid },
    audit(clientId, note ?? `${before ? 'Alterou' : 'Cadastrou'} a aplicação ${investment.description}`),
    optimistic(ctx.register)
  );
}

/** Informa (ou apaga, com `amount` null) o saldo bruto do extrato da aplicação na competência. */
export async function saveInvestmentBalance(clientId: string, investment: InvestmentAccount, month: string, amount: number | null, ctx: InvestmentContext): Promise<void> {
  const balances = { ...investment.balances };
  if (amount === null) delete balances[month];
  else balances[month] = amount;
  const label = `${month.slice(5)}/${month.slice(0, 4)}`;
  await saveInvestment(clientId, { ...investment, balances }, ctx, `Saldo de ${investment.description} em ${label}: ${amount === null ? 'apagado' : amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
}

/** Exclui uma aplicação cadastrada por engano (sem saldo em competência fechada). */
export async function deleteInvestment(clientId: string, investment: InvestmentAccount, ctx: InvestmentContext): Promise<void> {
  const lock = investmentLockProblem(investment, null, ctx.lockedMonths);
  if (lock) throw new Error('Esta aplicação tem saldo em competência fechada: reabra as competências para excluí-la, ou informe o encerramento.');
  const register = ctx.register ?? emptyRegister(clientId);
  const now = new Date().toISOString();
  await getRepository().saveInvestments(
    { ...register, accounts: register.accounts.filter((a) => a.id !== investment.id), updatedAt: now, updatedByUid: getActor().uid },
    audit(clientId, `Excluiu a aplicação ${investment.description}`),
    optimistic(ctx.register)
  );
}

/* =========================================================================
   Rendimento do mês
   ========================================================================= */

export interface MonthInvestment {
  status: InvestmentStatus;
  closeProblem: string | null;
}

async function monthStatus(clientId: string, month: string, ctx: InvestmentContext, repo: DataRepository): Promise<InvestmentStatus> {
  const investments = ctx.register?.accounts ?? [];
  const ledger = await monthLedgerWithout(clientId, month, ctx.accounts, (e) => e.investmentMonth === month, repo);
  return investmentStatus({ investments, month, accounts: ctx.accounts, ledgerCents: ledger.balanceCents, existing: ledger.excluded });
}

/** Situação do rendimento da competência, ou null sem aplicações cadastradas. */
export async function loadMonthInvestment(clientId: string, month: string, repo: DataRepository = getRepository()): Promise<MonthInvestment | null> {
  if (!(await repo.getInvestments(clientId))?.accounts.length) return null;
  const ctx = await loadInvestmentContext(clientId, repo);
  const status = await monthStatus(clientId, month, ctx, repo);
  return { status, closeProblem: investmentCloseProblem(status, month) };
}

/**
 * Lança, atualiza ou exclui o rendimento da competência para ficar igual aos saldos informados.
 * Sem o saldo de alguma aplicação, não faz nada (o aviso do fechamento pede o saldo).
 */
export async function postMonthInvestment(clientId: string, month: string, authorUid: string): Promise<'created' | 'updated' | 'removed' | 'none'> {
  const repo = getRepository();
  if (!(await repo.getInvestments(clientId))?.accounts.length) return 'none';
  let ctx = await loadInvestmentContext(clientId, repo);
  if (ctx.lockedMonths.has(month)) throw new Error('A competência está fechada: reabra-a para lançar o rendimento.');
  if (!ctx.accounts.some((a) => a.code === YIELD_CODE)) ctx = { ...ctx, accounts: await ensureTemplateAccounts(clientId, [YIELD_CODE], ctx.accounts) };
  const status = await monthStatus(clientId, month, ctx, repo);
  const now = new Date().toISOString();
  const actor = peekActor() ?? { uid: authorUid || 'local' };
  const routineNote = `Rendimento de aplicações financeiras (${formatMonth(month)})`;
  switch (status.kind) {
    case 'BLOCKED':
      throw new Error(status.problem);
    case 'REMOVE':
      await repo.deleteJournalEntry(
        status.existing.id,
        journalAudit('JOURNAL_DELETE', actor, clientId, now, status.existing, { note: routineNote })
      );
      return 'removed';
    case 'PENDING': {
      if (status.existing) {
        const e = status.existing;
        const updated: JournalEntry = { ...e, ...status.draft, id: e.id, clientId, entryNumber: e.entryNumber, createdAt: e.createdAt, createdByUid: e.createdByUid, updatedAt: now };
        await repo.updateJournalEntry(updated, journalAudit('JOURNAL_UPDATE', actor, clientId, now, updated, { note: routineNote }));
        return 'updated';
      }
      const draft = { ...status.draft, id: `je_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`, clientId, createdAt: now, updatedAt: now, createdByUid: authorUid || 'local' };
      await repo.createJournalEntry(draft, journalAudit('JOURNAL_CREATE', actor, clientId, now, draft, { note: routineNote }));
      return 'created';
    }
    default:
      return 'none';
  }
}
