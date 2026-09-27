'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  documentId,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import {
  getRules,
  getTransactions,
  saveRule,
  saveTransactionsBatch,
  updateTransactionClassification,
} from '@/lib/services/data-service';
import type { OFXTransaction } from '@/lib/ofx-parser';
import type {
  BankTransaction,
  ChartAccount,
  ClassificationRule,
  ReconciliationStatus,
  TransactionType,
} from '@/types/firestore';

/* =========================================================================
   Constantes & utilitários puros
   ========================================================================= */

const TRANSACTIONS = 'transactions';
const RULES = 'classification_rules';

/** Limite do operador `in` do Firestore. */
const IN_QUERY_LIMIT = 30;
/** Limite de operações por writeBatch. */
const BATCH_LIMIT = 500;

/** Normalização canônica usada tanto para memos quanto para padrões. */
export const normalizePattern = (value: string): string => value.toLowerCase().trim();

export const buildTransactionId = (clientId: string, fitid: string): string =>
  `${clientId}_${fitid}`;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Retorna a regra mais específica (padrão mais longo) contida no memo. */
function findMatchingRule(
  memo: string,
  rules: readonly ClassificationRule[]
): ClassificationRule | null {
  const normalizedMemo = normalizePattern(memo);
  let best: ClassificationRule | null = null;
  for (const rule of rules) {
    const pattern = normalizePattern(rule.pattern);
    if (!pattern || !normalizedMemo.includes(pattern)) continue;
    if (!best || pattern.length > normalizePattern(best.pattern).length) best = rule;
  }
  return best;
}

/** Commita operações em múltiplos batches respeitando o limite do Firestore. */
async function commitInBatches<T>(
  items: readonly T[],
  apply: (batch: WriteBatch, item: T) => void
): Promise<void> {
  for (const group of chunk(items, BATCH_LIMIT)) {
    const batch = writeBatch(db);
    group.forEach((item) => apply(batch, item));
    await batch.commit();
  }
}

/* =========================================================================
   Tipos públicos
   ========================================================================= */

/** Aceita tanto `OFXTransaction` (lib/ofx-parser) quanto `OFXRawTransaction` (lib/ofx). */
export type ImportableTransaction = Pick<OFXTransaction, 'fitid' | 'date' | 'amount' | 'memo'> & {
  type: TransactionType;
};

export interface ImportResult {
  added: number;
  duplicates: number;
  autoClassified: number;
}

export interface ClassifyOptions {
  learnRule?: boolean;
  customPattern?: string;
}

export interface ClassifyResult {
  /** Regra criada, quando `learnRule` estiver ativo. */
  rule: ClassificationRule | null;
  /** Quantidade de lançamentos pendentes retroalimentados pela nova regra. */
  propagated: number;
}

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
}

export interface UseReconciliationReturn {
  transactions: BankTransaction[];
  rules: ClassificationRule[];
  metrics: ReconciliationMetrics;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  importTransactions: (items: readonly ImportableTransaction[]) => Promise<ImportResult>;
  classifyTransaction: (
    transactionId: string,
    accountId: string,
    options?: ClassifyOptions
  ) => Promise<ClassifyResult>;
  /** Confirma em lote todos os lançamentos auto-classificados. Retorna a quantidade aprovada. */
  approveAutoClassified: () => Promise<number>;
  reload: () => Promise<void>;
}

/* =========================================================================
   Camada de dados (Firestore, com fallback local em modo desenvolvimento)
   ========================================================================= */

const firestoreEnabled = (): boolean => isFirebaseConfigured();

async function fetchRules(clientId: string): Promise<ClassificationRule[]> {
  if (firestoreEnabled()) {
    const snap = await getDocs(query(collection(db, RULES), where('clientId', '==', clientId)));
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        ...(data as Omit<ClassificationRule, 'id'>),
        id: d.id,
        createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
        updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
      };
    });
  }
  const all = await getRules(clientId);
  return all.filter((r) => r.clientId === clientId || r.clientId === 'global');
}

