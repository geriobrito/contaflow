/** Bens e contratos: imobilizado, despesas antecipadas, financiamentos, aplicações, estoque e folha de pagamento. */

/** Onde a depreciação do bem cai no resultado: custo (atividade-fim) ou despesa (administrativo/comercial). */
export type FixedAssetUse = 'COST' | 'EXPENSE';

export type FixedAssetDisposalReason = 'SALE' | 'LOSS' | 'SCRAP';

export interface FixedAssetPriorDepreciation {
  /** Última competência (YYYY-MM) contida no valor. */
  through: string;
  amount: number;
}

/** Venda do bem: a receita entra na data da nota, contra o crédito a receber do comprador. */
export interface FixedAssetSale {
  amount: number;
  buyer?: string;
  /** Número da nota fiscal de venda (ou do contrato). */
  invoiceRef?: string;
}

/** Baixa do bem: a depreciação para na data, e o lançamento tira custo e acumulada do balanço. */
export interface FixedAssetDisposal {
  /** YYYY-MM-DD. */
  date: string;
  reason: FixedAssetDisposalReason;
  note?: string;
  /** Só na venda (reason SALE). Baixas antigas, de antes deste campo, não têm. */
  sale?: FixedAssetSale;
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

/**
 * Aplicação financeira (Caixinha, CDB, fundo): a conta do plano que a representa e o saldo bruto
 * do extrato da aplicação no fim de cada competência. Aplicações e resgates vêm pelo extrato da
 * conta corrente; o rendimento do mês é a diferença entre o saldo informado e o contábil.
 */
export interface InvestmentAccount {
  id: string;
  description: string;
  /** Conta analítica do ativo (ex.: 1.1.1.03 Aplicações Financeiras de Liquidez Imediata). */
  ledgerAccountId: string;
  ledgerAccountCode: string;
  ledgerAccountName?: string;
  /** Primeira competência (YYYY-MM) com o saldo exigido. */
  startMonth: string;
  /** Última competência (YYYY-MM), quando a aplicação foi resgatada por inteiro. */
  closedMonth?: string;
  /** Saldo bruto do extrato da aplicação no fim de cada competência ('YYYY-MM' → reais). */
  balances: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

/** Aplicações da empresa (coleção `investment_accounts`, um documento por cliente, id = clientId). */
export interface InvestmentRegister {
  id: string;
  orgId?: string;
  clientId: string;
  accounts: InvestmentAccount[];
  updatedAt: string;
  updatedByUid?: string;
}

/** Com que frequência o cliente manda o relatório do estoque. */
export type StockCountFrequency = 'MONTHLY' | 'QUARTERLY';

/**
 * Controle do estoque da empresa (coleção `stock_controls`, um documento por cliente, id =
 * clientId): o estoque final do relatório do cliente (Bling, planilha) em cada competência. O
 * CMV do mês é estoque inicial + compras − estoque final: o lançamento leva o saldo contábil do
 * estoque ao valor informado.
 */
export interface StockControl {
  id: string;
  orgId?: string;
  clientId: string;
  /** Conta do estoque (ex.: 1.1.3.01 Mercadorias para Revenda). */
  stockAccountId: string;
  stockAccountCode: string;
  stockAccountName?: string;
  /** Conta do custo (ex.: 3.2.1.01 Custo das Mercadorias Vendidas). */
  costAccountId: string;
  costAccountCode: string;
  costAccountName?: string;
  /** Primeira competência (YYYY-MM) controlada. */
  startMonth: string;
  frequency: StockCountFrequency;
  /** Estoque final pelo relatório do cliente ('YYYY-MM' → reais). */
  counts: Record<string, number>;
  /** Origem do valor (ex.: "Relatório Bling de 31/07"), por competência. */
  notes?: Record<string, string>;
  updatedAt: string;
  updatedByUid?: string;
}

/** Mapeamento de contas contábeis da folha (padrão modelo CFC NBC TG 1002 / ITG 1000). */
export interface PayrollAccountMapping {
  salaryExpenseCode: string;
  proLaboreExpenseCode: string;
  socialChargesExpenseCode: string;
  provisionsExpenseCode: string;
  salariesPayableCode: string;
  proLaborePayableCode: string;
  inssPayableCode: string;
  fgtsPayableCode: string;
  vacationPayableCode: string;
  thirteenthPayableCode: string;
  irrfPayableCode: string;
}

/** Resumo mensal da folha de pagamento e pró-labore de uma competência (YYYY-MM). */
export interface PayrollSummary {
  id: string;
  clientId: string;
  /** Competência (YYYY-MM). */
  month: string;
  /** Data de apropriação contábil (último dia do mês, YYYY-MM-DD). */
  date: string;
  /** Salários brutos (CLT). */
  grossSalaries: number;
  /** Pró-labore bruto dos sócios/titular. */
  grossProLabore: number;
  /** INSS descontado dos empregados. */
  inssEmployees: number;
  /** INSS descontado dos sócios (11%). */
  inssProLabore: number;
  /** IRRF retido sobre salários. */
  irrfEmployees: number;
  /** IRRF retido sobre pró-labore. */
  irrfProLabore: number;
  /** Outros descontos em folha que reduzem a despesa/líquido (faltas, vale-transporte descontado, etc.). */
  otherDeductions?: number;
  /** Salários líquidos a pagar (bruto − INSS empregados − IRRF empregados − outros descontos). */
  netSalaries: number;
  /** Pró-labore líquido a pagar (bruto − INSS sócios − IRRF sócios). */
  netProLabore: number;
  /** FGTS da competência (8%). */
  fgts: number;
  /** INSS patronal / RAT / Terceiros (quando aplicável). */
  inssEmployer?: number;
  /** Cota mensal de provisão de férias + 1/3 + encargos. */
  vacationProvision?: number;
  /** Cota mensal de provisão de 13º salário + encargos. */
  thirteenthProvision?: number;
  /** IDs dos lançamentos gerados no Livro Diário. */
  journalEntryIds: string[];
  mappedAccounts?: Partial<PayrollAccountMapping>;
  notes?: string;
  updatedAt: string;
  updatedByUid?: string;
}

/** Controle da folha de pagamento da empresa (coleção `payroll_registers`, id = clientId). */
export interface PayrollRegister {
  id: string;
  orgId?: string;
  clientId: string;
  summaries: PayrollSummary[];
  defaultMapping?: Partial<PayrollAccountMapping>;
  updatedAt: string;
  updatedByUid?: string;
}
