'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OFXDropzone } from '@/components/conciliacao/OFXDropzone';
import type { BankAccount, BankTransaction, ChartAccount, ReconciliationStatus, RuleMatchType } from '@/types/firestore';
import type { OFXParseResult } from '@/lib/ofx/types';
import { getAccounts, getLatestTransactionDate, getRepository } from '@/lib/services/data-service';
import { PeriodPicker, usePeriod } from '@/components/ui/PeriodPicker';
import { useClient } from '@/contexts/ClientContext';
import { useReconciliation, type ImportResult, type MemoUpdate } from '@/hooks/useReconciliation';
import { AlertTriangle, ArrowLeftRight, CheckCheck, ChevronDown, Lock, MessageCircleQuestion, Pencil, Split, X } from 'lucide-react';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { PAGE, SURFACE } from '@/components/ui/primitives';
import type { SplitDraft } from '@/lib/splits';
import { ClassifySheet } from '@/components/conciliacao/ClassifySheet';
import { StatusBadge } from '@/components/conciliacao/StatusBadge';
import { MonthCloseBar } from '@/components/conciliacao/MonthCloseBar';
import { DuplicateImportModal, type DuplicateImportInfo } from '@/components/ui/DuplicateImportModal';
import { BalanceCheckBadge, StatementPanel } from '@/components/conciliacao/StatementPanel';
import { formatMonth, isMonthLocked, monthOf } from '@/lib/periods';
import { TransferPanel } from '@/components/conciliacao/TransferPanel';
import Link from 'next/link';
import { hasMojibake } from '@/lib/ofx/encoding';
import { findTransferPairs, type TransferPair } from '@/lib/transfers';
import { ensureTransitAccount } from '@/lib/services/accounting-service';

/* =========================================================================
   Métricas
   ========================================================================= */

interface MetricProps {
  label: string;
  value: string;
  caption?: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'accent';
  progress?: number;
}

const TONE: Record<NonNullable<MetricProps['tone']>, string> = {
  neutral: 'text-stone-900 dark:text-stone-100',
  positive: 'text-emerald-600 dark:text-emerald-400',
  negative: 'text-rose-600 dark:text-rose-400',
  accent: 'text-[#0071E3]',
};

function Metric({ label, value, caption, tone = 'neutral', progress }: MetricProps) {
  return (
    <div className="px-5 py-4 min-w-0 backdrop-blur-xl bg-white/80 dark:bg-stone-900/80">
      <p className="text-[12px] font-medium text-stone-500">{label}</p>
      <p className={`mt-1.5 text-[22px] leading-none font-semibold tracking-tight font-mono tabular-nums truncate ${TONE[tone]}`}>
        {value}
      </p>
      {progress !== undefined ? (
        <div className="mt-3 h-1 rounded-full bg-black/[0.05] dark:bg-white/[0.08] overflow-hidden">
          <div className="h-full rounded-full bg-[#0071E3] transition-[width] duration-500 ease-out" style={{ width: `${progress}%` }} />
        </div>
      ) : (
        caption && <p className="mt-2 text-[11px] text-stone-400 truncate">{caption}</p>
      )}
    </div>
  );
}

/* =========================================================================
   Sheet de classificação manual
   ========================================================================= */

/* =========================================================================
   Página
   ========================================================================= */

/** Linhas por página na tabela de lançamentos. */
const PAGE_SIZE = 50;

type Filter = 'ALL' | ReconciliationStatus;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'PENDING', label: 'Pendentes' },
  { value: 'AUTO_CLASSIFIED', label: 'Auto' },
  { value: 'RECONCILED', label: 'Conciliados' },
];

