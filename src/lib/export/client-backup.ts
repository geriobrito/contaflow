import type {
  AuditEntry,
  BankAccount,
  BankTransaction,
  ChartAccount,
  ClassificationRule,
  ClientCompany,
  ClientRequest,
  FinancingRegister,
  InvestmentRegister,
  StockControl,
  FixedAssetRegister,
  ImportBatch,
  PrepaidRegister,
  InvoiceSummary,
  JournalEntry,
  OpeningBalances,
  PeriodLock,
} from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { getRepository } from '@/lib/services/data-service';

/** Teto de registros de auditoria por backup; acima disso `auditTruncated` avisa. */
export const BACKUP_AUDIT_LIMIT = 20000;

/**
 * Cópia completa dos dados de uma empresa num único arquivo JSON, para guarda fora do sistema
 * (antes de excluir a empresa, por exemplo). Leva tudo o que a exclusão apaga, mais a trilha
 * de auditoria; os saldos consolidados (`period_snapshots`) ficam de fora por serem um cache
 * recalculável. O plano de contas e as regras incluem os itens globais do escritório.
 */
export interface ClientBackup {
  format: 'contaflow-backup';
  version: 1;
  exportedAt: string;
  client: ClientCompany;
  accounts: ChartAccount[];
  rules: ClassificationRule[];
  bankAccounts: BankAccount[];
  openingBalances: OpeningBalances | null;
  importBatches: ImportBatch[];
  transactions: BankTransaction[];
  journalEntries: JournalEntry[];
  periodLocks: PeriodLock[];
  clientRequests: ClientRequest[];
  /** Resumos das notas fiscais importadas (os XML não são guardados). */
  invoices: InvoiceSummary[];
  /** Cadastro do imobilizado (ausente em backups anteriores a ele). */
  fixedAssets: FixedAssetRegister | null;
  /** Despesas antecipadas (ausentes em backups anteriores a elas). */
  prepaidExpenses: PrepaidRegister | null;
  /** Contratos de empréstimo, financiamento e parcelamento (ausentes em backups anteriores a eles). */
  financingContracts: FinancingRegister | null;
  /** Aplicações financeiras e os saldos informados (ausentes em backups anteriores a elas). */
  investments: InvestmentRegister | null;
  /** Controle do estoque e os estoques finais informados (ausente em backups anteriores a ele). */
  stockControl: StockControl | null;
  /** Mais recentes primeiro. */
  audit: AuditEntry[];
  /** A trilha tem mais registros do que o teto do backup: os mais antigos ficaram de fora. */
  auditTruncated: boolean;
}

/** Lê do banco tudo o que pertence à empresa. Qualquer falha de leitura interrompe o backup. */
export async function buildClientBackup(
  client: ClientCompany,
  repo: DataRepository = getRepository(),
  exportedAt: string = new Date().toISOString()
): Promise<ClientBackup> {
  const id = client.id;
  const [accounts, rules, bankAccounts, openingBalances, importBatches, transactions, journalEntries, periodLocks, clientRequests, invoices, fixedAssets, prepaidExpenses, financingContracts, investments, stockControl, audit] =
    await Promise.all([
      repo.listAccounts(id),
      repo.listRules(id),
      repo.listBankAccounts(id),
      repo.getOpeningBalances(id),
      repo.listImportBatches(id),
      repo.listTransactions(id),
      repo.listJournalEntries(id),
      repo.listPeriodLocks(id),
      repo.listClientRequests(id),
      repo.listInvoices(id),
      repo.getFixedAssets(id),
      repo.getPrepaidExpenses(id),
      repo.getFinancingContracts(id),
      repo.getInvestments(id),
      repo.getStockControl(id),
      repo.listAudit(id, { limit: BACKUP_AUDIT_LIMIT }),
    ]);
  return {
    format: 'contaflow-backup',
    version: 1,
    exportedAt,
    client,
    accounts,
    rules,
    bankAccounts,
    openingBalances,
    importBatches,
    transactions,
    journalEntries,
    periodLocks,
    clientRequests,
    invoices,
    fixedAssets,
    prepaidExpenses,
    financingContracts,
    investments,
    stockControl,
    audit,
    auditTruncated: audit.length >= BACKUP_AUDIT_LIMIT,
  };
}

/** `Backup_Alpha_Tech_2026-10-13.json` — sem acentos nem caracteres inválidos em nomes de arquivo. */
export function backupFileName(client: Pick<ClientCompany, 'name' | 'tradeName'>, exportedAt: string): string {
  const slug = (client.tradeName || client.name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return `Backup_${slug || 'Cliente'}_${exportedAt.slice(0, 10)}.json`;
}

export const backupBlob = (backup: ClientBackup): Blob => new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
