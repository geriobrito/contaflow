'use client';

import { useState } from 'react';
import type { BankTransaction, ChartAccount, RuleMatchType } from '@/types/firestore';
import type { ClassifyOptions, UseReconciliationReturn } from '@/hooks/useReconciliation';
import type { PayeeGroup } from '@/lib/payee';
import { isMonthLocked } from '@/lib/periods';
import { ensureTransitAccount } from '@/lib/services/accounting-service';
import type { SplitDraft } from '@/lib/splits';
import type { TransferPair } from '@/lib/transfers';
import type { UndoPlan } from '@/hooks/reconciliation/types';
import type { ToastAction } from '@/components/ui/Toast';

interface ClassificationFlowParams
  extends Pick<
    UseReconciliationReturn,
    | 'classifyTransaction'
    | 'classifyMany'
    | 'splitTransaction'
    | 'unreconcileTransaction'
    | 'approveAutoClassified'
    | 'reconcileTransfers'
    | 'askClient'
    | 'undoChange'
    | 'lockedMonths'
  > {
  clientId: string | null;
  accounts: readonly ChartAccount[];
  /** A conta transitória de transferências foi criada no plano: a tela a acrescenta às contas carregadas. */
  onAccountCreated: (account: ChartAccount) => void;
  /** Aviso no rodapé, com uma ação opcional (o "Desfazer"). */
  notify: (message: string, action?: ToastAction) => void;
}

/**
 * Fluxo de classificação na tela de conciliação: qual lançamento (ou grupo de favorecido)
 * está aberto, quais rateios estão expandidos e o que dizer ao usuário depois de cada ação.
 * Os erros das ações já chegam à tela pelo `error` de `useReconciliation`.
 */
export function useClassificationFlow({
  clientId,
  accounts,
  lockedMonths,
  classifyTransaction,
  classifyMany,
  splitTransaction,
  unreconcileTransaction,
  approveAutoClassified,
  reconcileTransfers,
  askClient,
  undoChange,
  onAccountCreated,
  notify,
}: ClassificationFlowParams) {
  const [selected, setSelected] = useState<BankTransaction | null>(null);
  const [groupSheet, setGroupSheet] = useState<PayeeGroup | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // O lançamento aberto é do cliente anterior: fecha ao trocar.
  const [lastClientId, setLastClientId] = useState(clientId);
  if (lastClientId !== clientId) {
    setLastClientId(clientId);
    setSelected(null);
  }

  /** Desfaz a última ação e avisa quantos lançamentos voltaram. */
  const undo = async (plan: UndoPlan) => {
    try {
      const n = await undoChange(plan);
      notify(n === 1 ? 'Desfeito · o lançamento voltou ao estado anterior' : `Desfeito · ${n} lançamentos voltaram ao estado anterior`);
    } catch {
      /* erro exposto pelo hook */
    }
  };

  /** Aviso da ação com o botão "Desfazer" (quando houve o que desfazer). */
  const offerUndo = (message: string, plan: UndoPlan | null | undefined) => {
    if (!plan?.changes.length) notify(message);
    else notify(message, { label: 'Desfazer', onClick: () => void undo(plan) });
  };

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleConfirm = async (accountId: string, learnRule: boolean, customPattern: string, matchType: RuleMatchType) => {
    if (!selected) return;
    try {
      const { propagated, undo: plan } = await classifyTransaction(selected.id, accountId, {
        learnRule,
        customPattern: customPattern.trim() || undefined,
        matchType,
      });
      setSelected(null);
      const verb = selected.status === 'PENDING' ? 'Conciliado' : 'Classificação atualizada';
      offerUndo(propagated > 0 ? `${verb} · ${propagated} semelhante(s) classificado(s)` : verb, plan);
    } catch {
      /* erro exposto pelo hook */
    }
  };

  const handleSplit = async (drafts: SplitDraft[]) => {
    if (!selected) return;
    try {
      const plan = await splitTransaction(selected.id, drafts);
      setExpanded((prev) => new Set(prev).add(selected.id));
      setSelected(null);
      offerUndo(`Lançamento rateado em ${drafts.length} contas`, plan);
    } catch {
      /* erro exposto pelo hook */
    }
  };

  const handleUnreconcile = async () => {
    if (!selected) return;
    try {
      await unreconcileTransaction(selected.id);
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(selected.id);
        return next;
      });
      setSelected(null);
      notify('Conciliação desfeita · lançamento voltou para Pendente');
    } catch {
      /* erro exposto pelo hook */
    }
  };

  const handleAskClient = async (question: string) => {
    if (!selected) return;
    try {
      await askClient(selected.id, question);
      setSelected(null);
      notify(question.trim() ? 'Pergunta registrada · veja em Pendências do cliente' : 'Pergunta removida');
    } catch {
      /* erro exposto pelo hook */
    }
  };

  const handleApproveAll = async (onlyIds?: ReadonlySet<string>) => {
    try {
      const { approved, undo: plan } = await approveAutoClassified(onlyIds);
      if (approved > 0) offerUndo(`${approved} lançamento(s) aprovado(s)`, plan);
    } catch {
      /* erro exposto pelo hook */
    }
  };

  /** Aprova um auto-classificado (atalho de teclado), se a competência dele estiver aberta. */
  const approveOne = async (t: BankTransaction) => {
    if (t.status === 'AUTO_CLASSIFIED' && t.accountId && !isMonthLocked(t.date, lockedMonths)) {
      try {
        const { undo: plan } = await classifyTransaction(t.id, t.accountId);
        offerUndo('Lançamento auto-classificado aprovado', plan);
      } catch {
        /* erro exposto pelo hook */
      }
    }
  };

  const handleGroupConfirm = async (ids: string[], accountId: string, options: ClassifyOptions) => {
    try {
      const r = await classifyMany(ids, accountId, options);
      setGroupSheet(null);
      const parts = [`${r.classified} lançamento(s) classificado(s)`];
      if (r.rule) parts.push(`regra “${r.rule.pattern}” salva`);
      if (r.propagated > 0) parts.push(`${r.propagated} semelhante(s) em outros lançamentos`);
      if (r.skipped > 0) parts.push(`${r.skipped} ignorado(s) (mês fechado ou transferência)`);
      offerUndo(parts.join(' · '), r.undo);
    } catch {
      /* erro exposto pelo hook */
    }
  };

  /** Concilia pares de transferência na conta transitória, criando-a no plano se faltar. */
  const handleTransfers = async (pairs: readonly TransferPair[]) => {
    if (!clientId) return;
    try {
      const { account, created } = await ensureTransitAccount(clientId, accounts);
      if (created) onAccountCreated(account);
      const n = await reconcileTransfers(pairs, account);
      notify(`${n} transferência(s) conciliada(s) em ${account.code} ${account.name}${created ? ' (conta criada no plano)' : ''}`);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Não foi possível conciliar as transferências');
    }
  };

  return {
    selected,
    openTransaction: setSelected,
    closeTransaction: () => setSelected(null),
    groupSheet,
    openGroup: setGroupSheet,
    closeGroup: () => setGroupSheet(null),
    expanded,
    toggleExpanded,
    handleConfirm,
    handleSplit,
    handleUnreconcile,
    handleAskClient,
    handleApproveAll,
    approveOne,
    handleGroupConfirm,
    handleTransfers,
    offerUndo,
  };
}
