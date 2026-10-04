import type {
  AuditEntry,
  BankAccount,
  BankTransaction,
  ChartAccount,
  ClientCompany,
  ClientRequest,
  ImportBatch,
} from '@/types/firestore';
import type { TransactionPatch } from '@/lib/data/repository';
import { getRepository } from '@/lib/services/data-service';
import { getActor } from '@/lib/data/scope';
import { newAuditId, transactionAudit } from '@/lib/audit';
import { formatMonth, isMonthLocked, monthOf } from '@/lib/periods';
import { resetTransition } from '@/lib/transitions';
import { bankAccountId, defaultNickname, nextChildCode, suggestOpening } from '@/lib/bank-accounts';
import { findTransitAccount, TRANSIT_ACCOUNT } from '@/lib/transfers';
import type { OFXAccountInfo } from '@/lib/ofx/types';
import type { TextRepairPlan } from '@/lib/text-repair';

/* =========================================================================
   Contas bancárias
   ========================================================================= */

/** Código da conta de bancos no modelo ITG 1000 (vínculo padrão e pai das subcontas). */
export const BANKS_PARENT_CODE = '1.1.1.02';

/**
 * Garante o cadastro da conta bancária de um extrato (chamado na importação). Se o
 * plano tem a conta de bancos analítica e nenhum outro banco a usa, já vincula a ela.
 */
export async function ensureBankAccount(args: {
  clientId: string;
  accountKey: string;
  account: OFXAccountInfo;
  accounts: readonly ChartAccount[];
  batches: readonly ImportBatch[];
}): Promise<BankAccount> {
  const repo = getRepository();
  const existing = await repo.listBankAccounts(args.clientId);
  const found = existing.find((b) => b.accountKey === args.accountKey);
  if (found) return found;

  const now = new Date().toISOString();
  const meta = {
    bankId: args.account.bankId,
    branchId: args.account.branchId,
    accountNumber: args.account.accountId,
    bankName: args.account.org,
  };
  const banks = args.accounts.find((a) => a.code === BANKS_PARENT_CODE && a.nature === 'ANALYTIC');
  const linkDefault = banks && !existing.some((b) => b.ledgerAccountId === banks.id);
  const created: BankAccount = {
    id: bankAccountId(args.clientId, args.accountKey),
    clientId: args.clientId,
    accountKey: args.accountKey,
    ...Object.fromEntries(Object.entries(meta).filter(([, v]) => v)),
    nickname: defaultNickname(meta),
    ...(linkDefault ? { ledgerAccountId: banks.id, ledgerAccountCode: banks.code, ledgerAccountName: banks.name } : {}),
    ...(suggestOpening(args.batches, args.accountKey) ?? {}),
    createdAt: now,
    updatedAt: now,
  };
  await repo.saveBankAccount(created);
  return created;
}

/** Uso de uma conta do plano em lançamentos (conta única ou rateio) e regras. */
async function accountInUse(clientId: string, accountId: string): Promise<boolean> {
  const repo = getRepository();
  const [txs, rules] = await Promise.all([repo.listTransactions(clientId), repo.listRules(clientId)]);
  return (
    rules.some((r) => r.accountId === accountId) ||
    txs.some((t) => t.accountId === accountId || t.splits?.some((s) => s.accountId === accountId))
  );
}

/**
 * Cria uma subconta analítica por banco abaixo de 1.1.1.02 (ex.: 1.1.1.02.001 Itaú) e
 * vincula cada banco à sua. Se 1.1.1.02 ainda é analítica, vira sintética — só quando
 * nenhum lançamento ou regra a usa diretamente; os bancos ligados a ela ganham subconta.
 */
export async function createBankSubaccounts(args: {
  clientId: string;
  targets: readonly BankAccount[];
  allBankAccounts: readonly BankAccount[];
  accounts: readonly ChartAccount[];
}): Promise<{ created: ChartAccount[]; linked: BankAccount[] }> {
  const repo = getRepository();
  const parent = args.accounts.find((a) => a.code === BANKS_PARENT_CODE);
  if (!parent) {
    throw new Error(`O plano não tem a conta ${BANKS_PARENT_CODE} (Bancos). Aplique o modelo ITG 1000 ou vincule o banco a uma conta existente.`);
  }
  const targets = new Map(args.targets.map((b) => [b.id, b] as const));
  if (parent.nature === 'ANALYTIC') {
    if (await accountInUse(args.clientId, parent.id)) {
      throw new Error(
        `A conta ${parent.code} ${parent.name} já recebeu lançamentos ou regras e não pode virar sintética. Crie a subconta manualmente em outro grupo ou vincule o banco a uma conta existente.`
      );
    }
    // Todo banco vinculado à conta que vai virar sintética precisa da própria subconta.
    for (const b of args.allBankAccounts) if (b.ledgerAccountId === parent.id && !targets.has(b.id)) targets.set(b.id, b);
  }

  const now = new Date().toISOString();
  const pool: Pick<ChartAccount, 'code'>[] = [...args.accounts];
  const created: ChartAccount[] = [];
  const linked: BankAccount[] = [];
  for (const bank of targets.values()) {
    const code = nextChildCode(parent.code, pool);
    const account: ChartAccount = {
      id: `${args.clientId}_bank_${code}`,
      clientId: args.clientId,
      code,
      name: bank.nickname,
      type: 'ASSET',
      nature: 'ANALYTIC',
      parentId: parent.id,
      level: code.split('.').length,
      description: `Conta bancária ${bank.accountKey}`,
      createdAt: now,
      updatedAt: now,
    };
    pool.push(account);
    created.push(account);
    linked.push({ ...bank, ledgerAccountId: account.id, ledgerAccountCode: account.code, ledgerAccountName: account.name, updatedAt: now });
  }
  await repo.insertAccounts(created);
  if (parent.nature === 'ANALYTIC') await repo.saveAccount({ ...parent, nature: 'SYNTHETIC', updatedAt: now });
  for (const b of linked) await repo.saveBankAccount(b);
  return { created, linked };
}

