'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Lock, Search, X } from 'lucide-react';
import type { AuditEntry, BankTransaction, ChartAccount, ClassificationRule, RuleMatchType } from '@/types/firestore';
import { normalizePattern } from '@/lib/reconciliation';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { IOSSwitch, SegmentedControl } from '@/components/ui/primitives';
import { emptySplitDraft, SplitEditor } from '@/components/conciliacao/SplitEditor';
import { StatusBadge } from '@/components/conciliacao/StatusBadge';
import { AuditTimeline } from '@/components/conciliacao/AuditTimeline';
import { splitsToDrafts, summarizeSplits, type SplitDraft } from '@/lib/splits';

/* =========================================================================
   Sheet de classificação: conta única, rateio e histórico (auditoria)
   ========================================================================= */

interface ClassifySheetProps {
  transaction: BankTransaction;
  accounts: ChartAccount[];
  isSaving: boolean;
  onClose: () => void;
  onConfirm: (accountId: string, learnRule: boolean, customPattern: string, matchType: RuleMatchType) => Promise<void>;
  onSplit: (drafts: SplitDraft[]) => Promise<void>;
  onUnreconcile: () => Promise<void>;
  /** Regras do cliente, para pré-carregar o termo da regra que originou o lançamento. */
  rules: readonly ClassificationRule[];
  /** Competência fechada (ex.: "março de 2025"): o sheet fica somente leitura. */
  lockedMonthLabel?: string | null;
  /** Carrega a trilha de auditoria do lançamento. */
  loadAudit: () => Promise<AuditEntry[]>;
}

type SheetMode = 'single' | 'split' | 'history';

const MATCH_OPTIONS: readonly { value: RuleMatchType; label: string }[] = [
  { value: 'CONTAINS', label: 'Contém' },
  { value: 'STARTS_WITH', label: 'Começa com' },
  { value: 'EXACT', label: 'É exatamente' },
];

