import type { AuditEntry, ChartAccount, CompanyPorte, FixedAsset, FixedAssetDisposalReason, FixedAssetRegister, FixedAssetSale, JournalEntry } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { getRepository } from '@/lib/services/data-service';
import { getActor } from '@/lib/data/scope';
import { newAuditId } from '@/lib/audit';
import { missingTemplateAccounts, withMissingParents } from '@/lib/chart/itg1000';
import { implantationDate, implantationProblem } from '@/lib/opening';
import { monthOf } from '@/lib/periods';
import {
  assetProblem,
  depreciationCloseProblem,
  depreciationStatus,
  disposalCodes,
  disposalDraft,
  disposalLockProblem,
  intangibleTermProblem,
  lastDayOf,
  isAssetFrozen,
  lockedChangeProblem,
  missingDepreciationCodes,
  type DepreciationStatus,
} from '@/lib/fixed-assets';

/** Tudo o que o cálculo da depreciação de uma empresa precisa (cadastro, plano, fechamentos, implantação). */
export interface FixedAssetContext {
  register: FixedAssetRegister | null;
  accounts: ChartAccount[];
  lockedMonths: Set<string>;
  /** Competência da data de implantação: as cotas anteriores estão nos saldos de abertura. */
  implantationMonth: string | null;
  implantation: string | null;
}

export async function loadFixedAssetContext(clientId: string, repo: DataRepository = getRepository()): Promise<FixedAssetContext> {
  const [register, accounts, locks, openings, banks] = await Promise.all([
    repo.getFixedAssets(clientId),
    repo.listAccounts(clientId),
    repo.listPeriodLocks(clientId),
    repo.getOpeningBalances(clientId),
    repo.listBankAccounts(clientId),
  ]);
  const implantation = implantationDate(openings, banks);
  return {
    register,
    accounts,
    lockedMonths: new Set(locks.map((l) => l.month)),
    implantationMonth: implantation ? monthOf(implantation) : null,
    implantation,
  };
}

const assetAudit = (clientId: string, note: string): AuditEntry => {
  const actor = getActor();
  return {
    id: newAuditId(),
    clientId,
    action: 'ASSET_SAVE',
    actorUid: actor.uid,
    ...(actor.email ? { actorEmail: actor.email } : {}),
    at: new Date().toISOString(),
    note,
  };
};

const emptyRegister = (clientId: string): FixedAssetRegister => ({ id: clientId, clientId, assets: [], updatedAt: '' });

