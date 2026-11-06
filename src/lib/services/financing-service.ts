import type { AuditEntry, ChartAccount, FinancingContract, FinancingRegister } from '@/types/firestore';
import type { DataRepository, FixedAssetJournalChange } from '@/lib/data/repository';
import { getRepository } from '@/lib/services/data-service';
import { getActor } from '@/lib/data/scope';
import { newAuditId } from '@/lib/audit';
import { implantationDate, implantationProblem } from '@/lib/opening';
import { monthOf } from '@/lib/periods';
import { lastDayOf } from '@/lib/fixed-assets';
import { ensureTemplateAccounts } from '@/lib/services/prepaid-service';
import {
  contractMonths,
  financingCloseProblem,
  financingLockProblem,
  financingProblem,
  financingRoutineStatus,
  initialEntryDraft,
  missingFinancingCodes,
  type FinancingRoutineStatus,
} from '@/lib/financing';

export interface FinancingContext {
  register: FinancingRegister | null;
  accounts: ChartAccount[];
  lockedMonths: Set<string>;
  implantationMonth: string | null;
  implantation: string | null;
}

export async function loadFinancingContext(clientId: string, repo: DataRepository = getRepository()): Promise<FinancingContext> {
  const [register, accounts, locks, openings, banks] = await Promise.all([
    repo.getFinancingContracts(clientId),
    repo.listAccounts(clientId),
    repo.listPeriodLocks(clientId),
    repo.getOpeningBalances(clientId),
    repo.listBankAccounts(clientId),
  ]);
  const implantation = implantationDate(openings, banks);
  return { register, accounts, lockedMonths: new Set(locks.map((l) => l.month)), implantationMonth: implantation ? monthOf(implantation) : null, implantation };
}

const audit = (clientId: string, note: string): AuditEntry => {
  const actor = getActor();
  return {
    id: newAuditId(),
    clientId,
    action: 'FINANCING_SAVE',
    actorUid: actor.uid,
    ...(actor.email ? { actorEmail: actor.email } : {}),
    at: new Date().toISOString(),
    note,
  };
};

