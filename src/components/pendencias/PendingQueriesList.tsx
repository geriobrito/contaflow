'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Clock,
  ExternalLink,
  Lock,
  MessageCircleQuestion,
  Pencil,
  ReceiptText,
  Sparkles,
} from 'lucide-react';
import type { BankTransaction, ClientRequestAnswer } from '@/types/firestore';
import {
  formatWaitingDays,
  type PendingQueryCounts,
  type PendingQueryFilter,
  type PendingQueryGroup,
  type PendingQueryStage,
  waitingDays,
} from '@/lib/client-requests';
import { formatMonth, isMonthLocked, monthOf } from '@/lib/periods';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { formatDateTime } from '@/components/conciliacao/AuditTimeline';
import { BUTTON, EmptyState, SegmentedControl, SURFACE } from '@/components/ui/primitives';
import { TableSkeleton } from '@/components/ui/Skeleton';

const STAGE_STYLE: Record<
  PendingQueryStage,
  { dot: string; badge: string; label: string; shortLabel: string }
> = {
  ANSWERED: {
    dot: 'bg-emerald-500',
    badge:
      'bg-emerald-50 text-emerald-800 border-emerald-200/70 dark:bg-emerald-950/35 dark:text-emerald-300 dark:border-emerald-500/30',
    label: 'Respondidas (prontas para classificar)',
    shortLabel: 'Respondidas',
  },
  WAITING: {
    dot: 'bg-amber-500',
    badge:
      'bg-amber-50 text-amber-800 border-amber-200/70 dark:bg-amber-950/35 dark:text-amber-300 dark:border-amber-500/30',
    label: 'Aguardando o cliente',
    shortLabel: 'Aguardando',
  },
  NOT_SENT: {
    dot: 'bg-stone-400 dark:bg-stone-500',
    badge:
      'bg-stone-100 text-stone-700 border-stone-200/80 dark:bg-stone-800/80 dark:text-stone-300 dark:border-white/10',
    label: 'Ainda não enviadas',
    shortLabel: 'Não enviadas',
  },
};

export interface PendingQueriesSummaryProps {
  counts: PendingQueryCounts;
  filter: PendingQueryFilter;
  onFilterChange: (next: PendingQueryFilter) => void;
}

/** Resumo no topo da fila, com contagem e filtro ao clicar em cada situação (padrão da Conciliação). */
export function PendingQueriesSummary({ counts, filter, onFilterChange }: PendingQueriesSummaryProps) {
  const cards: {
    stage: PendingQueryStage;
    title: string;
    count: number;
    caption: string;
    dot: string;
    tone: string;
  }[] = [
    {
      stage: 'ANSWERED',
      title: 'Respondidas',
      count: counts.answered,
      caption: 'prontas para classificar',
      dot: 'bg-emerald-500',
      tone: 'text-emerald-600 dark:text-emerald-400',
    },
    {
      stage: 'WAITING',
      title: 'Aguardando o cliente',
      count: counts.waiting,
      caption: 'em link aberto',
      dot: 'bg-amber-500',
      tone: 'text-amber-700 dark:text-amber-400',
    },
    {
      stage: 'NOT_SENT',
      title: 'Ainda não enviadas',
      count: counts.notSent,
      caption: 'fora de link aberto',
      dot: 'bg-stone-400 dark:bg-stone-500',
      tone: 'text-stone-900 dark:text-stone-100',
    },
  ];

  return (
    <section
      aria-label="Resumo das pendências por situação"
      className="rounded-[18px] overflow-hidden grid grid-cols-1 sm:grid-cols-3 gap-px bg-black/5 dark:bg-white/6 border border-line shadow-card"
    >
      {cards.map((c) => {
        const active = filter === c.stage;
        return (
          <button
            key={c.stage}
            type="button"
            aria-pressed={active}
            onClick={() => onFilterChange(active ? 'ALL' : c.stage)}
            title={active ? 'Voltar a mostrar todas as pendências' : `Filtrar por: ${c.title}`}
            className={`px-4 py-3 text-left flex flex-col justify-center gap-1 transition-colors duration-150 ${
              active
                ? 'bg-stone-900/6 dark:bg-white/10 ring-1 ring-inset ring-stone-900/15 dark:ring-white/20'
                : 'bg-surface hover:bg-black/2 dark:hover:bg-white/4'
            }`}
          >
            <p className="flex items-center justify-between gap-2 text-[12px] font-medium text-stone-500 dark:text-stone-400">
              <span className="inline-flex items-center gap-1.5 truncate">
                <span aria-hidden className={`w-1.5 h-1.5 shrink-0 rounded-full ${c.dot}`} />
                <span className="truncate">{c.title}</span>
              </span>
              {active && (
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-accent-ink">
                  Filtro ativo
                </span>
              )}
            </p>
            <p className={`text-[20px] leading-none font-semibold tracking-tight font-mono tabular-nums ${c.tone}`}>
              {c.count}
            </p>
            <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate">{c.caption}</p>
          </button>
        );
      })}
    </section>
  );
}

