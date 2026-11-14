'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import type { RuleMatchType } from '@/types/firestore';
import { useClient } from '@/contexts/ClientContext';
import { useReconciliation } from '@/hooks/useReconciliation';
import { useBulkSelection } from '@/hooks/reconciliation/useBulkSelection';
import { useClassificationFlow } from '@/hooks/reconciliation/useClassificationFlow';
import { useImportFlow } from '@/hooks/reconciliation/useImportFlow';
import { useInvoiceMatches } from '@/hooks/reconciliation/useInvoiceMatches';
import { useAccountSuggestions } from '@/hooks/reconciliation/useAccountSuggestions';
import { useConciliationSetup } from '@/hooks/reconciliation/useConciliationSetup';
import { useInvoiceInspector } from '@/hooks/reconciliation/useInvoiceInspector';
import { useMonthRoutineNotice } from '@/hooks/reconciliation/useMonthRoutineNotice';
import { usePagination } from '@/hooks/usePagination';
import { useTableKeyboard } from '@/hooks/useTableKeyboard';
import { PeriodPicker } from '@/components/ui/PeriodPicker';
import { PAGE, SURFACE } from '@/components/ui/primitives';
import { DuplicateImportModal } from '@/components/ui/DuplicateImportModal';
import { Toast, useToast } from '@/components/ui/Toast';
import { CSVImportModal, FileDropOverlay, ImportButton, ImportEmptyState, ImportFeedback, useStatementFiles } from '@/components/conciliacao/StatementImport';
import { ClassifySheet } from '@/components/conciliacao/ClassifySheet';
import { GroupClassifySheet, PayeeGroupList } from '@/components/conciliacao/PayeeGroups';
import { MonthCloseBar } from '@/components/conciliacao/MonthCloseBar';
import { StatementChip, StatementDetails, useStatementBatches } from '@/components/conciliacao/StatementPanel';
import { TransferPanel } from '@/components/conciliacao/TransferPanel';
import { MetricsSummary } from '@/components/conciliacao/MetricsSummary';
import { ImportSummary } from '@/components/conciliacao/ImportSummary';
import { TransactionTable } from '@/components/conciliacao/TransactionTable';
import { TransactionListToolbar, type ListView } from '@/components/conciliacao/TransactionListToolbar';
import { BulkActionBar } from '@/components/conciliacao/BulkActionBar';
import { BulkClassifyModal } from '@/components/conciliacao/BulkClassifyModal';
import { BulkAskClientModal } from '@/components/conciliacao/BulkAskClientModal';
import { KeyboardHelpModal } from '@/components/conciliacao/KeyboardHelpModal';
import { InvoiceDetailDrawer } from '@/components/conciliacao/InvoiceDetailDrawer';
import { usePayeeGroupsWorker } from '@/hooks/useRulesWorker';
import type { SplitDraft } from '@/lib/splits';
import { formatMonth, isMonthLocked, monthOf } from '@/lib/periods';
import { hasMojibake } from '@/lib/ofx/encoding';
import { findTransferPairs } from '@/lib/transfers';
import { approvableIds, bankFilterOptions, bankNamesByKey, filterByBank, mainSplitAccountId, payeeCandidates, visibleTransactions, type StatusFilter } from '@/lib/reconciliation-list';
import { TableSkeleton } from '@/components/ui/Skeleton';

/** Linhas por página na tabela de lançamentos. */
const PAGE_SIZE = 50;

/**
 * Conciliação bancária. A tela só compõe: os dados e as gravações vêm de `useReconciliation`,
 * os cadastros e o período de `useConciliationSetup`, e cada fluxo de interação tem o seu hook
 * em src/hooks/reconciliation/ — importação de extratos (`useImportFlow`), classificação
 * (`useClassificationFlow`), seleção em lote (`useBulkSelection`) e rotinas do mês
 * (`useMonthRoutineNotice`).
 */