export function ClassifySheet({
  transaction,
  accounts,
  isSaving,
  onClose,
  onConfirm,
  onSplit,
  onUnreconcile,
  rules,
  lockedMonthLabel,
  loadAudit,
}: ClassifySheetProps) {
  const locked = Boolean(lockedMonthLabel);
  const isEditing = transaction.status !== 'PENDING';
  const sourceRule = transaction.matchedRuleId ? rules.find((r) => r.id === transaction.matchedRuleId) : undefined;
  const [confirmUndo, setConfirmUndo] = useState(false);
  const accountListRef = useRef<HTMLUListElement>(null);


  useEffect(() => {
    if (!confirmUndo) return;
    const t = setTimeout(() => setConfirmUndo(false), 3500);
    return () => clearTimeout(t);
  }, [confirmUndo]);

  const [mode, setMode] = useState<SheetMode>(locked ? 'history' : transaction.isSplit ? 'split' : 'single');
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  // Carrega a trilha na primeira vez que a aba Histórico é aberta.
  useEffect(() => {
    if (mode !== 'history' || audit !== null) return;
    let active = true;
    loadAudit()
      .then((entries) => active && setAudit(entries))
      .catch((e: unknown) => active && setAuditError(e instanceof Error ? e.message : 'Falha ao carregar o histórico.'));
    return () => {
      active = false;
    };
  }, [mode, audit, loadAudit]);
  const [drafts, setDrafts] = useState<SplitDraft[]>(() =>
    transaction.isSplit && transaction.splits?.length ? splitsToDrafts(transaction.splits) : [emptySplitDraft(), emptySplitDraft()]
  );
  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a] as const)), [accounts]);
  const splitSummary = summarizeSplits(transaction.amount, drafts, accountsById);
  const canSaveSplit = splitSummary.isBalanced && splitSummary.isComplete;

  // Em edição, traz a conta atual para o centro da lista (inclusive ao voltar do modo rateio).
  useEffect(() => {
    const list = accountListRef.current;
    const item = list?.querySelector<HTMLElement>('[aria-selected="true"]')?.closest('li');
    // Rola só a lista (scrollIntoView rolaria também o sheet e a página).
    if (list && item) list.scrollTop = item.offsetTop - list.clientHeight / 2 + item.clientHeight / 2;
  }, [mode]);
  const [search, setSearch] = useState('');
  const [accountId, setAccountId] = useState<string>(transaction.accountId ?? '');
  // Em edição, só atualiza regra por padrão se o lançamento veio de uma.
  const [learnRule, setLearnRule] = useState(isEditing ? Boolean(sourceRule) : true);
  const [customPattern, setCustomPattern] = useState(normalizePattern(sourceRule?.pattern ?? transaction.memo));
  const [matchType, setMatchType] = useState<RuleMatchType>(
    sourceRule?.matchType && sourceRule.matchType !== 'REGEX' ? sourceRule.matchType : 'CONTAINS'
  );

  const options = useMemo(() => {
    const term = normalizePattern(search);
    return accounts
      .filter((a) => a.nature === 'ANALYTIC')
      .filter((a) => !term || `${a.code} ${a.name}`.toLowerCase().includes(term));
  }, [accounts, search]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const negative = transaction.amount < 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6">
      <div className="absolute inset-0 bg-stone-900/25 backdrop-blur-sm animate-fade-in" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="classify-title"
        className={`relative w-full ${mode === 'split' ? 'sm:max-w-[640px]' : 'sm:max-w-[440px]'} max-h-[92vh] flex flex-col transition-[max-width] duration-200 rounded-t-[28px] sm:rounded-[28px] bg-[#F9F9F8]/95 dark:bg-stone-900/95 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_24px_64px_rgba(0,0,0,0.18)] animate-sheet-in`}
      >
        <div className="sm:hidden flex justify-center pt-2">
          <span className="w-9 h-[5px] rounded-full bg-black/15 dark:bg-white/20" />
        </div>

        {/* Cabeçalho */}
        <div className="flex items-start gap-3 px-6 pt-5 pb-4">
          <div className="flex-1 min-w-0">
            <h2 id="classify-title" className="text-[17px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              {isEditing ? 'Editar classificação' : 'Classificar lançamento'}
            </h2>
            <p className="mt-1 text-[13px] text-stone-500 truncate">{transaction.memo}</p>
            {isEditing && (
              <p className="mt-2 inline-flex items-center gap-1.5 max-w-full text-[12px] text-stone-500">
                <StatusBadge status={transaction.status} />
                <span className="truncate">
                  {transaction.isSplit
                    ? `Rateado em ${transaction.splits?.length ?? 0} contas`
                    : transaction.accountName
                      ? `${transaction.accountCode ?? ''} ${transaction.accountName}`
                      : 'Sem conta'}
                </span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="w-7 h-7 rounded-full bg-black/[0.05] dark:bg-white/[0.08] text-stone-500 flex items-center justify-center hover:bg-black/[0.08] active:scale-[0.94] transition-all duration-150"
          >
            <X className="w-3.5 h-3.5" strokeWidth={2.25} />
          </button>
        </div>

        <div className="px-6 pb-4 flex items-baseline justify-between">
          <span className="text-[12px] text-stone-400 font-mono tabular-nums">{formatDateBR(transaction.date)}</span>
          <span className={`text-[22px] font-semibold tracking-tight font-mono tabular-nums ${negative ? 'text-stone-900 dark:text-stone-100' : 'text-emerald-600'}`}>
            {formatCurrency(transaction.amount)}
          </span>
        </div>

        {locked && (
          <div role="status" className="mx-6 mb-4 flex items-start gap-2.5 px-3.5 py-3 rounded-2xl bg-stone-900/[0.04] dark:bg-white/[0.06] border border-black/[0.06] text-[12px] text-stone-600 dark:text-stone-300">
            <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              A competência de <b>{lockedMonthLabel}</b> está fechada. Para alterar este lançamento, reabra a competência em
              “Reabrir competência”, logo abaixo do seletor de período (a reabertura fica registrada na auditoria).
            </span>
          </div>
        )}

        <div className="px-6 pb-4 overflow-x-auto">
          <SegmentedControl
            ariaLabel="Modo de classificação"
            value={mode}
            onChange={setMode}
            options={[
              ...(locked
                ? []
                : [
                    { value: 'single' as const, label: 'Conta única' },
                    { value: 'split' as const, label: 'Rateio / desdobrar' },
                  ]),
              { value: 'history', label: 'Histórico' },
            ]}
          />
        </div>

        {mode === 'history' ? (
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 pb-2">
            {auditError ? (
              <p role="alert" className="text-[13px] text-rose-600">{auditError}</p>
            ) : audit === null ? (
              <p className="py-6 text-center text-[13px] text-stone-400">Carregando histórico…</p>
            ) : (
              <AuditTimeline entries={audit} emptyText="Nenhuma alteração registrada para este lançamento." />
            )}
          </div>
        ) : mode === 'split' ? (
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6">
            <SplitEditor transactionAmount={transaction.amount} accounts={accounts} drafts={drafts} onChange={setDrafts} />
          </div>
        ) : (
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 space-y-5">
          {/* Plano de contas */}
          <section className="space-y-2">
            <p className="text-[12px] font-medium text-stone-500 px-1">Conta contábil</p>
            <div className="rounded-2xl bg-white dark:bg-stone-800/60 border border-black/[0.06] dark:border-white/[0.06] overflow-hidden">
              <div className="relative border-b border-black/[0.04] dark:border-white/[0.06]">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por código ou nome"
                  className="w-full pl-10 pr-3 py-3 bg-transparent text-[14px] tracking-tight placeholder:text-stone-400 outline-none"
                />
              </div>
              <ul ref={accountListRef} role="listbox" className="relative max-h-56 overflow-y-auto overscroll-contain">
                {options.length === 0 && (
                  <li className="px-4 py-6 text-center text-[13px] text-stone-400">Nenhuma conta encontrada</li>
                )}
                {options.map((a) => {
                  const selected = a.id === accountId;
                  return (
                    <li key={a.id} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0">
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => setAccountId(a.id)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100 ${
                          selected ? 'bg-blue-50/70 dark:bg-blue-950/30' : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03]'
                        }`}
                      >
                        <span className="w-[96px] shrink-0 font-mono tabular-nums text-[12px] text-stone-400">{a.code}</span>
                        <span className={`flex-1 min-w-0 truncate text-[14px] tracking-tight ${selected ? 'text-[#0071E3] font-medium' : 'text-stone-800 dark:text-stone-200'}`}>
                          {a.name}
                        </span>
                        {selected && <Check className="w-4 h-4 text-[#0071E3] shrink-0" strokeWidth={2.5} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>

          {/* Aprendizado */}
          <section className="rounded-2xl bg-white dark:bg-stone-800/60 border border-black/[0.06] dark:border-white/[0.06] overflow-hidden">
            <label htmlFor="learn-rule" className="flex items-center gap-4 px-4 py-3 cursor-pointer">
              <span className="flex-1 min-w-0">
                <span className="block text-[14px] tracking-tight text-stone-900 dark:text-stone-100">
                  {isEditing ? 'Atualizar regra de aprendizado' : 'Lembrar essa classificação'}
                </span>
                <span className="block text-[12px] text-stone-500">
                  {sourceRule
                    ? `A regra “${sourceRule.pattern}” passará a usar a nova conta`
                    : 'Aplica a lançamentos semelhantes'}
                </span>
              </span>
              <IOSSwitch id="learn-rule" checked={learnRule} onChange={setLearnRule} />
            </label>
            {learnRule && (
              <div className="border-t border-black/[0.04] dark:border-white/[0.06] px-4 py-3 animate-fade-in">
                <label htmlFor="pattern" className="block text-[12px] text-stone-500 mb-1">
                  Termo a memorizar
                </label>
                <input
                  id="pattern"
                  value={customPattern}
                  onChange={(e) => setCustomPattern(e.target.value)}
                  placeholder="ex.: uber, aws, tarifa"
                  className="w-full bg-transparent font-mono text-[13px] text-stone-900 dark:text-stone-100 placeholder:text-stone-400 outline-none"
                />
                <div className="mt-2.5 overflow-x-auto">
                  <SegmentedControl ariaLabel="Tipo de comparação" value={matchType} onChange={setMatchType} options={MATCH_OPTIONS} />
                </div>
                {matchType === 'EXACT' && normalizePattern(customPattern) !== normalizePattern(transaction.memo) && (
                  <p className="mt-1.5 text-[11px] text-amber-700">
                    Com “É exatamente”, a regra só casa históricos idênticos ao termo — este lançamento não casaria.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
        )}

        <div className="px-6 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {mode === 'history' ? (
            <button
              type="button"
              onClick={onClose}
              className="w-full h-12 rounded-2xl bg-black/[0.05] dark:bg-white/[0.08] text-stone-800 dark:text-stone-100 text-[15px] font-medium tracking-tight active:scale-[0.98] transition-all duration-150"
            >
              Fechar
            </button>
          ) : mode === 'split' ? (
            <>
              {!canSaveSplit && (
                <p className="mb-2 text-center text-[12px] text-stone-500">
                  {!splitSummary.isBalanced
                    ? 'A soma das linhas deve ser igual ao valor do lançamento.'
                    : splitSummary.errors[0]}
                </p>
              )}
              <button
                type="button"
                disabled={!canSaveSplit || isSaving}
                onClick={() => void onSplit(drafts)}
                className="w-full h-12 rounded-2xl bg-[#0071E3] hover:bg-[#0077ED] text-white text-[15px] font-medium tracking-tight shadow-[0_4px_14px_rgba(0,113,227,0.25)] disabled:opacity-40 disabled:shadow-none active:scale-[0.98] transition-all duration-150"
              >
                {isSaving ? 'Salvando…' : isEditing ? 'Salvar novo rateio' : 'Salvar rateio'}
              </button>
            </>
          ) : (
          <button
            type="button"
            disabled={!accountId || isSaving}
            onClick={() => void onConfirm(accountId, learnRule, customPattern, matchType)}
            className="w-full h-12 rounded-2xl bg-[#0071E3] hover:bg-[#0077ED] text-white text-[15px] font-medium tracking-tight shadow-[0_4px_14px_rgba(0,113,227,0.25)] disabled:opacity-40 disabled:shadow-none active:scale-[0.98] transition-all duration-150"
          >
            {isSaving ? 'Salvando…' : isEditing ? 'Salvar nova classificação' : 'Conciliar'}
          </button>
          )}
          {isEditing && !locked && mode !== 'history' && (
            <div className="mt-2 flex justify-center">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => {
                  if (confirmUndo) void onUnreconcile();
                  else setConfirmUndo(true);
                }}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition-all duration-150 active:scale-[0.97] disabled:opacity-40 ${
                  confirmUndo
                    ? 'bg-rose-600 text-white shadow-[0_2px_10px_rgba(225,29,72,0.3)] animate-pop-in'
                    : 'text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40'
                }`}
              >
                {confirmUndo ? 'Toque para confirmar: voltar para Pendente' : 'Desfazer conciliação'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
