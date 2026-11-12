import type {
  AuditEntry,
  BankAccount,
  BankTransaction,
  ChartAccount,
  ClassificationRule,
  ClientCompany,
  ClientRequest,
  ClosingChecklist,
  ExplanatoryNotes,
  FinancingRegister,
  FixedAssetRegister,
  ImportBatch,
  InvestmentRegister,
  InvoiceSummary,
  JournalCounter,
  JournalEntry,
  LockState,
  OpeningBalances,
  PayrollRegister,
  PeriodLock,
  PrepaidRegister,
  StockControl,
} from '@/types/firestore';
import type { DataRepository, JournalEntryDraft, LocalClientRestorePayload, TransactionPatch } from '@/lib/data/repository';
import { getRepository } from '@/lib/services/data-service';
import { journalAudit, newAuditId, type Actor } from '@/lib/audit';
import { generateId, newAccountId, newBatchId, newClientId, newRuleId, newSplitId } from '@/lib/utils/id';
import { newAuditKey } from '@/lib/periods';
import type { ClientBackup } from './client-backup';

export type RestoreMode = 'local-exact' | 'new-company';

export interface NormalizedClientBackup extends Omit<ClientBackup, 'version'> {
  version: 1 | 2;
  journalCounter: JournalCounter | null;
  lockState: LockState | null;
  payrollRegister: PayrollRegister | null;
  closingChecklists: ClosingChecklist[];
  explanatoryNotes: ExplanatoryNotes[];
}

export interface BackupSummary {
  version: 1 | 2;
  exportedAt: string;
  clientName: string;
  tradeName?: string;
  cnpj: string;
  regime: ClientCompany['regime'];
  accounts: number;
  rules: number;
  bankAccounts: number;
  transactions: number;
  journalEntries: number;
  periodLocks: number;
  invoices: number;
  closingChecklists: number;
  explanatoryNotes: number;
  clientRequests: number;
  audit: number;
  auditTruncated: boolean;
  hasOpeningBalances: boolean;
  hasFixedAssets: boolean;
  hasPrepaidExpenses: boolean;
  hasFinancingContracts: boolean;
  hasInvestments: boolean;
  hasStockControl: boolean;
  hasPayrollRegister: boolean;
}

export interface RestoreOptions {
  /**
   * `'local-exact'` mantém IDs originais e histórico completo (apenas modo local).
   * `'new-company'` importa como nova empresa com remapeamento completo de IDs (Firestore e local).
   */
  mode: RestoreMode;
  targetName?: string;
  actor: Actor;
  repo?: DataRepository;
  onProgress?: (stage: string) => void;
}

export interface RestoreResult {
  client: ClientCompany;
  mode: RestoreMode;
  warnings: string[];
}

export class ClientRestoreError extends Error {
  readonly partialClientId?: string;
  readonly stage: string;

  constructor(message: string, stage: string, partialClientId?: string) {
    super(message);
    this.name = 'ClientRestoreError';
    this.stage = stage;
    this.partialClientId = partialClientId;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const asArray = <T>(v: unknown, name: string): T[] => {
  if (!Array.isArray(v)) throw new Error(`Backup inválido: campo "${name}" ausente ou malformado.`);
  return v as T[];
};
const asOptionalArray = <T>(v: unknown, name: string): T[] => {
  if (v === undefined || v === null) return [];
  return asArray<T>(v, name);
};

/** Faz o parse e valida a estrutura mínima de um JSON exportado pelo ContaFlow (v1 ou v2). */
export function parseClientBackup(json: string): NormalizedClientBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('O arquivo selecionado não contém um JSON válido.');
  }
  if (!isRecord(raw) || raw.format !== 'contaflow-backup') {
    throw new Error('Arquivo incompatível: não é um backup do ContaFlow.');
  }
  if (raw.version !== 1 && raw.version !== 2) {
    throw new Error(`Versão de backup não suportada: ${String(raw.version)}.`);
  }
  if (!isRecord(raw.client) || typeof raw.client.id !== 'string' || typeof raw.client.name !== 'string') {
    throw new Error('Backup inválido: dados cadastrais da empresa ausentes.');
  }
  if (typeof raw.exportedAt !== 'string') {
    throw new Error('Backup inválido: data de exportação ausente.');
  }

