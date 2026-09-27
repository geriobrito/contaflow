import type {
  BankTransaction,
  ChartAccount,
  ClassificationRule,
  ClientCompany,
  ImportBatch,
  TransactionSplit,
} from '@/types/firestore';

/** Intervalo de datas inclusivo (YYYY-MM-DD). */
export interface DateRange {
  start: string;
  end: string;
}

/** Campos de conta única gravados numa classificação. */
export interface AccountRef {
  accountId: string;
  accountCode: string;
  accountName: string;
}

/**
 * Classificação aplicada de forma atômica: o lançamento principal, a regra
 * criada/atualizada (opcional) e os lançamentos pendentes semelhantes que a regra
 * passa a auto-classificar.
 */
export interface ClassificationCommit {
  transactionId: string;
  account: AccountRef;
  /** Regra a gravar (nova ou existente); `null` desvincula o lançamento de regras. */
  rule: ClassificationRule | null;
  similarIds: readonly string[];
  now: string;
}

/**
 * Contrato único de persistência. Existem duas implementações — Firestore e
 * localStorage — e a aplicação usa exatamente uma por execução (sem escrita dupla).
 * Toda falha é propagada ao chamador; nenhuma implementação engole erros.
 */
export interface DataRepository {
  readonly mode: 'firestore' | 'local';

  /* Clientes */
  listClients(): Promise<ClientCompany[]>;
  saveClient(client: ClientCompany): Promise<void>;
  /** Exclui a empresa e, em cascata, contas, regras, lançamentos e lotes dela. */
  deleteClient(clientId: string): Promise<void>;

  /* Plano de contas */
  listAccounts(clientId: string): Promise<ChartAccount[]>;
  saveAccount(account: ChartAccount): Promise<void>;
  deleteAccount(accountId: string): Promise<void>;
  /** Grava várias contas de uma vez (aplicação de modelo). */
  insertAccounts(accounts: readonly ChartAccount[]): Promise<void>;

  /* Regras */
  listRules(clientId: string): Promise<ClassificationRule[]>;
  saveRule(rule: ClassificationRule): Promise<void>;
  deleteRule(ruleId: string): Promise<void>;

  /* Lançamentos */
  /** Lançamentos do cliente, do mais recente ao mais antigo; `range` limita a consulta no banco. */
  listTransactions(clientId: string, range?: DateRange): Promise<BankTransaction[]>;
  /** Data do lançamento mais recente (YYYY-MM-DD) ou null. */
  latestTransactionDate(clientId: string): Promise<string | null>;
  /** Quais dos IDs informados já existem (deduplicação por FITID). */
  findExistingTransactionIds(clientId: string, ids: readonly string[]): Promise<Set<string>>;
  insertTransactions(transactions: readonly BankTransaction[], batch?: ImportBatch): Promise<void>;
  commitClassification(commit: ClassificationCommit): Promise<void>;
  saveSplits(transactionId: string, splits: readonly TransactionSplit[], now: string): Promise<void>;
  resetToPending(transactionId: string): Promise<void>;
  approveTransactions(ids: readonly string[], now: string): Promise<void>;
}