/* =========================================================================
   Transferências entre contas próprias
   ========================================================================= */

/** Conta transitória do cliente; cria 1.1.1.04 (ou o próximo código livre em 1.1.1) se faltar. */
export async function ensureTransitAccount(clientId: string, accounts: readonly ChartAccount[]): Promise<{ account: ChartAccount; created: boolean }> {
  const existing = findTransitAccount(accounts);
  if (existing) return { account: existing, created: false };
  const group = accounts.find((a) => a.code === '1.1.1');
  const code = accounts.some((a) => a.code === TRANSIT_ACCOUNT.code) ? nextChildCode('1.1.1', accounts, 2) : TRANSIT_ACCOUNT.code;
  const now = new Date().toISOString();
  const account: ChartAccount = {
    id: `${clientId}_transit_${code}`,
    clientId,
    code,
    name: TRANSIT_ACCOUNT.name,
    type: 'ASSET',
    nature: 'ANALYTIC',
    ...(group ? { parentId: group.id } : {}),
    level: code.split('.').length,
    description: 'Transitória: as duas pernas de uma transferência entre contas próprias se anulam aqui.',
    createdAt: now,
    updatedAt: now,
  };
  await getRepository().saveAccount(account);
  return { account, created: true };
}

/**
 * Desfaz a outra perna de uma transferência quando uma perna é reclassificada, desfeita
 * ou excluída (senão a conta transitória ficaria com saldo). Devolve patch e auditoria.
 */
export async function partnerResetChange(
  target: BankTransaction,
  loaded: readonly BankTransaction[],
  lockedMonths: ReadonlySet<string>,
  now: string,
  note: string
): Promise<{ patch: TransactionPatch; audit: AuditEntry; after: BankTransaction } | null> {
  if (!target.transferPairId) return null;
  const partner = loaded.find((t) => t.id === target.transferPairId) ?? (await getRepository().getTransaction(target.transferPairId));
  if (!partner || partner.transferPairId !== target.id) return null;
  if (isMonthLocked(partner.date, lockedMonths)) {
    throw new Error(
      `A outra perna desta transferência está em ${formatMonth(monthOf(partner.date))}, competência fechada. Reabra-a para alterar a transferência.`
    );
  }
  const { patch, after } = resetTransition(partner);
  return { patch, after, audit: transactionAudit('UNRECONCILE', getActor(), partner, after, now, { note }) };
}

/* =========================================================================
   Exclusão de extrato importado
   ========================================================================= */

export interface BatchDeletionPreview {
  transactions: BankTransaction[];
  reconciled: number;
  /** Competências fechadas atingidas: se houver, a exclusão é bloqueada. */
  lockedMonths: string[];
  /** Pernas de transferência em outros extratos que voltarão para pendente. */
  partners: number;
}

export async function previewBatchDeletion(batch: ImportBatch, lockedMonths: ReadonlySet<string>): Promise<BatchDeletionPreview> {
  const transactions = await getRepository().listBatchTransactions(batch);
  const ids = new Set(transactions.map((t) => t.id));
  return {
    transactions,
    reconciled: transactions.filter((t) => t.status === 'RECONCILED').length,
    lockedMonths: [...new Set(transactions.map((t) => monthOf(t.date)).filter((m) => lockedMonths.has(m)))].sort(),
    partners: transactions.filter((t) => t.transferPairId && !ids.has(t.transferPairId)).length,
  };
}

