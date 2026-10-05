'use client';

import React, { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronRight } from 'lucide-react';
import type { BankTransaction, ChartAccount, RuleMatchType } from '@/types/firestore';
import type { ClassifyOptions } from '@/hooks/useReconciliation';
import { assessRuleTerm, type PayeeGroup } from '@/lib/payee';
import { matchesRule } from '@/lib/reconciliation';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, EmptyState, SearchField, Sheet } from '@/components/ui/primitives';
import { AccountPicker } from '@/components/conciliacao/AccountPicker';
import { RuleLearnPanel } from '@/components/conciliacao/RuleLearnPanel';

/* =========================================================================
   Lista de favorecidos com lançamentos pendentes
   ========================================================================= */

interface PayeeGroupListProps {
  groups: readonly PayeeGroup[];
  onOpen: (group: PayeeGroup) => void;
}

export function PayeeGroupList({ groups, onOpen }: PayeeGroupListProps) {
  const [search, setSearch] = useState('');
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? groups.filter((g) => g.label.toLowerCase().includes(term)) : groups;
  }, [groups, search]);
  const pending = groups.reduce((s, g) => s + g.transactions.length, 0);

  if (groups.length === 0) {
    return <EmptyState title="Nada pendente neste período" description="Todos os lançamentos já foram classificados ou estão em competência fechada." />;
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-3 border-b border-black/[0.04] dark:border-white/[0.06]">
        <p className="flex-1 text-[13px] text-stone-500">
          <span className="font-mono tabular-nums text-stone-800 dark:text-stone-200">{pending}</span> lançamento(s) pendente(s) em{' '}
          <span className="font-mono tabular-nums text-stone-800 dark:text-stone-200">{groups.length}</span> favorecido(s). Classifique um grupo de uma vez.
        </p>
        <SearchField value={search} onChange={setSearch} placeholder="Buscar favorecido" className="sm:w-64" />
      </div>
      <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
        {visible.map((g) => {
          const dates = g.transactions.map((t) => t.date).sort();
          const incoming = g.direction === 'IN';
          return (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => onOpen(g)}
                className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.03] focus:outline-none focus-visible:bg-blue-50/50 transition-colors"
              >
                <span
                  className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center ${
                    incoming ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15' : 'bg-stone-100 text-stone-500 dark:bg-stone-800'
                  }`}
                  title={incoming ? 'Entrada' : 'Saída'}
                >
                  {incoming ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[14px] font-medium tracking-tight text-stone-900 dark:text-stone-100">{g.label}</span>
                  <span className="block text-[12px] text-stone-500">
                    {g.transactions.length === 1 ? '1 lançamento' : `${g.transactions.length} lançamentos`} ·{' '}
                    <span className="font-mono tabular-nums">
                      {formatDateBR(dates[0])}
                      {dates[0] !== dates[dates.length - 1] && ` a ${formatDateBR(dates[dates.length - 1])}`}
                    </span>
                  </span>
                </span>
                <span className={`font-mono tabular-nums text-[14px] whitespace-nowrap ${incoming ? 'text-emerald-600 dark:text-emerald-400' : 'text-stone-900 dark:text-stone-100'}`}>
                  {formatCurrency(g.total)}
                </span>
                <ChevronRight className="w-4 h-4 shrink-0 text-stone-300" />
              </button>
            </li>
          );
        })}
        {visible.length === 0 && <li className="px-5 py-8 text-center text-[13px] text-stone-400">Nenhum favorecido corresponde a “{search}”.</li>}
      </ul>
    </div>
  );
}

/* =========================================================================
   Classificação do grupo
   ========================================================================= */

interface GroupClassifySheetProps {
  group: PayeeGroup;
  accounts: readonly ChartAccount[];
  /** Todos os lançamentos carregados: avaliam o termo e mostram o efeito da regra. */
  pool: readonly BankTransaction[];
  isSaving: boolean;
  onClose: () => void;
  onConfirm: (transactionIds: string[], accountId: string, options: ClassifyOptions) => Promise<void>;
}

export function GroupClassifySheet({ group, accounts, pool, isSaving, onClose, onConfirm }: GroupClassifySheetProps) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(group.transactions.map((t) => t.id)));
  const [accountId, setAccountId] = useState('');
  const [learn, setLearn] = useState(true);
  const [term, setTerm] = useState(group.term);
  const [matchType, setMatchType] = useState<RuleMatchType>('CONTAINS');
  const [acknowledged, setAcknowledged] = useState(false);

  const memos = useMemo(() => pool.map((t) => t.memo), [pool]);
  const assessment = useMemo(() => assessRuleTerm({ pattern: term, matchType }, memos), [term, matchType, memos]);
  const ruleBlocked = learn && assessment.level === 'generic' && !acknowledged;

  // A regra não distingue entrada de saída: avisa quando casaria também o sentido oposto.
  const groupIds = useMemo(() => new Set(group.transactions.map((t) => t.id)), [group]);
  const opposite = useMemo(() => {
    if (!learn || !term.trim()) return 0;
    return pool.filter(
      (t) => !groupIds.has(t.id) && t.status === 'PENDING' && (t.amount < 0 ? 'OUT' : 'IN') !== group.direction && matchesRule(t.memo, { pattern: term, matchType })
    ).length;
  }, [pool, groupIds, learn, term, matchType, group.direction]);

  const selectedTotal = group.transactions.filter((t) => picked.has(t.id)).reduce((s, t) => s + t.amount, 0);
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allPicked = picked.size === group.transactions.length;
  const can = Boolean(accountId) && picked.size > 0 && !ruleBlocked && !isSaving;
  const n = picked.size;

  return (
    <Sheet
      title={group.label}
      subtitle={`${group.direction === 'IN' ? 'Entradas' : 'Saídas'} · ${group.transactions.length} lançamento(s) pendente(s)`}
      onClose={onClose}
      side="right"
      footer={
        <button
          type="button"
          disabled={!can}
          onClick={() =>
            void onConfirm([...picked], accountId, {
              learnRule: learn && term.trim().length > 0,
              customPattern: term,
              matchType,
            })
          }
          className={`${BUTTON.accent} w-full h-12 rounded-2xl text-[15px]`}
        >
          {isSaving ? 'Salvando…' : `Classificar ${n} lançamento${n === 1 ? '' : 's'}`}
        </button>
      }
    >
      <div className="space-y-5 pb-2">
        <section className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-[12px] font-medium text-stone-500">Lançamentos</p>
            <button type="button" onClick={() => setPicked(allPicked ? new Set() : new Set(group.transactions.map((t) => t.id)))} className="text-[12px] text-[#0071E3] hover:underline">
              {allPicked ? 'Desmarcar todos' : 'Marcar todos'}
            </button>
          </div>
          <ul className="max-h-44 overflow-y-auto overscroll-contain rounded-2xl bg-white dark:bg-stone-800/60 border border-black/[0.06] dark:border-white/[0.06] divide-y divide-black/[0.04]">
            {group.transactions.map((t) => (
              <li key={t.id}>
                <label className="flex items-center gap-3 px-3.5 py-2 cursor-pointer hover:bg-black/[0.02]">
                  <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} aria-label={`${formatDateBR(t.date)} ${formatCurrency(t.amount)}`} />
                  <span className="font-mono tabular-nums text-[11px] text-stone-400 w-20 shrink-0">{formatDateBR(t.date)}</span>
                  <span className="flex-1 min-w-0 truncate text-[12px] text-stone-500" title={t.memo}>{t.memo}</span>
                  <span className="font-mono tabular-nums text-[13px] whitespace-nowrap">{formatCurrency(t.amount)}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="px-1 text-right text-[12px] text-stone-500">
            Selecionado: <span className="font-mono tabular-nums text-stone-800 dark:text-stone-200">{formatCurrency(selectedTotal)}</span>
          </p>
        </section>

        <section className="space-y-2">
          <p className="text-[12px] font-medium text-stone-500 px-1">Conta contábil</p>
          <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} autoFocus />
        </section>

        <RuleLearnPanel
          checked={learn}
          onChecked={setLearn}
          title="Criar regra para este favorecido"
          subtitle="Os próximos lançamentos dele serão classificados sozinhos"
          term={term}
          onTerm={setTerm}
          matchType={matchType}
          onMatchType={setMatchType}
          assessment={assessment}
          acknowledged={acknowledged}
          onAcknowledged={setAcknowledged}
          suggestion={group.term}
          note={
            opposite > 0 ? (
              <p className="mt-1.5 text-[11px] text-amber-700">
                A regra também casa {opposite} lançamento(s) pendente(s) de {group.direction === 'IN' ? 'saída' : 'entrada'} deste mesmo favorecido; eles
                irão para a mesma conta.
              </p>
            ) : null
          }
        />
      </div>
    </Sheet>
  );
}