const emptyRegister = (clientId: string): FinancingRegister => ({ id: clientId, clientId, contracts: [], updatedAt: '' });
const newJournalId = () => `je_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

/** Pares (id, código) das contas do contrato, na ordem em que são resolvidos. */
const ACCOUNT_KEYS = ['counterpart', 'shortTerm', 'longTerm', 'chargesShort', 'chargesLong', 'upfrontExpense', 'interestExpense'] as const;

/** Campos que mudam o lançamento inicial: com eles alterados (mês aberto), ele é refeito. */
const INITIAL_FIELDS = [
  'kind',
  'date',
  'principal',
  'upfrontCharges',
  'installments',
  'installmentAmount',
  'firstDueDate',
  'interestMode',
  'monthlyRate',
  'counterpartAccountId',
  'shortTermAccountId',
  'longTermAccountId',
  'chargesShortAccountId',
  'chargesLongAccountId',
  'upfrontExpenseAccountId',
  'description',
  'lender',
  'documentRef',
] as const;

/**
 * Grava um contrato. Na primeira gravação, gera o lançamento inicial na data do contrato, salvo
 * quando ele já estava contabilizado (`alreadyRecognized`: ex.: antes da implantação). Numa
 * alteração que muda o lançamento inicial (mês aberto), ele é refeito na mesma gravação. As contas
 * escolhidas que ainda não estão no plano (do modelo) entram antes.
 */
export async function saveFinancingContract(
  clientId: string,
  draft: FinancingContract,
  ctx: FinancingContext,
  options: { alreadyRecognized: boolean; authorUid: string }
): Promise<void> {
  const codes = ACCOUNT_KEYS.map((k) => draft[`${k}AccountCode`]).filter((c): c is string => Boolean(c));
  const accounts = await ensureTemplateAccounts(clientId, codes, ctx.accounts);
  const contract: FinancingContract = { ...draft };
  for (const k of ACCOUNT_KEYS) {
    const code = draft[`${k}AccountCode`];
    if (!code) continue;
    const acc = accounts.find((a) => a.id === draft[`${k}AccountId`]) ?? accounts.find((a) => a.code === code && a.nature === 'ANALYTIC');
    if (acc) (contract as unknown as Record<string, string>)[`${k}AccountId`] = acc.id;
  }
  const problem = financingProblem(contract, accounts);
  if (problem) throw new Error(problem);

  const register = ctx.register ?? emptyRegister(clientId);
  const before = register.contracts.find((c) => c.id === contract.id) ?? null;
  const lock = financingLockProblem(before, contract, ctx.lockedMonths, ctx.implantationMonth);
  if (lock) throw new Error(lock);

  const now = new Date().toISOString();
  const journal: FixedAssetJournalChange = {};
  let next: FinancingContract = { ...contract, updatedAt: now, createdAt: before?.createdAt ?? now };
  const initialLocked = Boolean(before?.initialEntryId) && ctx.lockedMonths.has(monthOf(before!.date));
  const changed = !initialLocked && (!before || INITIAL_FIELDS.some((f) => JSON.stringify(before[f] ?? null) !== JSON.stringify(contract[f] ?? null)));
  const wants = before ? Boolean(before.initialEntryId) : !options.alreadyRecognized;
  if (wants && changed) {
    const prior = implantationProblem(contract.date, ctx.implantation);
    if (prior) throw new Error(`${prior} Para um contrato anterior à implantação, marque que o lançamento inicial já está nos saldos de abertura.`);
    const { draft: entry, problem: entryProblem } = initialEntryDraft(contract, accounts);
    if (!entry) throw new Error(entryProblem ?? 'Não foi possível montar o lançamento inicial.');
    const id = newJournalId();
    journal.create = { ...entry, id, clientId, createdAt: now, updatedAt: now, createdByUid: options.authorUid || 'local' };
    if (before?.initialEntryId) journal.deleteId = before.initialEntryId;
    next = { ...next, initialEntryId: id };
  } else if (before?.initialEntryId) {
    next = { ...next, initialEntryId: before.initialEntryId };
  } else {
    delete next.initialEntryId;
  }

  const contracts = before ? register.contracts.map((c) => (c.id === contract.id ? next : c)) : [...register.contracts, next];
  await getRepository().saveFinancingContracts(
    { ...register, contracts, updatedAt: now, updatedByUid: getActor().uid },
    audit(clientId, `${before ? 'Alterou' : 'Cadastrou'} o contrato ${contract.description}`),
    journal
  );
}

/** Exclui um contrato cadastrado por engano, com o lançamento inicial (sem nada em competência fechada). */
export async function deleteFinancingContract(clientId: string, contract: FinancingContract, ctx: FinancingContext): Promise<void> {
  if (contractMonths(contract, ctx.implantationMonth).some((m) => ctx.lockedMonths.has(m))) {
    throw new Error('Este contrato já tem lançamento em competência fechada: reabra as competências para excluí-lo.');
  }
  const register = ctx.register ?? emptyRegister(clientId);
  const now = new Date().toISOString();
  await getRepository().saveFinancingContracts(
    { ...register, contracts: register.contracts.filter((c) => c.id !== contract.id), updatedAt: now, updatedByUid: getActor().uid },
    audit(clientId, `Excluiu o contrato ${contract.description}`),
    contract.initialEntryId ? { deleteId: contract.initialEntryId } : {}
  );
}

/* =========================================================================
   Rotina do mês (juros e reclassificação)
   ========================================================================= */

export interface MonthFinancing {
  status: FinancingRoutineStatus;
  closeProblem: string | null;
}

/** Situação da rotina da competência, ou null sem contratos cadastrados. */
export async function loadMonthFinancing(clientId: string, month: string, repo: DataRepository = getRepository()): Promise<MonthFinancing | null> {
  if (!(await repo.getFinancingContracts(clientId))?.contracts.length) return null;
  const ctx = await loadFinancingContext(clientId, repo);
  const entries = await repo.listJournalEntries(clientId, { start: `${month}-01`, end: lastDayOf(month) });
  const status = financingRoutineStatus({ contracts: ctx.register?.contracts ?? [], month, implantationMonth: ctx.implantationMonth, accounts: ctx.accounts, entries });
  return { status, closeProblem: financingCloseProblem(status, month) };
}

/** Lança, atualiza ou exclui o lançamento da rotina da competência para ficar igual aos contratos. */
export async function postMonthFinancing(clientId: string, month: string, authorUid: string): Promise<'created' | 'updated' | 'removed' | 'none'> {
  const repo = getRepository();
  const ctx = await loadFinancingContext(clientId, repo);
  if (ctx.lockedMonths.has(month)) throw new Error('A competência está fechada: reabra-a para lançar os juros.');
  const contracts = ctx.register?.contracts ?? [];
  let accounts = ctx.accounts;
  const missing = missingFinancingCodes(contracts, month, ctx.implantationMonth, accounts);
  if (missing.length) accounts = await ensureTemplateAccounts(clientId, missing, accounts);
  const entries = await repo.listJournalEntries(clientId, { start: `${month}-01`, end: lastDayOf(month) });
  const status = financingRoutineStatus({ contracts, month, implantationMonth: ctx.implantationMonth, accounts, entries });
  const now = new Date().toISOString();
  switch (status.kind) {
    case 'BLOCKED':
      throw new Error(status.problem);
    case 'REMOVE':
      await repo.deleteJournalEntry(status.existing.id);
      return 'removed';
    case 'PENDING': {
      if (status.existing) {
        const e = status.existing;
        await repo.updateJournalEntry({ ...e, ...status.draft, id: e.id, clientId, entryNumber: e.entryNumber, createdAt: e.createdAt, createdByUid: e.createdByUid, updatedAt: now });
        return 'updated';
      }
      await repo.createJournalEntry({ ...status.draft, id: newJournalId(), clientId, createdAt: now, updatedAt: now, createdByUid: authorUid || 'local' });
      return 'created';
    }
    default:
      return 'none';
  }
}