async function fetchTransactions(clientId: string): Promise<BankTransaction[]> {
  if (firestoreEnabled()) {
    const snap = await getDocs(
      query(collection(db, TRANSACTIONS), where('clientId', '==', clientId))
    );
    return snap.docs
      .map((d) => ({ ...(d.data() as BankTransaction), id: d.id }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }
  return getTransactions(clientId);
}

/** Consulta, em blocos de 30, quais IDs determinísticos já existem no Firestore. */
async function fetchExistingIds(ids: readonly string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  for (const group of chunk(ids, IN_QUERY_LIMIT)) {
    const snap = await getDocs(
      query(collection(db, TRANSACTIONS), where(documentId(), 'in', group))
    );
    snap.docs.forEach((d) => existing.add(d.id));
  }
  return existing;
}

/* =========================================================================
   Hook
   ========================================================================= */

export function useReconciliation({
  clientId,
  accounts,
}: UseReconciliationParams): UseReconciliationReturn {
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [rules, setRules] = useState<ClassificationRule[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const accountsById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a] as const)),
    [accounts]
  );

  const reload = useCallback(async (): Promise<void> => {
    if (!clientId) {
      setTransactions([]);
      setRules([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [loadedRules, loadedTxs] = await Promise.all([
        fetchRules(clientId),
        fetchTransactions(clientId),
      ]);
      setRules(loadedRules);
      setTransactions(loadedTxs);
    } catch (e) {
      console.error('[useReconciliation] Falha ao carregar dados:', e);
      setError('Não foi possível carregar os lançamentos.');
    } finally {
      setIsLoading(false);
    }
  }, [clientId]);

  // Carrega ao trocar de cliente (adiado um microtask para não setar estado no corpo do effect).
  useEffect(() => {
    let active = true;
    const run = async (): Promise<void> => {
      await Promise.resolve();
      if (active) await reload();
    };
    void run();
    return () => {
      active = false;
    };
  }, [reload]);

  /* ------------------------------------------------------------------ */
  /* 1 + 2. Importação anti-duplicidade com classificação automática     */
  /* ------------------------------------------------------------------ */
  const importTransactions = useCallback(
    async (items: readonly ImportableTransaction[]): Promise<ImportResult> => {
      if (!clientId) throw new Error('Selecione um cliente antes de importar.');
      setIsSaving(true);
      setError(null);

      try {
        // Deduplica dentro do próprio arquivo (FITIDs repetidos no OFX).
        const uniqueInFile = new Map<string, ImportableTransaction>();
        items.forEach((t) => uniqueInFile.set(buildTransactionId(clientId, t.fitid), t));
        const ids = [...uniqueInFile.keys()];

        const existing = firestoreEnabled()
          ? await fetchExistingIds(ids)
          : new Set(transactions.map((t) => t.id));

        const activeRules = firestoreEnabled() ? await fetchRules(clientId) : rules;
        const now = new Date().toISOString();

        const fresh: BankTransaction[] = [];
        for (const [id, raw] of uniqueInFile) {
          if (existing.has(id)) continue;
          const rule = findMatchingRule(raw.memo, activeRules);
          const account = rule ? accountsById.get(rule.accountId) : undefined;
          const status: ReconciliationStatus = rule ? 'AUTO_CLASSIFIED' : 'PENDING';

          const tx: BankTransaction = {
            id,
            clientId,
            fitid: raw.fitid,
            date: raw.date,
            amount: raw.amount,
            type: raw.type,
            memo: raw.memo,
            status,
            createdAt: now,
          };
          if (rule) {
            tx.accountId = rule.accountId;
            tx.matchedRuleId = rule.id;
            tx.accountCode = account?.code ?? rule.accountCode;
            tx.accountName = account?.name ?? rule.accountName;
          }
          fresh.push(tx);
        }

        if (fresh.length > 0) {
          if (firestoreEnabled()) {
            await commitInBatches(fresh, (batch, tx) => {
              // accountId: null explícito para lançamentos pendentes.
              batch.set(doc(db, TRANSACTIONS, tx.id), {
                ...stripUndefined(tx),
                accountId: tx.accountId ?? null,
              });
            });
          } else {
            await saveTransactionsBatch(clientId, fresh, {
              id: `batch_${Date.now()}`,
              clientId,
              fileName: 'ofx',
              fileSize: 0,
              totalTransactions: fresh.length,
              importedCount: fresh.length,
              duplicateCount: 0,
              autoClassifiedCount: 0,
              totalDebit: 0,
              totalCredit: 0,
              importedAt: now,
            });
          }
        }

        setRules(activeRules);
        setTransactions((prev) =>
          [...fresh, ...prev].sort((a, b) => b.date.localeCompare(a.date))
        );

        return {
          added: fresh.length,
          duplicates: items.length - fresh.length,
          autoClassified: fresh.filter((t) => t.status === 'AUTO_CLASSIFIED').length,
        };
      } catch (e) {
        console.error('[useReconciliation] Falha na importação:', e);
        setError('Falha ao importar o extrato.');
        throw e;
      } finally {
        setIsSaving(false);
      }
    },
    [clientId, transactions, rules, accountsById]
  );

  /* ------------------------------------------------------------------ */
  /* 3. Classificação manual + aprendizado contínuo                      */
  /* ------------------------------------------------------------------ */
  const classifyTransaction = useCallback(
    async (
      transactionId: string,
      accountId: string,
      options: ClassifyOptions = {}
    ): Promise<ClassifyResult> => {
      if (!clientId) throw new Error('Nenhum cliente selecionado.');
      const target = transactions.find((t) => t.id === transactionId);
      if (!target) throw new Error(`Lançamento ${transactionId} não encontrado.`);

      const account = accountsById.get(accountId);
      const accountCode = account?.code ?? '';
      const accountName = account?.name ?? '';
      const now = new Date().toISOString();

      const pattern = options.learnRule
        ? normalizePattern(options.customPattern || target.memo)
        : '';

      // Retroalimentação: pendentes (exceto o próprio) que contêm o padrão.
      const similar = pattern
        ? transactions.filter(
            (t) =>
              t.id !== transactionId &&
              t.status === 'PENDING' &&
              normalizePattern(t.memo).includes(pattern)
          )
        : [];

      setIsSaving(true);
      setError(null);
      try {
        let rule: ClassificationRule | null = null;

        if (firestoreEnabled()) {
          const batch = writeBatch(db);
          batch.update(doc(db, TRANSACTIONS, transactionId), {
            status: 'RECONCILED' satisfies ReconciliationStatus,
            accountId,
            accountCode,
            accountName,
            reconciledAt: now,
          });

          let ruleId: string | undefined;
          if (pattern) {
            const ruleRef = doc(collection(db, RULES));
            ruleId = ruleRef.id;
            batch.set(ruleRef, {
              clientId,
              pattern,
              accountId,
              accountCode,
              accountName,
              createdAt: serverTimestamp(),
            });
          }
          // A transação + regra + até 498 similares cabem no primeiro batch;
          // o excedente segue em batches adicionais.
          const head = similar.slice(0, BATCH_LIMIT - 2);
          head.forEach((t) =>
            batch.update(doc(db, TRANSACTIONS, t.id), {
              status: 'AUTO_CLASSIFIED' satisfies ReconciliationStatus,
              accountId,
              accountCode,
              accountName,
              ...(ruleId ? { matchedRuleId: ruleId } : {}),
            })
          );
          await batch.commit();
          await commitInBatches(similar.slice(BATCH_LIMIT - 2), (b, t) =>
            b.update(doc(db, TRANSACTIONS, t.id), {
              status: 'AUTO_CLASSIFIED' satisfies ReconciliationStatus,
              accountId,
              accountCode,
              accountName,
              ...(ruleId ? { matchedRuleId: ruleId } : {}),
            })
          );

          if (ruleId) {
            rule = { id: ruleId, clientId, pattern, accountId, accountCode, accountName, createdAt: now, updatedAt: now };
          }
        } else {
          await updateTransactionClassification(transactionId, accountId, accountCode, accountName, 'RECONCILED');
          if (pattern) {
            rule = { id: `rule_${Date.now()}`, clientId, pattern, accountId, accountCode, accountName, createdAt: now, updatedAt: now };
            await saveRule(rule);
          }
          for (const t of similar) {
            await updateTransactionClassification(t.id, accountId, accountCode, accountName, 'AUTO_CLASSIFIED');
          }
        }

        const similarIds = new Set(similar.map((t) => t.id));
        setTransactions((prev) =>
          prev.map((t) => {
            if (t.id === transactionId) {
              return { ...t, status: 'RECONCILED', accountId, accountCode, accountName, reconciledAt: now };
            }
            if (similarIds.has(t.id)) {
              return { ...t, status: 'AUTO_CLASSIFIED', accountId, accountCode, accountName, matchedRuleId: rule?.id };
            }
            return t;
          })
        );
        if (rule) {
          const created = rule;
          setRules((prev) => [created, ...prev]);
        }

        return { rule, propagated: similar.length };
      } catch (e) {
        console.error('[useReconciliation] Falha ao classificar:', e);
        setError('Não foi possível salvar a classificação.');
        throw e;
      } finally {
        setIsSaving(false);
      }
    },
    [clientId, transactions, accountsById]
  );

  /* ------------------------------------------------------------------ */
  /* Aprovação em lote dos auto-classificados                            */
  /* ------------------------------------------------------------------ */
  const approveAutoClassified = useCallback(async (): Promise<number> => {
    const eligible = transactions.filter(
      (t) => t.status === 'AUTO_CLASSIFIED' && Boolean(t.accountId)
    );
    if (eligible.length === 0) return 0;
    const now = new Date().toISOString();

    setIsSaving(true);
    setError(null);
    try {
      if (firestoreEnabled()) {
        await commitInBatches(eligible, (batch, t) =>
          batch.update(doc(db, TRANSACTIONS, t.id), {
            status: 'RECONCILED' satisfies ReconciliationStatus,
            reconciledAt: now,
          })
        );
      } else {
        for (const t of eligible) {
          await updateTransactionClassification(
            t.id,
            t.accountId ?? '',
            t.accountCode ?? '',
            t.accountName ?? '',
            'RECONCILED'
          );
        }
      }
      const ids = new Set(eligible.map((t) => t.id));
      setTransactions((prev) =>
        prev.map((t) => (ids.has(t.id) ? { ...t, status: 'RECONCILED', reconciledAt: now } : t))
      );
      return eligible.length;
    } catch (e) {
      console.error('[useReconciliation] Falha na aprovação em lote:', e);
      setError('Não foi possível aprovar os lançamentos.');
      throw e;
    } finally {
      setIsSaving(false);
    }
  }, [transactions]);

  /* ------------------------------------------------------------------ */
  /* Métricas                                                            */
  /* ------------------------------------------------------------------ */
  const metrics = useMemo<ReconciliationMetrics>(() => {
    let pending = 0;
    let autoClassified = 0;
    let reconciled = 0;
    let credits = 0;
    let debits = 0;
    for (const t of transactions) {
      if (t.status === 'PENDING') pending++;
      else if (t.status === 'AUTO_CLASSIFIED') autoClassified++;
      else reconciled++;
      if (t.amount >= 0) credits += t.amount;
      else debits += Math.abs(t.amount);
    }
    const total = transactions.length;
    return {
      total,
      pending,
      autoClassified,
      reconciled,
      reconciledPercent: total ? Math.round((reconciled / total) * 100) : 0,
      credits,
      debits,
    };
  }, [transactions]);

  return {
    transactions,
    rules,
    metrics,
    isLoading,
    isSaving,
    error,
    importTransactions,
    classifyTransaction,
    approveAutoClassified,
    reload,
  };
}

/** Firestore rejeita campos `undefined`; remove-os antes do `set`. */
function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as Partial<T>;
}
