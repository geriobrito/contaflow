'use client';

import { useCallback, useEffect, useRef } from 'react';
import { getRepository } from '@/lib/services/data-service';
import { applyRuleToPending } from '@/lib/services/reconciliation-service';
import { partnerResetChange } from '@/lib/services/accounting-service';
import { getActor } from '@/lib/data/scope';
import type { AccountRef } from '@/lib/data/repository';
import { draftsToSplits, summarizeSplits, type SplitDraft } from '@/lib/splits';
import { normalizePattern } from '@/lib/reconciliation';
import { classifyAction, transactionAudit } from '@/lib/audit';
import { newRuleId } from '@/lib/utils/id';
import { formatMonth, isMonthLocked, monthOf } from '@/lib/periods';
import { approveTransition, classifyTransition, queryTransition, resetTransition, restoreTransition, sameClassification, splitTransition, transferTransition } from '@/lib/transitions';
import type { TransferPair } from '@/lib/transfers';
import type { BankTransaction, ChartAccount, ClassificationRule, RuleMatchType } from '@/types/firestore';
import type { ApproveResult, ClassifyManyResult, ClassifyOptions, ClassifyResult, ReconciliationStore, UndoPlan } from '@/hooks/reconciliation/types';

export interface ClassificationActions {
  classifyTransaction: (transactionId: string, accountId: string, options?: ClassifyOptions) => Promise<ClassifyResult>;
  /** Classifica vários lançamentos na mesma conta (ex.: todos de um favorecido), criando uma única regra. */
  classifyMany: (transactionIds: readonly string[], accountId: string, options?: ClassifyOptions) => Promise<ClassifyManyResult>;
  splitTransaction: (transactionId: string, drafts: readonly SplitDraft[]) => Promise<UndoPlan>;
  unreconcileTransaction: (transactionId: string) => Promise<void>;
  approveAutoClassified: () => Promise<ApproveResult>;
  /** Concilia pares de transferência entre contas próprias na conta transitória. */
  reconcileTransfers: (pairs: readonly TransferPair[], transit: ChartAccount) => Promise<number>;
  /** Marca (ou remove, com pergunta vazia) uma pergunta ao cliente sobre o lançamento. */
  askClient: (transactionId: string, question: string) => Promise<void>;
  resolveClientQuery: (transactionId: string) => Promise<void>;
  /** Desfaz a última classificação, rateio ou aprovação (ver UndoPlan). Devolve quantos lançamentos voltaram. */
  undoChange: (plan: UndoPlan) => Promise<number>;
}

/** Semelhantes que a regra auto-classificou estavam pendentes: o estado anterior é o pendente limpo. */
const propagatedChanges = (propagated: readonly BankTransaction[]) => propagated.map((after) => ({ before: resetTransition(after).after, after }));

const ruleUndo = (rule: ClassificationRule | null, existingRule: ClassificationRule | undefined): UndoPlan['rule'] =>
  !rule ? undefined : existingRule ? { kind: 'updated', previous: existingRule } : { kind: 'created', rule };

/**
 * Classificação dos lançamentos carregados: conta única, rateio, transferência, desfazer,
 * aprovação em lote e perguntas ao cliente — sempre com o registro de auditoria junto.
 */
