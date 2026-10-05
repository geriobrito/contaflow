'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Pencil, Plus, Trash2, Wand2, X } from 'lucide-react';
import type { BankTransaction, ChartAccount, ClassificationRule, RuleMatchType } from '@/types/firestore';
import { deleteRule, getAccounts, getRepository, getRules, getTransactions, saveRule } from '@/lib/services/data-service';
import { applyRuleToPending } from '@/lib/services/reconciliation-service';
import { useClient } from '@/contexts/ClientContext';
import {
  MATCH_TYPE_LABEL,
  detectRuleConflicts,
  matchesRule,
  normalizePattern,
  pendingWonByRule,
  type RuleConflict,
} from '@/lib/reconciliation';
import { isMonthLocked } from '@/lib/periods';
import { formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, ConfirmButton, EmptyState, INPUT, PAGE, PageHeader, SearchField, SURFACE } from '@/components/ui/primitives';
import { TermWarning } from '@/components/conciliacao/RuleLearnPanel';
import { assessRuleTerm, type TermAssessment } from '@/lib/payee';

/** Tipos oferecidos na interface (REGEX existente continua funcionando e sendo exibido). */
const MATCH_OPTIONS: readonly RuleMatchType[] = ['CONTAINS', 'STARTS_WITH', 'EXACT'];

/** Lançamentos afetados: vinculados à regra ou cujo histórico casa com ela. */
function countAffected(rule: ClassificationRule, transactions: readonly BankTransaction[]): number {
  return transactions.filter((t) => t.matchedRuleId === rule.id || matchesRule(t.memo, rule)).length;
}

const ruleKey = (pattern: string, type: RuleMatchType | undefined) => `${type ?? 'CONTAINS'}:${pattern}`;

function MatchTypeSelect({ value, onChange, className = '' }: { value: RuleMatchType; onChange: (v: RuleMatchType) => void; className?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as RuleMatchType)}
      aria-label="Tipo de comparação"
      className={`${INPUT} ${className}`}
    >
      {(MATCH_OPTIONS.includes(value) ? MATCH_OPTIONS : [...MATCH_OPTIONS, value]).map((t) => (
        <option key={t} value={t}>
          {MATCH_TYPE_LABEL[t]}
        </option>
      ))}
    </select>
  );
}

/* =========================================================================
   Linha editável
   ========================================================================= */

interface RuleRowProps {
  rule: ClassificationRule;
  account: ChartAccount | undefined;
  affected: number;
  /** Pendentes que esta regra classificaria agora (casa e vence o conflito). */
  pending: number;
  conflicts: readonly RuleConflict[];
  rulesById: ReadonlyMap<string, ClassificationRule>;
  /** Avaliação do termo atual da regra (genérico/amplo) contra os lançamentos do cliente. */
  assessment: TermAssessment;
  /** Descrições dos lançamentos do cliente, para avaliar o termo em edição. */
  memos: readonly string[];
  isDuplicate: (key: string, exceptId: string) => boolean;
  onSave: (rule: ClassificationRule, pattern: string, matchType: RuleMatchType) => Promise<void>;
  onDelete: (rule: ClassificationRule) => Promise<void>;
  onApply: (rule: ClassificationRule) => Promise<void>;
  applying: boolean;
}

