'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getRepository } from '@/lib/services/data-service';
import type { DateRange } from '@/lib/data/repository';
import type { OFXTransaction } from '@/lib/ofx-parser';
import { draftsToSplits, summarizeSplits, type SplitDraft } from '@/lib/splits';
import { buildTransactionId, findMatchingRule, normalizePattern } from '@/lib/reconciliation';
import type {
  BankTransaction,
  ChartAccount,
  ClassificationRule,
  ReconciliationStatus,
  TransactionType,
} from '@/types/firestore';

export { normalizePattern, buildTransactionId } from '@/lib/reconciliation';

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
  /** Data mais recente entre os lançamentos importados (para posicionar o período). */
  latestDate: string | null;
}

export interface ClassifyOptions {
  learnRule?: boolean;
  customPattern?: string;
}

export interface ClassifyResult {
  /** Regra criada ou atualizada, quando `learnRule` estiver ativo. */
  rule: ClassificationRule | null;
  /** Quantidade de lançamentos pendentes retroalimentados pela regra. */
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
  /** Período consultado no banco; `null` aguarda a definição do período (não carrega nada). */
  range: DateRange | null;
}

export interface UseReconciliationReturn {
  transactions: BankTransaction[];
  rules: ClassificationRule[];
  metrics: ReconciliationMetrics;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  importTransactions: (items: readonly ImportableTransaction[]) => Promise<ImportResult>;
  classifyTransaction: (transactionId: string, accountId: string, options?: ClassifyOptions) => Promise<ClassifyResult>;
  /** Desdobra o lançamento em várias contas analíticas (rateio); rejeita se a soma não fechar. */
  splitTransaction: (transactionId: string, drafts: readonly SplitDraft[]) => Promise<void>;
  /** Volta o lançamento para PENDING, limpando conta, rateio e vínculo com regra. */
  unreconcileTransaction: (transactionId: string) => Promise<void>;
  /** Confirma em lote os auto-classificados do período. Retorna a quantidade aprovada. */
  approveAutoClassified: () => Promise<number>;
  reload: () => Promise<void>;
}

const inRange = (date: string, range: DateRange | null) => !range || (date >= range.start && date <= range.end);
const byDateDesc = (a: BankTransaction, b: BankTransaction) => b.date.localeCompare(a.date);
const describe = (e: unknown) => (e instanceof Error && e.message ? e.message : 'erro desconhecido');

/* =========================================================================
   Hook
   ========================================================================= */

