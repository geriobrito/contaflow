/**
 * ContaFlow - Tipos e Schema Oficial das Coleções do Firestore
 *
 * Isolamento: todo documento de dados carrega `orgId` (escritório). O vínculo
 * usuário → escritório fica em `users/{uid}.orgId`. Ver `firestore.rules`.
 * 
 * Coleções:
 * 1. clients (auto-id): name, cnpj, regime
 * 2. chart_of_accounts (auto-id): clientId, code, name, type
 * 3. classification_rules (auto-id): clientId, pattern, accountId
 * 4. transactions (clientId_fitid): clientId, fitid, date, amount, type, memo, accountId, status
 */

export type TaxRegime = 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL' | 'MEI';

export interface ClientCompany {
  /** Escritório dono do documento (isolamento multi-tenant; obrigatório no Firestore). */
  orgId?: string;
  id: string; // auto-id
  name: string; // Razão Social
  tradeName?: string; // Nome Fantasia
  cnpj: string;
  regime: TaxRegime; // Regime Tributário
  taxRegime?: TaxRegime; // Alias de compatibilidade
  email?: string;
  phone?: string;
  /** Representante legal / administrador que assina as demonstrações. */
  legalRepresentativeName?: string;
  legalRepresentativeCpf?: string;
  /**
   * Exclusão em andamento (ISO). A cascata apaga os dados em vários lotes; se parar no
   * meio, a empresa continua marcada e a exclusão é retomada de onde parou.
   */
  deletingAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type AccountNature = 'SYNTHETIC' | 'ANALYTIC';
export type AccountType =
  | 'ASSET'
  | 'LIABILITY'
  | 'EQUITY'
  | 'REVENUE'
  | 'COST'
  | 'EXPENSE'
  // Aliases legados em português (dados antigos)
  | 'RECEITA'
  | 'DESPESA'
  | 'ATIVO'
  | 'PASSIVO'
  | 'CUSTO';

/**
 * Grupos da DRE (ITG 1000, CFC 15/12/2022 — NBC TG 1002, Anexo 11).
 * Os valores em português são legados e continuam aceitos pelo `buildDRE`.
 */
export type DREGroup =
  | 'GROSS_REVENUE'
  | 'DEDUCTIONS'
  | 'COSTS'
  | 'OPERATING_EXPENSES'
  | 'FINANCIAL_INCOME'
  | 'FINANCIAL_EXPENSES'
  | 'OTHER_INCOME'
  | 'OTHER_EXPENSES'
  | 'INCOME_TAXES'
  // Legados
  | 'RECEITA_BRUTA'
  | 'DEDUCOES_RECEITA'
  | 'RECEITA_LIQUIDA'
  | 'CUSTOS'
  | 'LUCRO_BRUTO'
  | 'DESPESAS_OPERACIONAIS'
  | 'DESPESAS_ADMINISTRATIVAS'
  | 'DESPESAS_COMERCIAIS'
  | 'DESPESAS_FINANCEIRAS'
  | 'RECEITAS_FINANCEIRAS'
  | 'OUTRAS_RECEITAS_DESPESAS'
  | 'IMPOSTOS_LUCRO';

export interface ChartAccount {
  /** Escritório dono do documento (isolamento multi-tenant; obrigatório no Firestore). */
  orgId?: string;
  id: string; // auto-id
  clientId: string; // 'global' ou ID do cliente específico
  code: string; // ex: "3.1.01", "4.1.02.001"
  name: string; // ex: "Despesas com Software"
  type: AccountType; // "RECEITA" | "DESPESA" | "ATIVO" | "PASSIVO" | "CUSTO"
  nature: AccountNature; // SYNTHETIC ou ANALYTIC
  parentId?: string;
  level: number;
  dreGroup?: DREGroup;
  /** Conta redutora (retificadora), ex.: (-) Depreciação Acumulada. */
  isContra?: boolean;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export type TransactionType = 'DEBIT' | 'CREDIT' | 'OTHER';
export type ReconciliationStatus = 'PENDING' | 'AUTO_CLASSIFIED' | 'RECONCILED';

/**
 * Sub-item de um lançamento desdobrado (rateio de fatura de cartão, lotes etc.).
 * `amount` segue o sinal do lançamento original (débito negativo, crédito positivo),
 * de modo que a soma dos splits é igual a `BankTransaction.amount`.
 */
export interface TransactionSplit {
  id: string;
  accountId: string;
  amount: number;
  memo: string;
  /** Metadados desnormalizados para exibição. */
  accountCode?: string;
  accountName?: string;
}

export interface BankTransaction {
  /** Escritório dono do documento (isolamento multi-tenant; obrigatório no Firestore). */
  orgId?: string;
  id: string; // Document ID: `${clientId}_${fitid}`
  clientId: string;
  fitid: string;
  date: string; // YYYY-MM-DD
  amount: number; // Valor numérico
  type: TransactionType; // "DEBIT" | "CREDIT"
  memo: string; // Descrição do extrato
  accountId?: string; // ID da conta no Plano de Contas
  status: ReconciliationStatus; // PENDING | AUTO_CLASSIFIED | RECONCILED
  
