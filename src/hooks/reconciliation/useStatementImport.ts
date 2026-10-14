'use client';

import { useCallback } from 'react';
import { getRepository } from '@/lib/services/data-service';
import { checkStatementBalance } from '@/lib/services/reconciliation-service';
import { ensureBankAccount } from '@/lib/services/accounting-service';
import { getActor } from '@/lib/data/scope';
import type { DateRange } from '@/lib/data/repository';
import { buildTransactionId, findMatchingRule } from '@/lib/reconciliation';
import { newAuditId } from '@/lib/audit';
import { newBatchId } from '@/lib/utils/id';
import { isISODate, isMonthLocked } from '@/lib/periods';
import { accountKeyOf, findCoverageGaps, outOfRangeDates } from '@/lib/statement';
import type { BankTransaction, ImportBatch } from '@/types/firestore';
import {
  describeError,
  type ImportableTransaction,
  type ImportResult,
  type MemoUpdate,
  type PreImportCheck,
  type ReconciliationStore,
  type StatementMeta,
} from '@/hooks/reconciliation/types';

const inRange = (date: string, range: DateRange | null) => !range || (date >= range.start && date <= range.end);
const byDateDesc = (a: BankTransaction, b: BankTransaction) => b.date.localeCompare(a.date);

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

export interface StatementImportActions {
  /** Verifica quais lançamentos do arquivo já existem, sem gravar nada. */
  checkImport: (items: readonly ImportableTransaction[]) => Promise<PreImportCheck>;
  /** Atualiza a descrição de lançamentos já importados (competências fechadas são puladas). */
  updateMemos: (updates: readonly MemoUpdate[], fileName: string) => Promise<{ updated: number; skipped: number }>;
  importTransactions: (items: readonly ImportableTransaction[], meta?: StatementMeta) => Promise<ImportResult>;
}

/** Importação de extratos: deduplicação, auto-classificação e conferência de saldo. */
export function useStatementImport(store: ReconciliationStore): StatementImportActions {
  const { clientId, accounts, accountsById, range, lockedMonths, setTransactions, setRules, setError, mutate } = store;

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
        setError(`Falha ao verificar duplicidade do extrato (${describeError(e)}).`);
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
            setError(`Falha ao comparar as descrições do extrato (${describeError(e)}).`);
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
    [clientId, setError]
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
    [clientId, lockedMonths, mutate, setTransactions]
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
        const batchId = newBatchId();

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
          status: 'COMPLETED',
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
    [clientId, accounts, accountsById, mutate, range, setRules, setTransactions]
  );

  return { checkImport, updateMemos, importTransactions };
}
