'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCheck, Landmark } from 'lucide-react';
import type { BankAccount, ChartAccount, RuleMatchType } from '@/types/firestore';
import { getAccounts, getLatestTransactionDate, getRepository } from '@/lib/services/data-service';
import { useClient } from '@/contexts/ClientContext';
import { useMonthDepreciation } from '@/hooks/imobilizado/useMonthDepreciation';
import { manualDepreciationWarning } from '@/lib/fixed-assets';
import { useReconciliation } from '@/hooks/useReconciliation';
import { useBulkSelection } from '@/hooks/reconciliation/useBulkSelection';
import { useClassificationFlow } from '@/hooks/reconciliation/useClassificationFlow';
import { useImportFlow } from '@/hooks/reconciliation/useImportFlow';
import { useInvoiceMatches } from '@/hooks/reconciliation/useInvoiceMatches';
import { useAccountSuggestions } from '@/hooks/reconciliation/useAccountSuggestions';
import { usePagination } from '@/hooks/usePagination';
import { useTableKeyboard } from '@/hooks/useTableKeyboard';
import { PeriodPicker, usePeriod } from '@/components/ui/PeriodPicker';
import { PAGE, SEGMENT_PILL, SearchField, SegmentedControl, SURFACE, segmentClass } from '@/components/ui/primitives';
import { useSlidingIndicator } from '@/components/ui/useSlidingIndicator';
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
import { BulkActionBar } from '@/components/conciliacao/BulkActionBar';
import { BulkClassifyModal } from '@/components/conciliacao/BulkClassifyModal';
import { BulkAskClientModal } from '@/components/conciliacao/BulkAskClientModal';
import { KeyboardHelpModal } from '@/components/conciliacao/KeyboardHelpModal';
import { groupByPayee } from '@/lib/payee';
import type { SplitDraft } from '@/lib/splits';
import { formatMonth, isMonthLocked, monthOf } from '@/lib/periods';
import { hasMojibake } from '@/lib/ofx/encoding';
import { findTransferPairs } from '@/lib/transfers';
import { approvableIds, bankFilterOptions, bankNamesByKey, filterByBank, mainSplitAccountId, parseConciliationLink, payeeCandidates, upsertBank, visibleTransactions, type StatusFilter } from '@/lib/reconciliation-list';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { reportError } from '@/lib/monitoring';

/** Linhas por página na tabela de lançamentos. */
const PAGE_SIZE = 50;

type Filter = StatusFilter;

