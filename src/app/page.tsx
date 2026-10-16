'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCheck } from 'lucide-react';
import type { BankAccount, ChartAccount, ReconciliationStatus } from '@/types/firestore';
import { getAccounts, getLatestTransactionDate, getRepository } from '@/lib/services/data-service';
import { useClient } from '@/contexts/ClientContext';
import { useReconciliation } from '@/hooks/useReconciliation';
import { useBulkSelection } from '@/hooks/reconciliation/useBulkSelection';
import { useClassificationFlow } from '@/hooks/reconciliation/useClassificationFlow';
import { useImportFlow } from '@/hooks/reconciliation/useImportFlow';
import { usePagination } from '@/hooks/usePagination';
import { useTableKeyboard } from '@/hooks/useTableKeyboard';
import { PeriodPicker, usePeriod } from '@/components/ui/PeriodPicker';
import { PAGE, SEGMENT_PILL, SearchField, SegmentedControl, SURFACE, segmentClass } from '@/components/ui/primitives';
import { useSlidingIndicator } from '@/components/ui/useSlidingIndicator';
import { DuplicateImportModal } from '@/components/ui/DuplicateImportModal';
import { Toast, useToast } from '@/components/ui/Toast';
import { OFXDropzone } from '@/components/conciliacao/OFXDropzone';
import { ClassifySheet } from '@/components/conciliacao/ClassifySheet';
import { GroupClassifySheet, PayeeGroupList } from '@/components/conciliacao/PayeeGroups';
import { MonthCloseBar } from '@/components/conciliacao/MonthCloseBar';
import { StatementPanel } from '@/components/conciliacao/StatementPanel';
import { TransferPanel } from '@/components/conciliacao/TransferPanel';
import { MetricsSummary } from '@/components/conciliacao/MetricsSummary';
import { ImportSummary } from '@/components/conciliacao/ImportSummary';
import { TransactionTable } from '@/components/conciliacao/TransactionTable';
import { BulkActionBar } from '@/components/conciliacao/BulkActionBar';
import { BulkClassifyModal } from '@/components/conciliacao/BulkClassifyModal';
import { BulkAskClientModal } from '@/components/conciliacao/BulkAskClientModal';
import { KeyboardHelpModal } from '@/components/conciliacao/KeyboardHelpModal';
import { groupByPayee } from '@/lib/payee';
import { formatMonth, isMonthLocked, monthOf } from '@/lib/periods';
import { hasMojibake } from '@/lib/ofx/encoding';
import { findTransferPairs } from '@/lib/transfers';
import { matchTransaction } from '@/lib/utils/search';

/** Linhas por página na tabela de lançamentos. */
const PAGE_SIZE = 50;

type Filter = 'ALL' | ReconciliationStatus;

const loadFailure = (what: string, e: unknown): string => {
  console.error(`Erro ao carregar ${what}:`, e);
  return `Não foi possível carregar ${what} (${e instanceof Error && e.message ? e.message : 'erro desconhecido'}). Recarregue a página para tentar de novo.`;
};

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'PENDING', label: 'Pendentes' },
  { value: 'AUTO_CLASSIFIED', label: 'Auto' },
  { value: 'RECONCILED', label: 'Conciliados' },
];

/**
 * Conciliação bancária. A tela só compõe: os dados e as gravações vêm de `useReconciliation`,
 * e cada fluxo de interação tem o seu hook em src/hooks/reconciliation/ — importação de
 * extratos (`useImportFlow`), classificação (`useClassificationFlow`) e seleção em lote
 * (`useBulkSelection`).
 */
