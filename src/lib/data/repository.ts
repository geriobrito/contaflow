import type {
  AuditEntry,
  BankAccount,
  BankTransaction,
  ClientRequest,
  ClientRequestAnswer,
  ChartAccount,
  ClassificationRule,
  ClientCompany,
  ClientDaybookInfo,
  ClosingChecklist,
  ExplanatoryNotes,
  FinancingRegister,
  FixedAssetRegister,
  ImportBatch,
  InvestmentRegister,
  StockControl,
  PayrollRegister,
  PrepaidRegister,
  InvoiceLink,
  InvoiceSummary,
  JournalCounter,
  JournalEntry,
  LockState,
  OpeningBalances,
  OrgSettings,
  PeriodLock,
  PeriodSnapshot,
  ReconciliationStatus,
} from '@/types/firestore';
import type { Actor } from '@/lib/audit';
import { RegisterConflictError } from '@/lib/utils/errors';

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
  /** Regras a apagar na mesma gravação (ex.: desfazer a regra que acabou de ser criada). */
  deleteRuleIds?: readonly string[];
  audits: readonly AuditEntry[];
}

/** Lançamento manual ainda sem número: o repositório atribui o próximo da sequência do cliente. */
export type JournalEntryDraft = Omit<JournalEntry, 'entryNumber'>;

/**
 * Lançamento gravado junto com um cadastro (imobilizado, despesas antecipadas, contratos, folha):
 * criar (ex.: baixa, lançamento inicial, folha), substituir no mesmo id (mantendo o número no Diário)
 * e/ou excluir (ex.: baixa desfeita, remoção).
 */
export interface FixedAssetJournalChange {
  create?: JournalEntryDraft;
  replace?: { id: string; draft: JournalEntryDraft };
  deleteId?: string;
  deleteIds?: readonly string[];
}

/** Validação de concorrência otimista ao gravar um cadastro único por empresa. */
export interface RegisterSaveOptions {
  /** Versão esperada do documento atualmente gravado (`null` quando ainda não possuía `version`). */
  expectedVersion?: number | null;
  /** Carimbo `updatedAt` esperado caso o documento ainda não possua `version`. */
  expectedUpdatedAt?: string | null;
}

/**
 * Compara a versão/carimbo atual de um cadastro único com a esperada e calcula a próxima versão
 * (`(actualVersion ?? 0) + 1`). Lança `RegisterConflictError` se houver edição concorrente.
 */
export function resolveNextRegisterVersion(
  register: { version?: number },
  existingData: { version?: unknown; updatedAt?: unknown } | null,
  options?: RegisterSaveOptions
): number {
  const actualVersion = existingData && typeof existingData.version === 'number' ? existingData.version : null;
  const actualUpdatedAt = existingData && typeof existingData.updatedAt === 'string' ? existingData.updatedAt : null;

  if (options?.expectedVersion !== undefined) {
    if (options.expectedVersion === null) {
      if (actualVersion !== null) throw new RegisterConflictError();
      if (existingData !== null && options.expectedUpdatedAt === null) throw new RegisterConflictError();
      if (
        existingData !== null &&
        options.expectedUpdatedAt &&
        actualUpdatedAt &&
        actualUpdatedAt !== options.expectedUpdatedAt
      ) {
        throw new RegisterConflictError();
      }
    } else if (actualVersion !== options.expectedVersion) {
      throw new RegisterConflictError();
    }
  } else if (typeof register.version === 'number' && register.version !== actualVersion) {
    throw new RegisterConflictError();
  }

  return (actualVersion ?? 0) + 1;
}