export default function ConciliacaoPage() {
  const { currentClient } = useClient();
  const clientId = currentClient?.id ?? null;

  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [bankFilter, setBankFilter] = useState<string>('ALL');
  const [lastBankClientId, setLastBankClientId] = useState<string | null>(clientId);
  if (lastBankClientId !== clientId) {
    setLastBankClientId(clientId);
    setBankFilter('ALL');
  }
  const [searchQuery, setSearchQuery] = useState('');
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useToast();
  const [statementsKey, setStatementsKey] = useState(0);

  const setup = useConciliationSetup(clientId, statementsKey, (link) => {
    if (link.bank) setBankFilter(link.bank);
    if (link.filter) setFilter(link.filter);
  });
  const { period, range, selectedMonth, accounts, banks } = setup;
  const { jumpTo } = period;

  const recon = useReconciliation({ clientId, accounts, range });
  const { transactions, rules, metrics, isLoading, isSaving, error, locks, lockedMonths, closeMonth, reopenMonth, loadAudit } = recon;
  const depreciationNotice = useMonthRoutineNotice(clientId, selectedMonth, Boolean(selectedMonth && lockedMonths.has(selectedMonth)), setToast);

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
    undoChange: recon.undoChange,
    onAccountCreated: setup.addAccount,
    notify: (message, action) => setToast(action ? { message, action } : message),
  });
  const { selected } = flow;

  // Notas fiscais importadas: casam com os lançamentos e sugerem a conta (src/lib/nfe/match.ts).
  const invoices = useInvoiceMatches({ clientId, range, transactions, accounts });
  const inspector = useInvoiceInspector(invoices);
  const confirmClassification = async (accountId: string, learnRule: boolean, pattern: string, matchType: RuleMatchType, invoiceId?: string) => {
    const txId = selected?.id;
    const saved = await flow.handleConfirm(accountId, learnRule, pattern, matchType);
    if (saved && txId && invoiceId) await invoices.link(txId, invoiceId, accountId);
  };
  // Rateio com a nota aceita: o vínculo guarda a conta da maior linha (a despesa ou receita).
  const confirmSplit = async (drafts: SplitDraft[], invoiceId?: string) => {
    const txId = selected?.id;
    const saved = await flow.handleSplit(drafts);
    const mainAccountId = mainSplitAccountId(drafts);
    if (saved && txId && invoiceId && mainAccountId) await invoices.link(txId, invoiceId, mainAccountId);
  };

  /* ── Lista: filtro por conta, status, busca, visão por favorecido e paginação ── */
  const bankNames = useMemo(() => bankNamesByKey(banks), [banks]);
  const bankOptions = useMemo(() => bankFilterOptions(banks, transactions), [banks, transactions]);
  const byBank = useMemo(() => filterByBank(transactions, bankFilter), [transactions, bankFilter]);
  const visible = useMemo(() => visibleTransactions(byBank, filter, searchQuery), [byBank, filter, searchQuery]);

  // Visão por favorecido: pendentes de competência aberta, agrupados por quem pagou/recebeu (em Web Worker para volumes altos).
  const [view, setView] = useState<ListView>('list');
  const payeePool = useMemo(() => payeeCandidates(byBank, lockedMonths), [byBank, lockedMonths]);
  const payeeGroups = usePayeeGroupsWorker(payeePool);
  const memoPool = useMemo(() => transactions.map((t) => t.memo), [transactions]);

  // Volta à 1ª página ao trocar filtro, conta, busca, período ou cliente.
  const { currentPage, pageCount, rows: pageRows, setPage } = usePagination(
    visible,
    PAGE_SIZE,
    `${clientId}|${filter}|${bankFilter}|${searchQuery}|${range?.start}|${range?.end}`
  );
  const tableRef = useRef<HTMLElement>(null);
  const goToPage = (next: number) => {
    setPage(next);
    tableRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const approvable = useMemo(() => approvableIds(byBank, lockedMonths), [byBank, lockedMonths]);

  /* ── Seleção múltipla e ações em lote ──────────────────────────────── */
  const bulk = useBulkSelection({
    transactions,
    pageRows,
    classifyMany: recon.classifyMany,
    askClient: recon.askClient,
    reconcileTransferPairs: flow.handleTransfers,
    notify: setToast,
    offerUndo: flow.offerUndo,
    clientId,
  });

  // Contas sugeridas em cada seletor (nota fiscal, mesmo favorecido, recentes, mais usadas).
  const suggestions = useAccountSuggestions({
    clientId,
    accounts,
    transactions,
    selected,
    invoiceAccountId: selected ? inspector.matchFor(selected)?.suggestedAccountId : null,
    group: flow.groupSheet,
    bulk: bulk.showBulkClassify ? bulk.selectedTransactions : null,
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
  // Leitura dos arquivos: botão do cabeçalho, arrastar na página e tabela vazia.
  const statementFiles = useStatementFiles({ onParsedBatch: importFlow.handleOFXParsedBatch, isSaving });
  const statements = useStatementBatches(clientId, statementsKey);
  const [statementsOpen, setStatementsOpen] = useState(false);

  // Atalhos de teclado para conciliação rápida (suspensos enquanto houver um diálogo aberto).
  const isAnyModalOpen = Boolean(
    selected ||
      inspector.inspecting ||
      flow.groupSheet ||
      duplicate ||
      bulk.showBulkClassify ||
      bulk.showBulkAsk ||
      showKeyboardHelp ||
      statementFiles.csvQueue.length > 0
  );
  const { focusedIndex } = useTableKeyboard({
    items: pageRows,
    getId: (t) => t.id,
    disabled: isAnyModalOpen,
    onOpenClassify: (t) => flow.openTransaction(t, 'single'),
    onOpenSplit: (t) => flow.openTransaction(t, 'split'),
    onOpenInvoice: inspector.openFor,
    onToggleSelect: (id) => bulk.toggleSelect(id),
    onToggleSelectAll: () => bulk.toggleSelectAllPage(),
    onApprove: flow.approveOne,
    onPrevPage: () => {
      if (currentPage > 0) goToPage(currentPage - 1);
    },
    onNextPage: () => {
      if (currentPage < pageCount - 1) goToPage(currentPage + 1);
    },
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
      {/* Cabeçalho editorial, com a importação de extratos */}
      <header className="flex flex-wrap items-end justify-between gap-4 pb-5 border-b-[3px] border-double border-line-strong">
        <div className="space-y-2 min-w-0">
          {(currentClient?.tradeName || currentClient?.name) && (
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-accent-ink">
              <span aria-hidden className="w-1.5 h-1.5 rounded-[2px] bg-accent rotate-45 shrink-0" />
              <span className="truncate">{currentClient?.tradeName || currentClient?.name}</span>
            </p>
          )}
          <h1 className="font-serif text-[36px] leading-[1.08] font-medium text-stone-900 dark:text-stone-50">Conciliação bancária</h1>
          <p className="text-[14px] leading-relaxed text-stone-500 dark:text-stone-400">
            Classifique os lançamentos; cada classificação memorizada ensina o sistema —{' '}
            <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{rules.length}</span> regra(s) ativa(s).
          </p>
        </div>
        {clientId && <ImportButton files={statementFiles} />}
      </header>
      {clientId && <FileDropOverlay files={statementFiles} disabled={isAnyModalOpen} />}
      <ImportFeedback files={statementFiles} />
      <CSVImportModal
        files={statementFiles}
        bankAccounts={banks}
        accounts={accounts}
        clientId={clientId || ''}
        onBankAccountUpdated={setup.updateBank}
      />
      {setup.loadError && (
        <p role="alert" className="text-[13px] text-rose-600 dark:text-rose-300">
          {setup.loadError}
        </p>
      )}

      <div className="space-y-2">
        <PeriodPicker period={period} />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        {clientId && range ? (
          <MonthCloseBar
            month={selectedMonth}
            range={range}
            locks={locks}
            openItems={metrics.pending + metrics.autoClassified}
            busy={isSaving}
            depreciation={depreciationNotice}
            onClose={async (m) => {
              await closeMonth(m);
              setToast(`Competência de ${formatMonth(m)} fechada`);
            }}
            onReopen={async (m, reason) => {
              await reopenMonth(m, reason);
              setToast(`Competência de ${formatMonth(m)} reaberta`);
            }}
          />
        ) : (
          <span />
        )}
        <StatementChip summary={statements} open={statementsOpen} onToggle={() => setStatementsOpen((v) => !v)} />
        </div>
      </div>

      {statementsOpen && <StatementDetails summary={statements} />}

      <MetricsSummary metrics={metrics} periodLabel={period.label} />

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

      {hasBrokenText && (
        <p role="status" className="flex items-start gap-2 px-4 py-3 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200/60 dark:border-amber-500/25 text-[13px] text-amber-800 dark:text-amber-300">
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
        <TransactionListToolbar
          view={view}
          onViewChange={setView}
          filter={filter}
          onFilterChange={setFilter}
          bankFilter={bankFilter}
          onBankFilterChange={setBankFilter}
          bankOptions={bankOptions}
          totalCount={transactions.length}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchInputRef={searchInputRef}
          onShowHelp={() => setShowKeyboardHelp(true)}
          approvableCount={approvable.size}
          isSaving={isSaving}
          onApproveAll={() => void flow.handleApproveAll(bankFilter !== 'ALL' ? approvable : undefined)}
        />

        {view === 'payee' && !isLoading ? (
          <PayeeGroupList groups={payeeGroups} onOpen={flow.openGroup} />
        ) : isLoading ? (
          <TableSkeleton rows={6} label="Carregando lançamentos…" />
        ) : visible.length === 0 ? (
          <ImportEmptyState files={statementFiles} hasAnyTransaction={transactions.length > 0} />
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
            bankNamesByKey={bankFilter === 'ALL' && bankOptions.length > 1 ? bankNames : undefined}
            invoiceHints={inspector.hints}
            onOpenInvoice={inspector.openFor}
          />
        )}
      </section>

      {selected && (
        <ClassifySheet
          key={`${selected.id}-${flow.sheetInitialMode ?? 'default'}`}
          transaction={selected}
          accounts={accounts}
          isSaving={isSaving}
          onClose={flow.closeTransaction}
          onConfirm={confirmClassification}
          onSplit={confirmSplit}
          onUnreconcile={flow.handleUnreconcile}
          rules={rules}
          memoPool={memoPool}
          lockedMonthLabel={isMonthLocked(selected.date, lockedMonths) ? formatMonth(monthOf(selected.date)) : null}
          loadAudit={() => loadAudit(selected.id)}
          onAskClient={flow.handleAskClient}
          invoiceMatch={inspector.matchFor(selected)}
          linkedInvoice={invoices.linked.get(selected.id)}
          suggestions={suggestions.forSelected}
          regime={currentClient?.regime}
          floatingContracts={setup.floatingContracts}
          investmentAccountIds={setup.investmentAccountIds}
          initialMode={flow.sheetInitialMode}
          onViewInvoice={(inv) => inspector.show({ invoice: inv, match: inspector.matchFor(selected), transaction: selected })}
        />
      )}

      {inspector.inspecting && (
        <InvoiceDetailDrawer
          invoice={inspector.inspecting.invoice}
          match={inspector.inspecting.match}
          transaction={inspector.inspecting.transaction}
          accounts={accounts}
          onClose={inspector.close}
          onClassifyWithSuggestion={(tx, accId, invId) => {
            inspector.close();
            void (async () => {
              try {
                const { undo: plan } = await recon.classifyTransaction(tx.id, accId);
                await invoices.link(tx.id, invId, accId);
                flow.offerUndo('Lançamento classificado pela nota fiscal', plan);
              } catch {
                /* erro exposto pelo hook */
              }
            })();
          }}
          onOpenSplit={(tx) => {
            inspector.close();
            flow.openTransaction(tx, 'split');
          }}
        />
      )}

      {flow.groupSheet && (
        <GroupClassifySheet
          key={flow.groupSheet.id}
          group={flow.groupSheet}
          accounts={accounts}
          pool={transactions}
          suggestions={suggestions.forGroup}
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
        suggestions={suggestions.forBulk}
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

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </main>
  );
}