function RuleRow({ rule, account, affected, pending, conflicts, rulesById, assessment, memos, isDuplicate, onSave, onDelete, onApply, applying }: RuleRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rule.pattern);
  const [draftType, setDraftType] = useState<RuleMatchType>(rule.matchType ?? 'CONTAINS');

  const normalized = draftType === 'REGEX' ? draft.trim() : normalizePattern(draft);
  const draftAssessment = useMemo(
    () => (editing ? assessRuleTerm({ pattern: normalized, matchType: draftType }, memos) : assessment),
    [editing, normalized, draftType, memos, assessment]
  );
  const [ackKey, setAckKey] = useState('');
  const draftKey = `${draftType}|${normalized}`;
  const acknowledged = ackKey === draftKey;
  // Editar para um termo genérico exige "Criar mesmo assim"; manter o termo atual não.
  const needsAck = draftAssessment.level === 'generic' && draftKey !== `${rule.matchType ?? 'CONTAINS'}|${rule.pattern}` && !acknowledged;
  const error = !normalized
    ? 'Informe um termo.'
    : isDuplicate(ruleKey(normalized, draftType), rule.id)
      ? 'Já existe regra com esse termo e tipo.'
      : needsAck
        ? 'Termo genérico: marque “Criar mesmo assim” para salvar.'
        : null;

  const cancel = () => {
    setDraft(rule.pattern);
    setDraftType(rule.matchType ?? 'CONTAINS');
    setEditing(false);
  };

  const commit = async () => {
    if (error) return;
    try {
      await onSave(rule, normalized, draftType);
      setEditing(false);
    } catch {
      /* mensagem exibida pela página; mantém a edição aberta para nova tentativa */
    }
  };

  return (
    <tr className="group border-b border-black/[0.04] dark:border-white/[0.05] last:border-0">
      <td className="pl-5 pr-3 py-3 align-middle">
        {editing ? (
          <div className="space-y-1">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commit();
                if (e.key === 'Escape') cancel();
              }}
              aria-invalid={Boolean(error)}
              className={`${INPUT} h-9 font-mono text-[13px]`}
            />
            <MatchTypeSelect value={draftType} onChange={setDraftType} className="h-9 text-[12px]" />
            <TermWarning
              assessment={draftAssessment}
              acknowledged={acknowledged}
              onAcknowledged={(v) => setAckKey(v ? draftKey : '')}
              className="mt-1"
            />
            {error && !needsAck && <p className="text-[11px] text-rose-600">{error}</p>}
          </div>
        ) : (
          <div className="min-w-0 space-y-1">
            <span className="block text-[10px] uppercase tracking-wider text-stone-400">{MATCH_TYPE_LABEL[rule.matchType ?? 'CONTAINS']}</span>
            <span title={rule.pattern} className="inline-block max-w-full px-2.5 py-1 rounded-full bg-stone-900/[0.05] dark:bg-white/[0.08] border border-black/[0.04] font-mono text-[12px] text-stone-800 dark:text-stone-200 truncate">
              {rule.pattern}
            </span>
            {assessment.level !== 'ok' && (
              <p
                title={assessment.reasons.join('\n')}
                className={`flex items-start gap-1 text-[11px] leading-snug ${
                  assessment.level === 'generic' ? 'text-rose-700 dark:text-rose-400' : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                <AlertTriangle className="w-3 h-3 mt-px shrink-0" />
                <span>
                  {assessment.level === 'generic' ? 'Termo genérico' : 'Termo amplo'}
                  {assessment.matchCount > 0 && ` · casa com ${assessment.matchCount} lançamento(s) de ${assessment.payeeCount} favorecido(s)`}
                </span>
              </p>
            )}
            {conflicts.map((c) => {
              const winner = rulesById.get(c.winnerId);
              return (
                <p
                  key={c.winnerId}
                  title={`Históricos em disputa:\n${c.memos.join('\n')}`}
                  className="flex items-start gap-1 text-[11px] leading-snug text-amber-700 dark:text-amber-400"
                >
                  <AlertTriangle className="w-3 h-3 mt-px shrink-0" />
                  <span>
                    Perde para “{winner?.pattern ?? c.winnerId}” ({winner?.accountName ?? 'outra conta'}) em {c.count} histórico(s)
                  </span>
                </p>
              );
            })}
          </div>
        )}
      </td>
      <td className="px-3 py-3 max-w-0 w-full">
        <p className="text-[13px] text-stone-800 dark:text-stone-200 truncate">
          <span className="font-mono tabular-nums text-[12px] text-stone-400 mr-1.5">{account?.code ?? rule.accountCode ?? '—'}</span>
          {account?.name ?? rule.accountName ?? 'Conta removida'}
        </p>
      </td>
      <td className="px-3 py-3 hidden md:table-cell font-mono tabular-nums text-[12px] text-stone-400 whitespace-nowrap">
        {rule.createdAt ? formatDateBR(rule.createdAt.slice(0, 10)) : '—'}
      </td>
      <td className="px-3 py-3 text-right font-mono tabular-nums text-[13px] text-stone-600 dark:text-stone-400 whitespace-nowrap">
        {affected}
        {pending > 0 && !editing && (
          <button
            type="button"
            disabled={applying}
            onClick={() => void onApply(rule)}
            title="Classificar agora os lançamentos pendentes que esta regra vence (todos os períodos abertos)"
            className="ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-sans text-[11px] font-medium text-[#0071E3] bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 disabled:opacity-40 active:scale-[0.96] transition-all duration-150"
          >
            <Wand2 className="w-3 h-3" />
            {applying ? 'Aplicando…' : `Aplicar a ${pending}`}
          </button>
        )}
      </td>
      <td className="pl-3 pr-4 py-3">
        <div className="flex items-center justify-end gap-1">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => void commit()}
                disabled={Boolean(error)}
                aria-label="Salvar termo"
                className="w-8 h-8 rounded-full flex items-center justify-center bg-[#0071E3] text-white disabled:opacity-40 active:scale-[0.94] transition-all duration-150"
              >
                <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
              </button>
              <button
                type="button"
                onClick={cancel}
                aria-label="Cancelar edição"
                className="w-8 h-8 rounded-full flex items-center justify-center text-stone-400 hover:bg-black/[0.05] active:scale-[0.94] transition-all duration-150"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label={`Editar termo ${rule.pattern}`}
                className="w-8 h-8 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-800 hover:bg-black/[0.05] sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 active:scale-[0.94] transition-all duration-150"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <ConfirmButton
                ariaLabel={`Excluir regra ${rule.pattern}`}
                label={<Trash2 className="w-3.5 h-3.5" />}
                confirmLabel="Excluir"
                onConfirm={() => onDelete(rule)}
              />
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

/* =========================================================================
   Página
   ========================================================================= */

export default function RegrasPage() {
  const { currentClient } = useClient();
  const clientId = currentClient?.id;

  const [rules, setRules] = useState<ClassificationRule[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [lockedMonths, setLockedMonths] = useState<ReadonlySet<string>>(new Set());
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [newPattern, setNewPattern] = useState('');
  const [newAccountId, setNewAccountId] = useState('');
  const [newType, setNewType] = useState<RuleMatchType>('CONTAINS');
  const [notice, setNotice] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

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
  const fetchAll = (id: string) =>
    Promise.all([getRules(id), getAccounts(id), getTransactions(id), getRepository().listPeriodLocks(id)]);
  const load = async (id: string) => apply(id, await fetchAll(id));

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    fetchAll(clientId)
      .then((data) => active && apply(clientId, data))
      .catch((e) => console.error('Erro ao carregar regras:', e));
    return () => {
      active = false;
    };
  }, [clientId, apply]);

  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a] as const)), [accounts]);
  const analytic = useMemo(() => accounts.filter((a) => a.nature === 'ANALYTIC'), [accounts]);

  const rulesById = useMemo(() => new Map(rules.map((r) => [r.id, r] as const)), [rules]);
  const conflicts = useMemo(() => detectRuleConflicts(transactions.map((t) => t.memo), rules), [transactions, rules]);
  const openPending = useMemo(
    () => transactions.filter((t) => t.status === 'PENDING' && !isMonthLocked(t.date, lockedMonths)),
    [transactions, lockedMonths]
  );
  const conflictCount = conflicts.size;

  const memos = useMemo(() => transactions.map((t) => t.memo), [transactions]);

  // Termo da nova regra: avisa se é genérico ("enviado") ou casa com muitos favorecidos.
  const newTerm = newType === 'REGEX' ? newPattern.trim() : normalizePattern(newPattern);
  const newAssessment = useMemo(
    () => (newTerm ? assessRuleTerm({ pattern: newTerm, matchType: newType }, memos) : null),
    [newTerm, newType, memos]
  );
  const [newAckKey, setNewAckKey] = useState('');
  const newKey = `${newType}|${newTerm}`;
  const newBlocked = newAssessment?.level === 'generic' && newAckKey !== newKey;

  const rows = useMemo(() => {
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

  const handleApply = async (rule: ClassificationRule) => {
    setActionError(null);
    setNotice(null);
    setApplyingId(rule.id);
    try {
      const n = await applyToPending(rule, rules);
      setNotice(`“${rule.pattern}” classificou ${n} lançamento(s) pendente(s).`);
      if (clientId) await load(clientId);
    } catch (e: unknown) {
      setActionError(`Não foi possível aplicar a regra “${rule.pattern}” (${e instanceof Error ? e.message : 'erro desconhecido'}).`);
    } finally {
      setApplyingId(null);
    }
  };

  const isLoading = Boolean(clientId) && loadedFor !== clientId;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId) return;
    const pattern = normalizePattern(newPattern);
    const account = accountsById.get(newAccountId);
    if (!pattern || !account) {
      setAddError('Informe o termo e a conta de destino.');
      return;
    }
    if (newBlocked) {
      setAddError('Termo genérico: marque “Criar mesmo assim” para salvar.');
      return;
    }
    if (isDuplicate(ruleKey(pattern, newType), '')) {
      setAddError('Já existe uma regra com esse termo e tipo.');
      return;
    }
    setAdding(true);
    setAddError(null);
    setNotice(null);
    const now = new Date().toISOString();
    const rule: ClassificationRule = {
      id: `rule-${Date.parse(now)}`,
      clientId,
      pattern,
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name,
      matchType: newType,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await saveRule(rule);
      setNewPattern('');
      // Regra nova vale também para o que já está no banco, não só para as próximas importações.
      try {
        const n = await applyToPending(rule, [...rules, rule]);
        setNotice(n > 0 ? `Regra criada e aplicada a ${n} lançamento(s) pendente(s).` : 'Regra criada. Nenhum pendente em período aberto casou com ela.');
      } catch (e: unknown) {
        setActionError(`Regra criada, mas não foi possível aplicá-la aos pendentes (${e instanceof Error ? e.message : 'erro desconhecido'}).`);
      }
      await load(clientId);
    } catch (e: unknown) {
      setAddError(`Não foi possível salvar a regra (${e instanceof Error ? e.message : 'erro desconhecido'}).`);
    } finally {
      setAdding(false);
    }
  };

  const [actionError, setActionError] = useState<string | null>(null);

  /** Propaga ao RuleRow (que mantém o modo de edição aberto) e informa o usuário. */
  const handleSave = async (rule: ClassificationRule, pattern: string, matchType: RuleMatchType) => {
    setActionError(null);
    try {
      await saveRule({ ...rule, pattern, matchType, updatedAt: new Date().toISOString() });
      if (clientId) await load(clientId);
    } catch (e: unknown) {
      setActionError(`Não foi possível atualizar a regra “${rule.pattern}” (${e instanceof Error ? e.message : 'erro desconhecido'}).`);
      throw e;
    }
  };

  const handleDelete = async (rule: ClassificationRule) => {
    setActionError(null);
    try {
      await deleteRule(rule.id);
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
    } catch (e: unknown) {
      setActionError(`Não foi possível excluir a regra “${rule.pattern}” (${e instanceof Error ? e.message : 'erro desconhecido'}).`);
    }
  };

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.name}
        title="Regras de aprendizado"
        description={
          <>
            Termos memorizados que classificam lançamentos automaticamente. Quando duas regras casam o mesmo histórico, vence a
            mais restritiva (exato › começa com › contém), depois o termo mais longo e, por fim, a mais recente.{' '}
            <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{rules.length}</span> regra(s) ativa(s)
            {conflictCount > 0 && <span className="text-amber-700 dark:text-amber-400"> · {conflictCount} com conflito</span>}.
          </>
        }
      />

      {/* Adição rápida */}
      <form onSubmit={handleAdd} className={`${SURFACE} rounded-[22px] p-4 sm:p-5 space-y-3`}>
        <p className="text-[13px] font-medium text-stone-700 dark:text-stone-300">Nova regra</p>
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,3fr)_auto] gap-2.5">
          <MatchTypeSelect value={newType} onChange={setNewType} />
          <input
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            placeholder="Termo, ex.: uber"
            aria-label="Termo"
            className={`${INPUT} font-mono text-[13px]`}
          />
          <select
            value={newAccountId}
            onChange={(e) => setNewAccountId(e.target.value)}
            aria-label="Conta de destino"
            className={`${INPUT} min-w-0 ${newAccountId ? '' : 'text-stone-400'}`}
          >
            <option value="">Conta de destino…</option>
            {analytic.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
          <button type="submit" disabled={adding || !clientId} className={`${BUTTON.primary} h-11 md:px-5`}>
            <Plus className="w-4 h-4" strokeWidth={2} />
            {adding ? 'Adicionando…' : 'Adicionar'}
          </button>
        </div>
        {newAssessment && (
          <TermWarning
            assessment={newAssessment}
            acknowledged={newAckKey === newKey}
            onAcknowledged={(v) => setNewAckKey(v ? newKey : '')}
            className="mt-0"
          />
        )}
        {addError && <p className="text-[12px] text-rose-600 animate-fade-in">{addError}</p>}
        {notice && (
          <p role="status" className="text-[12px] text-emerald-700 animate-fade-in">
            {notice}
          </p>
        )}
      </form>

      <SearchField value={search} onChange={setSearch} placeholder="Buscar por termo ou conta" />
      {actionError && (
        <p role="alert" className="-mt-4 px-1 text-[13px] text-rose-600 animate-fade-in">
          {actionError}
        </p>
      )}

      <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
        {isLoading ? (
          <div className="p-5 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-4 rounded bg-black/[0.05] animate-pulse" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={rules.length === 0 ? 'Nenhuma regra ainda' : 'Nenhuma regra encontrada'}
            description={
              rules.length === 0
                ? 'Adicione acima ou marque “Lembrar essa classificação” ao conciliar um lançamento.'
                : `Nada corresponde a “${search}”.`
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-stone-400 border-b border-black/[0.04] dark:border-white/[0.06]">
                  <th scope="col" className="font-medium pl-5 pr-3 py-2.5 w-[34%]">Termo</th>
                  <th scope="col" className="font-medium px-3 py-2.5">Conta de destino</th>
                  <th scope="col" className="font-medium px-3 py-2.5 hidden md:table-cell w-32">Criada em</th>
                  <th scope="col" className="font-medium px-3 py-2.5 text-right w-44 whitespace-nowrap">Lançamentos afetados</th>
                  <th scope="col" className="pl-3 pr-4 py-2.5 w-24">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ rule, account, affected, pending, assessment }) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    assessment={assessment}
                    memos={memos}
                    account={account}
                    affected={affected}
                    pending={pending}
                    conflicts={conflicts.get(rule.id) ?? []}
                    rulesById={rulesById}
                    onApply={handleApply}
                    applying={applyingId === rule.id}
                    isDuplicate={isDuplicate}
                    onSave={handleSave}
                    onDelete={handleDelete}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