/** Dados completos para restauração fiel de uma empresa no modo local. */
export interface LocalClientRestorePayload {
  client: ClientCompany;
  accounts: readonly ChartAccount[];
  rules: readonly ClassificationRule[];
  bankAccounts: readonly BankAccount[];
  openingBalances: OpeningBalances | null;
  importBatches: readonly ImportBatch[];
  transactions: readonly BankTransaction[];
  journalEntries: readonly JournalEntry[];
  journalCounter: JournalCounter | null;
  periodLocks: readonly PeriodLock[];
  lockState: LockState | null;
  clientRequests: readonly ClientRequest[];
  invoices: readonly InvoiceSummary[];
  fixedAssets: FixedAssetRegister | null;
  prepaidExpenses: PrepaidRegister | null;
  financingContracts: FinancingRegister | null;
  investments: InvestmentRegister | null;
  stockControl: StockControl | null;
  payrollRegister: PayrollRegister | null;
  closingChecklists: readonly ClosingChecklist[];
  explanatoryNotes: readonly ExplanatoryNotes[];
  audit: readonly AuditEntry[];
  restoreAudit: AuditEntry;
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
  /** Grava só os dados dos termos do Livro Diário, sem tocar no resto do cadastro. */
  updateClientDaybook(clientId: string, daybook: ClientDaybookInfo): Promise<void>;
  /**
   * Exclui a empresa e, em cascata, contas, regras, lançamentos (bancários e manuais), lotes e
   * fechamentos. A auditoria é preservada, e cada fechamento removido fica registrado nela em
   * nome de `actor`. Só administradores do escritório. A empresa é marcada (`deletingAt`) antes
   * do primeiro lote: se a cascata parar no meio, chamar de novo retoma de onde parou.
   */
  deleteClient(clientId: string, actor: Actor): Promise<void>;

  /* Plano de contas */
  listAccounts(clientId: string): Promise<ChartAccount[]>;
  saveAccount(account: ChartAccount): Promise<void>;
  /** Exclui a conta e grava o registro de auditoria juntos. */
  deleteAccount(accountId: string, audit?: AuditEntry): Promise<void>;
  insertAccounts(accounts: readonly ChartAccount[]): Promise<void>;
  /** Grava contas do plano (cria ou altera) e contas bancárias (substitui) juntas: tudo ou nada. */
  saveChartSetup(changes: { accounts: readonly ChartAccount[]; bankAccounts: readonly BankAccount[] }): Promise<void>;

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
  /** Quantidade de lançamentos com data até `until`, contada no servidor (sem baixar os documentos). */
  countTransactions(clientId: string, until: string): Promise<number>;
  /** Quantidade de lançamentos do cliente na situação `status`, contada no servidor (visão da carteira no Painel). */
  countTransactionsByStatus(clientId: string, status: ReconciliationStatus): Promise<number>;
  /** Data do lançamento mais antigo na situação `status` (lê um documento só), ou null. */
  oldestTransactionDate(clientId: string, status: ReconciliationStatus): Promise<string | null>;
  /** Algum lançamento usa a conta (classificação, sugestão automática ou rateio)? Não baixa o histórico. */
  isAccountUsedInTransactions(clientId: string, accountId: string): Promise<boolean>;
  findExistingTransactionIds(clientId: string, ids: readonly string[]): Promise<Set<string>>;
  insertTransactions(transactions: readonly BankTransaction[], batch?: ImportBatch): Promise<void>;
  /** Grava lançamentos alterados, regras e auditoria juntos. */
  commitChanges(changes: ChangeSet): Promise<void>;
  /** Um lançamento pelo id (ex.: a outra perna de uma transferência), ou null. */
  getTransaction(id: string): Promise<BankTransaction | null>;
  /** Lançamentos com pergunta ao cliente em aberto. */
  listOpenQueries(clientId: string): Promise<BankTransaction[]>;

  /* Extratos importados */
  listImportBatches(clientId: string): Promise<ImportBatch[]>;
  saveImportBatch(batch: ImportBatch): Promise<void>;
  /** Lançamentos gravados por um extrato (por `importBatchId`). */
  listBatchTransactions(batch: ImportBatch): Promise<BankTransaction[]>;
  /**
   * Exclui um extrato: seus lançamentos e o registro do lote, com as alterações
   * decorrentes (ex.: pares de transferência desfeitos) e a auditoria, juntos.
   */
  deleteImportBatch(batch: ImportBatch, transactions: readonly Pick<BankTransaction, 'id' | 'date'>[], changes: ChangeSet): Promise<void>;

  /* Saldos de abertura (contas patrimoniais que não são bancos) */
  getOpeningBalances(clientId: string): Promise<OpeningBalances | null>;
  /**
   * Grava numa única operação os saldos de abertura, o registro de auditoria e, se informados, os
   * bancos com o saldo inicial na data da abertura (documentos substituídos, como em
   * `saveBankAccount`) e as contas que faltam no plano (ex.: 2.3.3.04 Balanço de Abertura).
   */
  saveOpeningBalances(
    balances: OpeningBalances,
    audit: AuditEntry,
    related?: { bankAccounts?: readonly BankAccount[]; accounts?: readonly ChartAccount[] }
  ): Promise<void>;

