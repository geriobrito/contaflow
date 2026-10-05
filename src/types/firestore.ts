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

export interface ImportBatch {
  /** Escritório dono do documento (isolamento multi-tenant; obrigatório no Firestore). */
  orgId?: string;
  id: string;
  clientId: string;
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
  createdAt: string;
}

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
  | 'MEMO_REPAIR';

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

export interface ClientRequestFileRef {
  id: string;
  name: string;
  type: string;
  size: number;
}

export interface ClientRequestItem {
  transactionId: string;
  date: string;
  memo: string;
  amount: number;
  question: string;
  answer?: string;
  answeredAt?: string;
  files?: ClientRequestFileRef[];
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
  status: ClientRequestStatus;
  createdAt: string;
  createdByUid: string;
  /** Validade do link (epoch ms), comparada com `request.time` nas regras. */
  expiresAtMs: number;
  respondedAt?: string;
}

/** Comprovante enviado pelo cliente (coleção `client_request_files`, conteúdo em base64). */
export interface ClientRequestFile {
  id: string;
  orgId: string;
  clientId: string;
  requestId: string;
  transactionId: string;
  name: string;
  type: string;
  /** Tamanho do arquivo original em bytes. */
  bytes: number;
  /** Conteúdo em base64 (sem o prefixo data:). */
  data: string;
  uploadedAt: string;
}
