'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BankTransaction, ChartAccount, ClassificationRule } from '@/types/firestore';
import { getAccounts, getRepository, getRules } from '@/lib/services/data-service';
import { applyRuleToPending, loadRuleSample } from '@/lib/services/reconciliation-service';
import { countAffected, detectRuleConflicts, normalizePattern, pendingWonByRule, ruleKey } from '@/lib/reconciliation';
import { assessRuleTerm, type TermAssessment } from '@/lib/payee';
import { isMonthLocked } from '@/lib/periods';
import { describeError } from '@/lib/utils/errors';

/** Uma linha da tabela de regras, com o que a regra afeta hoje. */
export interface RuleListRow {
  rule: ClassificationRule;
  /** Avaliação do termo (genérico/amplo) contra os lançamentos do cliente. */
  assessment: TermAssessment;
  account: ChartAccount | undefined;
  affected: number;
  /** Pendentes que a regra classificaria agora (casa e vence o conflito). */
  pending: number;
}

/**
 * Regras de aprendizado de uma empresa, com o que a tela precisa para avaliá-las: plano de
 * contas, fechamentos e uma amostra dos lançamentos (pendentes + últimos meses).
 */
export function useRulesData(clientId: string | undefined, search: string) {
  const [rules, setRules] = useState<ClassificationRule[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [lockedMonths, setLockedMonths] = useState<ReadonlySet<string>>(new Set());
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<{ id: string; message: string } | null>(null);

  const apply = useCallback(
    (id: string, [r, a, t, l]: [ClassificationRule[], ChartAccount[], BankTransaction[], { month: string }[]]) => {
      setRules(r);
      setAccounts(a);
      setTransactions(t);
      setLockedMonths(new Set(l.map((x) => x.month)));
      setLoadedFor(id);
    },
    []
  );

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    fetchAll(clientId)
      .then((data) => {
        if (!active) return;
        apply(clientId, data);
        setLoadError(null);
      })
      .catch((e: unknown) => {
        console.error('Erro ao carregar regras:', e);
        if (active) setLoadError({ id: clientId, message: describeError(e) });
      });
    return () => {
      active = false;
    };
  }, [clientId, apply]);

  const reload = useCallback(async () => {
    if (clientId) apply(clientId, await fetchAll(clientId));
  }, [clientId, apply]);

  const loadFailure = loadError && loadError.id === clientId ? loadError.message : null;
  const isLoading = Boolean(clientId) && loadedFor !== clientId && !loadFailure;

  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a] as const)), [accounts]);
  const analytic = useMemo(() => accounts.filter((a) => a.nature === 'ANALYTIC'), [accounts]);
  const rulesById = useMemo(() => new Map(rules.map((r) => [r.id, r] as const)), [rules]);
  const memos = useMemo(() => transactions.map((t) => t.memo), [transactions]);
  const conflicts = useMemo(() => detectRuleConflicts(memos, rules), [memos, rules]);
  const openPending = useMemo(
    () => transactions.filter((t) => t.status === 'PENDING' && !isMonthLocked(t.date, lockedMonths)),
    [transactions, lockedMonths]
  );

  const rows = useMemo((): RuleListRow[] => {
    const term = search.trim().toLowerCase();
    return rules
      .map((rule) => ({
        rule,
        assessment: assessRuleTerm(rule, memos),
        account: accountsById.get(rule.accountId),
        affected: countAffected(rule, transactions),
        pending: pendingWonByRule(openPending, rules, rule).length,
      }))
      .filter(
        ({ rule, account }) =>
          !term ||
          rule.pattern.toLowerCase().includes(term) ||
          (account?.name ?? rule.accountName ?? '').toLowerCase().includes(term) ||
          (account?.code ?? rule.accountCode ?? '').includes(term)
      )
      .sort((a, b) => b.affected - a.affected || a.rule.pattern.localeCompare(b.rule.pattern));
  }, [rules, accountsById, transactions, openPending, search, memos]);

  const isDuplicate = useCallback(
    (key: string, exceptId: string) =>
      rules.some((r) => r.id !== exceptId && ruleKey(r.matchType === 'REGEX' ? r.pattern.trim() : normalizePattern(r.pattern), r.matchType) === key),
    [rules]
  );

  /** Classifica os pendentes já gravados (todos os períodos abertos) que a regra vence. */
  const applyToPending = async (rule: ClassificationRule, pool: readonly ClassificationRule[]): Promise<number> => {
    if (!clientId) return 0;
    const updated = await applyRuleToPending({ clientId, rule, rules: pool, accountsById, lockedMonths });
    return updated.length;
  };

  /** Tira da lista uma regra já excluída do banco (sem recarregar tudo). */
  const dropRule = (ruleId: string) => setRules((prev) => prev.filter((r) => r.id !== ruleId));

  return { rules, analytic, rulesById, memos, conflicts, rows, isLoading, loadFailure, isDuplicate, applyToPending, dropRule, reload };
}

// Os lançamentos são uma amostra (pendentes + últimos meses), não o histórico inteiro.
const fetchAll = (id: string) => Promise.all([getRules(id), getAccounts(id), loadRuleSample(id), getRepository().listPeriodLocks(id)]);
