import type {
  AuditEntry,
  BankTransaction,
  ChartAccount,
  ClassificationRule,
  ClientCompany,
  ImportBatch,
  OrgSettings,
  PeriodLock,
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

/** Alteração num lançamento: `set` grava campos, `remove` apaga campos. `date` define a competência. */
export interface TransactionPatch {
  id: string;
  date: string;
  set: Partial<BankTransaction>;
  remove?: readonly (keyof BankTransaction)[];
}

/**
 * Conjunto de mudanças gravado junto: lançamentos alterados, regras criadas/atualizadas
 * e os registros de auditoria correspondentes. No Firestore vai em writeBatch (lotes de
 * até 500 operações, agrupados por competência por causa do limite de consultas das regras).
 */
export interface ChangeSet {
  patches: readonly TransactionPatch[];
  rules?: readonly ClassificationRule[];
  audits: readonly AuditEntry[];
}

/**
 * Contrato único de persistência. Duas implementações — Firestore e localStorage — e a
 * aplicação usa exatamente uma por execução (sem escrita dupla). Toda falha é propagada.
 */
export interface DataRepository {
  readonly mode: 'firestore' | 'local';

  /* Escritório */
  getOrgSettings(): Promise<OrgSettings | null>;
  saveOrgSettings(settings: OrgSettings): Promise<void>;

  /* Clientes */
  listClients(): Promise<ClientCompany[]>;
  saveClient(client: ClientCompany): Promise<void>;
  /** Exclui a empresa e, em cascata, contas, regras, lançamentos, lotes e fechamentos. A auditoria é preservada. */
  deleteClient(clientId: string): Promise<void>;

  /* Plano de contas */
  listAccounts(clientId: string): Promise<ChartAccount[]>;
  saveAccount(account: ChartAccount): Promise<void>;
  deleteAccount(accountId: string): Promise<void>;
  insertAccounts(accounts: readonly ChartAccount[]): Promise<void>;

  /* Regras */
  listRules(clientId: string): Promise<ClassificationRule[]>;
  saveRule(rule: ClassificationRule): Promise<void>;
  deleteRule(ruleId: string): Promise<void>;

  /* Lançamentos */
  /** Mais recentes primeiro; `range` limita a consulta no banco. */
  listTransactions(clientId: string, range?: DateRange): Promise<BankTransaction[]>;
  /** Todos os pendentes do cliente, de qualquer período (aplicação de regras). */
  listPendingTransactions(clientId: string): Promise<BankTransaction[]>;
  latestTransactionDate(clientId: string): Promise<string | null>;
  findExistingTransactionIds(clientId: string, ids: readonly string[]): Promise<Set<string>>;
  insertTransactions(transactions: readonly BankTransaction[], batch?: ImportBatch): Promise<void>;
  /** Grava lançamentos alterados, regras e auditoria juntos. */
  commitChanges(changes: ChangeSet): Promise<void>;

  /* Extratos importados */
  listImportBatches(clientId: string): Promise<ImportBatch[]>;
  saveImportBatch(batch: ImportBatch): Promise<void>;

  /* Fechamento de período */
  listPeriodLocks(clientId: string): Promise<PeriodLock[]>;
  closePeriod(lock: PeriodLock, audit: AuditEntry): Promise<void>;
  reopenPeriod(lock: PeriodLock, audit: AuditEntry): Promise<void>;

  /* Auditoria */
  listAudit(clientId: string, options?: { transactionId?: string; limit?: number }): Promise<AuditEntry[]>;
}
