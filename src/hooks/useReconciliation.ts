'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getRepository } from '@/lib/services/data-service';
import { applyRuleToPending, checkStatementBalance, closeMonth, reopenMonth } from '@/lib/services/reconciliation-service';
import { ensureBankAccount, partnerResetChange } from '@/lib/services/accounting-service';
import { getActor } from '@/lib/data/scope';
import type { AccountRef, DateRange } from '@/lib/data/repository';
import type { OFXRawTransaction } from '@/lib/ofx/types';
import type { OFXAccountInfo } from '@/lib/ofx/types';
import { draftsToSplits, summarizeSplits, type SplitDraft } from '@/lib/splits';
import { buildTransactionId, findMatchingRule, normalizePattern } from '@/lib/reconciliation';
import { classifyAction, newAuditId, transactionAudit } from '@/lib/audit';
import { formatMonth, isISODate, isMonthLocked, monthOf } from '@/lib/periods';
import { accountKeyOf, findCoverageGaps, outOfRangeDates, type CoverageGap } from '@/lib/statement';
import {
  approveTransition,
  classifyTransition,
  queryTransition,
  resetTransition,
  splitTransition,
  transferTransition,
} from '@/lib/transitions';
import type { TransferPair } from '@/lib/transfers';
import type {
  AuditEntry,
  BalanceCheck,
  BankTransaction,
  ChartAccount,
  ClassificationRule,
  ImportBatch,
  PeriodLock,
  RuleMatchType,
  TransactionType,
} from '@/types/firestore';

export { normalizePattern, buildTransactionId } from '@/lib/reconciliation';

/** Descarta datas/saldo de cabeçalho inválidos em vez de deixar a importação falhar. */
function sanitizeMeta(meta: StatementMeta): StatementMeta {
  const ledger = meta.ledgerBalance;
  return {
    ...meta,
    startDate: isISODate(meta.startDate) ? meta.startDate : undefined,
    endDate: isISODate(meta.endDate) ? meta.endDate : undefined,
    ledgerBalance:
      ledger && Number.isFinite(ledger.amount)
        ? { amount: ledger.amount, date: isISODate(ledger.date) ? ledger.date : undefined }
        : undefined,
  };
}

/* =========================================================================
   Tipos públicos
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

export interface ClassifyOptions {
  learnRule?: boolean;
  customPattern?: string;
  matchType?: RuleMatchType;
}

export interface ClassifyManyResult extends ClassifyResult {
  /** Lançamentos classificados. */
  classified: number;
  /** Ignorados: competência fechada ou perna de transferência. */
  skipped: number;
}

