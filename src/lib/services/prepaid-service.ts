import type { AuditEntry, ChartAccount, FixedAsset, PrepaidExpense, PrepaidRegister } from '@/types/firestore';
import type { DataRepository, FixedAssetJournalChange } from '@/lib/data/repository';
import { getRepository } from '@/lib/services/data-service';
import { getActor } from '@/lib/data/scope';
import { newAuditId } from '@/lib/audit';
import { missingTemplateAccounts, withMissingParents } from '@/lib/chart/itg1000';
import { implantationDate, implantationProblem } from '@/lib/opening';
import { monthOf } from '@/lib/periods';
import { lastDayOf } from '@/lib/fixed-assets';
import {
  appropriationCloseProblem,
  appropriationStatus,
  lockedPrepaidMonths,
  missingPrepaidCodes,
  prepaidLockProblem,
  prepaidProblem,
  recognitionDraft,
  type AppropriationStatus,
} from '@/lib/prepaid-expenses';

export interface PrepaidContext {
  register: PrepaidRegister | null;
  accounts: ChartAccount[];
  /** Bens do imobilizado (para escolher o bem segurado). */
  fixedAssets: FixedAsset[];
  lockedMonths: Set<string>;
  implantationMonth: string | null;
  implantation: string | null;
}

export async function loadPrepaidContext(clientId: string, repo: DataRepository = getRepository()): Promise<PrepaidContext> {
  const [register, accounts, locks, openings, banks, assets] = await Promise.all([
    repo.getPrepaidExpenses(clientId),
    repo.listAccounts(clientId),
    repo.listPeriodLocks(clientId),
    repo.getOpeningBalances(clientId),
    repo.listBankAccounts(clientId),
    repo.getFixedAssets(clientId),
  ]);
  const implantation = implantationDate(openings, banks);
  return {
    register,
    accounts,
    fixedAssets: assets?.assets ?? [],
    lockedMonths: new Set(locks.map((l) => l.month)),
    implantationMonth: implantation ? monthOf(implantation) : null,
    implantation,
  };
}

const audit = (clientId: string, note: string): AuditEntry => {
  const actor = getActor();
  return {
    id: newAuditId(),
    clientId,
    action: 'PREPAID_SAVE',
    actorUid: actor.uid,
    ...(actor.email ? { actorEmail: actor.email } : {}),
    at: new Date().toISOString(),
    note,
  };
};

