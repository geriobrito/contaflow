import type { AuditEntry, BankAccount, BankTransaction, ChartAccount, ClassificationRule, ClientCompany, ClientRequest, ClosingChecklist, ExplanatoryNotes, FeeRegister, ObligationChecks, FinancingRegister, FixedAssetRegister, ImportBatch, InvestmentRegister, InvoiceSummary, JournalCounter, JournalEntry, LockState, OpeningBalances, PayrollRegister, PeriodLock, PrepaidRegister, StockControl } from '@/types/firestore';
import type { JournalEntryDraft, TransactionPatch } from '@/lib/data/repository';
import { newAuditId } from '@/lib/audit';
import { generateId, newAccountId, newBatchId, newClientId, newRuleId, newSplitId } from '@/lib/utils/id';
import { newAuditKey } from '@/lib/periods';
import type { NormalizedClientBackup } from './parse';

/** Remapeamento de IDs e referências para importar o backup como nova empresa. */

export function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

export const omitOrg = <T extends { orgId?: string }>(doc: T): Omit<T, 'orgId'> => {
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
  feeRegister: FeeRegister | null;
  obligationChecks: ObligationChecks | null;
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
      ...(j.reversalOfId ? { reversalOfId: mapJournal(j.reversalOfId) } : {}),
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

  // Honorários e agenda de obrigações do escritório seguem a empresa.
  const feeRegister: FeeRegister | null = backup.feeRegister ? stripUndefined({ ...omitRegisterMeta(backup.feeRegister), id: clientId, clientId }) : null;
  const obligationChecks: ObligationChecks | null = backup.obligationChecks
    ? stripUndefined({ ...omitRegisterMeta(backup.obligationChecks), id: clientId, clientId })
    : null;

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
    feeRegister,
    obligationChecks,
    clientRequests,
    remappedAudit,
    warnings,
  };
}