  /* Contas bancárias */
  listBankAccounts(clientId: string): Promise<BankAccount[]>;
  saveBankAccount(account: BankAccount): Promise<void>;

  /* Fechamento de período */
  listPeriodLocks(clientId: string): Promise<PeriodLock[]>;
  /** Resumo de fechamentos da empresa (`count` e `seq`), ou null se ainda não inicializado. */
  getLockState(clientId: string): Promise<LockState | null>;
  /** Fecha/reabre a competência e grava o registro de auditoria juntos, sob o id `periodAuditId`. */
  closePeriod(lock: PeriodLock, audit: AuditEntry): Promise<void>;
  reopenPeriod(lock: PeriodLock, audit: AuditEntry): Promise<void>;

  /* Saldos consolidados de competências fechadas (cache de leitura; ver src/lib/snapshots.ts) */
  listPeriodSnapshots(clientId: string): Promise<PeriodSnapshot[]>;
  savePeriodSnapshot(snapshot: PeriodSnapshot): Promise<void>;

  /* Auditoria */
  listAudit(clientId: string, options?: { transactionId?: string; limit?: number }): Promise<AuditEntry[]>;

  /* Pendências com o cliente (escritório) */
  listClientRequests(clientId: string): Promise<ClientRequest[]>;
  saveClientRequest(request: ClientRequest): Promise<void>;
  /** Encerra o link sem tocar nas respostas (que podem ter chegado depois da última leitura). */
  closeClientRequest(requestId: string): Promise<void>;
  /** Reabre/prorroga um link vencido ou encerrado mantendo o mesmo token (`id`), perguntas e respostas. */
  renewClientRequest(requestId: string, expiresAtMs: number): Promise<void>;
  /** Marca links de pendências como visualizados pelo escritório (`seenAt`). */
  markClientRequestsSeen(items: readonly { id: string; seenAt: string }[]): Promise<void>;
  /** Todos os links `OPEN` do escritório (ativos ou recém-vencidos), para o indicador global de respostas novas. */
  listOpenOrgClientRequests(): Promise<ClientRequest[]>;

  /* Lançamentos manuais de fechamento (Diário Avulso / Ajustes) */
  listJournalEntries(clientId: string, range?: DateRange): Promise<JournalEntry[]>;
  getJournalCounter(clientId: string): Promise<JournalCounter | null>;
  /** Grava um lançamento novo com o próximo número da sequência do cliente; recusa se débito ≠ crédito. */
  createJournalEntry(draft: JournalEntryDraft, audit: AuditEntry): Promise<JournalEntry>;
  /** Altera um lançamento existente (o número não muda); recusa se débito ≠ crédito. */
  updateJournalEntry(entry: JournalEntry, audit: AuditEntry): Promise<void>;
  /** Exclui um lançamento do Diário e grava a auditoria (somente administrador nas regras). */
  deleteJournalEntry(entryId: string, audit: AuditEntry): Promise<void>;

  /* Encerramento do exercício (src/lib/year-closing.ts) */
  /**
   * Grava todos os lançamentos do encerramento, com números seguidos da sequência do cliente, e
   * o registro de auditoria YEAR_CLOSE numa única operação: entra tudo ou nada.
   */
  closeYear(drafts: readonly JournalEntryDraft[], audit: AuditEntry): Promise<JournalEntry[]>;
  /** Exclui todos os lançamentos do encerramento e grava o YEAR_REOPEN (`${closingAuditId}_reopen`) numa única operação. */
  reopenYear(entries: readonly JournalEntry[], audit: AuditEntry): Promise<void>;

  /* Notas fiscais: só o resumo do XML (src/lib/nfe), id `${clientId}_${chave}` */
  /** Notas da empresa, mais recentes primeiro; `range` limita pela data de emissão. */
  listInvoices(clientId: string, range?: DateRange): Promise<InvoiceSummary[]>;
  /**
   * Grava os resumos (cria ou atualiza). Preserva os vínculos com o extrato e nunca desfaz um
   * cancelamento: reimportar a nota autorizada não muda a situação gravada.
   */
  saveInvoices(invoices: readonly InvoiceSummary[]): Promise<void>;
  /** Marca como canceladas as notas já importadas da empresa com essas chaves; devolve quantas eram. */
  cancelInvoices(clientId: string, keys: readonly string[]): Promise<number>;
  /** Vincula um lançamento do extrato à nota (troca o vínculo anterior do mesmo lançamento). */
  linkInvoice(invoiceId: string, link: InvoiceLink): Promise<InvoiceSummary>;
  deleteInvoice(invoiceId: string): Promise<void>;