  // Metadados auxiliares para performance de renderização
  accountCode?: string;
  accountName?: string;
  matchedRuleId?: string;
  confidence?: number;
  bankName?: string;
  accountNumber?: string;
  importBatchId?: string;
  reconciledAt?: string;
  /** Conta bancária de origem (banco-agência-conta do OFX), usada na conferência de saldo. */
  accountKey?: string;
  /** Lançamento desdobrado em várias contas; quando true, `splits` substitui `accountId`. */
  isSplit?: boolean;
  splits?: TransactionSplit[];
  /** Transferência entre contas próprias: id do lançamento da outra perna (conciliados juntos). */
  transferPairId?: string;
  /** Pergunta ao cliente sobre este lançamento ("o que é este Pix?"). */
  clientQuery?: ClientQuery;
  createdAt: string;
}

export type ClientQueryStatus = 'OPEN' | 'RESOLVED';

/** Pendência com o cliente vinculada a um lançamento. As respostas ficam em `client_requests`. */
export interface ClientQuery {
  question: string;
  status: ClientQueryStatus;
  askedAt: string;
  askedByUid: string;
  askedByEmail?: string;
  resolvedAt?: string;
}

export type RuleMatchType = 'CONTAINS' | 'STARTS_WITH' | 'EXACT' | 'REGEX';

export interface ClassificationRule {
  /** Escritório dono do documento (isolamento multi-tenant; obrigatório no Firestore). */
  orgId?: string;
  id: string; // auto-id
  clientId: string; // ID do cliente ou 'global'
  pattern: string; // Termo da descrição bancária em caixa alta (ex: "UBER", "AWS")
  accountId: string; // ID da conta associada
  matchType?: RuleMatchType;
  accountCode?: string;
  accountName?: string;
  confidence?: number;
  usageCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type ImportBatchStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface ImportBatch {
  /** Escritório dono do documento (isolamento multi-tenant; obrigatório no Firestore). */
  orgId?: string;
  id: string;
  clientId: string;
  /** Status da gravação: PROCESSING durante o processo, COMPLETED ao finalizar, FAILED se falhar. */
  status?: ImportBatchStatus;
  fileName: string;
  fileSize: number;
  bankId?: string;
  accountNumber?: string;
  startDate?: string;
  endDate?: string;
  totalTransactions: number;
  importedCount: number;
  duplicateCount: number;
  autoClassifiedCount: number;
  totalDebit: number;
  totalCredit: number;
  importedAt: string;
  /** Conta bancária do extrato e saldo final informado pelo banco (LEDGERBAL). */
  accountKey?: string;
  bankName?: string;
  ledgerBalance?: number;
  ledgerDate?: string;
  /** Soma de todos os lançamentos do arquivo (inclusive duplicados). */
  fileNet?: number;
  balanceCheck?: BalanceCheck;
  importedByUid?: string;
}

export interface DRELineItem {
  id: string;
  title: string;
  code?: string;
  level: number;
  isTotal?: boolean;
  value: number;
  children?: DRELineItem[];
}

export interface DREResult {
  period: {
    startDate: string;
    endDate: string;
  };
  clientId: string;
  regime: TaxRegime;
  grossRevenue: number;
  deductions: number;
  netRevenue: number;
  costs: number;
  grossProfit: number;
  operatingExpenses: number;
  financialResult: number;
  netIncomeBeforeTaxes: number;
  taxes: number;
  netProfit: number;
  items: DRELineItem[];
}

/** Perfil do usuário: define a qual escritório (org) ele pertence. */
export interface UserProfile {
  uid: string;
  orgId: string;
  email?: string;
  /**
   * Papel no escritório. Sem o campo, o usuário é administrador. 'operator' (definido só
   * pelo console/Admin SDK) não reabre competência nem exclui empresa ou extrato.
   */
  role?: UserRole;
  createdAt: string;
}

export type UserRole = 'admin' | 'operator';

/* =========================================================================
   Auditoria, fechamento de período, escritório e extratos
   ========================================================================= */

export type AuditAction =
  | 'CLASSIFY'
  | 'RECLASSIFY'
  | 'SPLIT'
  | 'UNRECONCILE'
  | 'APPROVE'
  | 'AUTO_CLASSIFY'
  | 'PERIOD_CLOSE'
  | 'PERIOD_REOPEN'
  | 'TRANSFER'
  | 'BATCH_DELETE'
  | 'MEMO_REPAIR'
  | 'OPENING_SAVE'
  | 'ACCOUNT_DELETE'
  | 'QUERY_ASK'
  | 'QUERY_RESOLVE'
  | 'JOURNAL_CREATE'
  | 'JOURNAL_UPDATE'
  | 'JOURNAL_DELETE';

/** Estado de classificação de um lançamento num instante (antes/depois). */
export interface ClassificationSnapshot {
  status: ReconciliationStatus;
  accountId?: string;
  accountCode?: string;
  accountName?: string;
  matchedRuleId?: string;
  isSplit?: boolean;
  splits?: { accountId: string; accountCode?: string; accountName?: string; amount: number }[];
}

/** Registro imutável da trilha de auditoria (coleção `audit_log`, somente inclusão). */
export interface AuditEntry {
  id: string;
  orgId?: string;
  clientId: string;
  action: AuditAction;
  actorUid: string;
  actorEmail?: string;
  at: string;
  transactionId?: string;
  /** Data e histórico do lançamento, para leitura da trilha sem consultar a transação. */
  transactionDate?: string;
  transactionMemo?: string;
  transactionAmount?: number;
  /** Competência (YYYY-MM) em ações de fechamento/reabertura. */
  month?: string;
  before?: ClassificationSnapshot;
  after?: ClassificationSnapshot;
  /** Regra que motivou a ação (auto-classificação). */
  ruleId?: string;
  note?: string;
}

/** Competência fechada (coleção `period_locks`, id `${clientId}_${YYYY-MM}`). */
export interface PeriodLock {
  id: string;
  orgId?: string;
  clientId: string;
  month: string;
  lockedAt: string;
  lockedByUid: string;
  lockedByEmail?: string;
}

/** Quantidade de lançamentos bancários de uma competência, por situação. */
export interface MonthCounts {
  month: string;
  total: number;
  pending: number;
  auto: number;
  reconciled: number;
}

/**
 * Saldos consolidados até o fim de uma competência fechada (coleção `period_snapshots`,
 * id `${clientId}_${YYYY-MM}`). É um cache: evita reler o histórico inteiro a cada balanço.
 * Só é usado depois de conferido (`snapshotProblem` em src/lib/snapshots.ts) — se algo que
 * ele resume mudou, é descartado e refeito a partir dos lançamentos.
 */
export interface PeriodSnapshot {
  id: string;
  orgId?: string;
  clientId: string;
  month: string;
  /** Último dia coberto (YYYY-MM-DD). */
  asOf: string;
  /** Soma das partidas dos lançamentos bancários até `asOf`, por conta (positivo = devedor). */
  balances: { accountId: string; value: number }[];
  /** Lançamentos bancários até `asOf`: total e contagem por competência. */
  txCount: number;
  months: MonthCounts[];
  /** Fechamento de cada competência com lançamentos (reabrir e fechar de novo invalida). */
  locks: { month: string; lockedAt: string }[];
  /** Vínculos e datas dos bancos + contas do plano de que os saldos dependem. */
  configKey: string;
  createdAt: string;
}

/** Dados do escritório e do responsável técnico (coleção `orgs`, id = orgId). */
export interface OrgSettings {
  orgId: string;
  officeName: string;
  officeCnpj?: string;
  accountantName: string;
  accountantCrc: string;
  accountantCpf?: string;
  updatedAt: string;
  updatedByUid?: string;
}

/** AFTER_PERIOD: o saldo é de uma data posterior ao fim do extrato e não pode ser conferido só com o arquivo. */
export type BalanceCheckStatus = 'OK' | 'MISMATCH' | 'BASELINE' | 'NO_LEDGER' | 'AFTER_PERIOD';

/** Conferência do saldo final do extrato (LEDGERBAL) contra a movimentação. */
export interface BalanceCheck {
  status: BalanceCheckStatus;
  reported?: number;
  /** Saldo do extrato anterior + movimentação no intervalo. */
  expected?: number;
  difference?: number;
  previousBatchId?: string;
  previousLedgerDate?: string;
  movement?: number;
}

/* =========================================================================
   Contas bancárias, pendências com o cliente
   ========================================================================= */

/**
 * Conta bancária de um cliente (coleção `bank_accounts`, id `${clientId}_${accountKey}`).
 * Liga a conta do extrato (banco-agência-conta do OFX) a uma conta analítica do plano,
 * contrapartida bancária de todos os lançamentos dela no balancete e no balanço.
 */
export interface BankAccount {
  id: string;
  orgId?: string;
  clientId: string;
  /** Chave do extrato (`accountKeyOf`): banco-agência-conta. */
  accountKey: string;
  bankId?: string;
  branchId?: string;
  accountNumber?: string;
  bankName?: string;
  /** Nome amigável (ex.: "Itaú movimento"). */
  nickname: string;
  /** Conta do plano (ativo, analítica) que representa este banco na contabilidade. */
  ledgerAccountId?: string;
  ledgerAccountCode?: string;
  ledgerAccountName?: string;
  /** Saldo no fim do dia `openingDate`; os lançamentos posteriores somam a partir dele. */
  openingBalance?: number;
  openingDate?: string;
  createdAt: string;
  updatedAt: string;
}

/** Pergunta sobre um lançamento. Gravada pelo escritório; o link público não a altera. */
export interface ClientRequestItem {
  transactionId: string;
  date: string;
  memo: string;
  amount: number;
  question: string;
  /** Legado: links antigos guardavam a resposta dentro do item. Hoje fica em `ClientRequest.answers`. */
  answer?: string;
  answeredAt?: string;
}

/** Justificativa do cliente para uma pergunta (somente texto). */
export interface ClientRequestAnswer {
  text: string;
  answeredAt?: string;
}

export type ClientRequestStatus = 'OPEN' | 'CLOSED';

/**
 * Lista de perguntas enviada ao cliente (coleção `client_requests`). O id é um token
 * aleatório de 128 bits: quem tem o link lê e responde, sem login; ninguém lista.
 */
export interface ClientRequest {
  id: string;
  orgId?: string;
  clientId: string;
  clientName: string;
  officeName?: string;
  items: ClientRequestItem[];
  /**
   * Respostas do cliente, na mesma ordem de `items` (texto vazio = sem resposta). Com
   * `respondedAt`, é tudo o que o link público consegue gravar. Leia com `answerAt`
   * (src/lib/client-requests.ts): o conteúdo vem de fora e precisa ser saneado.
   */
  answers?: ClientRequestAnswer[];
  status: ClientRequestStatus;
  createdAt: string;
  createdByUid: string;
  /** Validade do link (epoch ms), comparada com `request.time` nas regras. */
  expiresAtMs: number;
  respondedAt?: string;
}

/* =========================================================================
   Saldos de abertura
   ========================================================================= */

/** Saldo de abertura de uma conta patrimonial, no lado natural dela (ativo devedor, passivo e PL credor). */
export interface OpeningEntry {
  accountId: string;
  accountCode?: string;
  accountName?: string;
  /** Valor positivo; contas retificadoras (isContra) reduzem o grupo. */
  amount: number;
}

/**
 * Saldos de abertura do cliente (coleção `opening_balances`, id = clientId): posição em `date`
 * das contas patrimoniais que não são bancos (clientes, fornecedores, estoque, imobilizado,
 * capital…). Os bancos têm o saldo inicial em `bank_accounts`.
 */
export interface OpeningBalances {
  id: string;
  orgId?: string;
  clientId: string;
  /** Data do saldo (YYYY-MM-DD), normalmente o último dia do exercício anterior. */
  date: string;
  entries: OpeningEntry[];
  updatedAt: string;
  updatedByUid?: string;
}

/* =========================================================================
   Lançamentos contábeis manuais (Diário de Fechamento / Ajustes Avulsos)
   ========================================================================= */

export type JournalEntryCategory =
  | 'PROVISION'
  | 'DEPRECIATION'
  | 'PAYROLL'
  | 'TAX'
  | 'ADJUSTMENT'
  | 'CLOSING'
  | 'OTHER';

export interface JournalEntryLine {
  id: string;
  accountId: string;
  accountCode?: string;
  accountName?: string;
  type: 'DEBIT' | 'CREDIT';
  amount: number;
  memo?: string;
}

/**
 * Lançamento contábil no livro diário sem movimentação de extrato bancário
 * (coleção `journal_entries`). Respeita estritamente a soma débito === crédito.
 */
export interface JournalEntry {
  id: string;
  orgId?: string;
  clientId: string;
  entryNumber: number;
  date: string; // YYYY-MM-DD
  memo: string;
  category: JournalEntryCategory;
  lines: JournalEntryLine[];
  totalAmount: number;
  documentRef?: string;
  attachmentUrl?: string;
  createdAt: string;
  updatedAt: string;
  createdByUid: string;
}

/**
 * Sequência dos lançamentos manuais de um cliente (coleção `journal_counters`, id = clientId).
 * `last` é o último número atribuído; só avança, de um em um, junto com o lançamento novo.
 */
export interface JournalCounter {
  id: string;
  orgId?: string;
  clientId: string;
  last: number;
}