const loadFailure = (what: string, e: unknown): string => {
  reportError(e, { area: 'conciliacao', op: `carregar ${what}` });
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
  const [filter, setFilter] = useState<Filter>('ALL');
  const [bankFilter, setBankFilter] = useState<string>('ALL');
  const [lastBankClientId, setLastBankClientId] = useState<string | null>(clientId);
  if (lastBankClientId !== clientId) {
    setLastBankClientId(clientId);
    setBankFilter('ALL');
  }
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

    getLatestTransactionDate(clientId)
      .then((latest) => {
        if (!active) return;
        // Links do painel abrem o mês e os filtros pedidos.
        const link = parseConciliationLink(window.location.search);
        if (link.bank) setBankFilter(link.bank);
        if (link.month) {
          setMode('month');
          jumpTo(`${link.month}-01`);
          if (link.filter) setFilter(link.filter);
        } else if (latest) jumpTo(latest);
        setPositionedFor(clientId);
      })
      .catch((e) => {
        reportError(e, { area: 'conciliacao', op: 'localizar período' });
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
  // Depreciação do imobilizado do mês: enquanto faltar, a competência não fecha.
  const monthDep = useMonthDepreciation(clientId ?? undefined, selectedMonth, Boolean(selectedMonth && lockedMonths.has(selectedMonth)));
  const dep = monthDep.depreciation;
  const depreciationNotice = dep
    ? dep.closeProblem
      ? {
          message: monthDep.error ?? dep.closeProblem,
          actionLabel: (dep.status.kind === 'PENDING' && dep.status.existing) || dep.status.kind === 'REMOVE' ? 'Atualizar lançamento' : 'Lançar depreciação',
          blocking: true,
          busy: monthDep.busy,
          onPost: () => {
            void monthDep.post().then((message) => message && setToast(message));
          },
        }
      : manualDepreciationWarning(dep.status, selectedMonth ?? '')
        ? { message: manualDepreciationWarning(dep.status, selectedMonth ?? '')!, actionLabel: null, blocking: false, busy: false, onPost: () => undefined }
        : null
    : null;
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

  // Contas bancárias e cartões (importação, filtro e nomes nas transferências); recarrega após cada importação.
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

  const handleBankAccountUpdated = (updated: BankAccount) => setBanks((prev) => upsertBank(prev, updated));

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
    onAccountCreated: (account) => setAccounts((prev) => [...prev, account]),
    notify: (message, action) => setToast(action ? { message, action } : message),
  });
  const { selected } = flow;

  // Notas fiscais importadas: casam com os lançamentos e sugerem a conta (src/lib/nfe/match.ts).
  const invoices = useInvoiceMatches({ clientId, range, transactions, accounts });
  const invoiceHints = useMemo(() => {
    const map = new Map<string, 'match' | 'linked'>();
    for (const id of invoices.linked.keys()) map.set(id, 'linked');
    for (const id of invoices.matches.keys()) map.set(id, 'match');
    return map;
  }, [invoices.matches, invoices.linked]);
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

  // Visão por favorecido: pendentes de competência aberta, agrupados por quem pagou/recebeu.
  const [view, setView] = useState<'list' | 'payee'>('list');
  const payeeGroups = useMemo(() => groupByPayee(payeeCandidates(byBank, lockedMonths)), [byBank, lockedMonths]);
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
    invoiceAccountId: selected && selected.status !== 'RECONCILED' ? invoices.matches.get(selected.id)?.suggestedAccountId : null,
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
    selected || flow.groupSheet || duplicate || bulk.showBulkClassify || bulk.showBulkAsk || showKeyboardHelp || statementFiles.csvQueue.length > 0
  );
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
      {/* Cabeçalho editorial, com a importação de extratos */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5 min-w-0">
          <p className="text-[13px] font-medium text-stone-500">{currentClient?.tradeName || currentClient?.name || '—'}</p>
          <h1 className="text-[32px] font-semibold tracking-tight text-stone-900 dark:text-stone-50">Conciliação bancária</h1>
          <p className="text-[14px] text-stone-500">
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
        onBankAccountUpdated={handleBankAccountUpdated}
      />
      {loadError && loadError.id === clientId && (
        <p role="alert" className="text-[13px] text-rose-600">
          {loadError.message}
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
        <div className="flex flex-wrap items-center gap-3 justify-between px-5 py-4 border-b border-black/4 dark:border-white/6">
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
              className={`${view === 'list' ? 'inline-flex' : 'hidden'} relative p-0.5 rounded-xl bg-black/4 dark:bg-white/6 self-start`}
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
            {(bankOptions.length > 1 || bankFilter !== 'ALL') && (
              <div className="relative inline-flex items-center">
                <Landmark className="w-3.5 h-3.5 text-stone-400 absolute left-3 pointer-events-none" />
                <select
                  aria-label="Filtrar por conta bancária ou cartão"
                  value={bankFilter}
                  onChange={(e) => setBankFilter(e.target.value)}
                  className="h-9 pl-8 pr-7 rounded-xl bg-black/4 dark:bg-white/6 text-[13px] font-medium text-stone-700 dark:text-stone-200 border border-transparent focus:border-accent/40 outline-none cursor-pointer transition-colors"
                >
                  <option value="ALL">Todas as contas ({transactions.length})</option>
                  {bankOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} ({opt.count})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {view === 'list' && (
              <div className="flex items-center gap-1.5">
                <SearchField
                  inputRef={searchInputRef}
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Buscar histórico, valor, conta ou fitid (pressione /)"
                  className="w-80"
                />
                <button
                  type="button"
                  onClick={() => setShowKeyboardHelp(true)}
                  title="Atalhos de teclado (?)"
                  aria-label="Atalhos de teclado"
                  className="inline-flex shrink-0 items-center justify-center w-10 h-10 rounded-xl text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 bg-black/3 dark:bg-white/5 hover:bg-black/6 transition-colors"
                >
                  <kbd className="font-mono text-[12px] font-semibold">?</kbd>
                </button>
              </div>
            )}

            {approvable.size > 0 && (
              <button
                type="button"
                disabled={isSaving}
                onClick={() => void flow.handleApproveAll(bankFilter !== 'ALL' ? approvable : undefined)}
                className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[13px] font-medium tracking-tight disabled:opacity-30 active:scale-[0.98] transition-all duration-150"
              >
                <CheckCheck className="w-4 h-4" strokeWidth={2} />
                Aprovar todos os auto-classificados
                <span className="font-mono tabular-nums text-[12px] px-1.5 rounded-full bg-white/20 dark:bg-black/10">{approvable.size}</span>
              </button>
            )}
          </div>
        </div>

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
            invoiceHints={invoiceHints}
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
          onConfirm={confirmClassification}
          onSplit={confirmSplit}
          onUnreconcile={flow.handleUnreconcile}
          rules={rules}
          memoPool={memoPool}
          lockedMonthLabel={isMonthLocked(selected.date, lockedMonths) ? formatMonth(monthOf(selected.date)) : null}
          loadAudit={() => loadAudit(selected.id)}
          onAskClient={flow.handleAskClient}
          invoiceMatch={selected.status === 'RECONCILED' ? null : invoices.matches.get(selected.id)}
          linkedInvoice={invoices.linked.get(selected.id)}
          suggestions={suggestions.forSelected}
          regime={currentClient?.regime}
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
