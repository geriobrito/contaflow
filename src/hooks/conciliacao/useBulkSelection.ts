'use client';

import { useCallback, useMemo, useState } from 'react';
import type { BankTransaction } from '@/types/firestore';
import type { ClassifyOptions, UseReconciliationReturn } from '@/hooks/useReconciliation';
import type { TransferPair } from '@/lib/transfers';

interface BulkSelectionParams extends Pick<UseReconciliationReturn, 'classifyMany' | 'askClient'> {
  transactions: readonly BankTransaction[];
  /** Linhas da página visível ("selecionar todos" vale para elas). */
  pageRows: readonly BankTransaction[];
  /** Concilia pares de transferência (cria a conta transitória se faltar). */
  reconcileTransferPairs: (pairs: readonly TransferPair[]) => Promise<void>;
  notify: (message: string) => void;
}

/**
 * Seleção múltipla e ações em lote da tabela de conciliação: classificar vários, perguntar
 * ao cliente sobre vários e casar dois lançamentos como transferência entre contas próprias.
 */
export function useBulkSelection({ transactions, pageRows, classifyMany, askClient, reconcileTransferPairs, notify }: BulkSelectionParams) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [showBulkClassify, setShowBulkClassify] = useState(false);
  const [showBulkAsk, setShowBulkAsk] = useState(false);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAllPage = useCallback(() => {
    setSelectedIds((prev) => {
      const allSelected = pageRows.length > 0 && pageRows.every((t) => prev.has(t.id));
      const next = new Set(prev);
      if (allSelected) {
        pageRows.forEach((t) => next.delete(t.id));
      } else {
        pageRows.forEach((t) => next.add(t.id));
      }
      return next;
    });
  }, [pageRows]);

  const selectedTransactions = useMemo(() => transactions.filter((t) => selectedIds.has(t.id)), [transactions, selectedIds]);

  const selectedDebits = useMemo(
    () => selectedTransactions.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0),
    [selectedTransactions]
  );
  const selectedCredits = useMemo(
    () => selectedTransactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0),
    [selectedTransactions]
  );

  /** Exatamente dois lançamentos, uma saída e uma entrada de mesmo valor. */
  const canMatchTransfer = useMemo(() => {
    if (selectedTransactions.length !== 2) return false;
    const [a, b] = selectedTransactions;
    return (
      ((a.amount < 0 && b.amount > 0) || (a.amount > 0 && b.amount < 0)) &&
      Math.abs(Math.abs(a.amount) - Math.abs(b.amount)) < 0.01
    );
  }, [selectedTransactions]);

  const handleBulkTransfer = async () => {
    if (!canMatchTransfer || selectedTransactions.length !== 2) return;
    const [a, b] = selectedTransactions;
    const out = a.amount < 0 ? a : b;
    const inTx = a.amount > 0 ? a : b;
    await reconcileTransferPairs([{ out, in: inTx, days: 0, hinted: true }]);
    setSelectedIds(new Set());
  };

  const handleConfirmBulkClassify = async (ids: string[], accountId: string, options: ClassifyOptions) => {
    try {
      const r = await classifyMany(ids, accountId, options);
      setShowBulkClassify(false);
      setSelectedIds(new Set());
      const parts = [`${r.classified} lançamento(s) classificado(s)`];
      if (r.rule) parts.push(`regra “${r.rule.pattern}” salva`);
      if (r.propagated > 0) parts.push(`${r.propagated} semelhante(s) em outros lançamentos`);
      if (r.skipped > 0) parts.push(`${r.skipped} ignorado(s)`);
      notify(parts.join(' · '));
    } catch {
      /* erro exposto pelo hook */
    }
  };

  const handleConfirmBulkAsk = async (question: string) => {
    try {
      let count = 0;
      for (const t of selectedTransactions) {
        if (t.status === 'PENDING') {
          await askClient(t.id, question);
          count++;
        }
      }
      setShowBulkAsk(false);
      setSelectedIds(new Set());
      notify(`Pergunta enviada ao cliente para ${count} lançamento(s)`);
    } catch {
      /* erro exposto pelo hook */
    }
  };

  return {
    selectedIds,
    toggleSelect,
    toggleSelectAllPage,
    clearSelection,
    selectedTransactions,
    selectedDebits,
    selectedCredits,
    canMatchTransfer,
    showBulkClassify,
    setShowBulkClassify,
    showBulkAsk,
    setShowBulkAsk,
    handleBulkTransfer,
    handleConfirmBulkClassify,
    handleConfirmBulkAsk,
  };
}