/** Exclui o extrato (lançamentos + lote), desfaz pares de transferência e registra na auditoria. */
export async function deleteImportBatch(batch: ImportBatch, preview: BatchDeletionPreview, lockedMonths: ReadonlySet<string>, reason?: string): Promise<void> {
  if (preview.lockedMonths.length) {
    throw new Error(`O extrato tem lançamentos em competência fechada (${preview.lockedMonths.map((m) => formatMonth(m)).join(', ')}). Reabra antes de excluir.`);
  }
  const actor = getActor();
  const now = new Date().toISOString();
  const ids = new Set(preview.transactions.map((t) => t.id));
  const patches: TransactionPatch[] = [];
  const audits: AuditEntry[] = [];
  for (const t of preview.transactions) {
    if (!t.transferPairId || ids.has(t.transferPairId)) continue;
    const change = await partnerResetChange(t, [], lockedMonths, now, `Par de transferência excluído com o extrato ${batch.fileName}`);
    if (change) {
      patches.push(change.patch);
      audits.push(change.audit);
    }
  }
  audits.push({
    id: newAuditId(),
    clientId: batch.clientId,
    action: 'BATCH_DELETE',
    actorUid: actor.uid,
    ...(actor.email ? { actorEmail: actor.email } : {}),
    at: now,
    note: [
      `${batch.fileName}: ${preview.transactions.length} lançamento(s) excluído(s), ${preview.reconciled} conciliado(s)`,
      batch.startDate && batch.endDate ? `período ${batch.startDate} a ${batch.endDate}` : '',
      reason ? `motivo: ${reason}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  });
  await getRepository().deleteImportBatch(batch, preview.transactions, { patches, audits });
}

/* =========================================================================
   Pendências com o cliente
   ========================================================================= */

/** Token do link: 128 bits aleatórios em hexadecimal (32 caracteres). */
export function newRequestToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const REQUEST_VALIDITY_DAYS = 30;

/** Cria o link com as perguntas em aberto (dados mínimos do lançamento, sem acesso ao restante). */
export async function createClientRequest(client: ClientCompany, queried: readonly BankTransaction[], officeName?: string): Promise<ClientRequest> {
  const items = queried
    .filter((t) => t.clientQuery?.status === 'OPEN')
    .map((t) => ({ transactionId: t.id, date: t.date, memo: t.memo, amount: t.amount, question: t.clientQuery!.question }));
  if (!items.length) throw new Error('Nenhuma pergunta em aberto para enviar.');
  const actor = getActor();
  const now = new Date();
  const request: ClientRequest = {
    id: newRequestToken(),
    clientId: client.id,
    clientName: client.tradeName || client.name,
    ...(officeName ? { officeName } : {}),
    items,
    status: 'OPEN',
    createdAt: now.toISOString(),
    createdByUid: actor.uid,
    expiresAtMs: now.getTime() + REQUEST_VALIDITY_DAYS * 86_400_000,
  };
  await getRepository().saveClientRequest(request);
  return request;
}

export async function closeClientRequest(request: ClientRequest): Promise<ClientRequest> {
  const closed: ClientRequest = { ...request, status: 'CLOSED' };
  await getRepository().saveClientRequest(closed);
  return closed;
}

/** Link público de resposta. */
export const requestLink = (origin: string, token: string) => `${origin}/responder?t=${token}`;

/* =========================================================================
   Correção de acentuação (UTF-8 lido como Latin-1 em importações antigas)
   ========================================================================= */

/**
 * Aplica o plano de `planTextRepair`: corrige o histórico dos lançamentos (só data e valor
 * são imutáveis nas regras, então a competência aberta aceita a alteração), o termo das
 * regras e remove regras que ficaram duplicadas. Competências fechadas não são tocadas.
 * A correção é registrada na auditoria (a trilha antiga é imutável e não é reescrita).
 */
export async function applyTextRepair(clientId: string, plan: TextRepairPlan): Promise<{ memos: number; rules: number; removedRules: number }> {
  if (!plan.memos.length && !plan.rules.length && !plan.duplicateRuleIds.length) return { memos: 0, rules: 0, removedRules: 0 };
  const repo = getRepository();
  const actor = getActor();
  const now = new Date().toISOString();
  const note = [
    `${plan.memos.length} histórico(s) e ${plan.rules.length} regra(s) corrigidos`,
    plan.duplicateRuleIds.length ? `${plan.duplicateRuleIds.length} regra(s) duplicada(s) removida(s)` : '',
    plan.lockedMemos.length ? `${plan.lockedMemos.length} em competência fechada mantido(s)` : '',
    plan.memos[0] ? `ex.: “${plan.memos[0].before.slice(0, 60)}” → “${plan.memos[0].after.slice(0, 60)}”` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  await repo.commitChanges({
    patches: plan.memos.map((m) => ({ id: m.id, date: m.date, set: { memo: m.after } })),
    rules: plan.rules.map((r) => ({ ...r.rule, pattern: r.after, updatedAt: now })),
    audits: [
      {
        id: newAuditId(),
        clientId,
        action: 'MEMO_REPAIR',
        actorUid: actor.uid,
        ...(actor.email ? { actorEmail: actor.email } : {}),
        at: now,
        note,
      },
    ],
  });
  for (const id of plan.duplicateRuleIds) await repo.deleteRule(id);
  return { memos: plan.memos.length, rules: plan.rules.length, removedRules: plan.duplicateRuleIds.length };
}
