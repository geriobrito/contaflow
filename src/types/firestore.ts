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

/** Porte contábil (CFC): define a norma das demonstrações, independente do regime tributário. */
export type CompanyPorte = 'MICROENTIDADE' | 'PEQUENA_EMPRESA';

/** Termos de abertura e de encerramento do Livro Diário (cada texto com até 120 caracteres). */
export interface ClientDaybookInfo {
  /** Número de ordem do livro (Diário nº 1, 2…). */
  number: string;
  /** Município/UF da sede. */
  city?: string;
  /** NIRE ou número de registro no cartório. */
  registry?: string;
}

export interface ClientCompany {
  /** Escritório dono do documento (isolamento multi-tenant; obrigatório no Firestore). */
  orgId?: string;
  id: string; // auto-id
  name: string; // Razão Social
  tradeName?: string; // Nome Fantasia
  cnpj: string;
  regime: TaxRegime; // Regime Tributário
  /** Porte contábil; ausente em cadastros antigos, que contam como microentidade. */
  porte?: CompanyPorte;
  /** Contas do modelo de plano de contas excluídas de propósito: "Completar com o modelo" não as oferece mais. */
  ignoredTemplateCodes?: string[];
  email?: string;
  phone?: string;
  /** Município/UF da sede (ex.: "Recife/PE"), usado também nos termos do Livro Diário. */
  city?: string;
  /**
   * Atividade principal (descrição do CNAE ou do objeto social), até 300 caracteres. Sai na
   * declaração de conformidade no fim das demonstrações (obrigatória na NBC TG 1002).
   */
  activity?: string;
  /** Representante legal / administrador que assina as demonstrações. */
  legalRepresentativeName?: string;
  legalRepresentativeCpf?: string;
  /** Dados dos termos do Livro Diário, gravados pela tela do Diário (não pelo formulário de Clientes). */
  daybook?: ClientDaybookInfo;
  /**
   * Exclusão em andamento (ISO). A cascata apaga os dados em vários lotes; se parar no
   * meio, a empresa continua marcada e a exclusão é retomada de onde parou.
   */
  deletingAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type AccountNature = 'SYNTHETIC' | 'ANALYTIC';
export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'COST' | 'EXPENSE';

/** Grupos da DRE (modelo de plano de contas do CFC — NBC TG 1002, Anexo 11). */
export type DREGroup =
  | 'GROSS_REVENUE'
  | 'DEDUCTIONS'
  | 'COSTS'
  | 'OPERATING_EXPENSES'
  | 'FINANCIAL_INCOME'
  | 'FINANCIAL_EXPENSES'
  | 'OTHER_INCOME'
  | 'OTHER_EXPENSES'
  | 'INCOME_TAXES';

/**
 * Classificação na Demonstração dos Fluxos de Caixa: uma das três atividades, ou caixa e
 * equivalentes de caixa (a conta é o próprio caixa e não gera fluxo).
 */
export type CashFlowActivity = 'OPERATING' | 'INVESTING' | 'FINANCING' | 'CASH';

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
  /**
   * Atividade da conta na DFC, quando o contador troca a sugerida pelo código (src/lib/cash-flow.ts).
   * Só muda a apresentação da DFC: não é campo estrutural nem trava com o fechamento.
   */
  cashFlowActivity?: CashFlowActivity;
  description?: string;
  /** Sequência de fechamento (`lock_state.seq`) na última gravação de campo estrutural. */
  lockSeq?: number;
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

/* =========================================================================
   Notas fiscais (NF-e): só o resumo do XML, lido no navegador
   ========================================================================= */

/** Lado da nota para a empresa: compra (ela é a destinatária) ou venda (ela é a emitente). */
export type InvoiceDirection = 'PURCHASE' | 'SALE';
export type InvoiceStatus = 'AUTHORIZED' | 'CANCELLED';

/** Parcela da cobrança (`<dup>`): vencimento e valor. */
export interface InvoiceInstallment {
  number?: string;
  dueDate: string;
  amount: number;
}

/** Valor dos produtos por CFOP. */
export interface InvoiceCfop {
  cfop: string;
  amount: number;
}

/** Pagamento ou recebimento do extrato confirmado como quitação (de parte) da nota. */
export interface InvoiceLink {
  transactionId: string;
  amount: number;
  /** Conta usada na classificação: vira a sugestão para as próximas notas do mesmo parceiro. */
  accountId: string;
  linkedAt: string;
}

/**
 * Resumo de uma NF-e (modelo 55), NFC-e (65) ou NFS-e do padrão nacional (`model` 'NFSE')
 * importada pelo XML. O arquivo não é guardado: o navegador lê o XML e grava só estes campos
 * (id `${clientId}_${key}`).
 */
export interface InvoiceSummary {
  orgId?: string;
  id: string;
  clientId: string;
  /** Chave de acesso: 44 caracteres (NF-e/NFC-e) ou 50 dígitos (NFS-e). */
  key: string;
  number: string;
  series: string;
  /** '55' NF-e, '65' NFC-e, 'NFSE' NFS-e do padrão nacional. */
  model: string;
  /** Data de emissão (YYYY-MM-DD). */
  issueDate: string;
  direction: InvoiceDirection;
  /** CNPJ/CPF do fornecedor (compra) ou do cliente (venda), sem pontuação; vazio se a nota não traz. */
  counterpartyDoc: string;
  counterpartyName: string;
  /** Valor a pagar: o total da NF-e (vNF) ou o líquido da NFS-e (vLiq, já sem as retenções). */
  total: number;
  /**
   * Outro valor que o pagamento pode ter, quando difere do total: o valor do serviço sem as
   * retenções (NFS-e, vServ) ou o total com IBS/CBS (NF-e, vNFTot).
   */
  altTotal?: number;
  /** IBS e CBS destacados na nota (reforma tributária, LC 214/2025); ausentes quando zero. */
  ibs?: number;
  cbs?: number;
  /** NFS-e: código de tributação nacional do serviço (cTribNac, 6 dígitos). */
  serviceCode?: string;
  cfops: InvoiceCfop[];
  installments: InvoiceInstallment[];
  status: InvoiceStatus;
  links?: InvoiceLink[];
  importedAt: string;
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
  /** Autor da regra (operador só exclui as regras que ele mesmo criou). */
  createdByUid?: string;
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
  | 'JOURNAL_DELETE'
  | 'YEAR_CLOSE'
  | 'YEAR_REOPEN'
  | 'ASSET_SAVE'
  | 'PREPAID_SAVE'
  | 'FINANCING_SAVE';

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
  /** ISO. No Firestore é gravado como carimbo do servidor (as regras exigem `request.time`). */
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
  /** ISO. No Firestore é gravado como carimbo do servidor (as regras exigem `request.time`). */
  lockedAt: string;
  /**
   * Valor aleatório que compõe o id dos registros de auditoria do fechamento (periodAuditId).
   * Ausente em fechamentos antigos do modo local, que usam `lockedAt` no lugar.
   */
  auditKey?: string;
  lockedByUid: string;
  lockedByEmail?: string;
}

export interface LockStateEvent {
  lockId: string;
  kind: 'close' | 'reopen' | 'year';
}

/**
 * Resumo dos fechamentos de uma empresa (coleção `lock_state`, id = clientId), mantido pelas
 * regras do Firestore: `count` é quantas competências estão fechadas agora e `seq` só cresce a
 * cada fechamento de competência ou encerramento do exercício.
 */
export interface LockState {
  id: string;
  orgId?: string;
  clientId: string;
  count: number;
  seq: number;
  lastEvent?: LockStateEvent;
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
  /**
   * Movimentação de cada conta bancária (chave do extrato) até `asOf`, já descontado o que
   * veio até a data do saldo inicial dela: soma direto em `bankBalanceAt`.
   */
  bankMovements: { accountKey: string; value: number }[];
  /** Lançamentos até `asOf` sem conta bancária identificada (extratos sem banco/conta). */
  unlinkedCount: number;
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
export type BankAccountKind = 'BANK' | 'CARD';

export type CSVDelimiter = ';' | ',' | '\t' | '|';

export interface CSVColumnMapping {
  /** Índice da coluna da data (0-based) */
  dateCol: number;
  /** Índice da coluna do histórico / descrição (0-based) */
  memoCol: number;
  /** Modo de leitura do valor: coluna única com sinal ou colunas separadas (débito/crédito) */
  valueMode: 'single' | 'split';
  /** Índice da coluna de valor único (quando valueMode === 'single') */
  amountCol?: number;
  /** Índice da coluna de saída/débito (quando valueMode === 'split') */
  debitCol?: number;
  /** Índice da coluna de entrada/crédito (quando valueMode === 'split') */
  creditCol?: number;
  /** Índice da coluna de documento / identificador (opcional) */
  docCol?: number;
  /** Inverter sinal (+/-): útil para faturas de cartão onde compras vêm positivas */
  invertSigns?: boolean;
  /** Se a primeira linha é cabeçalho */
  hasHeader: boolean;
}

export interface BankCSVPreset {
  delimiter: CSVDelimiter;
  mapping: CSVColumnMapping;
  /** Cabeçalhos observados na última confirmação (para validar compatibilidade de lotes). */
  headerSignature?: string[];
}

export interface BankAccount {
  id: string;
  orgId?: string;
  clientId: string;
  /** Chave do extrato (`accountKeyOf`): banco-agência-conta. */
  accountKey: string;
  /** Conta movimento (padrão) ou cartão de crédito. */
  kind?: BankAccountKind;
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
  /** Saldo no início do dia `openingDate`; os lançamentos desse dia em diante somam a partir dele. */
  openingBalance?: number;
  openingDate?: string;
  /** Formato de CSV memorizado para esta conta ou cartão. */
  csvPreset?: BankCSVPreset;
  /** Sequência de fechamento (`lock_state.seq`) na última gravação de campo protegido. */
  lockSeq?: number;
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
  /** Última leitura das respostas pelo escritório (ISO); `respondedAt > seenAt` indica resposta nova. */
  seenAt?: string;
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
 * Tipo de implantação:
 * - OPENING_BALANCE: balanço de abertura sem contabilidade anterior (MEI, Simples). A diferença
 *   entre débitos e créditos vai, como contrapartida, para a conta 2.3.3.04 Balanço de Abertura.
 * - CONTINUITY: transferência de saldos de um balanço anterior já fechado; débitos = créditos
 *   são conferidos, e a diferença fica em "Saldos de abertura (a detalhar)".
 */
export type OpeningMode = 'OPENING_BALANCE' | 'CONTINUITY';

/**
 * Saldos de abertura do cliente (coleção `opening_balances`, id = clientId): posição no início
 * do dia `date` das contas patrimoniais que não são bancos (clientes, fornecedores, estoque,
 * imobilizado, capital…). Os bancos têm o saldo inicial em `bank_accounts`, na mesma data.
 */
export interface OpeningBalances {
  id: string;
  orgId?: string;
  clientId: string;
  /** Data do balanço de abertura (YYYY-MM-DD): posição no início do dia; os lançamentos começam nela. */
  date: string;
  /** Sem o campo (documentos anteriores a ele): CONTINUITY. */
  mode?: OpeningMode;
  /** Histórico do lançamento de abertura no Diário. */
  memo?: string;
  entries: OpeningEntry[];
  /** Sequência de fechamento (`lock_state.seq`) na última gravação. */
  lockSeq?: number;
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
  /** Link (http/https) do comprovante guardado na nuvem; ver `parseAttachmentUrl` em src/lib/journal.ts. */
  attachmentUrl?: string;
  /** Lançamento do mês anterior do qual este foi repetido (recorrência mensal). */
  repeatedFromId?: string;
  /**
   * Exercício (YYYY) encerrado por este lançamento: gerado pela rotina de encerramento
   * (src/lib/year-closing.ts), com `category: 'CLOSING'` e data em 31/12. Fica fora da DRE, que
   * mostra o resultado antes do encerramento, e só sai pela reabertura do exercício.
   */
  yearClosing?: string;
  /**
   * Registro de auditoria (YEAR_CLOSE) do encerramento a que o lançamento pertence: todos os
   * lançamentos de um encerramento são gravados com ele numa só operação, e a reabertura grava
   * `${closingAuditId}_reopen` junto com a exclusão de todos.
   */
  closingAuditId?: string;
  /**
   * Competência (YYYY-MM) da depreciação gerada pelo cadastro do imobilizado
   * (src/lib/fixed-assets.ts): um lançamento por mês, atualizado enquanto o mês está aberto.
   */
  depreciationMonth?: string;
  /** Bem baixado por este lançamento (baixa por venda, perda ou sucata). */
  fixedAssetId?: string;
  /** Competência (YYYY-MM) da apropriação das despesas antecipadas (src/lib/prepaid-expenses.ts). */
  prepaidMonth?: string;
  /** Despesa antecipada reconhecida por este lançamento (D ativo / C obrigação, na data da apólice). */
  prepaidId?: string;
  /** Competência (YYYY-MM) dos juros e da reclassificação de empréstimos e financiamentos (src/lib/financing.ts). */
  financingMonth?: string;
  /** Contrato reconhecido por este lançamento (o inicial, na data do contrato). */
  financingId?: string;
  createdAt: string;
  updatedAt: string;
  createdByUid: string;
}

/* =========================================================================
   Imobilizado e intangível (controle patrimonial)
   ========================================================================= */

/** Onde a depreciação do bem cai no resultado: custo (atividade-fim) ou despesa (administrativo/comercial). */
export type FixedAssetUse = 'COST' | 'EXPENSE';

export type FixedAssetDisposalReason = 'SALE' | 'LOSS' | 'SCRAP';

export interface FixedAssetPriorDepreciation {
  /** Última competência (YYYY-MM) contida no valor. */
  through: string;
  amount: number;
}

/** Baixa do bem: a depreciação para na data, e o lançamento tira custo e acumulada do balanço. */
export interface FixedAssetDisposal {
  /** YYYY-MM-DD. */
  date: string;
  reason: FixedAssetDisposalReason;
  note?: string;
  /** Lançamento manual da baixa (journal_entries). */
  journalEntryId: string;
}

/**
 * Bem do imobilizado (1.2.3.x) ou do intangível (1.2.4.x). O custo é a soma das partes:
 * valor da nota + gastos para pôr o bem em uso + tributos não recuperáveis − descontos.
 */
export interface FixedAsset {
  id: string;
  description: string;
  /** Conta analítica do bem no plano (ex.: 1.2.3.04 Veículos). */
  accountId: string;
  accountCode: string;
  accountName?: string;
  use: FixedAssetUse;
  /** Data da nota fiscal (YYYY-MM-DD). */
  acquisitionDate: string;
  /** Data em que o bem ficou disponível para uso (YYYY-MM-DD): a depreciação começa nela, proporcional aos dias. */
  inUseDate: string;
  invoiceValue: number;
  /** Frete, transporte, montagem, instalação. */
  additionalCosts?: number;
  /** Tributos não recuperáveis (ex.: IPI sem crédito, imposto de importação). */
  nonRecoverableTaxes?: number;
  /** Descontos incondicionais e abatimentos. */
  discounts?: number;
  /** Dispensável na microentidade (NBC TG 1002); padrão zero. */
  residualValue?: number;
  /** Taxa anual em % (ex.: 20 = 20% ao ano; IN RFB 1700/2017, Anexo III). Zero não deprecia (terrenos). */
  annualRate: number;
  /** Número da nota fiscal ou outro documento. */
  documentRef?: string;
  /** Chave da NF-e, quando o bem veio de uma nota importada. */
  invoiceKey?: string;
  /**
   * Depreciação já contabilizada fora desta rotina até o fim da competência `through` (YYYY-MM):
   * a do bem anterior à implantação (está nos saldos de abertura) ou a lançada à mão em meses já
   * fechados. As cotas geradas começam no mês seguinte, a partir desse acumulado.
   */
  priorDepreciation?: FixedAssetPriorDepreciation;
  disposal?: FixedAssetDisposal;
  createdAt: string;
  updatedAt: string;
}

/** Controle patrimonial da empresa (coleção `fixed_assets`, um documento por cliente, id = clientId). */
export interface FixedAssetRegister {
  id: string;
  orgId?: string;
  clientId: string;
  assets: FixedAsset[];
  updatedAt: string;
  updatedByUid?: string;
}

/* =========================================================================
   Despesas antecipadas (seguros, assinaturas anuais…)
   ========================================================================= */

export type PrepaidKind = 'INSURANCE' | 'OTHER';

/**
 * Despesa paga ou contratada antes de ser consumida: o valor entra no ativo (despesa antecipada)
 * e vai para o resultado mês a mês, pela vigência, não pelos pagamentos.
 */
export interface PrepaidExpense {
  id: string;
  kind: PrepaidKind;
  description: string;
  /** Número da apólice ou do contrato. */
  documentRef?: string;
  /** Bem segurado (cadastro do imobilizado), quando houver. */
  insuredAssetId?: string;
  use: FixedAssetUse;
  /** Valor total (prêmio líquido da apólice). */
  amount: number;
  /** Data da apólice ou do contrato (YYYY-MM-DD): o lançamento inicial sai nela. */
  startDate: string;
  /** Vigência em meses: a apropriação começa no mês da apólice, uma cota por mês. */
  months: number;
  /** Despesa antecipada no ativo (ex.: 1.1.4.01 Seguros a Apropriar). */
  assetAccountId: string;
  assetAccountCode: string;
  /** Obrigação do lançamento inicial (ex.: 2.1.3.05 Seguros a Pagar), baixada pelos pagamentos do extrato. */
  payableAccountId: string;
  payableAccountCode: string;
  /** Conta de resultado da apropriação (despesa ou custo). */
  expenseAccountId: string;
  expenseAccountCode: string;
  /** Lançamento inicial gerado (D ativo / C obrigação). Ausente quando já estava contabilizado. */
  recognitionEntryId?: string;
  /** Apropriação já contabilizada fora desta rotina até o fim de `through` (implantação ou meses fechados). */
  priorAppropriation?: { through: string; amount: number };
  createdAt: string;
  updatedAt: string;
}

/** Despesas antecipadas da empresa (coleção `prepaid_expenses`, um documento por cliente, id = clientId). */
export interface PrepaidRegister {
  id: string;
  orgId?: string;
  clientId: string;
  items: PrepaidExpense[];
  updatedAt: string;
  updatedByUid?: string;
}

/* =========================================================================
   Empréstimos, financiamentos e parcelamentos
   ========================================================================= */

/** Empréstimo (o dinheiro entra no banco), financiamento (quita o fornecedor do bem) ou parcelamento de impostos. */
export type FinancingKind = 'LOAN' | 'FINANCING' | 'INSTALLMENT_PLAN';

/** Juros prefixados (tabela Price, conhecidos na contratação) ou pós-fixados (Selic: só se sabem a cada parcela). */
export type InterestMode = 'PREFIXED' | 'FLOATING';

/** Contrato com parcelas (src/lib/financing.ts). */
export interface FinancingContract {
  id: string;
  kind: FinancingKind;
  description: string;
  /** Banco, financiadora ou órgão (ex.: Receita Federal). */
  lender?: string;
  documentRef?: string;
  /** Data do contrato ou da adesão (YYYY-MM-DD): o lançamento inicial sai nela. */
  date: string;
  /** Valor do crédito, do bem financiado ou do débito consolidado. */
  principal: number;
  /** Encargos da contratação financiados junto (IOF, cadastro, registro): despesa financeira na data. */
  upfrontCharges?: number;
  installments: number;
  /** Parcela fixa (prefixado) ou parcela-base (pós-fixado). */
  installmentAmount: number;
  firstDueDate: string;
  interestMode: InterestMode;
  /** Taxa de juros ao mês (%), prefixado; sem ela, é calculada pela parcela. */
  monthlyRate?: number;
  counterpartAccountId: string;
  counterpartAccountCode: string;
  shortTermAccountId: string;
  shortTermAccountCode: string;
  longTermAccountId: string;
  longTermAccountCode: string;
  chargesShortAccountId?: string;
  chargesShortAccountCode?: string;
  chargesLongAccountId?: string;
  chargesLongAccountCode?: string;
  upfrontExpenseAccountId?: string;
  upfrontExpenseAccountCode?: string;
  interestExpenseAccountId: string;
  interestExpenseAccountCode: string;
  /** Lançamento inicial gerado. Ausente quando já estava contabilizado. */
  initialEntryId?: string;
  /** Juros e reclassificações já lançados fora desta rotina até o fim desta competência (YYYY-MM). */
  priorThrough?: string;
  createdAt: string;
  updatedAt: string;
}

/** Contratos da empresa (coleção `financing_contracts`, um documento por cliente, id = clientId). */
export interface FinancingRegister {
  id: string;
  orgId?: string;
  clientId: string;
  contracts: FinancingContract[];
  updatedAt: string;
  updatedByUid?: string;
}

/* =========================================================================
   Checklist do fechamento do exercício
   ========================================================================= */

/** Item conferido à mão no fechamento (ver `manualItems` em src/lib/closing-checklist.ts). */
export interface ClosingChecklistItem {
  done: boolean;
  /** ISO da marcação. */
  at: string;
  byUid?: string;
  note?: string;
}

export type BookRegistrationMethod = 'ECD' | 'JUNTA' | 'CARTORIO';

/** Comprovação da escrituração: ECD entregue ou livros registrados na Junta Comercial ou no cartório. */
export interface BookRegistration {
  method: BookRegistrationMethod;
  /** YYYY-MM-DD. */
  date?: string;
  /** Recibo da ECD ou número do registro. */
  protocol?: string;
}

/** Checklist do fechamento de um exercício (coleção `closing_checklists`, id `${clientId}_${year}`). */
export interface ClosingChecklist {
  id: string;
  orgId?: string;
  clientId: string;
  year: string;
  items: Record<string, ClosingChecklistItem>;
  books?: BookRegistration;
  updatedAt: string;
  updatedByUid?: string;
}

/* =========================================================================
   Notas explicativas
   ========================================================================= */

export interface ExplanatoryNoteBlock {
  id: string;
  title: string;
  text: string;
  enabled: boolean;
}

/**
 * Notas explicativas de um exercício (coleção `explanatory_notes`, id `${clientId}_${year}`):
 * o texto revisado pelo contador, compartilhado entre os aparelhos e usuários do escritório.
 */
export interface ExplanatoryNotes {
  id: string;
  orgId?: string;
  clientId: string;
  year: string;
  notes: ExplanatoryNoteBlock[];
  updatedAt: string;
  updatedByUid?: string;
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