export interface ClassifyResult {
  /** Regra criada ou atualizada, quando `learnRule` estiver ativo. */
  rule: ClassificationRule | null;
  /** Pendentes (de qualquer período) auto-classificados pela regra. */
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
  locks: PeriodLock[];
  lockedMonths: ReadonlySet<string>;
  metrics: ReconciliationMetrics;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  /** Verifica quais lançamentos do arquivo já existem, sem gravar nada. */
  checkImport: (items: readonly ImportableTransaction[]) => Promise<PreImportCheck>;
  /** Atualiza a descrição de lançamentos já importados (competências fechadas são puladas). */
  updateMemos: (updates: readonly MemoUpdate[], fileName: string) => Promise<{ updated: number; skipped: number }>;
  importTransactions: (items: readonly ImportableTransaction[], meta?: StatementMeta) => Promise<ImportResult>;
  classifyTransaction: (transactionId: string, accountId: string, options?: ClassifyOptions) => Promise<ClassifyResult>;
  /** Classifica vários lançamentos na mesma conta (ex.: todos de um favorecido), criando uma única regra. */
  classifyMany: (transactionIds: readonly string[], accountId: string, options?: ClassifyOptions) => Promise<ClassifyManyResult>;
  splitTransaction: (transactionId: string, drafts: readonly SplitDraft[]) => Promise<void>;
  unreconcileTransaction: (transactionId: string) => Promise<void>;
  approveAutoClassified: () => Promise<number>;
  closeMonth: (month: string) => Promise<void>;
  reopenMonth: (month: string, reason: string) => Promise<void>;
  loadAudit: (transactionId: string) => Promise<AuditEntry[]>;
  /** Concilia pares de transferência entre contas próprias na conta transitória. */
  reconcileTransfers: (pairs: readonly TransferPair[], transit: ChartAccount) => Promise<number>;
  /** Marca (ou remove, com pergunta vazia) uma pergunta ao cliente sobre o lançamento. */
  askClient: (transactionId: string, question: string) => Promise<void>;
  resolveClientQuery: (transactionId: string) => Promise<void>;
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
  const [locks, setLocks] = useState<PeriodLock[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a] as const)), [accounts]);
  const lockedMonths = useMemo(() => new Set(locks.map((l) => l.month)), [locks]);
  const rangeStart = range?.start;
  const rangeEnd = range?.end;

  const reload = useCallback(async (): Promise<void> => {
    if (!clientId || !rangeStart || !rangeEnd) {
      setTransactions([]);
      setRules([]);
      setLocks([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const repo = getRepository();
      const [loadedRules, loadedTxs, loadedLocks] = await Promise.all([
        repo.listRules(clientId),
        repo.listTransactions(clientId, { start: rangeStart, end: rangeEnd }),
        repo.listPeriodLocks(clientId),
      ]);
      setRules(loadedRules);
      setTransactions(loadedTxs);
      setLocks(loadedLocks);
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

  /** Substitui lançamentos no estado local (apenas os que estão carregados). */
  const replaceLoaded = useCallback((updated: readonly BankTransaction[]) => {
    if (!updated.length) return;
    const byId = new Map(updated.map((t) => [t.id, t] as const));
    setTransactions((prev) => prev.map((t) => byId.get(t.id) ?? t));
  }, []);

  /** Recusa alterações em competência fechada (as regras do Firestore também recusam). */
  const assertOpen = useCallback(
    (tx: BankTransaction) => {
      if (isMonthLocked(tx.date, lockedMonths)) {
        throw new Error(`A competência de ${formatMonth(monthOf(tx.date))} está fechada. Reabra-a para alterar lançamentos.`);
      }
    },
    [lockedMonths]
  );

  /** Regra a criar/atualizar: reaproveita a de origem ou outra com o mesmo termo e tipo, em vez de duplicar. */
  const buildLearnedRule = useCallback(
    (args: { pattern: string; matchType: RuleMatchType; ref: AccountRef; now: string; preferRuleId?: string }) => {
      if (!clientId || !args.pattern) return { rule: null, existingRule: undefined };
      const existingRule =
        rules.find((r) => args.preferRuleId && r.id === args.preferRuleId && r.clientId === clientId) ??
        rules.find((r) => r.clientId === clientId && normalizePattern(r.pattern) === args.pattern && (r.matchType ?? 'CONTAINS') === args.matchType);
      const rule: ClassificationRule = existingRule
        ? { ...existingRule, pattern: args.pattern, matchType: args.matchType, ...args.ref, updatedAt: args.now }
        : { id: `rule_${Date.now()}`, clientId, pattern: args.pattern, matchType: args.matchType, ...args.ref, createdAt: args.now, updatedAt: args.now };
      return { rule, existingRule };
    },
    [clientId, rules]
  );

  const findLoaded = useCallback(
    (id: string) => {
      const tx = transactions.find((t) => t.id === id);
      if (!tx) throw new Error(`Lançamento ${id} não encontrado.`);
      return tx;
    },
    [transactions]
  );

  /* ------------------------------------------------------------------ */
  /* Importação: deduplicação, auto-classificação e conferência de saldo */
  /* ------------------------------------------------------------------ */
  const checkImport = useCallback(
    async (items: readonly ImportableTransaction[]): Promise<PreImportCheck> => {
      if (!clientId) throw new Error('Selecione um cliente antes de importar.');
      const unique = new Map<string, ImportableTransaction>();
      items.forEach((t) => unique.set(buildTransactionId(clientId, t.fitid), t));
      setError(null);
      let existing: Set<string>;
      try {
        existing = await getRepository().findExistingTransactionIds(clientId, [...unique.keys()]);
      } catch (e) {
        setError(`Falha ao verificar duplicidade do extrato (${describe(e)}).`);
        throw e;
      }
      const newTransactions = [...unique].filter(([id]) => !existing.has(id)).map(([, t]) => t);
      const alreadyImportedCount = unique.size - newTransactions.length;

      // Extrato reimportado com descrições melhores (ex.: agora lê o NAME do OFX): oferece atualizar.
      const memoUpdates: MemoUpdate[] = [];
      if (existing.size > 0) {
        const dates = [...unique.values()].map((t) => t.date).filter(isISODate).sort();
        if (dates.length) {
          try {
            const stored = new Map(
              (await getRepository().listTransactions(clientId, { start: dates[0], end: dates[dates.length - 1] })).map((t) => [t.id, t] as const)
            );
            for (const [id, item] of unique) {
              const current = stored.get(id);
              if (current && current.memo !== item.memo) memoUpdates.push({ id, date: current.date, before: current.memo, after: item.memo });
            }
          } catch (e) {
            setError(`Falha ao comparar as descrições do extrato (${describe(e)}).`);
            throw e;
          }
        }
      }
      return {
        isFullDuplicate: unique.size > 0 && newTransactions.length === 0,
        isPartialOverlap: alreadyImportedCount > 0 && newTransactions.length > 0,
        totalInFile: unique.size,
        alreadyImportedCount,
        newTransactions,
        memoUpdates,
      };
    },
    [clientId]
  );

  const updateMemos = useCallback(
    (updates: readonly MemoUpdate[], fileName: string): Promise<{ updated: number; skipped: number }> =>
      mutate('Não foi possível atualizar as descrições', async () => {
        if (!clientId) throw new Error('Nenhum cliente selecionado.');
        const open = updates.filter((u) => !isMonthLocked(u.date, lockedMonths));
        if (!open.length) return { updated: 0, skipped: updates.length };
        const actor = getActor();
        const now = new Date().toISOString();
        await getRepository().commitChanges({
          patches: open.map((u) => ({ id: u.id, date: u.date, set: { memo: u.after } })),
          audits: [
            {
              id: newAuditId(),
              clientId,
              action: 'MEMO_REPAIR',
              actorUid: actor.uid,
              ...(actor.email ? { actorEmail: actor.email } : {}),
              at: now,
              note: `${open.length} descrição(ões) atualizada(s) pelo extrato ${fileName} · ex.: “${open[0].before.slice(0, 50)}” → “${open[0].after.slice(0, 70)}”`,
            },
          ],
        });
        const byId = new Map(open.map((u) => [u.id, u.after] as const));
        setTransactions((prev) => prev.map((t) => (byId.has(t.id) ? { ...t, memo: byId.get(t.id)! } : t)));
        return { updated: open.length, skipped: updates.length - open.length };
      }),
    [clientId, lockedMonths, mutate]
  );

  const importTransactions = useCallback(
    (items: readonly ImportableTransaction[], rawMeta: StatementMeta = {}): Promise<ImportResult> => {
      if (!clientId) return Promise.reject(new Error('Selecione um cliente antes de importar.'));
      return mutate('Falha ao importar o extrato', async () => {
        // Última barreira antes de gravar: nenhuma data fora de YYYY-MM-DD chega ao banco
        // nem às contas de saldo/lacunas (que quebrariam com "Invalid time value").
        const invalid = items.find((t) => !isISODate(t.date) || !Number.isFinite(t.amount));
        if (invalid) {
          throw new Error(`lançamento “${invalid.memo}” com data ou valor inválido (${invalid.date || 'sem data'}).`);
        }
        const meta = sanitizeMeta(rawMeta);
        const repo = getRepository();
        const accountKey = meta.account ? accountKeyOf(meta.account) : undefined;

        // Deduplica dentro do arquivo e contra o banco inteiro (não só o período visível).
        const uniqueInFile = new Map<string, ImportableTransaction>();
        items.forEach((t) => uniqueInFile.set(buildTransactionId(clientId, t.fitid), t));
        const existing = await repo.findExistingTransactionIds(clientId, [...uniqueInFile.keys()]);

        const [activeRules, batches] = await Promise.all([repo.listRules(clientId), repo.listImportBatches(clientId)]);
        const classifiable = activeRules.filter((r) => accountsById.get(r.accountId)?.nature !== 'SYNTHETIC');
        const now = new Date().toISOString();
        const batchId = `batch_${Date.now()}`;

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
            importBatchId: batchId,
            ...(accountKey ? { accountKey } : {}),
          };
          if (rule) {
            tx.accountId = rule.accountId;
            tx.matchedRuleId = rule.id;
            tx.accountCode = account?.code ?? rule.accountCode;
            tx.accountName = account?.name ?? rule.accountName;
          }
          fresh.push(tx);
        }

        // Registro do extrato + conferência do saldo final contra o extrato anterior.
        const ledger = meta.ledgerBalance;
        const batch: ImportBatch = {
          id: batchId,
          clientId,
          fileName: meta.fileName ?? 'extrato.ofx',
          fileSize: 0,
          totalTransactions: items.length,
          importedCount: fresh.length,
          duplicateCount: items.length - fresh.length,
          autoClassifiedCount: fresh.filter((t) => t.status === 'AUTO_CLASSIFIED').length,
          totalDebit: fresh.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0),
          totalCredit: fresh.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0),
          fileNet: items.reduce((s, t) => s + t.amount, 0),
          importedAt: now,
          importedByUid: getActor().uid,
          ...(meta.startDate ? { startDate: meta.startDate } : {}),
          ...(meta.endDate ? { endDate: meta.endDate } : {}),
          ...(meta.account?.bankId ? { bankId: meta.account.bankId } : {}),
          ...(meta.account?.accountId ? { accountNumber: meta.account.accountId } : {}),
          ...(meta.account?.org ? { bankName: meta.account.org } : {}),
          ...(accountKey ? { accountKey } : {}),
          ...(ledger ? { ledgerBalance: ledger.amount, ledgerDate: ledger.date ?? meta.endDate } : {}),
        };
        batch.balanceCheck = await checkStatementBalance({ clientId, batch, batches, pendingInsert: fresh });

        await repo.insertTransactions(fresh, batch);
        // Cadastro da conta bancária do extrato (vínculo contábil e saldo inicial sugeridos).
        if (accountKey && meta.account) {
          await ensureBankAccount({ clientId, accountKey, account: meta.account, accounts, batches: [...batches, batch] });
        }

        setRules(activeRules);
        const visible = fresh.filter((t) => inRange(t.date, range));
        if (visible.length) setTransactions((prev) => [...visible, ...prev].sort(byDateDesc));

        return {
          added: fresh.length,
          duplicates: items.length - fresh.length,
          autoClassified: batch.autoClassifiedCount,
          latestDate: fresh.reduce<string | null>((max, t) => (!max || t.date > max ? t.date : max), null),
          balanceCheck: batch.balanceCheck,
          gaps: accountKey ? findCoverageGaps([...batches, batch]).filter((g) => g.accountKey === accountKey) : [],
          outOfRange: outOfRangeDates(items.map((t) => t.date), meta.startDate, meta.endDate).length,
        };
      });
    },
    [clientId, accounts, accountsById, mutate, range]
  );

  /** Reclassificar, ratear ou desfazer uma perna de transferência desfaz também a outra. */
  const partnerChange = useCallback(
    (target: BankTransaction, now: string) =>
      partnerResetChange(target, transactions, lockedMonths, now, 'Par de transferência desfeito junto com a outra perna'),
    [transactions, lockedMonths]
  );

  /* ------------------------------------------------------------------ */
  /* Classificação / reclassificação + aprendizado contínuo              */
  /* ------------------------------------------------------------------ */
  const classifyTransaction = useCallback(
    (transactionId: string, accountId: string, options: ClassifyOptions = {}): Promise<ClassifyResult> =>
      mutate('Não foi possível salvar a classificação', async () => {
        if (!clientId) throw new Error('Nenhum cliente selecionado.');
        const target = findLoaded(transactionId);
        assertOpen(target);
        const account = accountsById.get(accountId);
        // Contas sintéticas apenas totalizam: lançamentos só em contas analíticas.
        if (account && account.nature !== 'ANALYTIC') {
          throw new Error(`A conta ${account.code} é sintética e não pode receber lançamentos.`);
        }

        const actor = getActor();
        const ref = { accountId, accountCode: account?.code ?? '', accountName: account?.name ?? '' };
        const now = new Date().toISOString();
        const pattern = options.learnRule ? normalizePattern(options.customPattern || target.memo) : '';
        const matchType = options.matchType ?? 'CONTAINS';

        // Reclassificação: atualiza a regra de origem (ou uma com o mesmo termo e tipo) em vez de duplicar.
        const { rule, existingRule } = buildLearnedRule({ pattern, matchType, ref, now, preferRuleId: target.matchedRuleId });

        const { patch, after } = classifyTransition(target, ref, rule?.id ?? null, now);
        const partner = await partnerChange(target, now);
        await getRepository().commitChanges({
          patches: [patch, ...(partner ? [partner.patch] : [])],
          rules: rule ? [rule] : [],
          audits: [
            transactionAudit(classifyAction(target), actor, target, after, now, rule ? { ruleId: rule.id } : {}),
            ...(partner ? [partner.audit] : []),
          ],
        });
        replaceLoaded([after, ...(partner ? [partner.after] : [])]);

        let propagated: BankTransaction[] = [];
        if (rule) {
          const nextRules = existingRule ? rules.map((r) => (r.id === rule.id ? rule : r)) : [rule, ...rules];
          setRules(nextRules);
          // Retroalimentação: pendentes de QUALQUER período no banco que a regra vence.
          propagated = await applyRuleToPending({
            clientId,
            rule,
            rules: nextRules,
            accountsById,
            lockedMonths,
            exclude: new Set([transactionId]),
            now,
          });
          replaceLoaded(propagated);
        }
        return { rule, propagated: propagated.length };
      }),
    [clientId, rules, accountsById, lockedMonths, mutate, findLoaded, assertOpen, replaceLoaded, partnerChange, buildLearnedRule]
  );

  /* ------------------------------------------------------------------ */
  /* Classificação em lote (todos os lançamentos de um favorecido)       */
  /* ------------------------------------------------------------------ */
  const classifyMany = useCallback(
    (transactionIds: readonly string[], accountId: string, options: ClassifyOptions = {}): Promise<ClassifyManyResult> =>
      mutate('Não foi possível classificar os lançamentos', async () => {
        if (!clientId) throw new Error('Nenhum cliente selecionado.');
        const account = accountsById.get(accountId);
        if (account && account.nature !== 'ANALYTIC') {
          throw new Error(`A conta ${account.code} é sintética e não pode receber lançamentos.`);
        }
        const loaded = transactionIds.map(findLoaded);
        // Competência fechada e pernas de transferência (que arrastariam a outra perna) ficam de fora.
        const targets = loaded.filter((t) => !isMonthLocked(t.date, lockedMonths) && !t.transferPairId);
        const skipped = loaded.length - targets.length;
        if (!targets.length) return { rule: null, propagated: 0, classified: 0, skipped };

        const actor = getActor();
        const ref = { accountId, accountCode: account?.code ?? '', accountName: account?.name ?? '' };
        const now = new Date().toISOString();
        const pattern = options.learnRule ? normalizePattern(options.customPattern ?? '') : '';
        const matchType = options.matchType ?? 'CONTAINS';
        const { rule, existingRule } = buildLearnedRule({ pattern, matchType, ref, now });

        const moves = targets.map((tx) => ({ tx, ...classifyTransition(tx, ref, rule?.id ?? null, now) }));
        await getRepository().commitChanges({
          patches: moves.map((m) => m.patch),
          rules: rule ? [rule] : [],
          audits: moves.map((m) => transactionAudit(classifyAction(m.tx), actor, m.tx, m.after, now, rule ? { ruleId: rule.id } : {})),
        });
        replaceLoaded(moves.map((m) => m.after));

        let propagated: BankTransaction[] = [];
        if (rule) {
          const nextRules = existingRule ? rules.map((r) => (r.id === rule.id ? rule : r)) : [rule, ...rules];
          setRules(nextRules);
          // Pendentes de outros períodos (e do mesmo) que a regra vence também são classificados.
          propagated = await applyRuleToPending({
            clientId,
            rule,
            rules: nextRules,
            accountsById,
            lockedMonths,
            exclude: new Set(moves.map((m) => m.tx.id)),
            now,
          });
          replaceLoaded(propagated);
        }
        return { rule, propagated: propagated.length, classified: moves.length, skipped };
      }),
    [clientId, accountsById, lockedMonths, mutate, findLoaded, replaceLoaded, buildLearnedRule, rules]
  );

  /* ------------------------------------------------------------------ */
  /* Desfazer conciliação                                                */
  /* ------------------------------------------------------------------ */
  const unreconcileTransaction = useCallback(
    (transactionId: string): Promise<void> =>
      mutate('Não foi possível desfazer a conciliação', async () => {
        const target = findLoaded(transactionId);
        assertOpen(target);
        const { patch, after } = resetTransition(target);
        const now = new Date().toISOString();
        const partner = await partnerChange(target, now);
        await getRepository().commitChanges({
          patches: [patch, ...(partner ? [partner.patch] : [])],
          audits: [transactionAudit('UNRECONCILE', getActor(), target, after, now), ...(partner ? [partner.audit] : [])],
        });
        replaceLoaded([after, ...(partner ? [partner.after] : [])]);
      }),
    [mutate, findLoaded, assertOpen, replaceLoaded, partnerChange]
  );

  /* ------------------------------------------------------------------ */
  /* Desdobramento (rateio)                                              */
  /* ------------------------------------------------------------------ */
  const splitTransaction = useCallback(
    (transactionId: string, drafts: readonly SplitDraft[]): Promise<void> =>
      mutate('Não foi possível salvar o rateio', async () => {
        const target = findLoaded(transactionId);
        assertOpen(target);
        const summary = summarizeSplits(target.amount, drafts, accountsById);
        if (!summary.isComplete) throw new Error(summary.errors[0]);
        if (!summary.isBalanced) throw new Error('A soma do rateio difere do valor do lançamento.');
        const now = new Date().toISOString();
        const { patch, after } = splitTransition(target, draftsToSplits(target, drafts, accountsById), now);
        const partner = await partnerChange(target, now);
        await getRepository().commitChanges({
          patches: [patch, ...(partner ? [partner.patch] : [])],
          audits: [transactionAudit('SPLIT', getActor(), target, after, now), ...(partner ? [partner.audit] : [])],
        });
        replaceLoaded([after, ...(partner ? [partner.after] : [])]);
      }),
    [accountsById, mutate, findLoaded, assertOpen, replaceLoaded, partnerChange]
  );

  /* ------------------------------------------------------------------ */
  /* Transferências entre contas próprias                                */
  /* ------------------------------------------------------------------ */
  const reconcileTransfers = useCallback(
    (pairs: readonly TransferPair[], transit: ChartAccount): Promise<number> =>
      mutate('Não foi possível conciliar as transferências', async () => {
        if (transit.nature !== 'ANALYTIC') throw new Error(`A conta ${transit.code} é sintética.`);
        const ref = { accountId: transit.id, accountCode: transit.code, accountName: transit.name };
        const actor = getActor();
        const now = new Date().toISOString();
        const moves = pairs.flatMap((p) => {
          assertOpen(p.out);
          assertOpen(p.in);
          return [
            { tx: p.out, ...transferTransition(p.out, ref, p.in.id, now) },
            { tx: p.in, ...transferTransition(p.in, ref, p.out.id, now) },
          ];
        });
        if (!moves.length) return 0;
        await getRepository().commitChanges({
          patches: moves.map((m) => m.patch),
          audits: moves.map((m) => transactionAudit('TRANSFER', actor, m.tx, m.after, now)),
        });
        replaceLoaded(moves.map((m) => m.after));
        return pairs.length;
      }),
    [mutate, assertOpen, replaceLoaded]
  );

  /* ------------------------------------------------------------------ */
  /* Pendências com o cliente                                            */
  /* ------------------------------------------------------------------ */
  const askClient = useCallback(
    (transactionId: string, question: string): Promise<void> =>
      mutate('Não foi possível registrar a pergunta ao cliente', async () => {
        const target = findLoaded(transactionId);
        assertOpen(target);
        const actor = getActor();
        const text = question.trim();
        const { patch, after } = queryTransition(
          target,
          text
            ? {
                question: text,
                status: 'OPEN',
                askedAt: new Date().toISOString(),
                askedByUid: actor.uid,
                ...(actor.email ? { askedByEmail: actor.email } : {}),
              }
            : undefined
        );
        await getRepository().commitChanges({ patches: [patch], audits: [] });
        replaceLoaded([after]);
      }),
    [mutate, findLoaded, assertOpen, replaceLoaded]
  );

  const resolveClientQuery = useCallback(
    (transactionId: string): Promise<void> =>
      mutate('Não foi possível concluir a pendência', async () => {
        const target = findLoaded(transactionId);
        if (!target.clientQuery) return;
        assertOpen(target);
        const { patch, after } = queryTransition(target, { ...target.clientQuery, status: 'RESOLVED', resolvedAt: new Date().toISOString() });
        await getRepository().commitChanges({ patches: [patch], audits: [] });
        replaceLoaded([after]);
      }),
    [mutate, findLoaded, assertOpen, replaceLoaded]
  );

  /* ------------------------------------------------------------------ */
  /* Aprovação em lote dos auto-classificados (competências abertas)     */
  /* ------------------------------------------------------------------ */
  const approveAutoClassified = useCallback(
    (): Promise<number> =>
      mutate('Não foi possível aprovar os lançamentos', async () => {
        const eligible = transactions.filter(
          (t) => t.status === 'AUTO_CLASSIFIED' && Boolean(t.accountId) && !isMonthLocked(t.date, lockedMonths)
        );
        if (!eligible.length) return 0;
        const actor = getActor();
        const now = new Date().toISOString();
        const moves = eligible.map((tx) => ({ tx, ...approveTransition(tx, now) }));
        await getRepository().commitChanges({
          patches: moves.map((m) => m.patch),
          audits: moves.map((m) => transactionAudit('APPROVE', actor, m.tx, m.after, now)),
        });
        replaceLoaded(moves.map((m) => m.after));
        return moves.length;
      }),
    [transactions, lockedMonths, mutate, replaceLoaded]
  );

  /* ------------------------------------------------------------------ */
  /* Fechamento de competência                                           */
  /* ------------------------------------------------------------------ */
  const closeMonthCb = useCallback(
    (month: string): Promise<void> =>
      mutate('Não foi possível fechar a competência', async () => {
        if (!clientId) throw new Error('Nenhum cliente selecionado.');
        const lock = await closeMonth(clientId, month);
        setLocks((prev) => [...prev.filter((l) => l.id !== lock.id), lock]);
      }),
    [clientId, mutate]
  );

  const reopenMonthCb = useCallback(
    (month: string, reason: string): Promise<void> =>
      mutate('Não foi possível reabrir a competência', async () => {
        const lock = locks.find((l) => l.month === month);
        if (!lock) throw new Error('Competência não está fechada.');
        if (!reason.trim()) throw new Error('Informe o motivo da reabertura.');
        await reopenMonth(lock, reason.trim());
        setLocks((prev) => prev.filter((l) => l.id !== lock.id));
      }),
    [locks, mutate]
  );

  const loadAudit = useCallback(
    (transactionId: string) => (clientId ? getRepository().listAudit(clientId, { transactionId }) : Promise.resolve([])),
    [clientId]
  );

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
    locks,
    lockedMonths,
    metrics,
    isLoading,
    isSaving,
    error,
    checkImport,
    updateMemos,
    importTransactions,
    classifyTransaction,
    classifyMany,
    splitTransaction,
    unreconcileTransaction,
    approveAutoClassified,
    closeMonth: closeMonthCb,
    reopenMonth: reopenMonthCb,
    loadAudit,
    reconcileTransfers,
    askClient,
    resolveClientQuery,
    reload,
  };
}
