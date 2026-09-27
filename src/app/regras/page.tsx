'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { BankTransaction, ChartAccount, ClassificationRule } from '@/types/firestore';
import { deleteRule, getAccounts, getRules, getTransactions, saveRule } from '@/lib/services/data-service';
import { useClient } from '@/contexts/ClientContext';
import { normalizePattern } from '@/hooks/useReconciliation';
import { formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, ConfirmButton, EmptyState, INPUT, PageHeader, SearchField, SURFACE } from '@/components/ui/primitives';

/** Lançamentos afetados: vinculados à regra ou cujo histórico contém o padrão. */
function countAffected(rule: ClassificationRule, transactions: readonly BankTransaction[]): number {
  const pattern = normalizePattern(rule.pattern);
  if (!pattern) return 0;
  return transactions.filter((t) => t.matchedRuleId === rule.id || normalizePattern(t.memo).includes(pattern)).length;
}

/* =========================================================================
   Linha editável
   ========================================================================= */

interface RuleRowProps {
  rule: ClassificationRule;
  account: ChartAccount | undefined;
  affected: number;
  isDuplicate: (pattern: string, exceptId: string) => boolean;
  onSave: (rule: ClassificationRule, pattern: string) => Promise<void>;
  onDelete: (rule: ClassificationRule) => Promise<void>;
}

function RuleRow({ rule, account, affected, isDuplicate, onSave, onDelete }: RuleRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rule.pattern);

  const normalized = normalizePattern(draft);
  const error = !normalized ? 'Informe um termo.' : isDuplicate(normalized, rule.id) ? 'Termo já cadastrado.' : null;

  const commit = async () => {
    if (error) return;
    await onSave(rule, normalized);
    setEditing(false);
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
                if (e.key === 'Escape') {
                  setDraft(rule.pattern);
                  setEditing(false);
                }
              }}
              aria-invalid={Boolean(error)}
              className={`${INPUT} h-9 font-mono text-[13px]`}
            />
            {error && <p className="text-[11px] text-rose-600">{error}</p>}
          </div>
        ) : (
          <span className="inline-flex max-w-full px-2.5 py-1 rounded-full bg-stone-900/[0.05] dark:bg-white/[0.08] border border-black/[0.04] font-mono text-[12px] text-stone-800 dark:text-stone-200 truncate">
            {rule.pattern}
          </span>
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
                onClick={() => {
                  setDraft(rule.pattern);
                  setEditing(false);
                }}
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
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [newPattern, setNewPattern] = useState('');
  const [newAccountId, setNewAccountId] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const apply = useCallback(
    (id: string, [r, a, t]: [ClassificationRule[], ChartAccount[], BankTransaction[]]) => {
      setRules(r);
      setAccounts(a);
      setTransactions(t);
      setLoadedFor(id);
    },
    []
  );
  const fetchAll = (id: string) => Promise.all([getRules(id), getAccounts(id), getTransactions(id)]);
  const load = async (id: string) => apply(id, await fetchAll(id));

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    Promise.all([getRules(clientId), getAccounts(clientId), getTransactions(clientId)])
      .then((data) => active && apply(clientId, data))
      .catch((e) => console.error('Erro ao carregar regras:', e));
    return () => {
      active = false;
    };
  }, [clientId, apply]);

  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a] as const)), [accounts]);
  const analytic = useMemo(() => accounts.filter((a) => a.nature === 'ANALYTIC'), [accounts]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rules
      .map((rule) => ({ rule, account: accountsById.get(rule.accountId), affected: countAffected(rule, transactions) }))
      .filter(
        ({ rule, account }) =>
          !term ||
          rule.pattern.toLowerCase().includes(term) ||
          (account?.name ?? rule.accountName ?? '').toLowerCase().includes(term) ||
          (account?.code ?? rule.accountCode ?? '').includes(term)
      )
      .sort((a, b) => b.affected - a.affected || a.rule.pattern.localeCompare(b.rule.pattern));
  }, [rules, accountsById, transactions, search]);

  const isDuplicate = useCallback(
    (pattern: string, exceptId: string) => rules.some((r) => r.id !== exceptId && normalizePattern(r.pattern) === pattern),
    [rules]
  );

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
    if (isDuplicate(pattern, '')) {
      setAddError('Já existe uma regra com esse termo.');
      return;
    }
    setAdding(true);
    setAddError(null);
    const now = new Date().toISOString();
    try {
      await saveRule({
        id: `rule-${Date.now()}`,
        clientId,
        pattern,
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        matchType: 'CONTAINS',
        createdAt: now,
        updatedAt: now,
      });
      setNewPattern('');
      await load(clientId);
    } finally {
      setAdding(false);
    }
  };

  const handleSave = async (rule: ClassificationRule, pattern: string) => {
    await saveRule({ ...rule, pattern, updatedAt: new Date().toISOString() });
    if (clientId) await load(clientId);
  };

  const handleDelete = async (rule: ClassificationRule) => {
    await deleteRule(rule.id);
    setRules((prev) => prev.filter((r) => r.id !== rule.id));
  };

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-8 py-8 sm:py-12 space-y-8">
      <PageHeader
        eyebrow={currentClient?.name}
        title="Regras de aprendizado"
        description={
          <>
            Termos memorizados que classificam lançamentos automaticamente na importação.{' '}
            <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{rules.length}</span> regra(s) ativa(s).
          </>
        }
      />

      {/* Adição rápida */}
      <form onSubmit={handleAdd} className={`${SURFACE} rounded-[22px] p-4 sm:p-5 space-y-3`}>
        <p className="text-[13px] font-medium text-stone-700 dark:text-stone-300">Nova regra</p>
        <div className="flex flex-col md:flex-row gap-2.5">
          <input
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            placeholder="Termo, ex.: uber"
            aria-label="Termo"
            className={`${INPUT} md:w-64 font-mono text-[13px]`}
          />
          <select
            value={newAccountId}
            onChange={(e) => setNewAccountId(e.target.value)}
            aria-label="Conta de destino"
            className={`${INPUT} flex-1 min-w-0 ${newAccountId ? '' : 'text-stone-400'}`}
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
        {addError && <p className="text-[12px] text-rose-600 animate-fade-in">{addError}</p>}
      </form>

      <SearchField value={search} onChange={setSearch} placeholder="Buscar por termo ou conta" />

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
                  <th scope="col" className="font-medium pl-5 pr-3 py-2.5 w-56">Termo</th>
                  <th scope="col" className="font-medium px-3 py-2.5">Conta de destino</th>
                  <th scope="col" className="font-medium px-3 py-2.5 hidden md:table-cell w-28">Criada em</th>
                  <th scope="col" className="font-medium px-3 py-2.5 text-right w-24">Afetados</th>
                  <th scope="col" className="pl-3 pr-4 py-2.5 w-24">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ rule, account, affected }) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    account={account}
                    affected={affected}
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
