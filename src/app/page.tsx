'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { OFXDropzone } from '@/components/conciliacao/OFXDropzone';
import type { BankTransaction, ChartAccount, ClassificationRule, ReconciliationStatus } from '@/types/firestore';
import type { OFXParseResult } from '@/lib/ofx/types';
import { getAccounts, getLatestTransactionDate } from '@/lib/services/data-service';
import { PeriodPicker, usePeriod } from '@/components/ui/PeriodPicker';
import { useClient } from '@/contexts/ClientContext';
import { normalizePattern, useReconciliation, type ImportResult } from '@/hooks/useReconciliation';
import { Check, CheckCheck, ChevronDown, Pencil, Search, Split, X } from 'lucide-react';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { IOSSwitch, PAGE, SegmentedControl, SURFACE } from '@/components/ui/primitives';
import { emptySplitDraft, SplitEditor } from '@/components/conciliacao/SplitEditor';
import { splitsToDrafts, summarizeSplits, type SplitDraft } from '@/lib/splits';

/* =========================================================================
   Primitivos visuais
   ========================================================================= */

const STATUS_BADGE: Record<ReconciliationStatus, { label: string; className: string }> = {
  PENDING: { label: 'Pendente', className: 'bg-amber-50 text-amber-700 border-amber-200/60' },
  AUTO_CLASSIFIED: { label: 'Auto', className: 'bg-blue-50 text-[#0071E3] border-blue-200/60' },
  RECONCILED: { label: 'Conciliado', className: 'bg-emerald-50 text-emerald-700 border-emerald-200/60' },
};

function StatusBadge({ status }: { status: ReconciliationStatus }) {
  const { label, className } = STATUS_BADGE[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap ${className}`}>
      {label}
    </span>
  );
}

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

interface ClassifySheetProps {
  transaction: BankTransaction;
  accounts: ChartAccount[];
  isSaving: boolean;
  onClose: () => void;
  onConfirm: (accountId: string, learnRule: boolean, customPattern: string) => Promise<void>;
  onSplit: (drafts: SplitDraft[]) => Promise<void>;
  onUnreconcile: () => Promise<void>;
  /** Regras do cliente, para pré-carregar o termo da regra que originou o lançamento. */
  rules: readonly ClassificationRule[];
}

type SheetMode = 'single' | 'split';

function ClassifySheet({
  transaction,
  accounts,
  isSaving,
  onClose,
  onConfirm,
  onSplit,
  onUnreconcile,
  rules,
}: ClassifySheetProps) {
  const isEditing = transaction.status !== 'PENDING';
  const sourceRule = transaction.matchedRuleId ? rules.find((r) => r.id === transaction.matchedRuleId) : undefined;
  const [confirmUndo, setConfirmUndo] = useState(false);
  const accountListRef = useRef<HTMLUListElement>(null);


  useEffect(() => {
    if (!confirmUndo) return;
    const t = setTimeout(() => setConfirmUndo(false), 3500);
    return () => clearTimeout(t);
  }, [confirmUndo]);

  const [mode, setMode] = useState<SheetMode>(transaction.isSplit ? 'split' : 'single');
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

        <div className="px-6 pb-4">
          <SegmentedControl
            ariaLabel="Modo de classificação"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'single', label: 'Conta única' },
              { value: 'split', label: 'Classificar com rateio / desdobrar' },
            ]}
          />
        </div>

        {mode === 'split' ? (
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
              </div>
            )}
          </section>
        </div>
        )}

        <div className="px-6 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {mode === 'split' ? (
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
            onClick={() => void onConfirm(accountId, learnRule, customPattern)}
            className="w-full h-12 rounded-2xl bg-[#0071E3] hover:bg-[#0077ED] text-white text-[15px] font-medium tracking-tight shadow-[0_4px_14px_rgba(0,113,227,0.25)] disabled:opacity-40 disabled:shadow-none active:scale-[0.98] transition-all duration-150"
          >
            {isSaving ? 'Salvando…' : isEditing ? 'Salvar nova classificação' : 'Conciliar'}
          </button>
          )}
          {isEditing && (
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
    importTransactions,
    classifyTransaction,
    splitTransaction,
    unreconcileTransaction,
    approveAutoClassified,
  } = useReconciliation({ clientId, accounts, range });

  useEffect(() => {
    if (!clientId) return;
    getAccounts(clientId)
      .then(setAccounts)
      .catch((e) => console.error('Erro ao carregar plano de contas:', e));
  }, [clientId]);

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
    () => transactions.filter((t) => t.status === 'AUTO_CLASSIFIED' && t.accountId).length,
    [transactions]
  );

  const handleOFXParsed = async (result: OFXParseResult) => {
    try {
      const imported = await importTransactions(result.transactions);
      setLastImport(imported);
      // Leva o período até o extrato recém-importado, se ele estiver fora da janela atual.
      if (imported.latestDate && range && (imported.latestDate < range.start || imported.latestDate > range.end)) {
        jumpTo(imported.latestDate);
      }
    } catch {
      /* erro exposto pelo hook */
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

  const handleConfirm = async (accountId: string, learnRule: boolean, customPattern: string) => {
    if (!selected) return;
    try {
      const { propagated } = await classifyTransaction(selected.id, accountId, {
        learnRule,
        customPattern: customPattern.trim() || undefined,
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

      <PeriodPicker period={period} />

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
