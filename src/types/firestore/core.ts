/** Cadastros: empresa, plano de contas, usuário, escritório, contas bancárias (com o formato de CSV) e saldos de abertura. */

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