export function useClassification(store: ReconciliationStore): ClassificationActions {
  const { clientId, accountsById, transactions, rules, lockedMonths, setRules, mutate, replaceLoaded } = store;

  // O "Desfazer" é clicado depois de novos renders: confere o lançamento na lista atual, não na
  // capturada quando o aviso foi criado (essa ainda tem o estado de antes da ação).
  const latestTransactions = useRef(transactions);
  useEffect(() => {
    latestTransactions.current = transactions;
  }, [transactions]);

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
        : { id: newRuleId(), clientId, pattern: args.pattern, matchType: args.matchType, ...args.ref, createdAt: args.now, updatedAt: args.now };
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
        const undo: UndoPlan = {
          changes: [{ before: target, after }, ...(partner ? [{ before: partner.before, after: partner.after }] : []), ...propagatedChanges(propagated)],
          rule: ruleUndo(rule, existingRule),
        };
        return { rule, propagated: propagated.length, undo };
      }),
    [clientId, rules, accountsById, lockedMonths, mutate, findLoaded, assertOpen, replaceLoaded, partnerChange, buildLearnedRule, setRules]
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
        if (!targets.length) return { rule: null, propagated: 0, classified: 0, skipped, undo: { changes: [] } };

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
        const undo: UndoPlan = {
          changes: [...moves.map((m) => ({ before: m.tx, after: m.after })), ...propagatedChanges(propagated)],
          rule: ruleUndo(rule, existingRule),
        };
        return { rule, propagated: propagated.length, classified: moves.length, skipped, undo };
      }),
    [clientId, accountsById, lockedMonths, mutate, findLoaded, replaceLoaded, buildLearnedRule, rules, setRules]
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
    (transactionId: string, drafts: readonly SplitDraft[]): Promise<UndoPlan> =>
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
        return { changes: [{ before: target, after }, ...(partner ? [{ before: partner.before, after: partner.after }] : [])] };
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
        const now = new Date().toISOString();
        const { patch, after } = queryTransition(
          target,
          text
            ? {
                question: text,
                status: 'OPEN',
                askedAt: now,
                askedByUid: actor.uid,
                ...(actor.email ? { askedByEmail: actor.email } : {}),
              }
            : undefined
        );
        const audit = transactionAudit('QUERY_ASK', actor, target, after, now, {
          note: text ? `Pergunta enviada ao cliente: “${text}”` : 'Pergunta ao cliente removida',
        });
        await getRepository().commitChanges({ patches: [patch], audits: [audit] });
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
        const actor = getActor();
        const now = new Date().toISOString();
        const { patch, after } = queryTransition(target, { ...target.clientQuery, status: 'RESOLVED', resolvedAt: now });
        const audit = transactionAudit('QUERY_RESOLVE', actor, target, after, now, {
          note: target.clientQuery.question ? `Pendência concluída · Pergunta: “${target.clientQuery.question}”` : 'Pendência concluída',
        });
        await getRepository().commitChanges({ patches: [patch], audits: [audit] });
        replaceLoaded([after]);
      }),
    [mutate, findLoaded, assertOpen, replaceLoaded]
  );

  /* ------------------------------------------------------------------ */
  /* Aprovação em lote dos auto-classificados (competências abertas)     */
  /* ------------------------------------------------------------------ */
  const approveAutoClassified = useCallback(
    (): Promise<ApproveResult> =>
      mutate('Não foi possível aprovar os lançamentos', async () => {
        const eligible = transactions.filter(
          (t) => t.status === 'AUTO_CLASSIFIED' && Boolean(t.accountId) && !isMonthLocked(t.date, lockedMonths)
        );
        if (!eligible.length) return { approved: 0, undo: null };
        const actor = getActor();
        const now = new Date().toISOString();
        const moves = eligible.map((tx) => ({ tx, ...approveTransition(tx, now) }));
        await getRepository().commitChanges({
          patches: moves.map((m) => m.patch),
          audits: moves.map((m) => transactionAudit('APPROVE', actor, m.tx, m.after, now)),
        });
        replaceLoaded(moves.map((m) => m.after));
        return { approved: moves.length, undo: { changes: moves.map((m) => ({ before: m.tx, after: m.after })) } };
      }),
    [transactions, lockedMonths, mutate, replaceLoaded]
  );

  /* ------------------------------------------------------------------ */
  /* Desfazer a última ação (botão do aviso)                              */
  /* ------------------------------------------------------------------ */
  const undoChange = useCallback(
    (plan: UndoPlan): Promise<number> =>
      mutate('Não foi possível desfazer', async () => {
        if (!plan.changes.length) return 0;
        // Os da tela são conferidos no estado atual; os de outros períodos, pelo que a ação gravou.
        const loaded = new Map(latestTransactions.current.map((t) => [t.id, t] as const));
        const moves = plan.changes.map(({ before, after }) => {
          const current = loaded.get(after.id) ?? after;
          if (!sameClassification(current, after)) {
            throw new Error('o lançamento foi alterado depois desta ação; ajuste-o pelo próprio lançamento');
          }
          assertOpen(current);
          return { current, before, ...restoreTransition(current, before) };
        });
        const actor = getActor();
        const now = new Date().toISOString();
        const note = 'Desfeito pelo botão Desfazer: voltou à classificação anterior';
        await getRepository().commitChanges({
          patches: moves.map((m) => m.patch),
          rules: plan.rule?.kind === 'updated' ? [plan.rule.previous] : [],
          deleteRuleIds: plan.rule?.kind === 'created' ? [plan.rule.rule.id] : [],
          audits: moves.map((m) => transactionAudit(m.before.status === 'PENDING' ? 'UNRECONCILE' : 'RECLASSIFY', actor, m.current, m.after, now, { note })),
        });
        replaceLoaded(moves.map((m) => m.after));
        const ruleChange = plan.rule;
        if (ruleChange?.kind === 'created') setRules((prev) => prev.filter((r) => r.id !== ruleChange.rule.id));
        else if (ruleChange?.kind === 'updated') setRules((prev) => prev.map((r) => (r.id === ruleChange.previous.id ? ruleChange.previous : r)));
        return moves.length;
      }),
    [mutate, assertOpen, replaceLoaded, setRules]
  );

  return {
    classifyTransaction,
    classifyMany,
    splitTransaction,
    unreconcileTransaction,
    approveAutoClassified,
    reconcileTransfers,
    askClient,
    resolveClientQuery,
    undoChange,
  };
}