const emptyRegister = (clientId: string): PrepaidRegister => ({ id: clientId, clientId, items: [], updatedAt: '' });
const newJournalId = () => `je_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

/** Cria no plano as contas do modelo entre `codes` que faltam (com os grupos) e devolve o plano atualizado. */
export async function ensureTemplateAccounts(clientId: string, codes: readonly string[], accounts: ChartAccount[]): Promise<ChartAccount[]> {
  const missing = missingTemplateAccounts(clientId, accounts);
  const wanted = withMissingParents(codes, missing);
  const toCreate = missing.filter((a) => wanted.has(a.code));
  if (!toCreate.length) return accounts;
  const repo = getRepository();
  await repo.insertAccounts(toCreate);
  return repo.listAccounts(clientId);
}

/** Campos que mudam o lançamento inicial: com eles alterados, o lançamento é refeito. */
const RECOGNITION_FIELDS = ['amount', 'startDate', 'months', 'assetAccountId', 'payableAccountId', 'description', 'documentRef'] as const;

/**
 * Grava uma despesa antecipada. Na primeira gravação, gera o lançamento inicial na data da apólice
 * (D ativo / C obrigação), salvo quando ele já estava contabilizado (`alreadyRecognized`: ex.:
 * antes da implantação). Numa alteração que muda o lançamento inicial, ele é refeito na mesma
 * gravação. As contas escolhidas que ainda não estão no plano (do modelo) entram antes.
 */
export async function savePrepaidExpense(
  clientId: string,
  draftItem: PrepaidExpense,
  ctx: PrepaidContext,
  options: { alreadyRecognized: boolean; authorUid: string }
): Promise<void> {
  const accounts = await ensureTemplateAccounts(clientId, [draftItem.assetAccountCode, draftItem.payableAccountCode, draftItem.expenseAccountCode], ctx.accounts);
  const byCode = (code: string, id: string) => accounts.find((a) => a.id === id) ?? accounts.find((a) => a.code === code && a.nature === 'ANALYTIC');
  const asset = byCode(draftItem.assetAccountCode, draftItem.assetAccountId);
  const payable = byCode(draftItem.payableAccountCode, draftItem.payableAccountId);
  const expense = byCode(draftItem.expenseAccountCode, draftItem.expenseAccountId);
  const item: PrepaidExpense = {
    ...draftItem,
    assetAccountId: asset?.id ?? draftItem.assetAccountId,
    payableAccountId: payable?.id ?? draftItem.payableAccountId,
    expenseAccountId: expense?.id ?? draftItem.expenseAccountId,
  };
  const problem = prepaidProblem(item, accounts);
  if (problem) throw new Error(problem);

  const register = ctx.register ?? emptyRegister(clientId);
  const before = register.items.find((i) => i.id === item.id) ?? null;
  const lock = prepaidLockProblem(before, item, ctx.lockedMonths, ctx.implantationMonth);
  if (lock) throw new Error(lock);

  const now = new Date().toISOString();
  const journal: FixedAssetJournalChange = {};
  let next: PrepaidExpense = { ...item, updatedAt: now, createdAt: before?.createdAt ?? now };
  // Com o mês da apólice fechado, o lançamento inicial fica como está (só a descrição pode ter mudado).
  const recognitionLocked = Boolean(before?.recognitionEntryId) && ctx.lockedMonths.has(monthOf(before!.startDate));
  const changedRecognition =
    !recognitionLocked && (!before || RECOGNITION_FIELDS.some((f) => JSON.stringify(before[f] ?? null) !== JSON.stringify(item[f] ?? null)));
  const wantsRecognition = before ? Boolean(before.recognitionEntryId) : !options.alreadyRecognized;
  if (wantsRecognition && changedRecognition) {
    const prior = implantationProblem(item.startDate, ctx.implantation);
    if (prior) throw new Error(`${prior} Para uma apólice anterior à implantação, marque que o lançamento inicial já está nos saldos de abertura.`);
    const { draft, problem: draftProblem } = recognitionDraft(item, accounts);
    if (!draft) throw new Error(draftProblem ?? 'Não foi possível montar o lançamento inicial.');
    const id = newJournalId();
    journal.create = { ...draft, id, clientId, createdAt: now, updatedAt: now, createdByUid: options.authorUid || 'local' };
    if (before?.recognitionEntryId) journal.deleteId = before.recognitionEntryId;
    next = { ...next, recognitionEntryId: id };
  } else if (before?.recognitionEntryId) {
    next = { ...next, recognitionEntryId: before.recognitionEntryId };
  } else {
    delete next.recognitionEntryId;
  }

  const items = before ? register.items.map((i) => (i.id === item.id ? next : i)) : [...register.items, next];
  await getRepository().savePrepaidExpenses(
    { ...register, items, updatedAt: now, updatedByUid: getActor().uid },
    audit(clientId, `${before ? 'Alterou' : 'Cadastrou'} ${item.description}`),
    journal
  );
}

/** Exclui uma despesa antecipada cadastrada por engano, com o lançamento inicial dela (mês aberto). */
export async function deletePrepaidExpense(clientId: string, item: PrepaidExpense, ctx: PrepaidContext): Promise<void> {
  const locked = lockedPrepaidMonths(item, ctx.lockedMonths, ctx.implantationMonth);
  if (locked.length) throw new Error('Esta despesa já tem lançamento em competência fechada: reabra as competências para excluí-la.');
  const register = ctx.register ?? emptyRegister(clientId);
  const now = new Date().toISOString();
  await getRepository().savePrepaidExpenses(
    { ...register, items: register.items.filter((i) => i.id !== item.id), updatedAt: now, updatedByUid: getActor().uid },
    audit(clientId, `Excluiu ${item.description}`),
    item.recognitionEntryId ? { deleteId: item.recognitionEntryId } : {}
  );
}

/* =========================================================================
   Apropriação do mês
   ========================================================================= */

export interface MonthAppropriation {
  status: AppropriationStatus;
  closeProblem: string | null;
}

/** Situação da apropriação da competência, ou null sem despesas antecipadas cadastradas. */
export async function loadMonthAppropriation(clientId: string, month: string, repo: DataRepository = getRepository()): Promise<MonthAppropriation | null> {
  if (!(await repo.getPrepaidExpenses(clientId))?.items.length) return null;
  const ctx = await loadPrepaidContext(clientId, repo);
  const items = ctx.register?.items ?? [];
  const entries = await repo.listJournalEntries(clientId, { start: `${month}-01`, end: lastDayOf(month) });
  const status = appropriationStatus({ items, month, implantationMonth: ctx.implantationMonth, accounts: ctx.accounts, entries });
  return { status, closeProblem: appropriationCloseProblem(status, month) };
}

/** Lança, atualiza ou exclui a apropriação da competência para ficar igual ao cadastro. */
export async function postMonthAppropriation(clientId: string, month: string, authorUid: string): Promise<'created' | 'updated' | 'removed' | 'none'> {
  const repo = getRepository();
  const ctx = await loadPrepaidContext(clientId, repo);
  if (ctx.lockedMonths.has(month)) throw new Error('A competência está fechada: reabra-a para lançar a apropriação.');
  const items = ctx.register?.items ?? [];
  let accounts = ctx.accounts;
  const missing = missingPrepaidCodes(items, month, ctx.implantationMonth, accounts);
  if (missing.length) accounts = await ensureTemplateAccounts(clientId, missing, accounts);
  const entries = await repo.listJournalEntries(clientId, { start: `${month}-01`, end: lastDayOf(month) });
  const status = appropriationStatus({ items, month, implantationMonth: ctx.implantationMonth, accounts, entries });
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