  const client = raw.client as unknown as ClientCompany;
  return {
    format: 'contaflow-backup',
    version: raw.version,
    exportedAt: raw.exportedAt,
    client,
    accounts: asArray<ChartAccount>(raw.accounts, 'accounts'),
    rules: asArray<ClassificationRule>(raw.rules, 'rules'),
    bankAccounts: asArray<BankAccount>(raw.bankAccounts, 'bankAccounts'),
    openingBalances: isRecord(raw.openingBalances) ? (raw.openingBalances as unknown as OpeningBalances) : null,
    importBatches: asArray<ImportBatch>(raw.importBatches, 'importBatches'),
    transactions: asArray<BankTransaction>(raw.transactions, 'transactions'),
    journalEntries: asArray<JournalEntry>(raw.journalEntries, 'journalEntries'),
    journalCounter: isRecord(raw.journalCounter) ? (raw.journalCounter as unknown as JournalCounter) : null,
    periodLocks: asArray<PeriodLock>(raw.periodLocks, 'periodLocks'),
    lockState: isRecord(raw.lockState) ? (raw.lockState as unknown as LockState) : null,
    clientRequests: asArray<ClientRequest>(raw.clientRequests, 'clientRequests'),
    invoices: asArray<InvoiceSummary>(raw.invoices, 'invoices'),
    fixedAssets: isRecord(raw.fixedAssets) ? (raw.fixedAssets as unknown as FixedAssetRegister) : null,
    prepaidExpenses: isRecord(raw.prepaidExpenses) ? (raw.prepaidExpenses as unknown as PrepaidRegister) : null,
    financingContracts: isRecord(raw.financingContracts) ? (raw.financingContracts as unknown as FinancingRegister) : null,
    investments: isRecord(raw.investments) ? (raw.investments as unknown as InvestmentRegister) : null,
    stockControl: isRecord(raw.stockControl) ? (raw.stockControl as unknown as StockControl) : null,
    payrollRegister: isRecord(raw.payrollRegister) ? (raw.payrollRegister as unknown as PayrollRegister) : null,
    closingChecklists: asOptionalArray<ClosingChecklist>(raw.closingChecklists, 'closingChecklists'),
    explanatoryNotes: asOptionalArray<ExplanatoryNotes>(raw.explanatoryNotes, 'explanatoryNotes'),
    audit: asArray<AuditEntry>(raw.audit, 'audit'),
    auditTruncated: Boolean(raw.auditTruncated),
  };
}

