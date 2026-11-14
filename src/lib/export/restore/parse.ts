import type { AuditEntry, BankAccount, BankTransaction, ChartAccount, ClassificationRule, ClientCompany, ClientRequest, ClosingChecklist, ExplanatoryNotes, FeeRegister, ObligationChecks, FinancingRegister, FixedAssetRegister, ImportBatch, InvestmentRegister, InvoiceSummary, JournalCounter, JournalEntry, LockState, OpeningBalances, PayrollRegister, PeriodLock, PrepaidRegister, StockControl } from '@/types/firestore';
import type { ClientBackup } from '../client-backup';

/** Leitura e validação do arquivo de backup, e o resumo para a pré-visualização. */

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
    ...('feeRegister' in raw ? { feeRegister: isRecord(raw.feeRegister) ? (raw.feeRegister as unknown as FeeRegister) : null } : {}),
    ...('obligationChecks' in raw ? { obligationChecks: isRecord(raw.obligationChecks) ? (raw.obligationChecks as unknown as ObligationChecks) : null } : {}),
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

