import type { AuditEntry, ChartAccount, StockControl } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { getRepository } from '@/lib/services/data-service';
import { getActor } from '@/lib/data/scope';
import { newAuditId } from '@/lib/audit';
import { toCents } from '@/lib/money';
import { monthLedgerWithout } from '@/lib/services/month-ledger';
import { DISTRIBUTED_PROFIT_CODE, stockCloseProblem, stockLockProblem, stockProblem, stockStatus, stockWarnings, type StockStatus } from '@/lib/stock';

export interface StockContext {
  control: StockControl | null;
  accounts: ChartAccount[];
  lockedMonths: Set<string>;
}

export async function loadStockContext(clientId: string, repo: DataRepository = getRepository()): Promise<StockContext> {
  const [control, accounts, locks] = await Promise.all([repo.getStockControl(clientId), repo.listAccounts(clientId), repo.listPeriodLocks(clientId)]);
  return { control, accounts, lockedMonths: new Set(locks.map((l) => l.month)) };
}

const audit = (clientId: string, note: string): AuditEntry => {
  const actor = getActor();
  return {
    id: newAuditId(),
    clientId,
    action: 'STOCK_SAVE',
    actorUid: actor.uid,
    ...(actor.email ? { actorEmail: actor.email } : {}),
    at: new Date().toISOString(),
    note,
  };
};

/** Grava o controle (contas, início, frequência e os estoques informados). */
export async function saveStockControl(clientId: string, control: StockControl, ctx: StockContext, note?: string): Promise<void> {
  const problem = stockProblem(control, ctx.accounts);
  if (problem) throw new Error(problem);
  const lock = stockLockProblem(ctx.control, control, ctx.lockedMonths);
  if (lock) throw new Error(lock);
  const stock = ctx.accounts.find((a) => a.id === control.stockAccountId);
  const cost = ctx.accounts.find((a) => a.id === control.costAccountId);
  const now = new Date().toISOString();
  await getRepository().saveStockControl(
    {
      ...control,
      id: clientId,
      clientId,
      stockAccountCode: stock?.code ?? control.stockAccountCode,
      ...(stock ? { stockAccountName: stock.name } : {}),
      costAccountCode: cost?.code ?? control.costAccountCode,
      ...(cost ? { costAccountName: cost.name } : {}),
      updatedAt: now,
      updatedByUid: getActor().uid,
    },
    audit(clientId, note ?? `${ctx.control ? 'Alterou' : 'Configurou'} o controle de estoque`)
  );
}

/** Informa (ou apaga, com `amount` null) o estoque final da competência, com a origem. */
export async function saveStockCount(clientId: string, month: string, amount: number | null, source: string, ctx: StockContext): Promise<void> {
  if (!ctx.control) throw new Error('Configure o controle de estoque antes de informar o estoque final.');
  const counts = { ...ctx.control.counts };
  const notes = { ...(ctx.control.notes ?? {}) };
  if (amount === null) {
    delete counts[month];
    delete notes[month];
  } else {
    counts[month] = amount;
    if (source.trim()) notes[month] = source.trim().slice(0, 120);
    else delete notes[month];
  }
  const label = `${month.slice(5)}/${month.slice(0, 4)}`;
  await saveStockControl(clientId, { ...ctx.control, counts, notes }, ctx, `Estoque final de ${label}: ${amount === null ? 'apagado' : amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
}

/* =========================================================================
   CMV do mês
   ========================================================================= */

export interface MonthStock {
  status: StockStatus;
  closeProblem: string | null;
  warnings: string[];
}

async function monthStatus(clientId: string, month: string, ctx: StockContext, repo: DataRepository): Promise<{ status: StockStatus; distributedCents: number }> {
  const control = ctx.control!;
  const ledger = await monthLedgerWithout(clientId, month, ctx.accounts, (e) => e.stockMonth === month, repo);
  const distributedIds = new Set(ctx.accounts.filter((a) => a.code === DISTRIBUTED_PROFIT_CODE).map((a) => a.id));
  const distributedCents = ledger.monthPostings.filter((p) => distributedIds.has(p.accountId) && p.value > 0).reduce((s, p) => s + toCents(p.value), 0);
  const status = stockStatus({ control, month, accounts: ctx.accounts, ledgerCents: ledger.balanceCents(control.stockAccountId), existing: ledger.excluded });
  return { status, distributedCents };
}

/** Situação do CMV da competência, ou null sem controle de estoque configurado. */
export async function loadMonthStock(clientId: string, month: string, repo: DataRepository = getRepository()): Promise<MonthStock | null> {
  const control = await repo.getStockControl(clientId);
  if (!control || month < control.startMonth) return null;
  const ctx = await loadStockContext(clientId, repo);
  const { status, distributedCents } = await monthStatus(clientId, month, ctx, repo);
  return { status, closeProblem: stockCloseProblem(status, month), warnings: stockWarnings(status, month, distributedCents) };
}

/** Lança, atualiza ou exclui o CMV da competência para ficar igual ao estoque informado. */
export async function postMonthStock(clientId: string, month: string, authorUid: string): Promise<'created' | 'updated' | 'removed' | 'none'> {
  const repo = getRepository();
  const control = await repo.getStockControl(clientId);
  if (!control || month < control.startMonth) return 'none';
  const ctx = await loadStockContext(clientId, repo);
  if (ctx.lockedMonths.has(month)) throw new Error('A competência está fechada: reabra-a para lançar o CMV.');
  const { status } = await monthStatus(clientId, month, ctx, repo);
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
      await repo.createJournalEntry({ ...status.draft, id: `je_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`, clientId, createdAt: now, updatedAt: now, createdByUid: authorUid || 'local' });
      return 'created';
    }
    default:
      return 'none';
  }
}