export function useReconciliation({ clientId, accounts, range }: UseReconciliationParams): UseReconciliationReturn {
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [rules, setRules] = useState<ClassificationRule[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a] as const)), [accounts]);
  const rangeStart = range?.start;
  const rangeEnd = range?.end;

  const reload = useCallback(async (): Promise<void> => {
    if (!clientId || !rangeStart || !rangeEnd) {
      setTransactions([]);
      setRules([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const repo = getRepository();
      const [loadedRules, loadedTxs] = await Promise.all([
        repo.listRules(clientId),
        repo.listTransactions(clientId, { start: rangeStart, end: rangeEnd }),
      ]);
      setRules(loadedRules);
      setTransactions(loadedTxs);
    } catch (e) {
      console.error('[useReconciliation] Falha ao carregar dados:', e);
      setError(`Não foi possível carregar os lançamentos (${describe(e)}).`);
    } finally {
      setIsLoading(false);
    }
  }, [clientId, rangeStart, rangeEnd]);

  // Recarrega ao trocar cliente ou período (adiado um microtask para não setar estado no corpo do effect).
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

  /** Envolve uma operação de escrita com estado de gravação e mensagem de erro. */
  const mutate = useCallback(async <T,>(failure: string, op: () => Promise<T>): Promise<T> => {
    setIsSaving(true);
    setError(null);
    try {
      return await op();
    } catch (e) {
      console.error(`[useReconciliation] ${failure}:`, e);
      setError(`${failure} (${describe(e)}).`);
      throw e;
    } finally {
      setIsSaving(false);
    }
  }, []);

  /* ------------------------------------------------------------------ */
  /* Importação anti-duplicidade com classificação automática            */
  /* ------------------------------------------------------------------ */
  const importTransactions = useCallback(
    (items: readonly ImportableTransaction[]): Promise<ImportResult> => {
      if (!clientId) return Promise.reject(new Error('Selecione um cliente antes de importar.'));
      return mutate('Falha ao importar o extrato', async () => {
        const repo = getRepository();
        // Deduplica dentro do arquivo e contra o banco inteiro (não só o período visível).
        const uniqueInFile = new Map<string, ImportableTransaction>();
        items.forEach((t) => uniqueInFile.set(buildTransactionId(clientId, t.fitid), t));
        const existing = await repo.findExistingTransactionIds(clientId, [...uniqueInFile.keys()]);

        const activeRules = await repo.listRules(clientId);
        // Regras apontando para contas sintéticas não classificam (o lançamento fica pendente).
        const classifiable = activeRules.filter((r) => accountsById.get(r.accountId)?.nature !== 'SYNTHETIC');
        const now = new Date().toISOString();

        const fresh: BankTransaction[] = [];
        for (const [id, raw] of uniqueInFile) {
          if (existing.has(id)) continue;
          const rule = findMatchingRule(raw.memo, classifiable);
          const account = rule ? accountsById.get(rule.accountId) : undefined;
          const tx: BankTransaction = {
            id,
            clientId,
            fitid: raw.fitid,
            date: raw.date,
            amount: raw.amount,
            type: raw.type,
            memo: raw.memo,
            status: rule ? 'AUTO_CLASSIFIED' : 'PENDING',
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
          const autoClassifiedCount = fresh.filter((t) => t.status === 'AUTO_CLASSIFIED').length;
          await repo.insertTransactions(fresh, {
            id: `batch_${Date.now()}`,
            clientId,
            fileName: 'ofx',
            fileSize: 0,
            totalTransactions: items.length,
            importedCount: fresh.length,
            duplicateCount: items.length - fresh.length,
            autoClassifiedCount,
            totalDebit: fresh.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0),
            totalCredit: fresh.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0),
            importedAt: now,
          });
        }

        setRules(activeRules);
        const visible = fresh.filter((t) => inRange(t.date, range));
        if (visible.length) setTransactions((prev) => [...visible, ...prev].sort(byDateDesc));

        return {
          added: fresh.length,
          duplicates: items.length - fresh.length,
          autoClassified: fresh.filter((t) => t.status === 'AUTO_CLASSIFIED').length,
          latestDate: fresh.reduce<string | null>((max, t) => (!max || t.date > max ? t.date : max), null),
        };
      });
    },
    [clientId, accountsById, mutate, range]
  );

  /* ------------------------------------------------------------------ */
  /* Classificação manual / reclassificação + aprendizado contínuo       */
  /* ------------------------------------------------------------------ */
  const classifyTransaction = useCallback(
    (transactionId: string, accountId: string, options: ClassifyOptions = {}): Promise<ClassifyResult> => {
      if (!clientId) return Promise.reject(new Error('Nenhum cliente selecionado.'));
      const target = transactions.find((t) => t.id === transactionId);
      if (!target) return Promise.reject(new Error(`Lançamento ${transactionId} não encontrado.`));
      const account = accountsById.get(accountId);
      // Contas sintéticas apenas totalizam: lançamentos só em contas analíticas.
      if (account && account.nature !== 'ANALYTIC') {
        return Promise.reject(new Error(`A conta ${account.code} é sintética e não pode receber lançamentos.`));
      }

      const ref = { accountId, accountCode: account?.code ?? '', accountName: account?.name ?? '' };
      const now = new Date().toISOString();
      const pattern = options.learnRule ? normalizePattern(options.customPattern || target.memo) : '';

      // Retroalimentação: pendentes do período (exceto o próprio) que contêm o padrão.
      const similar = pattern
        ? transactions.filter(
            (t) => t.id !== transactionId && t.status === 'PENDING' && normalizePattern(t.memo).includes(pattern)
          )
        : [];

      // Reclassificação: atualiza a regra de origem (ou uma com o mesmo termo) em vez de duplicar.
      const existingRule = pattern
        ? (rules.find((r) => r.id === target.matchedRuleId && r.clientId === clientId) ??
          rules.find((r) => r.clientId === clientId && normalizePattern(r.pattern) === pattern))
        : undefined;
      const rule: ClassificationRule | null = pattern
        ? existingRule
          ? { ...existingRule, pattern, ...ref, updatedAt: now }
          : { id: `rule_${Date.now()}`, clientId, pattern, ...ref, matchType: 'CONTAINS', createdAt: now, updatedAt: now }
        : null;

      return mutate('Não foi possível salvar a classificação', async () => {
        await getRepository().commitClassification({
          transactionId,
          account: ref,
          rule,
          similarIds: similar.map((t) => t.id),
          now,
        });

        const similarIds = new Set(similar.map((t) => t.id));
        setTransactions((prev) =>
          prev.map((t) => {
            if (t.id === transactionId) {
              return { ...t, ...ref, status: 'RECONCILED', reconciledAt: now, isSplit: false, splits: undefined, matchedRuleId: rule?.id };
            }
            if (similarIds.has(t.id)) return { ...t, ...ref, status: 'AUTO_CLASSIFIED', matchedRuleId: rule?.id };
            return t;
          })
        );
        if (rule) {
          setRules((prev) => (existingRule ? prev.map((r) => (r.id === rule.id ? rule : r)) : [rule, ...prev]));
        }
        return { rule, propagated: similar.length };
      });
    },
    [clientId, transactions, rules, accountsById, mutate]
  );

  /* ------------------------------------------------------------------ */
  /* Desfazer conciliação                                                */
  /* ------------------------------------------------------------------ */
  const unreconcileTransaction = useCallback(
    (transactionId: string): Promise<void> =>
      mutate('Não foi possível desfazer a conciliação', async () => {
        await getRepository().resetToPending(transactionId);
        setTransactions((prev) =>
          prev.map((t) => {
            if (t.id !== transactionId) return t;
            const { accountId: _a, accountCode: _c, accountName: _n, matchedRuleId: _m, splits: _s, reconciledAt: _r, ...rest } = t;
            void [_a, _c, _n, _m, _s, _r];
            return { ...rest, status: 'PENDING' as ReconciliationStatus, isSplit: false };
          })
        );
      }),
    [mutate]
  );

  /* ------------------------------------------------------------------ */
  /* Desdobramento (rateio)                                              */
  /* ------------------------------------------------------------------ */
  const splitTransaction = useCallback(
    (transactionId: string, drafts: readonly SplitDraft[]): Promise<void> => {
      const target = transactions.find((t) => t.id === transactionId);
      if (!target) return Promise.reject(new Error(`Lançamento ${transactionId} não encontrado.`));
      const summary = summarizeSplits(target.amount, drafts, accountsById);
      if (!summary.isComplete) return Promise.reject(new Error(summary.errors[0]));
      if (!summary.isBalanced) return Promise.reject(new Error('A soma do rateio difere do valor do lançamento.'));

      const splits = draftsToSplits(target, drafts, accountsById);
      const now = new Date().toISOString();
      return mutate('Não foi possível salvar o rateio', async () => {
        await getRepository().saveSplits(transactionId, splits, now);
        setTransactions((prev) =>
          prev.map((t) =>
            t.id === transactionId
              ? {
                  ...t,
                  status: 'RECONCILED',
                  isSplit: true,
                  splits,
                  accountId: undefined,
                  accountCode: undefined,
                  accountName: undefined,
                  matchedRuleId: undefined,
                  reconciledAt: now,
                }
              : t
          )
        );
      });
    },
    [transactions, accountsById, mutate]
  );

  /* ------------------------------------------------------------------ */
  /* Aprovação em lote dos auto-classificados                            */
  /* ------------------------------------------------------------------ */
  const approveAutoClassified = useCallback((): Promise<number> => {
    const eligible = transactions.filter((t) => t.status === 'AUTO_CLASSIFIED' && Boolean(t.accountId));
    if (eligible.length === 0) return Promise.resolve(0);
    const now = new Date().toISOString();
    const ids = eligible.map((t) => t.id);
    return mutate('Não foi possível aprovar os lançamentos', async () => {
      await getRepository().approveTransactions(ids, now);
      const set = new Set(ids);
      setTransactions((prev) => prev.map((t) => (set.has(t.id) ? { ...t, status: 'RECONCILED', reconciledAt: now } : t)));
      return ids.length;
    });
  }, [transactions, mutate]);

  /* ------------------------------------------------------------------ */
  /* Métricas do período                                                 */
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
    splitTransaction,
    unreconcileTransaction,
    approveAutoClassified,
    reload,
  };
}
