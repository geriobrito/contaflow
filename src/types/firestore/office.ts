/** Gestão do escritório: honorários, obrigações acessórias e resumos da DRE de competências fechadas. */

/** Valor do honorário mensal a partir de uma competência (o mais recente vale até o próximo). */
export interface FeeRate {
  /** Primeira competência em que o valor vale (YYYY-MM). */
  fromMonth: string;
  amount: number;
  /** Ex.: "Reajuste IPCA 4,8%". */
  note?: string;
}

/** Recebimento do honorário de uma competência. */
export interface FeePayment {
  /** Competência paga (YYYY-MM). */
  month: string;
  amount: number;
  /** Data do recebimento (YYYY-MM-DD). */
  paidAt: string;
  note?: string;
}

/**
 * Honorários de uma empresa (coleção `fee_registers`, id = clientId): valores no tempo,
 * vencimento, reajuste anual e recebimentos por competência. Controle do escritório; não
 * entra na contabilidade do cliente.
 */
export interface FeeRegister {
  id: string;
  orgId?: string;
  clientId: string;
  /** Dia do vencimento (1 a 31; em meses mais curtos, o último dia). */
  dueDay: number;
  /** O honorário de uma competência vence no mês seguinte a ela (padrão: no próprio mês). */
  dueNextMonth?: boolean;
  /** Mês do reajuste anual (1 a 12). */
  adjustmentMonth?: number;
  /** Índice combinado no contrato (ex.: IPCA, INPC, IGP-M). */
  adjustmentIndex?: string;
  /** Cobra o 13º honorário em dezembro. */
  thirteenth?: boolean;
  /** Valores no tempo, em ordem de `fromMonth` (pelo menos um). */
  rates: FeeRate[];
  payments: FeePayment[];
  /** Competência a partir da qual o contrato acabou (sem cobrança dela em diante), YYYY-MM. */
  endMonth?: string;
  notes?: string;
  version?: number;
  updatedAt: string;
  updatedByUid?: string;
}

/** Obrigação marcada como entregue/paga, por código e período (`${code}|${period}`). */
export interface ObligationDone {
  key: string;
  /** Quando foi marcada (ISO). */
  doneAt: string;
  note?: string;
}

/**
 * Agenda de obrigações de uma empresa (coleção `obligation_checks`, id = clientId): o que já
 * foi cumprido e quais obrigações valem para ela além (ou no lugar) das sugeridas pelo regime.
 */
export interface ObligationChecks {
  id: string;
  orgId?: string;
  clientId: string;
  /** Códigos opcionais ligados para esta empresa (ex.: EFD-Reinf). */
  enabled: string[];
  /** Códigos sugeridos pelo regime e desligados para esta empresa. */
  disabled: string[];
  done: ObligationDone[];
  version?: number;
  updatedAt: string;
}

/**
 * Resumo da DRE de uma competência fechada (coleção `result_summaries`, id
 * `${clientId}_${month}`): o que a DRE e a conferência contábil precisam dos lançamentos
 * bancários do mês, sem relê-los. Cache conferido antes do uso (src/lib/dre/summaries.ts).
 */
export interface ResultSummary {
  id: string;
  orgId?: string;
  clientId: string;
  /** Competência (YYYY-MM). */
  month: string;
  /** Data do fechamento quando o resumo foi montado: reabrir e fechar de novo invalida. */
  lockedAt: string;
  /** Lançamentos bancários da competência (todas as situações): importar depois invalida. */
  txCount: number;
  /** Bancos e contas do plano de que o resumo depende. */
  configKey: string;
  /** Por conta de resultado: soma no sinal do extrato (crédito positivo) e partidas, como em buildDRE. */
  lines: { accountId: string; amount: number; count: number }[];
  /** Lançamentos conciliados que entraram na DRE. */
  reconciledCount: number;
  /** Lançamentos auto-classificados (fora da DRE até a aprovação). */
  awaitingApproval: number;
  /** Lançamentos pendentes de classificação. */
  pendingCount: number;
  /** Partidas do razão da competência somadas por conta (positivo = devedor). */
  postings: { accountId: string; value: number }[];
  createdAt: string;
}