/** Resume o conteúdo de um backup normalizado para pré-visualização antes de restaurar. */
export function inspectClientBackup(backup: NormalizedClientBackup): BackupSummary {
  return {
    version: backup.version,
    exportedAt: backup.exportedAt,
    clientName: backup.client.name,
    tradeName: backup.client.tradeName,
    cnpj: backup.client.cnpj,
    regime: backup.client.regime,
    accounts: backup.accounts.length,
    rules: backup.rules.length,
    bankAccounts: backup.bankAccounts.length,
    transactions: backup.transactions.length,
    journalEntries: backup.journalEntries.length,
    periodLocks: backup.periodLocks.length,
    invoices: backup.invoices.length,
    closingChecklists: backup.closingChecklists.length,
    explanatoryNotes: backup.explanatoryNotes.length,
    clientRequests: backup.clientRequests.length,
    audit: backup.audit.length,
    auditTruncated: backup.auditTruncated,
    hasOpeningBalances: Boolean(backup.openingBalances),
    hasFixedAssets: Boolean(backup.fixedAssets),
    hasPrepaidExpenses: Boolean(backup.prepaidExpenses),
    hasFinancingContracts: Boolean(backup.financingContracts),
    hasInvestments: Boolean(backup.investments),
    hasStockControl: Boolean(backup.stockControl),
    hasPayrollRegister: Boolean(backup.payrollRegister),
  };
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

const omitOrg = <T extends { orgId?: string }>(doc: T): Omit<T, 'orgId'> => {
  const { orgId: _o, ...rest } = doc;
  void _o;
  return rest;
};

const omitRegisterMeta = <T extends { orgId?: string; version?: number }>(doc: T): Omit<T, 'orgId' | 'version'> => {
  const { orgId: _o, version: _v, ...rest } = doc;
  void _o;
  void _v;
  return rest;
};

const newRequestToken = (): string =>
  `${generateId('req').replace(/[^A-Za-z0-9]/g, '')}${generateId('').replace(/[^A-Za-z0-9]/g, '')}`
    .padEnd(36, '0')
    .slice(0, 44);

export interface RemappedBackup {
  client: ClientCompany;
  accountsToCreate: ChartAccount[];
  rulesToCreate: ClassificationRule[];
  bankAccounts: BankAccount[];
  openingBalances: OpeningBalances | null;
  importBatches: ImportBatch[];
  pendingTransactions: BankTransaction[];
  finalTransactions: BankTransaction[];
  transactionPatches: TransactionPatch[];
  regularJournalDrafts: JournalEntryDraft[];
  closingYearGroups: { year: string; drafts: JournalEntryDraft[] }[];
  fullJournalEntries: JournalEntry[];
  journalCounter: JournalCounter | null;
  periodLocks: PeriodLock[];
  lockState: LockState | null;
  invoices: InvoiceSummary[];
  fixedAssets: FixedAssetRegister | null;
  prepaidExpenses: PrepaidRegister | null;
  financingContracts: FinancingRegister | null;
  investments: InvestmentRegister | null;
  stockControl: StockControl | null;
  payrollRegister: PayrollRegister | null;
  closingChecklists: ClosingChecklist[];
  explanatoryNotes: ExplanatoryNotes[];
  clientRequests: ClientRequest[];
  remappedAudit: AuditEntry[];
  warnings: string[];
}

/**
 * Remapeia todos os IDs e referências cruzadas de um backup para importar como uma nova empresa,
 * preservando itens `'global'` que já existem no escritório de destino sem alterá-los.
 */
export function remapBackupForNewClient(
  backup: NormalizedClientBackup,
  params: {
    targetClientId?: string;
    targetName?: string;
    existingGlobalAccounts: readonly ChartAccount[];
    existingGlobalRules: readonly ClassificationRule[];
    actorUid: string;
    now?: string;
  }
): RemappedBackup {
  const now = params.now ?? new Date().toISOString();
  const clientId = params.targetClientId ?? newClientId();
  const warnings: string[] = [];

  const { orgId: _cOrg, deletingAt: _cDel, ...clientBase } = backup.client;
  void _cOrg;
  void _cDel;
  const targetName = params.targetName?.trim() || `${backup.client.name} (Restaurada)`;
  const client: ClientCompany = stripUndefined({
    ...clientBase,
    id: clientId,
    name: targetName,
    updatedAt: now,
  });

  // 1. Plano de contas: globais existentes são reutilizados; faltantes ou próprios viram contas da nova empresa.
  const globalAccountIds = new Set(params.existingGlobalAccounts.map((a) => a.id));
  const globalAccountByCode = new Map(
    params.existingGlobalAccounts.filter((a) => a.clientId === 'global').map((a) => [a.code, a.id])
  );
  const accountIdMap = new Map<string, string>();
  const draftAccounts: ChartAccount[] = [];
  for (const acc of backup.accounts) {
    if (acc.clientId === 'global') {
      if (globalAccountIds.has(acc.id)) {
        accountIdMap.set(acc.id, acc.id);
        continue;
      }
      const sameCode = globalAccountByCode.get(acc.code);
      if (sameCode) {
        accountIdMap.set(acc.id, sameCode);
        continue;
      }
    }
    const newId = newAccountId();
    accountIdMap.set(acc.id, newId);
    const { orgId: _aOrg, lockSeq: _aSeq, ...accRest } = acc;
    void _aOrg;
    void _aSeq;
    draftAccounts.push(stripUndefined({ ...accRest, id: newId, clientId }));
  }
  const mapAcc = (id: string) => accountIdMap.get(id) ?? id;
  const accountsToCreate: ChartAccount[] = draftAccounts.map((acc) =>
    stripUndefined({
      ...acc,
      ...(acc.parentId ? { parentId: mapAcc(acc.parentId) } : {}),
    })
  );

  // 2. Regras: globais existentes no destino são preservadas; demais viram regras da nova empresa.
  const globalRuleIds = new Set(params.existingGlobalRules.map((r) => r.id));
  const rulesToCreate: ClassificationRule[] = [];
  const ruleIdMap = new Map<string, string>();
  for (const rule of backup.rules) {
    if (rule.clientId === 'global' && globalRuleIds.has(rule.id)) {
      ruleIdMap.set(rule.id, rule.id);
      continue;
    }
    const newId = newRuleId();
    ruleIdMap.set(rule.id, newId);
    rulesToCreate.push(
      stripUndefined({
        ...omitOrg(rule),
        id: newId,
        clientId,
        accountId: mapAcc(rule.accountId),
        createdByUid: params.actorUid,
      })
    );
  }
  const mapRule = (id?: string) => (id ? (ruleIdMap.get(id) ?? id) : undefined);

  // 3. Bancos e lotes de importação.
  const bankAccounts: BankAccount[] = backup.bankAccounts.map((b) => {
    const { orgId: _bOrg, lockSeq: _bSeq, ...bRest } = b;
    void _bOrg;
    void _bSeq;
    return stripUndefined({
      ...bRest,
      id: `${clientId}_${b.accountKey}`,
      clientId,
      ...(b.ledgerAccountId ? { ledgerAccountId: mapAcc(b.ledgerAccountId) } : {}),
    });
  });

  const batchIdMap = new Map<string, string>();
  for (const batch of backup.importBatches) {
    batchIdMap.set(batch.id, newBatchId());
  }
  const mapBatch = (id?: string) => (id ? (batchIdMap.get(id) ?? id) : undefined);
  const importBatches: ImportBatch[] = backup.importBatches.map((b) =>
    stripUndefined({
      ...omitOrg(b),
      id: batchIdMap.get(b.id)!,
      clientId,
      ...(b.balanceCheck?.previousBatchId
        ? { balanceCheck: { ...b.balanceCheck, previousBatchId: mapBatch(b.balanceCheck.previousBatchId) } }
        : {}),
    })
  );

  // 4. Lançamentos bancários: monta mapa de IDs antes por causa de pares de transferência (`transferPairId`).
  const txIdMap = new Map<string, string>();
  for (const t of backup.transactions) {
    txIdMap.set(t.id, `${clientId}_${t.fitid}`);
  }
  const mapTx = (id: string) => txIdMap.get(id) ?? id;

  const finalTransactions: BankTransaction[] = [];
  const pendingTransactions: BankTransaction[] = [];
  const transactionPatches: TransactionPatch[] = [];

  for (const t of backup.transactions) {
    const newId = txIdMap.get(t.id)!;
    const remappedSplits = t.splits?.map((s) =>
      stripUndefined({
        ...s,
        id: newSplitId(),
        accountId: mapAcc(s.accountId),
      })
    );
    const full: BankTransaction = stripUndefined({
      ...omitOrg(t),
      id: newId,
      clientId,
      ...(t.accountId ? { accountId: mapAcc(t.accountId) } : {}),
      ...(t.matchedRuleId ? { matchedRuleId: mapRule(t.matchedRuleId) } : {}),
      ...(t.importBatchId ? { importBatchId: mapBatch(t.importBatchId) } : {}),
      ...(remappedSplits ? { splits: remappedSplits } : {}),
      ...(t.transferPairId ? { transferPairId: mapTx(t.transferPairId) } : {}),
    });
    finalTransactions.push(full);

    // No Firestore, `create` em `transactions` só aceita PENDING ou AUTO_CLASSIFIED; demais campos vão em patch.
    const pending: BankTransaction = stripUndefined({
      id: newId,
      clientId,
      fitid: t.fitid,
      date: t.date,
      amount: t.amount,
      type: t.type,
      memo: t.memo,
      status: 'PENDING' as const,
      ...(t.bankName !== undefined ? { bankName: t.bankName } : {}),
      ...(t.accountNumber !== undefined ? { accountNumber: t.accountNumber } : {}),
      ...(full.importBatchId !== undefined ? { importBatchId: full.importBatchId } : {}),
      ...(t.accountKey !== undefined ? { accountKey: t.accountKey } : {}),
      createdAt: t.createdAt,
    });
    pendingTransactions.push(pending);

    const set: Partial<BankTransaction> = {};
    if (full.status !== 'PENDING') set.status = full.status;
    if (full.accountId !== undefined) set.accountId = full.accountId;
    if (full.accountCode !== undefined) set.accountCode = full.accountCode;
    if (full.accountName !== undefined) set.accountName = full.accountName;
    if (full.matchedRuleId !== undefined) set.matchedRuleId = full.matchedRuleId;
    if (full.confidence !== undefined) set.confidence = full.confidence;
    if (full.reconciledAt !== undefined) set.reconciledAt = full.reconciledAt;
    if (full.isSplit !== undefined) set.isSplit = full.isSplit;
    if (full.splits !== undefined) set.splits = full.splits;
    if (full.transferPairId !== undefined) set.transferPairId = full.transferPairId;
    if (full.clientQuery !== undefined) set.clientQuery = full.clientQuery;
    if (Object.keys(set).length > 0) {
      transactionPatches.push({ id: newId, date: full.date, set });
    }
  }

  // 5. Saldos de abertura.
  const openingBalances: OpeningBalances | null = backup.openingBalances
    ? (() => {
        const { orgId: _oOrg, lockSeq: _oSeq, ...oRest } = backup.openingBalances;
        void _oOrg;
        void _oSeq;
        return stripUndefined({
          ...oRest,
          id: clientId,
          clientId,
          entries: backup.openingBalances.entries.map((e) => stripUndefined({ ...e, accountId: mapAcc(e.accountId) })),
        });
      })()
    : null;

  // 6. Lançamentos manuais do Diário (avulsos vs encerramento do exercício).
  const journalIdMap = new Map<string, string>();
  for (const j of backup.journalEntries) {
    journalIdMap.set(j.id, generateId('je'));
  }
  const mapJournal = (id: string) => journalIdMap.get(id) ?? id;
  const sortedEntries = [...backup.journalEntries].sort(
    (a, b) => (a.entryNumber || 0) - (b.entryNumber || 0) || a.date.localeCompare(b.date)
  );
  const fullJournalEntries: JournalEntry[] = [];
  const regularJournalDrafts: JournalEntryDraft[] = [];
  const closingByYear = new Map<string, JournalEntryDraft[]>();

  for (const j of sortedEntries) {
    const newId = journalIdMap.get(j.id)!;
    const remappedEntry: JournalEntry = stripUndefined({
      ...omitOrg(j),
      id: newId,
      clientId,
      ...(j.repeatedFromId ? { repeatedFromId: mapJournal(j.repeatedFromId) } : {}),
      lines: j.lines.map((l) => stripUndefined({ ...l, accountId: mapAcc(l.accountId) })),
    });
    fullJournalEntries.push(remappedEntry);

    const { entryNumber: _num, closingAuditId: _cid, ...draftRest } = remappedEntry;
    void _num;
    void _cid;
    if (j.yearClosing) {
      const list = closingByYear.get(j.yearClosing) ?? [];
      list.push(draftRest);
      closingByYear.set(j.yearClosing, list);
    } else {
      regularJournalDrafts.push(draftRest);
    }
  }

  const closingYearGroups = [...closingByYear.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, drafts]) => ({ year, drafts }));

  // 7. Fechamentos e sequências.
  const periodLocks: PeriodLock[] = [...backup.periodLocks]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((l) =>
      stripUndefined({
        ...omitOrg(l),
        id: `${clientId}_${l.month}`,
        clientId,
        auditKey: newAuditKey(),
      })
    );

  const journalCounter: JournalCounter | null = backup.journalCounter
    ? { id: clientId, clientId, last: backup.journalCounter.last }
    : fullJournalEntries.length > 0
      ? { id: clientId, clientId, last: fullJournalEntries.reduce((m, e) => Math.max(m, e.entryNumber || 0), 0) }
      : null;

  const lockState: LockState | null = backup.lockState
    ? { id: clientId, clientId, count: periodLocks.length, seq: Math.max(backup.lockState.seq, periodLocks.length) }
    : periodLocks.length > 0
      ? { id: clientId, clientId, count: periodLocks.length, seq: periodLocks.length }
      : null;

  // 8. Notas fiscais (resumos + vínculos remapeados).
  const invoices: InvoiceSummary[] = backup.invoices.map((inv) =>
    stripUndefined({
      ...omitOrg(inv),
      id: `${clientId}_${inv.key}`,
      clientId,
      ...(inv.links
        ? {
            links: inv.links.map((lk) =>
              stripUndefined({
                ...lk,
                transactionId: mapTx(lk.transactionId),
                accountId: mapAcc(lk.accountId),
              })
            ),
          }
        : {}),
    })
  );

  // 9. Os 6 cadastros auxiliares.
  const fixedAssets: FixedAssetRegister | null = backup.fixedAssets
    ? stripUndefined({
        ...omitRegisterMeta(backup.fixedAssets),
        id: clientId,
        clientId,
        assets: backup.fixedAssets.assets.map((a) =>
          stripUndefined({
            ...a,
            accountId: mapAcc(a.accountId),
            ...(a.disposal
              ? { disposal: { ...a.disposal, journalEntryId: mapJournal(a.disposal.journalEntryId) } }
              : {}),
          })
        ),
      })
    : null;

  const prepaidExpenses: PrepaidRegister | null = backup.prepaidExpenses
    ? stripUndefined({
        ...omitRegisterMeta(backup.prepaidExpenses),
        id: clientId,
        clientId,
        items: backup.prepaidExpenses.items.map((item) =>
          stripUndefined({
            ...item,
            assetAccountId: mapAcc(item.assetAccountId),
            payableAccountId: mapAcc(item.payableAccountId),
            expenseAccountId: mapAcc(item.expenseAccountId),
            ...(item.recognitionEntryId ? { recognitionEntryId: mapJournal(item.recognitionEntryId) } : {}),
          })
        ),
      })
    : null;

  const financingContracts: FinancingRegister | null = backup.financingContracts
    ? stripUndefined({
        ...omitRegisterMeta(backup.financingContracts),
        id: clientId,
        clientId,
        contracts: backup.financingContracts.contracts.map((c) =>
          stripUndefined({
            ...c,
            counterpartAccountId: mapAcc(c.counterpartAccountId),
            shortTermAccountId: mapAcc(c.shortTermAccountId),
            longTermAccountId: mapAcc(c.longTermAccountId),
            ...(c.chargesShortAccountId ? { chargesShortAccountId: mapAcc(c.chargesShortAccountId) } : {}),
            ...(c.chargesLongAccountId ? { chargesLongAccountId: mapAcc(c.chargesLongAccountId) } : {}),
            ...(c.upfrontExpenseAccountId ? { upfrontExpenseAccountId: mapAcc(c.upfrontExpenseAccountId) } : {}),
            interestExpenseAccountId: mapAcc(c.interestExpenseAccountId),
            ...(c.initialEntryId ? { initialEntryId: mapJournal(c.initialEntryId) } : {}),
          })
        ),
      })
    : null;

  const investments: InvestmentRegister | null = backup.investments
    ? stripUndefined({
        ...omitRegisterMeta(backup.investments),
        id: clientId,
        clientId,
        accounts: backup.investments.accounts.map((a) =>
          stripUndefined({ ...a, ledgerAccountId: mapAcc(a.ledgerAccountId) })
        ),
      })
    : null;

  const stockControl: StockControl | null = backup.stockControl
    ? stripUndefined({
        ...omitRegisterMeta(backup.stockControl),
        id: clientId,
        clientId,
        stockAccountId: mapAcc(backup.stockControl.stockAccountId),
        costAccountId: mapAcc(backup.stockControl.costAccountId),
      })
    : null;

  const payrollRegister: PayrollRegister | null = backup.payrollRegister
    ? stripUndefined({
        ...omitRegisterMeta(backup.payrollRegister),
        id: clientId,
        clientId,
        summaries: backup.payrollRegister.summaries.map((s) =>
          stripUndefined({
            ...s,
            clientId,
            journalEntryIds: s.journalEntryIds.map(mapJournal),
          })
        ),
      })
    : null;

  // 10. Checklists, notas explicativas e pendências antigas (sempre encerradas para não vazar link).
  const closingChecklists: ClosingChecklist[] = backup.closingChecklists.map((c) =>
    stripUndefined({ ...omitOrg(c), id: `${clientId}_${c.year}`, clientId })
  );
  const explanatoryNotes: ExplanatoryNotes[] = backup.explanatoryNotes.map((n) =>
    stripUndefined({ ...omitOrg(n), id: `${clientId}_${n.year}`, clientId })
  );

  const clientRequests: ClientRequest[] = [];
  for (const r of backup.clientRequests) {
    if (r.items.length === 0 || r.items.length > 24) {
      warnings.push(`Link de pendência "${r.id}" ignorado (quantidade de perguntas fora do limite permitido).`);
      continue;
    }
    clientRequests.push(
      stripUndefined({
        ...omitOrg(r),
        id: newRequestToken(),
        clientId,
        clientName: targetName,
        status: 'CLOSED' as const,
        createdByUid: params.actorUid,
        expiresAtMs: Date.now() + 86_400_000,
        items: r.items.map((item) => stripUndefined({ ...item, transactionId: mapTx(item.transactionId) })),
      })
    );
  }

  // 11. Trilha de auditoria (remapeada apenas para uso no modo local).
  const remappedAudit: AuditEntry[] = backup.audit.map((a) =>
    stripUndefined({
      ...omitOrg(a),
      id: newAuditId(),
      clientId,
      ...(a.transactionId ? { transactionId: mapTx(a.transactionId) } : {}),
    })
  );

  return {
    client,
    accountsToCreate,
    rulesToCreate,
    bankAccounts,
    openingBalances,
    importBatches,
    pendingTransactions,
    finalTransactions,
    transactionPatches,
    regularJournalDrafts,
    closingYearGroups,
    fullJournalEntries,
    journalCounter,
    periodLocks,
    lockState,
    invoices,
    fixedAssets,
    prepaidExpenses,
    financingContracts,
    investments,
    stockControl,
    payrollRegister,
    closingChecklists,
    explanatoryNotes,
    clientRequests,
    remappedAudit,
    warnings,
  };
}