export default function ConciliacaoPage() {
  const { currentClient } = useClient();
  const clientId = currentClient?.id ?? null;

  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [filter, setFilter] = useState<Filter>('ALL');
  const { containerRef: filterTabsRef, indicatorRef: filterPillRef } = useSlidingIndicator<HTMLDivElement>(filter);
  const [searchQuery, setSearchQuery] = useState('');
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useToast();
  // Falha ao carregar os cadastros da empresa: sem eles a tela pareceria apenas vazia.
  const [loadError, setLoadError] = useState<{ id: string; message: string } | null>(null);

  // Período consultado no banco. Ao trocar de cliente, posiciona no mês do lançamento
  // mais recente; até lá o hook não carrega nada (evita buscar o histórico inteiro).
  const period = usePeriod('month');
  const { jumpTo, setMode } = period;
  const [positionedFor, setPositionedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    const repo = getRepository();

    repo.listBankAccounts(clientId)
      .then((banks) => active && setBankAccounts(banks))
      .catch((e: unknown) => active && setLoadError({ id: clientId, message: loadFailure('as contas bancárias', e) }));

    getLatestTransactionDate(clientId)
      .then((latest) => {
        if (!active) return;
        // Links do painel: /?mes=AAAA-MM[&filtro=PENDING|AUTO_CLASSIFIED] abrem o mês (e o filtro) pedidos.
        const params = new URLSearchParams(window.location.search);
        const mes = params.get('mes');
        const filtro = params.get('filtro');
        if (mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
          setMode('month');
          jumpTo(`${mes}-01`);
          if (filtro === 'PENDING' || filtro === 'AUTO_CLASSIFIED') setFilter(filtro);
        } else if (latest) jumpTo(latest);
        setPositionedFor(clientId);
      })
      .catch((e) => {
        console.error('Erro ao localizar o período mais recente:', e);
        if (active) setPositionedFor(clientId);
      });
    return () => {
      active = false;
    };
  }, [clientId, jumpTo, setMode]);
  const range = clientId && positionedFor === clientId ? period.range : null;

  const recon = useReconciliation({ clientId, accounts, range });
  const { transactions, rules, metrics, isLoading, isSaving, error, locks, lockedMonths, closeMonth, reopenMonth, loadAudit } = recon;
  const selectedMonth = period.mode === 'month' ? `${period.year}-${String(period.month).padStart(2, '0')}` : null;
  const [statementsKey, setStatementsKey] = useState(0);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    getAccounts(clientId)
      .then((list) => active && setAccounts(list))
      .catch((e: unknown) => active && setLoadError({ id: clientId, message: loadFailure('o plano de contas', e) }));
    return () => {
      active = false;
    };
  }, [clientId]);

  // Contas bancárias (nomes nas transferências); recarrega após cada importação.
  const [banks, setBanks] = useState<BankAccount[]>([]);
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    getRepository()
      .listBankAccounts(clientId)
      .then((b) => active && setBanks(b))
      .catch((e: unknown) => active && setLoadError({ id: clientId, message: loadFailure('as contas bancárias', e) }));
    return () => {
      active = false;
    };
  }, [clientId, statementsKey]);

  // Históricos de importações antigas com acentuação quebrada: a correção fica em Contas e Extratos.
  const hasBrokenText = useMemo(() => transactions.some((t) => hasMojibake(t.memo)), [transactions]);
  const transferPairs = useMemo(() => findTransferPairs(transactions, { lockedMonths }), [transactions, lockedMonths]);

  /* ── Classificação ─────────────────────────────────────────────────── */
  const flow = useClassificationFlow({
    clientId,
    accounts,
    lockedMonths,
    classifyTransaction: recon.classifyTransaction,
    classifyMany: recon.classifyMany,
    splitTransaction: recon.splitTransaction,
    unreconcileTransaction: recon.unreconcileTransaction,
    approveAutoClassified: recon.approveAutoClassified,
    reconcileTransfers: recon.reconcileTransfers,
    askClient: recon.askClient,
    onAccountCreated: (account) => setAccounts((prev) => [...prev, account]),
    notify: setToast,
  });
  const { selected } = flow;

  /* ── Lista: filtro, busca, visão por favorecido e paginação ────────── */
  const visible = useMemo(() => {
    const byFilter = filter === 'ALL' ? transactions : transactions.filter((t) => t.status === filter);
    return searchQuery.trim() ? byFilter.filter((t) => matchTransaction(t, searchQuery)) : byFilter;
  }, [transactions, filter, searchQuery]);

  // Visão por favorecido: pendentes de competência aberta, agrupados por quem pagou/recebeu.
  const [view, setView] = useState<'list' | 'payee'>('list');
  const payeeGroups = useMemo(
    () => groupByPayee(transactions.filter((t) => t.status === 'PENDING' && !t.transferPairId && !isMonthLocked(t.date, lockedMonths))),
    [transactions, lockedMonths]
  );
  const memoPool = useMemo(() => transactions.map((t) => t.memo), [transactions]);

  // Volta à 1ª página ao trocar filtro, busca, período ou cliente.
  const { currentPage, pageCount, rows: pageRows, setPage } = usePagination(
    visible,
    PAGE_SIZE,
    `${clientId}|${filter}|${searchQuery}|${range?.start}|${range?.end}`
  );
  const tableRef = useRef<HTMLElement>(null);
  const goToPage = (next: number) => {
    setPage(next);
    tableRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const approvable = useMemo(
    () => transactions.filter((t) => t.status === 'AUTO_CLASSIFIED' && t.accountId && !isMonthLocked(t.date, lockedMonths)).length,
    [transactions, lockedMonths]
  );

  /* ── Seleção múltipla e ações em lote ──────────────────────────────── */
  const bulk = useBulkSelection({
    transactions,
    pageRows,
    classifyMany: recon.classifyMany,
    askClient: recon.askClient,
    reconcileTransferPairs: flow.handleTransfers,
    notify: setToast,
  });

  /* ── Importação de extratos ────────────────────────────────────────── */
  const importFlow = useImportFlow({
    clientId,
    clientName: currentClient?.tradeName || currentClient?.name || 'selecionada',
    range,
    jumpTo,
    checkImport: recon.checkImport,
    importTransactions: recon.importTransactions,
    updateMemos: recon.updateMemos,
    onStatementsChanged: () => setStatementsKey((k) => k + 1),
    notify: setToast,
  });
  const { duplicate } = importFlow;

  // Atalhos de teclado para conciliação rápida (suspensos enquanto houver um diálogo aberto).
  const isAnyModalOpen = Boolean(selected || flow.groupSheet || duplicate || bulk.showBulkClassify || bulk.showBulkAsk || showKeyboardHelp);
  const { focusedIndex } = useTableKeyboard({
    items: pageRows,
    getId: (t) => t.id,
    disabled: isAnyModalOpen,
    onOpenClassify: (t) => flow.openTransaction(t),
    onToggleSelect: (id) => bulk.toggleSelect(id),
    onApprove: flow.approveOne,
    onClearSelection: () => {
      if (bulk.selectedIds.size > 0) bulk.clearSelection();
      else if (searchQuery) setSearchQuery('');
    },
    onFocusSearch: () => {
      searchInputRef.current?.focus();
    },
    onToggleHelp: () => {
      setShowKeyboardHelp((prev) => !prev);
    },
  });

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
      {loadError && loadError.id === clientId && (
        <p role="alert" className="text-[13px] text-rose-600">
          {loadError.message}
        </p>
      )}

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

      <MetricsSummary metrics={metrics} periodLabel={period.label} />

      <OFXDropzone
        onParsed={importFlow.handleOFXParsed}
        onParsedBatch={importFlow.handleOFXParsedBatch}
        isLoading={isSaving}
        bankAccounts={bankAccounts}
        clientId={clientId || ''}
      />
      {duplicate && (
        <DuplicateImportModal
          info={duplicate.info}
          busy={isSaving}
          onClose={importFlow.closeDuplicate}
          onImportNew={() => void importFlow.confirmImportNew()}
          onUpdateMemos={() => void importFlow.confirmUpdateMemos()}
        />
      )}

      <ImportSummary lastImport={importFlow.lastImport} error={error} onDismiss={importFlow.dismissLastImport} />

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

      <TransferPanel pairs={transferPairs} banks={banks} busy={isSaving} onReconcile={flow.handleTransfers} />

      {/* Lançamentos */}
      <section ref={tableRef} className={`${SURFACE} rounded-[22px] overflow-hidden scroll-mt-6`}>
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 justify-between px-5 py-4 border-b border-black/[0.04] dark:border-white/[0.06]">
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              ariaLabel="Visão dos lançamentos"
              value={view}
              onChange={setView}
              options={[
                { value: 'list', label: 'Lista' },
                { value: 'payee', label: 'Por favorecido' },
              ]}
            />
            <div
              ref={filterTabsRef}
              role="tablist"
              className={`${view === 'list' ? 'inline-flex' : 'hidden'} relative p-0.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] self-start`}
            >
              <span ref={filterPillRef} aria-hidden className={SEGMENT_PILL} />
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.value}
                  data-active={filter === f.value}
                  onClick={() => setFilter(f.value)}
                  className={segmentClass(filter === f.value)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {view === 'list' && (
              <div className="flex items-center gap-1.5 flex-1 sm:flex-initial">
                <SearchField
                  inputRef={searchInputRef}
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Buscar histórico, valor, conta ou fitid (pressione /)"
                  className="w-full sm:w-64 md:w-80"
                />
                <button
                  type="button"
                  onClick={() => setShowKeyboardHelp(true)}
                  title="Atalhos de teclado (?)"
                  aria-label="Atalhos de teclado"
                  className="hidden sm:inline-flex shrink-0 items-center justify-center w-10 h-10 rounded-xl text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 bg-black/[0.03] dark:bg-white/[0.05] hover:bg-black/[0.06] transition-colors"
                >
                  <kbd className="font-mono text-[12px] font-semibold">?</kbd>
                </button>
              </div>
            )}

            <button
              type="button"
              disabled={approvable === 0 || isSaving}
              onClick={() => void flow.handleApproveAll()}
              className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[13px] font-medium tracking-tight disabled:opacity-30 active:scale-[0.98] transition-all duration-150"
            >
              <CheckCheck className="w-4 h-4" strokeWidth={2} />
              Aprovar todos os auto-classificados
              <span className="font-mono tabular-nums text-[12px] px-1.5 rounded-full bg-white/20 dark:bg-black/10">{approvable}</span>
            </button>
          </div>
        </div>

        {view === 'payee' && !isLoading ? (
          <PayeeGroupList groups={payeeGroups} onOpen={flow.openGroup} />
        ) : isLoading ? (
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
              {transactions.length === 0 ? 'Importe um extrato OFX para começar.' : 'Nenhum lançamento neste filtro ou busca.'}
            </p>
          </div>
        ) : (
          <TransactionTable
            rows={pageRows}
            lockedMonths={lockedMonths}
            selectedIds={bulk.selectedIds}
            focusedIndex={focusedIndex}
            expanded={flow.expanded}
            onOpen={flow.openTransaction}
            onToggleSelect={bulk.toggleSelect}
            onToggleSelectAllPage={bulk.toggleSelectAllPage}
            onToggleExpanded={flow.toggleExpanded}
            total={visible.length}
            pageSize={PAGE_SIZE}
            currentPage={currentPage}
            pageCount={pageCount}
            onGoToPage={goToPage}
          />
        )}
      </section>

      {selected && (
        <ClassifySheet
          key={selected.id}
          transaction={selected}
          accounts={accounts}
          isSaving={isSaving}
          onClose={flow.closeTransaction}
          onConfirm={flow.handleConfirm}
          onSplit={flow.handleSplit}
          onUnreconcile={flow.handleUnreconcile}
          rules={rules}
          memoPool={memoPool}
          lockedMonthLabel={isMonthLocked(selected.date, lockedMonths) ? formatMonth(monthOf(selected.date)) : null}
          loadAudit={() => loadAudit(selected.id)}
          onAskClient={flow.handleAskClient}
        />
      )}

      {flow.groupSheet && (
        <GroupClassifySheet
          key={flow.groupSheet.id}
          group={flow.groupSheet}
          accounts={accounts}
          pool={transactions}
          isSaving={isSaving}
          onClose={flow.closeGroup}
          onConfirm={flow.handleGroupConfirm}
        />
      )}

      <BulkActionBar
        selectedCount={bulk.selectedIds.size}
        totalDebits={bulk.selectedDebits}
        totalCredits={bulk.selectedCredits}
        canMatchTransfer={bulk.canMatchTransfer}
        isSaving={isSaving}
        onClassify={() => bulk.setShowBulkClassify(true)}
        onAskClient={() => bulk.setShowBulkAsk(true)}
        onMatchTransfer={() => void bulk.handleBulkTransfer()}
        onClearSelection={bulk.clearSelection}
      />

      <BulkClassifyModal
        isOpen={bulk.showBulkClassify}
        transactions={bulk.selectedTransactions}
        accounts={accounts}
        memoPool={memoPool}
        isSaving={isSaving}
        onClose={() => bulk.setShowBulkClassify(false)}
        onConfirm={bulk.handleConfirmBulkClassify}
      />

      <BulkAskClientModal
        isOpen={bulk.showBulkAsk}
        transactions={bulk.selectedTransactions}
        isSaving={isSaving}
        onClose={() => bulk.setShowBulkAsk(false)}
        onConfirm={bulk.handleConfirmBulkAsk}
      />

      <KeyboardHelpModal isOpen={showKeyboardHelp} onClose={() => setShowKeyboardHelp(false)} />

      <Toast message={toast} />
    </main>
  );
}
