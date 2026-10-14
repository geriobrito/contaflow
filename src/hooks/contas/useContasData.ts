'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BankAccount, ChartAccount, ClassificationRule, ImportBatch, PeriodLock } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { loadLedgerWindow, type LedgerWindow } from '@/lib/services/ledger-loader';
import { applyTextRepair, ensureBankAccount } from '@/lib/services/accounting-service';
import { lastReportedStatement } from '@/lib/bank-accounts';
import { planTextRepair } from '@/lib/text-repair';
import { describeError } from '@/lib/utils/errors';

export interface ContasData {
  accounts: ChartAccount[];
  banks: BankAccount[];
  batches: ImportBatch[];
  /** Lançamentos do período aberto e a movimentação já consolidada (competências fechadas). */
  ledger: LedgerWindow;
  locks: PeriodLock[];
  rules: ClassificationRule[];
}

/**
 * Dados e gravações da tela "Contas e extratos" de uma empresa: contas bancárias, extratos
 * importados, saldos por conta e a correção de acentuação de importações antigas.
 */
export function useContasData(clientId: string | undefined) {
  const [data, setData] = useState<ContasData | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (id: string) => {
    const repo = getRepository();
    const [accounts, banks, batches, locks, rules] = await Promise.all([
      repo.listAccounts(id),
      repo.listBankAccounts(id),
      repo.listImportBatches(id),
      repo.listPeriodLocks(id),
      repo.listRules(id),
    ]);
    // Competências fechadas entram consolidadas; só o período aberto é lido lançamento a
    // lançamento. O consolidado termina antes do saldo mais antigo a conferir com o banco.
    const reported = banks.flatMap((b) => lastReportedStatement(batches, b.accountKey)?.ledgerDate ?? []).sort();
    const ledger = await loadLedgerWindow({ clientId: id, accounts, banks, locks, from: reported[0] });
    setData({ accounts, banks, batches, ledger, locks, rules });
    setLoadedFor(id);
    setError(null);
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    Promise.resolve()
      .then(() => (active ? load(clientId) : undefined))
      .catch((e: unknown) => active && setError(describeError(e)));
    return () => {
      active = false;
    };
  }, [clientId, load]);

  const reload = useCallback(async () => {
    if (clientId) await load(clientId);
  }, [clientId, load]);

  const lockedMonths = useMemo(() => new Set((data?.locks ?? []).map((l) => l.month)), [data]);
  const current = loadedFor === clientId ? data : null;

  /** Contas vistas em extratos antigos que ainda não têm cadastro. */
  const unregistered = useMemo(() => {
    if (!current) return [];
    const known = new Set(current.banks.map((b) => b.accountKey));
    const byKey = new Map<string, ImportBatch>();
    for (const b of current.batches) if (b.accountKey && !known.has(b.accountKey)) byKey.set(b.accountKey, b);
    return [...byKey.values()];
  }, [current]);

  // Históricos de competências já consolidadas não entram: estão fechadas e só seriam
  // corrigidos depois da reabertura, quando voltam a ser lidos.
  const textPlan = useMemo(
    () => (current && clientId ? planTextRepair(current.ledger.transactions, current.rules, clientId, lockedMonths) : null),
    [current, clientId, lockedMonths]
  );

  const unlinkedTx = current ? current.ledger.carriedUnlinked + current.ledger.transactions.filter((t) => !t.accountKey).length : 0;
  const carriedByBank = useMemo(() => new Map((current?.ledger.carriedBanks ?? []).map((b) => [b.accountKey, b.value] as const)), [current]);

  /** Cadastra a conta bancária vista num extrato antigo. Devolve se deu certo (o erro fica em `error`). */
  const register = async (batch: ImportBatch): Promise<boolean> => {
    if (!clientId || !current || !batch.accountKey) return false;
    setBusy(true);
    try {
      await ensureBankAccount({
        clientId,
        accountKey: batch.accountKey,
        account: { bankId: batch.bankId, accountId: batch.accountNumber, org: batch.bankName },
        accounts: current.accounts,
        batches: current.batches,
      });
      await reload();
      return true;
    } catch (e) {
      setError(describeError(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** Corrige a acentuação dos históricos e regras. Devolve o resumo do que foi feito, ou null se falhou. */
  const repairText = async (): Promise<string | null> => {
    if (!clientId || !textPlan) return null;
    setBusy(true);
    setError(null);
    try {
      const done = await applyTextRepair(clientId, textPlan);
      await reload();
      return `Acentuação corrigida · ${done.memos} histórico(s), ${done.rules} regra(s)${done.removedRules ? `, ${done.removedRules} regra(s) duplicada(s) removida(s)` : ''}`;
    } catch (e) {
      setError(`Não foi possível corrigir (${describeError(e)}).`);
      return null;
    } finally {
      setBusy(false);
    }
  };

  return { current, error, busy, lockedMonths, unregistered, textPlan, unlinkedTx, carriedByBank, reload, register, repairText };
}