function buildRestoreAudit(clientId: string, sourceClient: ClientCompany, actor: Actor, at: string, note: string): AuditEntry {
  return {
    id: newAuditId(),
    clientId,
    action: 'CLIENT_RESTORE',
    actorUid: actor.uid,
    ...(actor.email ? { actorEmail: actor.email } : {}),
    at,
    note: `${note} (origem: ${sourceClient.name}${sourceClient.cnpj ? ` · ${sourceClient.cnpj}` : ''})`,
  };
}

/**
 * Executa a restauração em 6 etapas pelos métodos comuns do repositório (Client SDK / Firestore):
 * 1) Empresa + plano de contas + regras + bancos;
 * 2) Lotes + transações como PENDING;
 * 3) Lançamentos avulsos do Diário (ainda com todos os meses abertos) + saldos de abertura;
 * 4) Conciliações/classificações (`commitChanges`), cadastros auxiliares, notas fiscais (com vínculos), checklists, notas e links encerrados;
 * 5) Fechamentos de competência em ordem cronológica + encerramentos anuais (`closeYear`);
 * 6) Registro único `CLIENT_RESTORE` na trilha de auditoria.
 */
export async function restoreNewCompanyViaRepository(
  backup: NormalizedClientBackup,
  remapped: RemappedBackup,
  repo: DataRepository,
  actor: Actor,
  onProgress?: (stage: string) => void
): Promise<RestoreResult> {
  const now = new Date().toISOString();
  const clientId = remapped.client.id;
  const warnings = [...remapped.warnings];
  let createdClient = false;

  const runStage = async (stage: string, fn: () => Promise<void>) => {
    onProgress?.(stage);
    try {
      await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro inesperado durante a restauração.';
      throw new ClientRestoreError(msg, stage, createdClient ? clientId : undefined);
    }
  };

  // Etapa 1: empresa + estrutura base
  await runStage('Criando empresa, plano de contas e regras...', async () => {
    await repo.saveClient(remapped.client);
    createdClient = true;
    if (remapped.accountsToCreate.length > 0) {
      await repo.insertAccounts(remapped.accountsToCreate);
    }
    for (const rule of remapped.rulesToCreate) {
      await repo.saveRule(rule);
    }
    for (const bank of remapped.bankAccounts) {
      await repo.saveBankAccount(bank);
    }
  });

  // Etapa 2: extratos e lançamentos bancários (sempre PENDING na criação para passar nas regras)
  await runStage('Importando lotes e lançamentos bancários...', async () => {
    for (const batch of remapped.importBatches) {
      await repo.saveImportBatch(batch);
    }
    if (remapped.pendingTransactions.length > 0) {
      await repo.insertTransactions(remapped.pendingTransactions);
    }
  });

  // Etapa 3: lançamentos manuais regulares + saldos de abertura (ainda sem meses fechados)
  await runStage('Restaurando Diário e saldos de abertura...', async () => {
    for (const draft of remapped.regularJournalDrafts) {
      await repo.createJournalEntry(draft, journalAudit('JOURNAL_CREATE', actor, clientId, now, draft));
    }
    if (remapped.openingBalances) {
      await repo.saveOpeningBalances(remapped.openingBalances, {
        id: newAuditId(),
        clientId,
        action: 'OPENING_SAVE',
        actorUid: actor.uid,
        ...(actor.email ? { actorEmail: actor.email } : {}),
        at: now,
        note: 'Saldos de abertura restaurados a partir de backup',
      });
    }
  });

  // Etapa 4: conciliações, cadastros auxiliares, notas fiscais, checklists, notas e pendências
  await runStage('Aplicando conciliações, cadastros auxiliares e notas...', async () => {
    if (remapped.transactionPatches.length > 0) {
      await repo.commitChanges({ patches: remapped.transactionPatches, audits: [] });
    }
    const regAudit = (action: AuditEntry['action']): AuditEntry => ({
      id: newAuditId(),
      clientId,
      action,
      actorUid: actor.uid,
      ...(actor.email ? { actorEmail: actor.email } : {}),
      at: now,
      note: 'Cadastro restaurado a partir de backup',
    });
    if (remapped.fixedAssets) await repo.saveFixedAssets(remapped.fixedAssets, regAudit('ASSET_SAVE'));
    if (remapped.prepaidExpenses) await repo.savePrepaidExpenses(remapped.prepaidExpenses, regAudit('PREPAID_SAVE'));
    if (remapped.financingContracts) await repo.saveFinancingContracts(remapped.financingContracts, regAudit('FINANCING_SAVE'));
    if (remapped.investments) await repo.saveInvestments(remapped.investments, regAudit('INVESTMENT_SAVE'));
    if (remapped.stockControl) await repo.saveStockControl(remapped.stockControl, regAudit('STOCK_SAVE'));
    if (remapped.payrollRegister) await repo.savePayrollRegister(remapped.payrollRegister, regAudit('PAYROLL_SAVE'));

    if (remapped.invoices.length > 0) {
      await repo.saveInvoices(remapped.invoices);
      for (const inv of remapped.invoices) {
        for (const link of inv.links ?? []) {
          await repo.linkInvoice(inv.id, link);
        }
      }
    }
    for (const checklist of remapped.closingChecklists) {
      await repo.saveClosingChecklist(checklist);
    }
    for (const notes of remapped.explanatoryNotes) {
      await repo.saveExplanatoryNotes(notes);
    }
    for (const req of remapped.clientRequests) {
      // As regras do Firestore exigem criar com `status: 'OPEN'` e então encerrar.
      await repo.saveClientRequest({ ...req, status: 'OPEN' });
      await repo.closeClientRequest(req.id);
    }
  });

  // Etapa 5: fechamentos de período e encerramentos anuais
  await runStage('Reaplicando competências fechadas e encerramentos...', async () => {
    for (const lock of remapped.periodLocks) {
      await repo.closePeriod(
        { ...lock, lockedByUid: actor.uid, lockedAt: now },
        {
          id: `${lock.id}_close_${lock.auditKey ?? now}`,
          clientId,
          action: 'PERIOD_CLOSE',
          actorUid: actor.uid,
          ...(actor.email ? { actorEmail: actor.email } : {}),
          at: now,
          month: lock.month,
          note: 'Competência fechada na restauração do backup',
        }
      );
    }
    for (const group of remapped.closingYearGroups) {
      const closeAuditId = `${clientId}_${group.year}_close_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      await repo.closeYear(group.drafts, {
        id: closeAuditId,
        clientId,
        action: 'YEAR_CLOSE',
        actorUid: actor.uid,
        ...(actor.email ? { actorEmail: actor.email } : {}),
        at: now,
        month: `${group.year}-12`,
        note: `Encerramento de ${group.year} restaurado a partir de backup`,
      });
    }
  });

  // Etapa 6: registro final de auditoria
  await runStage('Registrando trilha da restauração...', async () => {
    const truncatedInfo = backup.auditTruncated
      ? ' Trilha histórica do backup estava truncada no teto de 20.000 eventos.'
      : '';
    const audit = buildRestoreAudit(
      clientId,
      backup.client,
      actor,
      now,
      `Restaurado como nova empresa (${remapped.finalTransactions.length} bancários, ${remapped.fullJournalEntries.length} no Diário). Histórico antigo permanece no JSON.${truncatedInfo}`
    );
    await repo.commitChanges({ patches: [], audits: [audit] });
  });

  if (backup.audit.length > 0) {
    warnings.push('O histórico antigo da trilha de auditoria permanece arquivado apenas no arquivo JSON (regra de imutabilidade na nuvem).');
  }

  return { client: remapped.client, mode: 'new-company', warnings };
}

/**
 * Restaura um backup de empresa do ContaFlow.
 * - No modo local (`local-exact` ou `new-company`), grava fielmente todos os documentos e a auditoria histórica.
 * - No Firestore (`new-company`), importa em 6 etapas como uma nova empresa com remapeamento seguro de IDs.
 */
export async function restoreClientBackup(backup: NormalizedClientBackup, options: RestoreOptions): Promise<RestoreResult> {
  const repo = options.repo ?? getRepository();
  const now = new Date().toISOString();

  if (options.mode === 'local-exact') {
    if (repo.mode !== 'local' || !repo.restoreLocalClientData) {
      throw new ClientRestoreError('A restauração mantendo o ID original só está disponível no modo local.', 'validacao');
    }
    options.onProgress?.('Restaurando empresa com IDs originais no modo local...');
    const { deletingAt: _del, ...clientRest } = backup.client;
    void _del;
    const restoredClient: ClientCompany = {
      ...clientRest,
      name: options.targetName?.trim() || backup.client.name,
      updatedAt: now,
    };
    const restoreAudit = buildRestoreAudit(
      restoredClient.id,
      backup.client,
      options.actor,
      now,
      'Empresa restaurada fielmente no modo local'
    );
    const payload: LocalClientRestorePayload = {
      client: restoredClient,
      accounts: backup.accounts,
      rules: backup.rules,
      bankAccounts: backup.bankAccounts,
      openingBalances: backup.openingBalances,
      importBatches: backup.importBatches,
      transactions: backup.transactions,
      journalEntries: backup.journalEntries,
      journalCounter: backup.journalCounter,
      periodLocks: backup.periodLocks,
      lockState: backup.lockState,
      clientRequests: backup.clientRequests,
      invoices: backup.invoices,
      fixedAssets: backup.fixedAssets,
      prepaidExpenses: backup.prepaidExpenses,
      financingContracts: backup.financingContracts,
      investments: backup.investments,
      stockControl: backup.stockControl,
      payrollRegister: backup.payrollRegister,
      closingChecklists: backup.closingChecklists,
      explanatoryNotes: backup.explanatoryNotes,
      audit: backup.audit,
      restoreAudit,
    };
    await repo.restoreLocalClientData(payload);
    return {
      client: restoredClient,
      mode: 'local-exact',
      warnings: backup.auditTruncated ? ['O arquivo de backup indicou trilha de auditoria truncada (teto de 20.000 registros).'] : [],
    };
  }

  options.onProgress?.('Lendo plano de contas e regras existentes...');
  const [existingGlobalAccounts, existingGlobalRules] = await Promise.all([
    repo.listAccounts('global'),
    repo.listRules('global'),
  ]);
  const remapped = remapBackupForNewClient(backup, {
    targetName: options.targetName,
    existingGlobalAccounts,
    existingGlobalRules,
    actorUid: options.actor.uid,
    now,
  });

  if (repo.mode === 'local' && repo.restoreLocalClientData) {
    options.onProgress?.('Gravando nova empresa no armazenamento local...');
    const restoreAudit = buildRestoreAudit(
      remapped.client.id,
      backup.client,
      options.actor,
      now,
      'Empresa restaurada como cópia no modo local'
    );
    await repo.restoreLocalClientData({
      client: remapped.client,
      accounts: remapped.accountsToCreate,
      rules: remapped.rulesToCreate,
      bankAccounts: remapped.bankAccounts,
      openingBalances: remapped.openingBalances,
      importBatches: remapped.importBatches,
      transactions: remapped.finalTransactions,
      journalEntries: remapped.fullJournalEntries,
      journalCounter: remapped.journalCounter,
      periodLocks: remapped.periodLocks,
      lockState: remapped.lockState,
      clientRequests: remapped.clientRequests,
      invoices: remapped.invoices,
      fixedAssets: remapped.fixedAssets,
      prepaidExpenses: remapped.prepaidExpenses,
      financingContracts: remapped.financingContracts,
      investments: remapped.investments,
      stockControl: remapped.stockControl,
      payrollRegister: remapped.payrollRegister,
      closingChecklists: remapped.closingChecklists,
      explanatoryNotes: remapped.explanatoryNotes,
      audit: remapped.remappedAudit,
      restoreAudit,
    });
    return { client: remapped.client, mode: 'new-company', warnings: remapped.warnings };
  }

  return restoreNewCompanyViaRepository(backup, remapped, repo, options.actor, options.onProgress);
}
