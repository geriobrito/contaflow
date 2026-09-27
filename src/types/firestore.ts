/**
 * ContaFlow - Tipos e Schema Oficial das Coleções do Firestore
 * 
 * Coleções:
 * 1. clients (auto-id): name, cnpj, regime
 * 2. chart_of_accounts (auto-id): clientId, code, name, type
 * 3. classification_rules (auto-id): clientId, pattern, accountId
 * 4. transactions (clientId_fitid): clientId, fitid, date, amount, type, memo, accountId, status
 */

export type TaxRegime = 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL' | 'MEI';

export interface ClientCompany {
  id: string; // auto-id
  name: string; // Razão Social
  tradeName?: string; // Nome Fantasia
  cnpj: string;
  regime: TaxRegime; // Regime Tributário
  taxRegime?: TaxRegime; // Alias de compatibilidade
  email?: string;
  phone?: string;
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
 * Grupos da DRE (ITG 1000 — Resolução CFC nº 1.418/2012).
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

export interface BankTransaction {
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
  createdAt: string;
}

export type RuleMatchType = 'CONTAINS' | 'STARTS_WITH' | 'EXACT' | 'REGEX';

export interface ClassificationRule {
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
