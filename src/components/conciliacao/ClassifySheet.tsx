'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Lock, MessageCircleQuestion, X } from 'lucide-react';
import type { AuditEntry, BankTransaction, ChartAccount, ClassificationRule, RuleMatchType } from '@/types/firestore';
import { normalizePattern } from '@/lib/reconciliation';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { SegmentedControl } from '@/components/ui/primitives';
import { AccountPicker } from '@/components/conciliacao/AccountPicker';
import { RuleLearnPanel } from '@/components/conciliacao/RuleLearnPanel';
import { assessRuleTerm, suggestMemoTerm, suggestRuleTerm } from '@/lib/payee';
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
  /** Descrições dos lançamentos carregados, para avaliar se o termo da regra é genérico ou amplo. */
  memoPool?: readonly string[];
  /** Registra (texto) ou remove (vazio) a pergunta ao cliente. Sem a prop, a aba não aparece. */
  onAskClient?: (question: string) => Promise<void>;
}

type SheetMode = 'single' | 'split' | 'ask' | 'history';

/** Pergunta sugerida: data, valor e histórico, para o cliente reconhecer o lançamento. */
const defaultQuestion = (t: BankTransaction) =>
  `O que é o lançamento de ${formatCurrency(Math.abs(t.amount))} em ${formatDateBR(t.date)} (“${t.memo}”)? Se tiver, anexe a nota ou o comprovante.`;


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
  onAskClient,
  memoPool = [],
}: ClassifySheetProps) {
  const locked = Boolean(lockedMonthLabel);
  const isEditing = transaction.status !== 'PENDING';
  const sourceRule = transaction.matchedRuleId ? rules.find((r) => r.id === transaction.matchedRuleId) : undefined;
  const [confirmUndo, setConfirmUndo] = useState(false);


  useEffect(() => {
    if (!confirmUndo) return;
    const t = setTimeout(() => setConfirmUndo(false), 3500);
    return () => clearTimeout(t);
  }, [confirmUndo]);

  const [mode, setMode] = useState<SheetMode>(locked ? 'history' : transaction.isSplit ? 'split' : 'single');
  const openQuery = transaction.clientQuery?.status === 'OPEN' ? transaction.clientQuery : undefined;
  const [question, setQuestion] = useState(openQuery?.question ?? defaultQuestion(transaction));
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

  const [accountId, setAccountId] = useState<string>(transaction.accountId ?? '');
  // Em edição, só atualiza regra por padrão se o lançamento veio de uma.
  const [learnRule, setLearnRule] = useState(isEditing ? Boolean(sourceRule) : true);
  // Termo sugerido: a descrição como aparece na lista ("Pix recebido - Fulano"), sem CPF/dados bancários;
  // ao editar, o termo da regra de origem. O favorecido sozinho fica disponível como atalho.
  const suggestedTerm = suggestMemoTerm(transaction.memo);
  const payeeTerm = suggestRuleTerm(transaction.memo);
  const [customPattern, setCustomPattern] = useState(sourceRule?.pattern ?? suggestedTerm);
  const [matchType, setMatchType] = useState<RuleMatchType>(
    sourceRule?.matchType && sourceRule.matchType !== 'REGEX' ? sourceRule.matchType : 'CONTAINS'
  );

  const assessment = useMemo(
    () => assessRuleTerm({ pattern: customPattern, matchType }, memoPool),
    [customPattern, matchType, memoPool]
  );
  const [acknowledged, setAcknowledged] = useState(false);
  // Termo genérico só é salvo depois de "Criar mesmo assim".
  const ruleBlocked = learnRule && assessment.level === 'generic' && !acknowledged;

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

        {transaction.transferPairId && (
          <div role="status" className="mx-6 mb-4 flex items-start gap-2.5 px-3.5 py-3 rounded-2xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200/60 text-[12px] text-sky-800 dark:text-sky-300">
            <ArrowLeftRight className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>Transferência entre contas próprias. Reclassificar, ratear ou desfazer este lançamento volta a outra perna para pendente.</span>
          </div>
        )}
        {openQuery && mode !== 'ask' && (
          <div role="status" className="mx-6 mb-4 flex items-start gap-2.5 px-3.5 py-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 text-[12px] text-amber-800 dark:text-amber-300">
            <MessageCircleQuestion className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>Aguardando o cliente: “{openQuery.question}”</span>
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
                    ...(onAskClient ? [{ value: 'ask' as const, label: 'Perguntar ao cliente' }] : []),
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
        ) : mode === 'ask' ? (
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 pb-2 space-y-3">
            <p className="text-[13px] text-stone-600 dark:text-stone-300">
              A pergunta entra na lista de <b>Pendências do cliente</b>, de onde você gera um link para o cliente responder e anexar
              comprovantes, sem precisar de login.
            </p>
            <label className="block space-y-1.5">
              <span className="block text-[12px] font-medium text-stone-500 px-0.5">Pergunta</span>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={4}
                maxLength={500}
                className="w-full px-3.5 py-3 rounded-xl bg-white/80 dark:bg-stone-800/70 border border-black/[0.08] dark:border-white/[0.10] text-[14px] leading-relaxed outline-none focus:border-[#0071E3]/60 focus:shadow-[0_0_0_4px_rgba(0,113,227,0.12)]"
              />
            </label>
            {openQuery && (
              <p className="text-[12px] text-stone-400">
                Perguntado por {openQuery.askedByEmail ?? openQuery.askedByUid} em {formatDateBR(openQuery.askedAt.slice(0, 10))}.
              </p>
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
            <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} autoFocus />
          </section>

          {/* Aprendizado */}
          <RuleLearnPanel
            checked={learnRule}
            onChecked={setLearnRule}
            title={isEditing ? 'Atualizar regra de aprendizado' : 'Lembrar essa classificação'}
            subtitle={sourceRule ? `A regra “${sourceRule.pattern}” passará a usar a nova conta` : 'Aplica a lançamentos semelhantes'}
            term={customPattern}
            onTerm={setCustomPattern}
            matchType={matchType}
            onMatchType={setMatchType}
            assessment={assessment}
            acknowledged={acknowledged}
            onAcknowledged={setAcknowledged}
            suggestion={payeeTerm}
            memoSuggestion={suggestedTerm}
            note={
              matchType === 'EXACT' && normalizePattern(customPattern) !== normalizePattern(transaction.memo) ? (
                <p className="mt-1.5 text-[11px] text-amber-700">
                  Com “É exatamente”, a regra só casa históricos idênticos ao termo — este lançamento não casaria.
                </p>
              ) : null
            }
          />
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
          ) : mode === 'ask' ? (
            <div className="space-y-2">
              <button
                type="button"
                disabled={!question.trim() || isSaving}
                onClick={() => void onAskClient?.(question)}
                className="w-full h-12 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white text-[15px] font-medium tracking-tight disabled:opacity-40 active:scale-[0.98] transition-all duration-150"
              >
                {isSaving ? 'Salvando…' : openQuery ? 'Atualizar pergunta' : 'Enviar para pendências do cliente'}
              </button>
              {openQuery && (
                <button type="button" disabled={isSaving} onClick={() => void onAskClient?.('')} className="w-full text-[13px] text-stone-500 hover:text-rose-600">
                  Remover pergunta
                </button>
              )}
            </div>
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
            disabled={!accountId || isSaving || ruleBlocked}
            onClick={() => void onConfirm(accountId, learnRule, customPattern, matchType)}
            className="w-full h-12 rounded-2xl bg-[#0071E3] hover:bg-[#0077ED] text-white text-[15px] font-medium tracking-tight shadow-[0_4px_14px_rgba(0,113,227,0.25)] disabled:opacity-40 disabled:shadow-none active:scale-[0.98] transition-all duration-150"
          >
            {isSaving ? 'Salvando…' : isEditing ? 'Salvar nova classificação' : 'Conciliar'}
          </button>
          )}
          {isEditing && !locked && (mode === 'single' || mode === 'split') && (
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