export default function ConciliacaoPage() {
  const { currentClient } = useClient();
  const clientId = currentClient?.id ?? null;

  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [selected, setSelected] = useState<BankTransaction | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [lastImport, setLastImport] = useState<ImportResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Período consultado no banco. Ao trocar de cliente, posiciona no mês do lançamento
  // mais recente; até lá o hook não carrega nada (evita buscar o histórico inteiro).
  const period = usePeriod('month');
  const { jumpTo } = period;
  const [positionedFor, setPositionedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    getLatestTransactionDate(clientId)
      .then((latest) => {
        if (!active) return;
        if (latest) jumpTo(latest);
        setPositionedFor(clientId);
      })
      .catch((e) => {
        console.error('Erro ao localizar o período mais recente:', e);
        if (active) setPositionedFor(clientId);
      });
    return () => {
      active = false;
    };
  }, [clientId, jumpTo]);
  const range = clientId && positionedFor === clientId ? period.range : null;

  const {
    transactions,
    rules,
    metrics,
    isLoading,
    isSaving,
    error,
    checkImport,
    updateMemos,
    importTransactions,
    classifyTransaction,
    splitTransaction,
    unreconcileTransaction,
    approveAutoClassified,
    locks,
    lockedMonths,
    closeMonth,
    reopenMonth,
    loadAudit,
    reconcileTransfers,
    askClient,
  } = useReconciliation({ clientId, accounts, range });
  const selectedMonth = period.mode === 'month' ? `${period.year}-${String(period.month).padStart(2, '0')}` : null;
  const [statementsKey, setStatementsKey] = useState(0);

  useEffect(() => {
    if (!clientId) return;
    getAccounts(clientId)
      .then(setAccounts)
      .catch((e) => console.error('Erro ao carregar plano de contas:', e));
  }, [clientId]);

  // Contas bancárias (nomes nas transferências); recarrega após cada importação.
  const [banks, setBanks] = useState<BankAccount[]>([]);
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    getRepository()
      .listBankAccounts(clientId)
      .then((b) => active && setBanks(b))
      .catch((e) => console.error('Erro ao carregar contas bancárias:', e));
    return () => {
      active = false;
    };
  }, [clientId, statementsKey]);

  // Históricos de importações antigas com acentuação quebrada: a correção fica em Contas e Extratos.
  const hasBrokenText = useMemo(() => transactions.some((t) => hasMojibake(t.memo)), [transactions]);

  const transferPairs = useMemo(() => findTransferPairs(transactions, { lockedMonths }), [transactions, lockedMonths]);

  const handleTransfers = async (pairs: readonly TransferPair[]) => {
    if (!clientId) return;
    try {
      const { account, created } = await ensureTransitAccount(clientId, accounts);
      if (created) setAccounts((prev) => [...prev, account]);
      const n = await reconcileTransfers(pairs, account);
      setToast(`${n} transferência(s) conciliada(s) em ${account.code} ${account.name}${created ? ' (conta criada no plano)' : ''}`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Não foi possível conciliar as transferências');
    }
  };

  // Reseta estados efêmeros ao trocar de cliente.
  const [lastClientId, setLastClientId] = useState(clientId);
  if (lastClientId !== clientId) {
    setLastClientId(clientId);
    setSelected(null);
    setLastImport(null);
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const visible = useMemo(
    () => (filter === 'ALL' ? transactions : transactions.filter((t) => t.status === filter)),
    [transactions, filter]
  );

  // Paginação da tabela (volta à 1ª página ao trocar filtro, período ou cliente).
  const [page, setPage] = useState(0);
  const pageKey = `${clientId}|${filter}|${range?.start}|${range?.end}`;
  const [lastPageKey, setLastPageKey] = useState(pageKey);
  if (lastPageKey !== pageKey) {
    setLastPageKey(pageKey);
    setPage(0);
  }
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const tableRef = useRef<HTMLElement>(null);
  const goToPage = (next: number) => {
    setPage(next);
    tableRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const approvable = useMemo(
    () => transactions.filter((t) => t.status === 'AUTO_CLASSIFIED' && t.accountId && !isMonthLocked(t.date, lockedMonths)).length,
    [transactions, lockedMonths]
  );

  /** Extrato aguardando decisão do usuário (sobreposição parcial) ou bloqueado (duplicado). */
  const [duplicate, setDuplicate] = useState<{
    info: DuplicateImportInfo;
    result: OFXParseResult;
    fileName: string;
    memoUpdates: MemoUpdate[];
  } | null>(null);

  const runImport = async (result: OFXParseResult, fileName: string) => {
    const imported = await importTransactions(result.transactions, {
      fileName,
      account: result.account,
      startDate: result.startDate,
      endDate: result.endDate,
      ledgerBalance: result.ledgerBalance,
    });
    setLastImport(imported);
    setStatementsKey((k) => k + 1);
    // Leva o período até o extrato recém-importado, se ele estiver fora da janela atual.
    if (imported.latestDate && range && (imported.latestDate < range.start || imported.latestDate > range.end)) {
      jumpTo(imported.latestDate);
    }
  };

  /** Checa duplicidade antes de gravar: bloqueia o extrato repetido e confirma a sobreposição parcial. */
  const handleOFXParsed = async (result: OFXParseResult, fileName: string) => {
    try {
      const check = await checkImport(result.transactions);
      if (check.isFullDuplicate || check.isPartialOverlap) {
        setDuplicate({
          result,
          fileName,
          info: {
            kind: check.isFullDuplicate ? 'full' : 'partial',
            fileName,
            clientName: currentClient?.tradeName || currentClient?.name || 'selecionada',
            startDate: result.startDate,
            endDate: result.endDate,
            totalInFile: check.totalInFile,
            alreadyImportedCount: check.alreadyImportedCount,
            newCount: check.newTransactions.length,
            memoUpdateCount: check.memoUpdates.length,
          },
          memoUpdates: check.memoUpdates,
        });
        return;
      }
      await runImport(result, fileName);
    } catch {
      /* erro exposto pelo hook */
    }
  };

  const closeDuplicate = useCallback(() => setDuplicate(null), []);

  const confirmUpdateMemos = async () => {
    if (!duplicate) return;
    try {
      const { updated, skipped } = await updateMemos(duplicate.memoUpdates, duplicate.fileName);
      setToast(
        skipped > 0
          ? `${updated} descrição(ões) atualizada(s) · ${skipped} em competência fechada mantida(s)`
          : `${updated} descrição(ões) atualizada(s)`
      );
      setDuplicate(null);
    } catch {
      /* erro exposto pelo hook */
    }
  };

  const confirmImportNew = async () => {
    if (!duplicate) return;
    try {
      // A importação grava só os lançamentos inexistentes (a deduplicação é refeita no momento da gravação).
      await runImport(duplicate.result, duplicate.fileName);
    } catch {
      /* erro exposto pelo hook */
    } finally {
      setDuplicate(null);
    }
  };

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
      setToast('Conciliação desfeita · lançamento voltou para Pendente');
    } catch {
      /* erro exposto pelo hook */
    }
  };

  const handleSplit = async (drafts: SplitDraft[]) => {
    if (!selected) return;
    try {
      await splitTransaction(selected.id, drafts);
      setExpanded((prev) => new Set(prev).add(selected.id));
      setSelected(null);
      setToast(`Lançamento rateado em ${drafts.length} contas`);
    } catch {
      /* erro exposto pelo hook */
    }
  };

  const handleConfirm = async (accountId: string, learnRule: boolean, customPattern: string, matchType: RuleMatchType) => {
    if (!selected) return;
    try {
      const { propagated } = await classifyTransaction(selected.id, accountId, {
        learnRule,
        customPattern: customPattern.trim() || undefined,
        matchType,
      });
      setSelected(null);
      const verb = selected.status === 'PENDING' ? 'Conciliado' : 'Classificação atualizada';
      setToast(propagated > 0 ? `${verb} · ${propagated} semelhante(s) classificado(s)` : verb);
    } catch {
      /* erro exposto pelo hook */
    }
  };

  const handleApproveAll = async () => {
    try {
      const n = await approveAutoClassified();
      if (n > 0) setToast(`${n} lançamento(s) aprovado(s)`);
    } catch {
      /* erro exposto pelo hook */
    }
  };

  return (
    <main className={PAGE}>
      {/* Cabeçalho editorial */}
      <header className="space-y-1.5">
        <p className="text-[13px] font-medium text-stone-500">{currentClient?.tradeName || currentClient?.name || '—'}</p>
        <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-tight text-stone-900 dark:text-stone-50">
          Conciliação bancária
        </h1>
        <p className="text-[14px] text-stone-500 max-w-xl">
          Importe extratos e classifique lançamentos. Cada classificação memorizada ensina o sistema —{' '}
          <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{rules.length}</span> regra(s) ativa(s).
        </p>
      </header>

      <div className="space-y-2">
        <PeriodPicker period={period} />
        {clientId && range && (
          <MonthCloseBar
            month={selectedMonth}
            range={range}
            locks={locks}
            openItems={metrics.pending + metrics.autoClassified}
            busy={isSaving}
            onClose={async (m) => {
              await closeMonth(m);
              setToast(`Competência de ${formatMonth(m)} fechada`);
            }}
            onReopen={async (m, reason) => {
              await reopenMonth(m, reason);
              setToast(`Competência de ${formatMonth(m)} reaberta`);
            }}
          />
        )}
      </div>

      {/* Métricas */}
      <section
        aria-label="Resumo"
        className="rounded-[22px] overflow-hidden grid grid-cols-2 lg:grid-cols-4 gap-px bg-black/[0.05] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.04)]"
      >
        <Metric
          label={`Lançamentos · ${period.label}`}
          value={String(metrics.total)}
          caption={`${metrics.pending} pendente(s)`}
        />
        <Metric label="Conciliado" value={`${metrics.reconciledPercent}%`} tone="accent" progress={metrics.reconciledPercent} />
        <Metric label="Entradas" value={formatCurrency(metrics.credits)} tone="positive" caption="Créditos" />
        <Metric label="Saídas" value={formatCurrency(metrics.debits)} tone="negative" caption="Débitos" />
      </section>

      <OFXDropzone onParsed={handleOFXParsed} isLoading={isSaving} />
      {duplicate && (
        <DuplicateImportModal
          info={duplicate.info}
          busy={isSaving}
          onClose={closeDuplicate}
          onImportNew={() => void confirmImportNew()}
          onUpdateMemos={() => void confirmUpdateMemos()}
        />
      )}

      {(lastImport || error) && (
        <div className="space-y-2 animate-fade-in">
          {error && (
            <p className="px-4 py-3 rounded-2xl bg-rose-50 border border-rose-200/60 text-[13px] text-rose-700">{error}</p>
          )}
          {lastImport && (
            <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-2xl bg-white/70 border border-black/[0.06] text-[13px] text-stone-600">
              <span>
                <span className="font-mono tabular-nums font-medium text-stone-900">{lastImport.added}</span> importados ·{' '}
                <span className="font-mono tabular-nums font-medium text-[#0071E3]">{lastImport.autoClassified}</span> auto-classificados
                {lastImport.duplicates > 0 && (
                  <>
                    {' · '}
                    <span className="font-mono tabular-nums">{lastImport.duplicates}</span> duplicado(s) ignorado(s)
                  </>
                )}
                <span className="block mt-1 space-x-3">
                  <BalanceCheckBadge check={lastImport.balanceCheck} />
                  {lastImport.gaps.map((g) => (
                    <span key={g.from} className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700">
                      <AlertTriangle className="w-3 h-3" />
                      Falta extrato de {formatDateBR(g.from)} a {formatDateBR(g.to)}
                    </span>
                  ))}
                  {lastImport.outOfRange > 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
                      <AlertTriangle className="w-3 h-3" />
                      {lastImport.outOfRange} lançamento(s) fora do período declarado no arquivo
                    </span>
                  )}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setLastImport(null)}
                aria-label="Dispensar"
                className="p-1 rounded-lg text-stone-400 hover:text-stone-700 active:scale-[0.94] transition-all duration-150"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {clientId && <StatementPanel clientId={clientId} refreshKey={statementsKey} />}

      {hasBrokenText && (
        <p role="status" className="flex items-start gap-2 px-4 py-3 rounded-2xl bg-amber-50 border border-amber-200/60 text-[13px] text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Alguns históricos estão com acentuação quebrada (ex.: “transferÃªncia”) por importações antigas.{' '}
            <Link href="/contas" className="font-medium underline">Corrigir em Contas e Extratos</Link>
          </span>
        </p>
      )}

      <TransferPanel pairs={transferPairs} banks={banks} busy={isSaving} onReconcile={handleTransfers} />

      {/* Lançamentos */}
      <section ref={tableRef} className={`${SURFACE} rounded-[22px] overflow-hidden scroll-mt-6`}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between px-5 py-4 border-b border-black/[0.04] dark:border-white/[0.06]">
          <div role="tablist" className="inline-flex p-0.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] self-start">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={filter === f.value}
                onClick={() => setFilter(f.value)}
                className={`px-3 py-1 rounded-[10px] text-[12px] font-medium tracking-tight transition-all duration-150 active:scale-[0.97] ${
                  filter === f.value
                    ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]'
                    : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={approvable === 0 || isSaving}
            onClick={() => void handleApproveAll()}
            className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[13px] font-medium tracking-tight disabled:opacity-30 active:scale-[0.98] transition-all duration-150"
          >
            <CheckCheck className="w-4 h-4" strokeWidth={2} />
            Aprovar todos os auto-classificados
            <span className="font-mono tabular-nums text-[12px] px-1.5 rounded-full bg-white/20 dark:bg-black/10">{approvable}</span>
          </button>
        </div>

        {isLoading ? (
          <div className="divide-y divide-black/[0.04]">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 px-5 flex items-center gap-4">
                <div className="h-3 w-16 rounded bg-black/[0.05] animate-pulse" />
                <div className="h-3 flex-1 rounded bg-black/[0.05] animate-pulse" />
                <div className="h-3 w-20 rounded bg-black/[0.05] animate-pulse" />
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-[15px] font-medium tracking-tight text-stone-800 dark:text-stone-200">
              {transactions.length === 0 ? 'Nenhum lançamento ainda' : 'Nada por aqui'}
            </p>
            <p className="mt-1 text-[13px] text-stone-500">
              {transactions.length === 0 ? 'Importe um extrato OFX para começar.' : 'Nenhum lançamento neste filtro.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-stone-400 border-b border-black/[0.04] dark:border-white/[0.06]">
                  <th scope="col" className="font-medium pl-5 pr-3 py-2.5 w-24">Data</th>
                  <th scope="col" className="font-medium px-3 py-2.5">Descrição</th>
                  <th scope="col" className="font-medium px-3 py-2.5 hidden md:table-cell">Conta</th>
                  <th scope="col" className="font-medium px-3 py-2.5 w-28">Status</th>
                  <th scope="col" className="font-medium pl-3 pr-5 py-2.5 text-right w-36">Valor</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((t) => {
                  const splitCount = t.isSplit ? (t.splits?.length ?? 0) : 0;
                  const isExpanded = expanded.has(t.id);
                  const splitBadge = splitCount > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpanded(t.id);
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                      aria-expanded={isExpanded}
                      aria-controls={`split-${t.id}`}
                      title={t.splits?.map((sp) => `${sp.accountCode ?? ''} ${sp.accountName ?? ''}: ${formatCurrency(sp.amount)}`).join('\n')}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-0.5 rounded-full border text-[11px] font-medium bg-violet-50 text-violet-700 border-violet-200/60 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800/50 hover:bg-violet-100 active:scale-[0.97] transition-all duration-150"
                    >
                      <Split className="w-3 h-3" strokeWidth={2} />
                      Rateado em {splitCount} contas
                      <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>
                  );
                  return (
                    <React.Fragment key={t.id}>
                    <tr
                      // Todo lançamento abre o sheet: pendentes para classificar, os demais para editar/desfazer.
                      onClick={() => setSelected(t)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelected(t);
                        }
                      }}
                      tabIndex={0}
                      className="group border-b border-black/[0.04] dark:border-white/[0.05] last:border-0 cursor-pointer transition-colors duration-100 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] focus:outline-none focus-visible:bg-blue-50/50"
                    >
                      <td className="pl-5 pr-3 py-3 font-mono tabular-nums text-[12px] text-stone-400 whitespace-nowrap">
                        {formatDateBR(t.date)}
                      </td>
                      <td className="px-3 py-3 max-w-0 w-full">
                        <p title={t.memo} className="text-[14px] tracking-tight text-stone-900 dark:text-stone-100 truncate lg:whitespace-normal lg:break-words">
                          {t.memo}
                        </p>
                        {t.accountName && (
                          <p className="md:hidden text-[12px] text-stone-400 truncate">{t.accountName}</p>
                        )}
                        {splitBadge && <div className="md:hidden mt-1">{splitBadge}</div>}
                      </td>
                      <td className="px-3 py-3 hidden md:table-cell max-w-[240px] xl:max-w-[380px]">
                        {splitBadge ? (
                          splitBadge
                        ) : t.accountName ? (
                          <p className="text-[13px] text-stone-600 dark:text-stone-400 truncate">
                            <span className="font-mono tabular-nums text-[12px] text-stone-400 mr-1.5">{t.accountCode}</span>
                            {t.accountName}
                          </p>
                        ) : (
                          <span className="text-[13px] text-stone-300 dark:text-stone-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          <StatusBadge status={t.status} />
                          {t.transferPairId && (
                            <ArrowLeftRight aria-label="Transferência entre contas próprias" className="w-3.5 h-3.5 text-sky-600" />
                          )}
                          {t.clientQuery?.status === 'OPEN' && (
                            <MessageCircleQuestion aria-label="Aguardando resposta do cliente" className="w-3.5 h-3.5 text-amber-600" />
                          )}
                          {isMonthLocked(t.date, lockedMonths) && (
                            <Lock aria-label="Competência fechada" className="w-3 h-3 text-stone-400" />
                          )}
                          {t.status !== 'PENDING' && (
                            <Pencil
                              aria-hidden
                              className="w-3.5 h-3.5 text-stone-400 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity"
                            />
                          )}
                        </span>
                      </td>
                      <td
                        className={`pl-3 pr-5 py-3 text-right font-mono tabular-nums text-[13px] whitespace-nowrap ${
                          t.amount < 0 ? 'text-stone-900 dark:text-stone-100' : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {formatCurrency(t.amount)}
                      </td>
                    </tr>
                    {splitCount > 0 && isExpanded && (
                      <tr id={`split-${t.id}`} className="border-b border-black/[0.04] dark:border-white/[0.05] bg-stone-900/[0.015] dark:bg-white/[0.02]">
                        <td />
                        <td colSpan={4} className="px-3 pb-3 pt-1 pr-5">
                          <ul className="rounded-2xl border border-black/[0.05] dark:border-white/[0.06] bg-white/70 dark:bg-stone-900/40 divide-y divide-black/[0.04] dark:divide-white/[0.05] animate-fade-in">
                            {t.splits?.map((sp) => (
                              <li key={sp.id} className="flex items-baseline gap-3 px-4 py-2 text-[13px]">
                                <span className="w-24 shrink-0 font-mono tabular-nums text-[11px] text-stone-400">{sp.accountCode}</span>
                                <span className="flex-1 min-w-0 truncate text-stone-700 dark:text-stone-300">
                                  {sp.accountName}
                                  {sp.memo && <span className="ml-2 text-stone-400">· {sp.memo}</span>}
                                </span>
                                <span className="font-mono tabular-nums text-stone-900 dark:text-stone-100 whitespace-nowrap">
                                  {formatCurrency(sp.amount)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            {visible.length > PAGE_SIZE && (
              <nav
                aria-label="Paginação"
                className="flex items-center justify-between gap-3 px-5 py-3 border-t border-black/[0.04] dark:border-white/[0.06] text-[12px] text-stone-500"
              >
                <span className="font-mono tabular-nums">
                  {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, visible.length)} de {visible.length}
                </span>
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => goToPage(currentPage - 1)}
                    disabled={currentPage === 0}
                    className="h-8 px-3 rounded-full hover:bg-black/[0.05] disabled:opacity-30 active:scale-[0.97] transition-all duration-150"
                  >
                    Anterior
                  </button>
                  <span className="font-mono tabular-nums px-1">
                    {currentPage + 1}/{pageCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => goToPage(currentPage + 1)}
                    disabled={currentPage >= pageCount - 1}
                    className="h-8 px-3 rounded-full hover:bg-black/[0.05] disabled:opacity-30 active:scale-[0.97] transition-all duration-150"
                  >
                    Próxima
                  </button>
                </span>
              </nav>
            )}
          </div>
        )}
      </section>

      {selected && (
        <ClassifySheet
          key={selected.id}
          transaction={selected}
          accounts={accounts}
          isSaving={isSaving}
          onClose={() => setSelected(null)}
          onConfirm={handleConfirm}
          onSplit={handleSplit}
          onUnreconcile={handleUnreconcile}
          rules={rules}
          lockedMonthLabel={isMonthLocked(selected.date, lockedMonths) ? formatMonth(monthOf(selected.date)) : null}
          loadAudit={() => loadAudit(selected.id)}
          onAskClient={async (question) => {
            try {
              await askClient(selected.id, question);
              setSelected(null);
              setToast(question.trim() ? 'Pergunta registrada · veja em Pendências do cliente' : 'Pergunta removida');
            } catch {
              /* erro exposto pelo hook */
            }
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full bg-stone-900/90 dark:bg-stone-100/90 text-white dark:text-stone-900 text-[13px] tracking-tight shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-xl animate-sheet-in"
        >
          {toast}
        </div>
      )}
    </main>
  );
}