  /* Imobilizado e intangível (um documento por cliente, id = clientId; src/lib/fixed-assets.ts) */
  getFixedAssets(clientId: string): Promise<FixedAssetRegister | null>;
  /**
   * Grava o cadastro e o registro de auditoria numa única operação e, se informado, também cria
   * o lançamento (com o próximo número), substitui no mesmo id ou exclui, tudo junto.
   */
  saveFixedAssets(
    register: FixedAssetRegister,
    audit: AuditEntry,
    journal?: FixedAssetJournalChange,
    options?: RegisterSaveOptions
  ): Promise<JournalEntry | null>;

  /* Checklist do fechamento do exercício (id `${clientId}_${year}`) */
  listClosingChecklists(clientId: string): Promise<ClosingChecklist[]>;
  getClosingChecklist(clientId: string, year: string): Promise<ClosingChecklist | null>;
  saveClosingChecklist(checklist: ClosingChecklist): Promise<void>;

  /* Despesas antecipadas (um documento por cliente, id = clientId; src/lib/prepaid-expenses.ts) */
  getPrepaidExpenses(clientId: string): Promise<PrepaidRegister | null>;
  /** Como `saveFixedAssets`: cadastro, auditoria e o lançamento numa única operação. */
  savePrepaidExpenses(
    register: PrepaidRegister,
    audit: AuditEntry,
    journal?: FixedAssetJournalChange,
    options?: RegisterSaveOptions
  ): Promise<JournalEntry | null>;

  /* Empréstimos, financiamentos e parcelamentos (um documento por cliente, id = clientId; src/lib/financing.ts) */
  getFinancingContracts(clientId: string): Promise<FinancingRegister | null>;
  /** Como `saveFixedAssets`: cadastro, auditoria e o lançamento inicial numa única operação. */
  saveFinancingContracts(
    register: FinancingRegister,
    audit: AuditEntry,
    journal?: FixedAssetJournalChange,
    options?: RegisterSaveOptions
  ): Promise<JournalEntry | null>;

  /* Aplicações financeiras (um documento por cliente, id = clientId; src/lib/investments.ts) */
  getInvestments(clientId: string): Promise<InvestmentRegister | null>;
  /** Como `saveFixedAssets`: cadastro e auditoria numa única operação (o rendimento é a rotina do mês). */
  saveInvestments(register: InvestmentRegister, audit: AuditEntry, options?: RegisterSaveOptions): Promise<JournalEntry | null>;

  /* Estoque e CMV (um documento por cliente, id = clientId; src/lib/stock.ts) */
  getStockControl(clientId: string): Promise<StockControl | null>;
  /** Controle e auditoria numa única operação (o CMV é a rotina do mês). */
  saveStockControl(control: StockControl, audit: AuditEntry, options?: RegisterSaveOptions): Promise<JournalEntry | null>;

  /* Folha de pagamento e pró-labore (um documento por cliente, id = clientId; src/lib/payroll.ts) */
  getPayrollRegister(clientId: string): Promise<PayrollRegister | null>;
  /** Como `saveFixedAssets`: cadastro da folha, auditoria e lançamentos contábeis numa única operação. */
  savePayrollRegister(
    register: PayrollRegister,
    audit: AuditEntry,
    journal?: FixedAssetJournalChange,
    options?: RegisterSaveOptions
  ): Promise<JournalEntry | null>;

  /* Notas explicativas (id `${clientId}_${year}`) */
  listExplanatoryNotes(clientId: string): Promise<ExplanatoryNotes[]>;
  getExplanatoryNotes(clientId: string, year: string): Promise<ExplanatoryNotes | null>;
  saveExplanatoryNotes(notes: ExplanatoryNotes): Promise<void>;

  /** Restaura dados completos da empresa no modo local (opcional; ausente no Firestore). */
  restoreLocalClientData?(payload: LocalClientRestorePayload): Promise<void>;

  /* Pendências com o cliente (acesso público pelo link, sem login) */
  getPublicClientRequest(token: string): Promise<ClientRequest | null>;
  /** Grava só as respostas (uma por pergunta, na ordem de `items`); as perguntas não mudam. */
  answerPublicClientRequest(token: string, answers: readonly ClientRequestAnswer[], respondedAt: string): Promise<void>;
}
