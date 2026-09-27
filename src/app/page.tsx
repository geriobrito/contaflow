'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { OFXDropzone } from '@/components/conciliacao/OFXDropzone';
import type {
  BankTransaction,
  ChartAccount,
  ClientCompany,
  ReconciliationStatus,
} from '@/types/firestore';
import type { OFXParseResult } from '@/lib/ofx/types';
import { getAccounts, getClients } from '@/lib/services/data-service';
import {
  normalizePattern,
  useReconciliation,
  type ImportResult,
} from '@/hooks/useReconciliation';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Layers,
  Percent,
  Search,
  X,
} from 'lucide-react';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

/* =========================================================================
   Badges de status (Apple style)
   ========================================================================= */

const STATUS_BADGE: Record<ReconciliationStatus, { label: string; className: string }> = {
  PENDING: {
    label: 'Pendente',
    className: 'bg-amber-50 text-amber-700 border-amber-200/60',
  },
  AUTO_CLASSIFIED: {
    label: 'Auto-Classificado',
    className: 'bg-blue-50 text-[#0071E3] border-blue-200/60',
  },
  RECONCILED: {
    label: 'Conciliado',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  },
};

function StatusBadge({ status }: { status: ReconciliationStatus }) {
  const { label, className } = STATUS_BADGE[status];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-[11px] font-medium ${className}`}
    >
      {label}
    </span>
  );
}

/* =========================================================================
   Barra de métricas (Apple Card)
   ========================================================================= */

interface MetricCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent: string;
}

function MetricCard({ label, value, icon, accent }: MetricCardProps) {
  return (
    <div className="rounded-3xl bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)] p-5 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${accent}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wider font-medium text-zinc-400">{label}</p>
        <p className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-white truncate">
          {value}
        </p>
      </div>
    </div>
  );
}

/* =========================================================================
   Modal de conciliação
   ========================================================================= */

interface ReconcileSheetProps {
  transaction: BankTransaction;
  accounts: ChartAccount[];
  isSaving: boolean;
  onClose: () => void;
  onConfirm: (accountId: string, learnRule: boolean, customPattern: string) => Promise<void>;
}

function ReconcileSheet({ transaction, accounts, isSaving, onClose, onConfirm }: ReconcileSheetProps) {
  const [search, setSearch] = useState('');
  const [accountId, setAccountId] = useState<string>(transaction.accountId ?? '');
  const [learnRule, setLearnRule] = useState(true);
  const [customPattern, setCustomPattern] = useState(normalizePattern(transaction.memo));

  const analytic = useMemo(() => {
    const term = normalizePattern(search);
    return accounts
      .filter((a) => a.nature === 'ANALYTIC')
      .filter((a) => !term || `${a.code} ${a.name}`.toLowerCase().includes(term));
  }, [accounts, search]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/20 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-3xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] shadow-2xl p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-white">Conciliar lançamento</h3>
            <p className="text-xs text-zinc-500 mt-1 truncate">{transaction.memo}</p>
            <p className={`text-sm font-semibold mt-1 ${transaction.amount < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              {formatCurrency(transaction.amount)} · {formatDateBR(transaction.date)}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Fechar">
            <X className="w-4 h-4 text-zinc-500" />
          </button>
        </div>

        {/* Seletor com busca do plano de contas */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar conta por código ou nome…"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-zinc-100/80 dark:bg-zinc-800 text-sm outline-none focus:ring-2 focus:ring-[#0071E3]/40"
            />
          </div>
          <ul className="max-h-52 overflow-y-auto rounded-xl border border-black/[0.06] dark:border-white/[0.08] divide-y divide-black/[0.04] dark:divide-white/[0.06]">
            {analytic.length === 0 && (
              <li className="px-3 py-4 text-xs text-center text-zinc-400">Nenhuma conta encontrada</li>
            )}
            {analytic.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setAccountId(a.id)}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-3 transition-colors ${
                    accountId === a.id ? 'bg-blue-50 dark:bg-blue-950/40 text-[#0071E3]' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60'
                  }`}
                >
                  <span className="font-mono text-[11px] text-zinc-400 w-20 shrink-0">{a.code}</span>
                  <span className="truncate flex-1">{a.name}</span>
                  {accountId === a.id && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Switch iOS (checkbox nativo) */}
        <label className="flex items-center justify-between gap-4 cursor-pointer select-none">
          <span className="text-sm text-zinc-700 dark:text-zinc-300">
            Lembrar essa classificação para lançamentos semelhantes?
          </span>
          <span className="relative inline-flex shrink-0">
            <input
              type="checkbox"
              checked={learnRule}
              onChange={(e) => setLearnRule(e.target.checked)}
              className="peer sr-only"
            />
            <span className="w-[51px] h-[31px] rounded-full bg-zinc-200 dark:bg-zinc-700 transition-colors peer-checked:bg-[#34C759] peer-focus-visible:ring-2 peer-focus-visible:ring-[#0071E3]/50" />
            <span className="absolute top-[2px] left-[2px] w-[27px] h-[27px] rounded-full bg-white shadow-md transition-transform peer-checked:translate-x-5" />
          </span>
        </label>

        {learnRule && (
          <div className="space-y-1.5">
            <label htmlFor="pattern" className="text-[11px] uppercase tracking-wider font-medium text-zinc-400">
              Termo a memorizar (opcional)
            </label>
            <input
              id="pattern"
              value={customPattern}
              onChange={(e) => setCustomPattern(e.target.value)}
              placeholder="ex: uber, aws, pix recebido"
              className="w-full px-3 py-2.5 rounded-xl bg-zinc-100/80 dark:bg-zinc-800 text-sm outline-none focus:ring-2 focus:ring-[#0071E3]/40"
            />
            <p className="text-[11px] text-zinc-400">
              Lançamentos pendentes contendo este termo serão classificados automaticamente.
            </p>
          </div>
        )}

        <button
          type="button"
          disabled={!accountId || isSaving}
          onClick={() => onConfirm(accountId, learnRule, customPattern)}
          className="w-full py-3 rounded-2xl bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-40 text-white text-sm font-medium transition-colors"
        >
          {isSaving ? 'Salvando…' : 'Conciliar'}
        </button>
      </div>
    </div>
  );
}

/* =========================================================================
   Página principal
   ========================================================================= */

export default function ConciliacaoPage() {
  const [clients, setClients] = useState<ClientCompany[]>([]);
  const [currentClient, setCurrentClient] = useState<ClientCompany | null>(null);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [selected, setSelected] = useState<BankTransaction | null>(null);
  const [lastImport, setLastImport] = useState<ImportResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const clientId = currentClient?.id ?? null;
  const {
    transactions,
    rules,
    metrics,
    isLoading,
    isSaving,
    error,
    importTransactions,
    classifyTransaction,
  } = useReconciliation({ clientId, accounts });

  useEffect(() => {
    getClients()
      .then((list) => {
        setClients(list);
        setCurrentClient((prev) => prev ?? list[0] ?? null);
      })
      .catch((e) => console.error('Erro ao carregar clientes:', e));
  }, []);

  useEffect(() => {
    if (!clientId) return;
    getAccounts(clientId)
      .then(setAccounts)
      .catch((e) => console.error('Erro ao carregar plano de contas:', e));
  }, [clientId]);

  const handleSelectClient = (client: ClientCompany) => {
    setCurrentClient(client);
    setLastImport(null);
    setSelected(null);
  };

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
      setToast(
        propagated > 0
          ? `Lançamento conciliado · ${propagated} semelhante(s) auto-classificado(s)`
          : 'Lançamento conciliado'
      );
    } catch {
      /* erro exposto pelo hook */
    }
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="min-h-screen flex flex-col bg-[#fbfbfd] dark:bg-black">
      <Navbar
        currentClient={currentClient ?? undefined}
        clients={clients}
        onSelectClient={handleSelectClient}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
            Conciliação Bancária
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Aprendizado contínuo ativo para{' '}
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">{currentClient?.name}</span>
            {' · '}
            {rules.length} regra(s) memorizada(s)
          </p>
        </div>

        {/* Métricas */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="Lançamentos"
            value={String(metrics.total)}
            icon={<Layers className="w-5 h-5" />}
            accent="bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          />
          <MetricCard
            label="Conciliado"
            value={`${metrics.reconciledPercent}%`}
            icon={<Percent className="w-5 h-5" />}
            accent="bg-blue-50 text-[#0071E3] dark:bg-blue-950/40"
          />
          <MetricCard
            label="Entradas"
            value={formatCurrency(metrics.credits)}
            icon={<ArrowUpRight className="w-5 h-5" />}
            accent="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40"
          />
          <MetricCard
            label="Saídas"
            value={formatCurrency(metrics.debits)}
            icon={<ArrowDownLeft className="w-5 h-5" />}
            accent="bg-rose-50 text-rose-600 dark:bg-rose-950/40"
          />
        </section>

        {error && (
          <div className="px-4 py-3 rounded-2xl bg-rose-50 border border-rose-200/60 text-sm text-rose-700">
            {error}
          </div>
        )}

        {lastImport && (
          <div className="px-4 py-3 rounded-2xl bg-blue-50/70 border border-blue-200/60 flex items-center justify-between gap-4 text-xs text-zinc-700">
            <span>
              <b className="text-[#0071E3]">{lastImport.added}</b> novos lançamentos ·{' '}
              <b className="text-[#0071E3]">{lastImport.autoClassified}</b> auto-classificados
              {lastImport.duplicates > 0 && (
                <span className="text-amber-700"> · {lastImport.duplicates} duplicidade(s) ignorada(s)</span>
              )}
            </span>
            <button onClick={() => setLastImport(null)} className="font-medium text-[#0071E3]">
              Fechar
            </button>
          </div>
        )}

        <OFXDropzone onParsed={handleOFXParsed} isLoading={isLoading || isSaving} />

        {/* Lista de lançamentos */}
        <section className="rounded-3xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between border-b border-black/[0.04] dark:border-white/[0.06]">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Lançamentos</h2>
            <span className="text-xs text-zinc-500">
              {metrics.pending} pendente(s) · {metrics.autoClassified} auto · {metrics.reconciled} conciliado(s)
            </span>
          </div>

          {isLoading ? (
            <p className="p-8 text-center text-sm text-zinc-400">Carregando…</p>
          ) : transactions.length === 0 ? (
            <p className="p-8 text-center text-sm text-zinc-400">Importe um extrato OFX para começar.</p>
          ) : (
            <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
              {transactions.map((t) => {
                const clickable = t.status !== 'RECONCILED';
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      disabled={!clickable}
                      onClick={() => setSelected(t)}
                      className="w-full px-5 py-3 flex items-center gap-4 text-left enabled:hover:bg-zinc-50 dark:enabled:hover:bg-zinc-800/50 transition-colors"
                    >
                      <span className="text-xs text-zinc-400 w-20 shrink-0">{formatDateBR(t.date)}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-zinc-900 dark:text-white truncate">{t.memo}</span>
                        {t.accountName && (
                          <span className="block text-[11px] text-zinc-400 truncate">
                            {t.accountCode} · {t.accountName}
                          </span>
                        )}
                      </span>
                      <StatusBadge status={t.status} />
                      <span
                        className={`text-sm font-semibold tabular-nums w-28 text-right shrink-0 ${
                          t.amount < 0 ? 'text-rose-600' : 'text-emerald-600'
                        }`}
                      >
                        {formatCurrency(t.amount)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      {selected && (
        <ReconcileSheet
          key={selected.id}
          transaction={selected}
          accounts={accounts}
          isSaving={isSaving}
          onClose={() => setSelected(null)}
          onConfirm={handleConfirm}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full bg-zinc-900/90 text-white text-xs shadow-lg backdrop-blur">
          {toast}
        </div>
      )}
    </div>
  );
}