export interface PendingQueriesListProps {
  loading: boolean;
  totalQueries: number;
  counts: PendingQueryCounts;
  filter: PendingQueryFilter;
  onFilterChange: (next: PendingQueryFilter) => void;
  groups: readonly PendingQueryGroup[];
  answers: ReadonlyMap<string, ClientRequestAnswer>;
  newlyAnsweredIds: ReadonlySet<string>;
  sentAtMap: ReadonlyMap<string, string>;
  lockedMonths: ReadonlySet<string>;
  nowMs: number;
  isSaving: boolean;
  isLoadingRecon: boolean;
  loadedTxIds: ReadonlySet<string>;
  invoiceHints?: ReadonlyMap<string, 'match' | 'linked'>;
  onSelectClassify: (tx: BankTransaction) => void;
  onResolveWithoutClassifying: (txId: string) => void;
  onEditQuestion: (txId: string, newQuestion: string) => Promise<void>;
  onOpenInvoice?: (tx: BankTransaction) => void;
}

export function PendingQueriesList({
  loading,
  totalQueries,
  counts,
  filter,
  onFilterChange,
  groups,
  answers,
  newlyAnsweredIds,
  sentAtMap,
  lockedMonths,
  nowMs,
  isSaving,
  isLoadingRecon,
  loadedTxIds,
  invoiceHints,
  onSelectClassify,
  onResolveWithoutClassifying,
  onEditQuestion,
  onOpenInvoice,
}: PendingQueriesListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftQuestion, setDraftQuestion] = useState('');
  const [savingQuestionId, setSavingQuestionId] = useState<string | null>(null);

  const startEditing = (q: BankTransaction) => {
    setEditingId(q.id);
    setDraftQuestion(q.clientQuery?.question ?? '');
  };

  const saveQuestion = async (txId: string) => {
    const trimmed = draftQuestion.trim();
    if (!trimmed) return;
    setSavingQuestionId(txId);
    try {
      await onEditQuestion(txId, trimmed);
      setEditingId(null);
    } finally {
      setSavingQuestionId(null);
    }
  };

  if (loading) {
    return (
      <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
        <TableSkeleton rows={5} label="Carregando pendências…" />
      </section>
    );
  }

  if (totalQueries === 0) {
    return (
      <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
        <EmptyState
          title="Nenhuma pendência em aberto"
          description="Na Conciliação, abra um lançamento e use “Perguntar ao cliente” para incluí-lo aqui."
        />
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <PendingQueriesSummary counts={counts} filter={filter} onFilterChange={onFilterChange} />

      <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
        <div className="px-5 py-3.5 border-b border-black/4 dark:border-white/5 flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl<PendingQueryFilter>
            ariaLabel="Filtrar pendências por situação"
            value={filter}
            onChange={onFilterChange}
            options={[
              { value: 'ALL', label: `Todas (${counts.all})` },
              { value: 'ANSWERED', label: `Respondidas (${counts.answered})` },
              { value: 'WAITING', label: `Aguardando (${counts.waiting})` },
              { value: 'NOT_SENT', label: `Não enviadas (${counts.notSent})` },
            ]}
          />
        </div>

        {groups.length === 0 ? (
          <EmptyState
            title="Nenhuma pendência nesta situação"
            description="Troque o filtro acima para ver as demais pendências em aberto."
            action={
              <button type="button" onClick={() => onFilterChange('ALL')} className={BUTTON.secondary}>
                Mostrar todas ({counts.all})
              </button>
            }
          />
        ) : (
          <div className="divide-y divide-black/6 dark:divide-white/8">
            {groups.map((group) => {
              const style = STAGE_STYLE[group.stage];
              return (
                <div key={group.stage} role="region" aria-label={group.title}>
                  <div className="px-5 py-2.5 bg-black/2 dark:bg-white/3 border-b border-black/4 dark:border-white/5 flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span aria-hidden className={`w-2 h-2 rounded-full ${style.dot}`} />
                      <h3 className="text-[13px] font-semibold tracking-tight text-stone-800 dark:text-stone-100">
                        {group.title}
                      </h3>
                      <span className={`px-2 py-0.5 rounded-full border text-[11px] font-mono tabular-nums font-medium ${style.badge}`}>
                        {group.items.length}
                      </span>
                    </div>
                    <p className="text-[11.5px] text-stone-500 dark:text-stone-400">{group.subtitle}</p>
                  </div>

                  <ul className="divide-y divide-black/4 dark:divide-white/5">
                    {group.items.map((q) => {
                      const answer = answers.get(q.id);
                      const isNewAnswer = newlyAnsweredIds.has(q.id);
                      const locked = isMonthLocked(q.date, lockedMonths);
                      const month = monthOf(q.date);
                      const sentAt = sentAtMap.get(q.id);
                      const daysWaiting = sentAt ? waitingDays(sentAt, nowMs) : null;
                      const isReadyToClassify = loadedTxIds.has(q.id) && !isLoadingRecon;
                      const hint = invoiceHints?.get(q.id);
                      const isEditingThis = editingId === q.id;

                      return (
                        <li key={q.id} className="px-5 py-4 space-y-2.5">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="font-mono tabular-nums text-[12px] text-stone-500 dark:text-stone-400">
                              {formatDateBR(q.date)}
                            </span>
                            <span className="flex-1 min-w-0 text-[14px] font-medium tracking-tight truncate" title={q.memo}>
                              {q.memo}
                            </span>
                            {hint && onOpenInvoice && (
                              <button
                                type="button"
                                onClick={() => onOpenInvoice(q)}
                                title="Ver nota fiscal correspondente"
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200/70 dark:border-emerald-500/30 text-[11px] font-medium text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/70"
                              >
                                <ReceiptText className="w-3 h-3" />
                                {hint === 'linked' ? 'Nota vinculada' : 'Nota sugerida'}
                              </button>
                            )}
                            {group.stage === 'WAITING' && daysWaiting !== null && (
                              <span
                                title={`Enviado ao cliente em ${formatDateTime(sentAt!)}`}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                                  daysWaiting >= 7
                                    ? 'bg-amber-100/90 text-amber-900 border border-amber-300/80 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-500/35'
                                    : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300'
                                }`}
                              >
                                <Clock className="w-3 h-3" />
                                {formatWaitingDays(daysWaiting)}
                              </span>
                            )}
                            <span className="font-mono tabular-nums text-[14px] font-medium">{formatCurrency(q.amount)}</span>
                          </div>

                          {isEditingThis ? (
                            <div className="ml-6 space-y-2">
                              <label className="block">
                                <span className="sr-only">Editar pergunta ao cliente</span>
                                <textarea
                                  value={draftQuestion}
                                  onChange={(e) => setDraftQuestion(e.target.value)}
                                  rows={2}
                                  maxLength={500}
                                  aria-label="Texto da pergunta ao cliente"
                                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-stone-800/80 border border-line-strong text-[13px] leading-relaxed outline-none focus:border-accent/60"
                                />
                              </label>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={!draftQuestion.trim() || savingQuestionId === q.id}
                                  onClick={() => void saveQuestion(q.id)}
                                  className={`${BUTTON.primary} h-7 text-[12px]`}
                                >
                                  {savingQuestionId === q.id ? 'Salvando…' : 'Salvar pergunta'}
                                </button>
                                <button
                                  type="button"
                                  disabled={savingQuestionId === q.id}
                                  onClick={() => setEditingId(null)}
                                  className={`${BUTTON.ghost} h-7 text-[12px]`}
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <p className="flex items-start gap-2 text-[13px] text-stone-600 dark:text-stone-300 flex-1 min-w-0">
                                <MessageCircleQuestion className="w-4 h-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
                                <span>{q.clientQuery?.question}</span>
                              </p>
                              {!locked && (
                                <button
                                  type="button"
                                  onClick={() => startEditing(q)}
                                  className="inline-flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
                                >
                                  <Pencil className="w-3 h-3" /> Editar pergunta
                                </button>
                              )}
                            </div>
                          )}

                          {answer ? (
                            <div
                              className={`ml-6 rounded-2xl px-4 py-3 space-y-2 border ${
                                isNewAnswer
                                  ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700/60'
                                  : 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-500/25'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-emerald-700 dark:text-emerald-400">
                                  Resposta do cliente{answer.answeredAt && ` · ${formatDateTime(answer.answeredAt)}`}
                                </p>
                                {isNewAnswer && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-semibold tracking-tight">
                                    <Sparkles className="w-2.5 h-2.5" />
                                    Nova resposta
                                  </span>
                                )}
                              </div>
                              <p className="text-[14px] text-stone-800 dark:text-stone-100 whitespace-pre-wrap wrap-break-word">
                                {answer.text}
                              </p>
                            </div>
                          ) : (
                            <p className="ml-6 text-[12px] text-stone-500 dark:text-stone-400">
                              {group.stage === 'WAITING'
                                ? `Enviado ao cliente${daysWaiting !== null ? ` (${formatWaitingDays(daysWaiting)})` : ''} · aguardando resposta`
                                : 'Ainda não enviado em link ativo · gere um novo link no topo ou reative um anterior'}
                            </p>
                          )}

                          <div className="ml-6 flex flex-wrap items-center gap-2">
                            {locked ? (
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-stone-900/4 dark:bg-white/6 border border-black/6 dark:border-white/8 px-3 py-2 text-[12px] text-stone-600 dark:text-stone-300">
                                <span className="inline-flex items-center gap-1.5">
                                  <Lock className="w-3.5 h-3.5 shrink-0 text-stone-500" />
                                  <span>
                                    Competência de <b>{formatMonth(month)}</b> fechada · reabra o mês na Conciliação para classificar ou concluir esta pendência.
                                  </span>
                                </span>
                                <Link
                                  href={`/?mes=${month}`}
                                  className="inline-flex items-center gap-1 font-medium text-accent-ink hover:underline"
                                >
                                  Abrir {formatMonth(month)} na Conciliação
                                  <ExternalLink className="w-3 h-3" />
                                </Link>
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  disabled={isSaving || !isReadyToClassify}
                                  title={
                                    !isReadyToClassify
                                      ? 'Aguardando o carregamento das regras e fechamentos da empresa…'
                                      : isSaving
                                        ? 'Salvando alteração…'
                                        : undefined
                                  }
                                  onClick={() => onSelectClassify(q)}
                                  className={`${BUTTON.primary} h-8`}
                                >
                                  {!isReadyToClassify
                                    ? 'Carregando regras…'
                                    : isSaving
                                      ? 'Salvando…'
                                      : 'Classificar e concluir'}
                                </button>
                                <button
                                  type="button"
                                  disabled={isSaving}
                                  onClick={() => onResolveWithoutClassifying(q.id)}
                                  className={`${BUTTON.ghost} h-8`}
                                >
                                  Concluir sem classificar
                                </button>
                              </>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