const newJournalId = () => `je_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

/**
 * Grava um bem novo ou alterado. Recusa o que não fecha (`assetProblem`) e o que mexeria em
 * cotas de competência fechada (`lockedChangeProblem`).
 */
export async function saveFixedAsset(clientId: string, asset: FixedAsset, ctx: FixedAssetContext, porte?: CompanyPorte): Promise<void> {
  const problem = assetProblem(asset, ctx.accounts);
  if (problem) throw new Error(problem);
  const register = ctx.register ?? emptyRegister(clientId);
  const before = register.assets.find((a) => a.id === asset.id) ?? null;
  // O prazo do intangível vale para o cadastro novo e para a troca de conta ou de taxa: um bem
  // antigo continua editável (descrição, nota) mesmo fora da regra.
  if (!before || before.annualRate !== asset.annualRate || before.accountCode !== asset.accountCode) {
    const term = intangibleTermProblem(asset, porte);
    if (term) throw new Error(term);
  }
  if (before?.disposal && !asset.disposal) throw new Error('Desfaça a baixa pelo botão próprio.');
  const locked = lockedChangeProblem(before, asset, ctx.lockedMonths, ctx.implantationMonth);
  if (locked) throw new Error(locked);
  const now = new Date().toISOString();
  const assets = before ? register.assets.map((a) => (a.id === asset.id ? { ...asset, updatedAt: now } : a)) : [...register.assets, { ...asset, createdAt: now, updatedAt: now }];
  await getRepository().saveFixedAssets(
    { ...register, assets, updatedAt: now, updatedByUid: getActor().uid },
    assetAudit(clientId, `${before ? 'Alterou' : 'Cadastrou'} o bem ${asset.description}`)
  );
}

/** Exclui um bem cadastrado por engano: só sem cota em competência fechada e sem baixa. */
export async function deleteFixedAsset(clientId: string, asset: FixedAsset, ctx: FixedAssetContext): Promise<void> {
  if (asset.disposal) throw new Error('Desfaça a baixa antes de excluir o bem.');
  const register = ctx.register ?? emptyRegister(clientId);
  if (isAssetFrozen(asset, ctx.lockedMonths, ctx.implantationMonth)) throw new Error('A depreciação deste bem já foi lançada em competência fechada: dê baixa em vez de excluir.');
  const now = new Date().toISOString();
  await getRepository().saveFixedAssets(
    { ...register, assets: register.assets.filter((a) => a.id !== asset.id), updatedAt: now, updatedByUid: getActor().uid },
    assetAudit(clientId, `Excluiu o bem ${asset.description}`)
  );
}

export interface DisposalInput {
  date: string;
  reason: FixedAssetDisposalReason;
  note?: string;
  /** Obrigatória na venda: a receita entra junto com a baixa. */
  sale?: FixedAssetSale;
}

/** Baixa do bem: grava o cadastro e o lançamento da baixa (com a venda, se houver) juntos. */
export async function disposeFixedAsset(
  clientId: string,
  asset: FixedAsset,
  disposal: DisposalInput,
  ctx: FixedAssetContext,
  authorUid: string
): Promise<JournalEntry | null> {
  if (asset.disposal) throw new Error('Este bem já foi baixado.');
  const before = implantationProblem(disposal.date, ctx.implantation);
  if (before) throw new Error(before);
  const lock = disposalLockProblem(asset, disposal.date, ctx.lockedMonths, ctx.implantationMonth);
  if (lock) throw new Error(lock);
  const sale: FixedAssetSale | undefined =
    disposal.reason === 'SALE'
      ? {
          amount: disposal.sale?.amount ?? 0,
          ...(disposal.sale?.buyer?.trim() ? { buyer: disposal.sale.buyer.trim() } : {}),
          ...(disposal.sale?.invoiceRef?.trim() ? { invoiceRef: disposal.sale.invoiceRef.trim() } : {}),
        }
      : undefined;
  if (sale && !(sale.amount > 0)) throw new Error('Informe o valor da venda (o da nota fiscal).');
  const accounts = await ensureTemplateCodes(clientId, disposalCodes(asset, disposal.reason), ctx.accounts);
  const { draft, problem } = disposalDraft(asset, disposal.date, disposal.reason, ctx.implantationMonth, accounts, sale);
  if (!draft) throw new Error(problem ?? 'Não foi possível montar o lançamento da baixa.');
  const now = new Date().toISOString();
  const journalId = newJournalId();
  const register = ctx.register ?? emptyRegister(clientId);
  const disposed: FixedAsset = {
    ...asset,
    disposal: {
      date: disposal.date,
      reason: disposal.reason,
      ...(disposal.note?.trim() ? { note: disposal.note.trim() } : {}),
      ...(sale ? { sale } : {}),
      journalEntryId: journalId,
    },
    updatedAt: now,
  };
  return getRepository().saveFixedAssets(
    { ...register, assets: register.assets.map((a) => (a.id === asset.id ? disposed : a)), updatedAt: now, updatedByUid: getActor().uid },
    assetAudit(clientId, `Baixou o bem ${asset.description}`),
    { create: { ...draft, id: journalId, clientId, createdAt: now, updatedAt: now, createdByUid: authorUid || 'local' } }
  );
}

/** Desfaz a baixa (mês aberto): exclui o lançamento dela junto com a volta do bem. */
export async function undoFixedAssetDisposal(clientId: string, asset: FixedAsset, ctx: FixedAssetContext): Promise<void> {
  if (!asset.disposal) return;
  const month = monthOf(asset.disposal.date);
  if (ctx.lockedMonths.has(month)) throw new Error(`A competência da baixa (${month.slice(5)}/${month.slice(0, 4)}) está fechada: reabra-a para desfazer.`);
  const register = ctx.register ?? emptyRegister(clientId);
  const restored: FixedAsset = { ...asset, updatedAt: new Date().toISOString() };
  delete restored.disposal;
  await getRepository().saveFixedAssets(
    { ...register, assets: register.assets.map((a) => (a.id === asset.id ? restored : a)), updatedAt: restored.updatedAt, updatedByUid: getActor().uid },
    assetAudit(clientId, `Desfez a baixa do bem ${asset.description}`),
    { deleteId: asset.disposal.journalEntryId }
  );
}

/**
 * Cria no plano as contas do modelo que faltam entre `codes` (com os grupos delas) e devolve o
 * plano atualizado. Conta que o contador excluiu de propósito do modelo também volta: sem ela o
 * lançamento não fecha.
 */
async function ensureTemplateCodes(clientId: string, codes: readonly string[], accounts: ChartAccount[]): Promise<ChartAccount[]> {
  const missing = missingTemplateAccounts(clientId, accounts);
  const wanted = withMissingParents(codes, missing);
  const toCreate = missing.filter((a) => wanted.has(a.code));
  if (!toCreate.length) return accounts;
  const repo = getRepository();
  await repo.insertAccounts(toCreate);
  return repo.listAccounts(clientId);
}

/* =========================================================================
   Depreciação da competência
   ========================================================================= */

export interface MonthDepreciation {
  status: DepreciationStatus;
  /** O que impede fechar a competência, ou null. */
  closeProblem: string | null;
}

/** Situação da depreciação da competência, ou null quando a empresa não tem bens cadastrados. */
export async function loadMonthDepreciation(clientId: string, month: string, repo: DataRepository = getRepository()): Promise<MonthDepreciation | null> {
  // Sem bens, para na primeira leitura (o cadastro fica em cache): o fechamento não paga o resto.
  if (!(await repo.getFixedAssets(clientId))?.assets.length) return null;
  const ctx = await loadFixedAssetContext(clientId, repo);
  if (!ctx.register?.assets.length) return null;
  const entries = await repo.listJournalEntries(clientId, { start: `${month}-01`, end: lastDayOf(month) });
  const status = depreciationStatus({ assets: ctx.register.assets, month, implantationMonth: ctx.implantationMonth, accounts: ctx.accounts, entries });
  return { status, closeProblem: depreciationCloseProblem(status, month) };
}

/**
 * Lança, atualiza ou exclui o lançamento de depreciação da competência para que fique igual ao
 * cadastro. Contas do modelo que faltam (ex.: 3.2.1.04) entram no plano antes. Devolve o que fez.
 */
export async function postMonthDepreciation(clientId: string, month: string, authorUid: string): Promise<'created' | 'updated' | 'removed' | 'none'> {
  const repo = getRepository();
  const ctx = await loadFixedAssetContext(clientId, repo);
  if (ctx.lockedMonths.has(month)) throw new Error('A competência está fechada: reabra-a para lançar a depreciação.');
  const assets = ctx.register?.assets ?? [];
  let accounts = ctx.accounts;
  const missing = missingDepreciationCodes(assets, month, ctx.implantationMonth, accounts);
  if (missing.length) accounts = await ensureTemplateCodes(clientId, missing, accounts);

  const entries = await repo.listJournalEntries(clientId, { start: `${month}-01`, end: lastDayOf(month) });
  const status = depreciationStatus({ assets, month, implantationMonth: ctx.implantationMonth, accounts, entries });
  const now = new Date().toISOString();
  switch (status.kind) {
    case 'BLOCKED':
      throw new Error(status.problem);
    case 'REMOVE':
      await repo.deleteJournalEntry(status.existing.id);
      return 'removed';
    case 'PENDING': {
      const before = implantationProblem(status.draft.date, ctx.implantation);
      if (before) throw new Error(before);
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
