/** Conciliação: lançamentos do extrato, rateios, regras, lotes de importação, conferência de saldo e pendências com o cliente. */

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
