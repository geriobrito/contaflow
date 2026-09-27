'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { OFXDropzone } from '@/components/conciliacao/OFXDropzone';
import type { BankTransaction, ChartAccount, ReconciliationStatus } from '@/types/firestore';
import type { OFXParseResult } from '@/lib/ofx/types';
import { getAccounts } from '@/lib/services/data-service';
import { useClient } from '@/contexts/ClientContext';
import { normalizePattern, useReconciliation, type ImportResult } from '@/hooks/useReconciliation';
import { Check, CheckCheck, Search, X } from 'lucide-react';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { IOSSwitch, PAGE, SURFACE } from '@/components/ui/primitives';

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
}

function ClassifySheet({ transaction, accounts, isSaving, onClose, onConfirm }: ClassifySheetProps) {
  const [search, setSearch] = useState('');
  const [accountId, setAccountId] = useState<string>(transaction.accountId ?? '');
  const [learnRule, setLearnRule] = useState(true);
  const [customPattern, setCustomPattern] = useState(normalizePattern(transaction.memo));

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
        className="relative w-full sm:max-w-[440px] max-h-[92vh] flex flex-col rounded-t-[28px] sm:rounded-[28px] bg-[#F9F9F8]/95 dark:bg-stone-900/95 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_24px_64px_rgba(0,0,0,0.18)] animate-sheet-in"
      >
        <div className="sm:hidden flex justify-center pt-2">
          <span className="w-9 h-[5px] rounded-full bg-black/15 dark:bg-white/20" />
        </div>

        {/* Cabeçalho */}
        <div className="flex items-start gap-3 px-6 pt-5 pb-4">
          <div className="flex-1 min-w-0">
            <h2 id="classify-title" className="text-[17px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              Classificar lançamento
            </h2>
            <p className="mt-1 text-[13px] text-stone-500 truncate">{transaction.memo}</p>
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
              <ul role="listbox" className="max-h-56 overflow-y-auto overscroll-contain scroll-smooth">
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
                        <span className="w-[72px] shrink-0 font-mono tabular-nums text-[12px] text-stone-400">{a.code}</span>
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
                  Lembrar essa classificação
                </span>
                <span className="block text-[12px] text-stone-500">Aplica a lançamentos semelhantes</span>
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

        <div className="px-6 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            disabled={!accountId || isSaving}
            onClick={() => void onConfirm(accountId, learnRule, customPattern)}
            className="w-full h-12 rounded-2xl bg-[#0071E3] hover:bg-[#0077ED] text-white text-[15px] font-medium tracking-tight shadow-[0_4px_14px_rgba(0,113,227,0.25)] disabled:opacity-40 disabled:shadow-none active:scale-[0.98] transition-all duration-150"
          >
            {isSaving ? 'Salvando…' : 'Conciliar'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   Página
   ========================================================================= */

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

  const {
    transactions,
    rules,
    metrics,
    isLoading,
    isSaving,
    error,
    importTransactions,
    classifyTransaction,
    approveAutoClassified,
  } = useReconciliation({ clientId, accounts });

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
  const approvable = useMemo(
    () => transactions.filter((t) => t.status === 'AUTO_CLASSIFIED' && t.accountId).length,
    [transactions]
  );

  const handleOFXParsed = async (result: OFXParseResult) => {
    try {
      setLastImport(await importTransactions(result.transactions));
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
      setToast(propagated > 0 ? `Conciliado · ${propagated} semelhante(s) classificado(s)` : 'Lançamento conciliado');
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

      {/* Métricas */}
      <section
        aria-label="Resumo"
        className="rounded-[22px] overflow-hidden grid grid-cols-2 lg:grid-cols-4 gap-px bg-black/[0.05] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.04)]"
      >
        <Metric
          label="Lançamentos"
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
      <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
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
                {visible.map((t) => {
                  const actionable = t.status !== 'RECONCILED';
                  return (
                    <tr
                      key={t.id}
                      onClick={actionable ? () => setSelected(t) : undefined}
                      onKeyDown={
                        actionable
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setSelected(t);
                              }
                            }
                          : undefined
                      }
                      tabIndex={actionable ? 0 : undefined}
                      className={`border-b border-black/[0.04] dark:border-white/[0.05] last:border-0 transition-colors duration-100 ${
                        actionable
                          ? 'cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.03] focus:outline-none focus-visible:bg-blue-50/50'
                          : ''
                      }`}
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
                      </td>
                      <td className="px-3 py-3 hidden md:table-cell max-w-[240px] xl:max-w-[380px]">
                        {t.accountName ? (
                          <p className="text-[13px] text-stone-600 dark:text-stone-400 truncate">
                            <span className="font-mono tabular-nums text-[12px] text-stone-400 mr-1.5">{t.accountCode}</span>
                            {t.accountName}
                          </p>
                        ) : (
                          <span className="text-[13px] text-stone-300 dark:text-stone-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={t.status} />
                      </td>
                      <td
                        className={`pl-3 pr-5 py-3 text-right font-mono tabular-nums text-[13px] whitespace-nowrap ${
                          t.amount < 0 ? 'text-stone-900 dark:text-stone-100' : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {formatCurrency(t.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
