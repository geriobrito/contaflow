import type { Dispatch, SetStateAction } from 'react';
import type { DateRange } from '@/lib/data/repository';
import type { OFXAccountInfo, OFXRawTransaction } from '@/lib/ofx/types';
import type { CoverageGap } from '@/lib/statement';
import type {
  BalanceCheck,
  BankTransaction,
  ChartAccount,
  ClassificationRule,
  PeriodLock,
  RuleMatchType,
  TransactionType,
} from '@/types/firestore';

/* =========================================================================
   Importação
   ========================================================================= */

/** Lançamento pronto para importar (ex.: `OFXRawTransaction` de lib/ofx). */
export type ImportableTransaction = Pick<OFXRawTransaction, 'fitid' | 'date' | 'amount' | 'memo'> & {
  type: TransactionType;
};

/** Metadados do arquivo OFX para registro do extrato e conferência de saldo. */
export interface StatementMeta {
  fileName?: string;
  account?: OFXAccountInfo;
  startDate?: string;
  endDate?: string;
  ledgerBalance?: { amount: number; date?: string };
}

export interface ImportResult {
  added: number;
  duplicates: number;
  autoClassified: number;
  /** Data mais recente entre os lançamentos importados (para posicionar o período). */
  latestDate: string | null;
  balanceCheck?: BalanceCheck;
  /** Lacunas de datas na cobertura de extratos da conta. */
  gaps: CoverageGap[];
  /** Lançamentos com data fora do intervalo declarado no arquivo. */
  outOfRange: number;
}

/** Lançamento já importado cuja descrição no arquivo é diferente (mais completa ou corrigida). */
export interface MemoUpdate {
  id: string;
  date: string;
  before: string;
  after: string;
}

/** Resultado da checagem prévia de duplicidade (nada é gravado). */
export interface PreImportCheck {
  /** Todos os lançamentos do arquivo já estão no banco: a importação deve ser bloqueada. */
  isFullDuplicate: boolean;
  /** Parte já existe (extratos com dias sobrepostos): pedir confirmação antes de gravar. */
  isPartialOverlap: boolean;
  /** Lançamentos distintos no arquivo (FITIDs repetidos no próprio arquivo contam uma vez). */
  totalInFile: number;
  alreadyImportedCount: number;
  newTransactions: ImportableTransaction[];
  /** Descrições dos lançamentos já importados que o arquivo traz diferentes. */
  memoUpdates: MemoUpdate[];
}

/* =========================================================================
   Classificação
   ========================================================================= */

export interface ClassifyOptions {
  learnRule?: boolean;
  customPattern?: string;
  matchType?: RuleMatchType;
}

export interface ClassifyResult {
  /** Regra criada ou atualizada, quando `learnRule` estiver ativo. */
  rule: ClassificationRule | null;
  /** Pendentes (de qualquer período) auto-classificados pela regra. */
  propagated: number;
}

export interface ClassifyManyResult extends ClassifyResult {
  /** Lançamentos classificados. */
  classified: number;
  /** Ignorados: competência fechada ou perna de transferência. */
  skipped: number;
}

/* =========================================================================
   Estado
   ========================================================================= */

export interface ReconciliationMetrics {
  total: number;
  pending: number;
  autoClassified: number;
  reconciled: number;
  reconciledPercent: number;
  credits: number;
  debits: number;
}

export interface UseReconciliationParams {
  clientId: string | null;
  accounts: readonly ChartAccount[];
  /** Período consultado no banco; `null` aguarda a definição do período (não carrega nada). */
  range: DateRange | null;
}

/**
 * Estado da conciliação compartilhado pelos hooks de importação, classificação e
 * fechamento. Quem guarda o estado é `useReconciliation`; os demais só leem e gravam por aqui.
 */
export interface ReconciliationStore {
  clientId: string | null;
  accounts: readonly ChartAccount[];
  accountsById: ReadonlyMap<string, ChartAccount>;
  range: DateRange | null;
  transactions: BankTransaction[];
  rules: ClassificationRule[];
  locks: PeriodLock[];
  lockedMonths: ReadonlySet<string>;
  setTransactions: Dispatch<SetStateAction<BankTransaction[]>>;
  setRules: Dispatch<SetStateAction<ClassificationRule[]>>;
  setLocks: Dispatch<SetStateAction<PeriodLock[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
  /** Envolve uma operação de escrita com estado de gravação e mensagem de erro. */
  mutate: <T>(failure: string, op: () => Promise<T>) => Promise<T>;
  /** Substitui lançamentos no estado local (apenas os que estão carregados). */
  replaceLoaded: (updated: readonly BankTransaction[]) => void;
}

/** Mensagem de um erro qualquer, para compor o aviso ao usuário. */
export const describeError = (e: unknown): string => (e instanceof Error && e.message ? e.message : 'erro desconhecido');
