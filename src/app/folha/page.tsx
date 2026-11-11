'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Lock,
} from 'lucide-react';
import type { BankTransaction } from '@/types/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import {
  buildPayrollJournalDraft,
  calculateNetPayroll,
  matchBankTransactionsWithPayroll,
  prevMonthOf,
  resolvePayrollMapping,
  type PayrollInput,
  type PayrollObligationMatch,
} from '@/lib/payroll';
import {
  deletePayrollMonth,
  loadPayrollContext,
  reconcilePayrollBankTransaction,
  savePayrollMonth,
  type PayrollContext,
} from '@/lib/services/payroll-service';
import { generatePayrollExcel, generatePayrollPdf } from '@/lib/export/payroll-export';
import { PayrollForm } from '@/components/folha/PayrollForm';
import { PayrollReconciliationPanel } from '@/components/folha/PayrollReconciliationPanel';
import { formatMonth } from '@/lib/periods';
import { formatCurrency } from '@/lib/utils/formatters';
import { reportError } from '@/lib/monitoring';
import { BUTTON, EmptyState, PAGE, PageHeader, SURFACE, INPUT_COMPACT } from '@/components/ui/primitives';
import { TableSkeleton } from '@/components/ui/Skeleton';

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function FolhaPagamentoPage() {
  const { user } = useAuth();
  const { currentClient } = useClient();
  const clientId = currentClient?.id;

  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [loadedState, setLoadedState] = useState<{ key: string; value: PayrollContext } | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const stateKey = `${clientId ?? ''}|${month}|${reloadCount}`;
  const ctx = loadedState?.key === stateKey ? loadedState.value : null;
  const loading = Boolean(clientId && !ctx && !error);

  // Suporta abertura via `?mes=AAAA-MM` (ex.: atalho das Rotinas do Mês).
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      const m = new URLSearchParams(window.location.search).get('mes');
      if (active && m && /^\d{4}-\d{2}$/.test(m)) setMonth(m);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const reload = useCallback(() => setReloadCount((c) => c + 1), []);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    const key = `${clientId}|${month}|${reloadCount}`;
    loadPayrollContext(clientId, month)
      .then((value) => {
        if (!active) return;
        setLoadedState({ key, value });
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        reportError(err, { area: 'folha', op: 'carregar' });
        setError(err instanceof Error ? err.message : 'Não foi possível carregar a folha de pagamento.');
      });
    return () => {
      active = false;
    };
  }, [clientId, month, reloadCount]);

  const existingSummary = useMemo(
    () => ctx?.register?.summaries.find((s) => s.month === month) ?? null,
    [ctx, month]
  );

  const previousSummary = useMemo(() => {
    if (!ctx?.register?.summaries.length) return null;
    const prev = prevMonthOf(month);
    return (
      ctx.register.summaries.find((s) => s.month === prev) ??
      [...ctx.register.summaries]
        .filter((s) => s.month < month)
        .sort((a, b) => b.month.localeCompare(a.month))[0] ??
      null
    );
  }, [ctx, month]);

  const locked = Boolean(ctx?.lockedMonths.has(month));

  const mapping = useMemo(
    () => resolvePayrollMapping(ctx?.register?.defaultMapping, existingSummary?.mappedAccounts),
    [ctx, existingSummary]
  );

  const obligations = useMemo(() => {
    if (!existingSummary || !ctx) return [];
    return matchBankTransactionsWithPayroll(existingSummary, ctx.windowTransactions, ctx.accounts, mapping);
  }, [existingSummary, ctx, mapping]);

  const calc = useMemo(
    () => (existingSummary ? calculateNetPayroll(existingSummary) : null),
    [existingSummary]
  );

  const handleSave = async (input: PayrollInput) => {
    if (!clientId || !ctx) return;
    setSaving(true);
    setError(null);
    try {
      await savePayrollMonth(clientId, input, ctx, user?.uid ?? 'local');
      reload();
      setToast(`Provisão da folha de ${formatMonth(month)} contabilizada com sucesso.`);
    } catch (err) {
      reportError(err, { area: 'folha', op: 'salvar' });
      setError(err instanceof Error ? err.message : 'Erro ao contabilizar a folha de pagamento.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!clientId || !ctx) return;
    setSaving(true);
    setError(null);
    try {
      await deletePayrollMonth(clientId, month, ctx);
      reload();
      setToast(`Folha de pagamento de ${formatMonth(month)} excluída.`);
    } catch (err) {
      reportError(err, { area: 'folha', op: 'excluir' });
      setError(err instanceof Error ? err.message : 'Erro ao excluir a folha de pagamento.');
    } finally {
      setSaving(false);
    }
  };

  const handleReconcile = async (tx: BankTransaction, obligation: PayrollObligationMatch) => {
    if (!clientId || !ctx) return;
    setError(null);
    try {
      await reconcilePayrollBankTransaction({
        clientId,
        transaction: tx,
        obligation,
        ctx,
      });
      reload();
      setToast(`Pagamento conciliado em ${obligation.accountCode} (${obligation.label}).`);
    } catch (err) {
      reportError(err, { area: 'folha', op: 'conciliar' });
      setError(err instanceof Error ? err.message : 'Erro ao conciliar o lançamento bancário.');
    }
  };

  const signatories = useMemo(
    () => ({
      legalRepresentative: {
        name: currentClient?.legalRepresentativeName,
        cpf: currentClient?.legalRepresentativeCpf,
      },
    }),
    [currentClient]
  );

  const handleExportPdf = () => {
    if (!currentClient || !existingSummary || !ctx) return;
    try {
      const entry =
        ctx.monthEntries.find((e) => e.payrollMonth === month) ??
        buildPayrollJournalDraft(existingSummary, ctx.accounts, mapping);
      const { blob, fileName } = generatePayrollPdf({
        client: currentClient,
        summary: existingSummary,
        journalLines: entry.lines,
        obligations,
        signatories,
      });
      downloadBlob(blob, fileName);
    } catch (err) {
      reportError(err, { area: 'folha', op: 'exportar-pdf' });
      setToast(err instanceof Error ? err.message : 'Não foi possível exportar o PDF.');
    }
  };

  const handleExportExcel = async () => {
    if (!currentClient || !existingSummary || !ctx) return;
    try {
      const entry =
        ctx.monthEntries.find((e) => e.payrollMonth === month) ??
        buildPayrollJournalDraft(existingSummary, ctx.accounts, mapping);
      const { blob, fileName } = await generatePayrollExcel({
        client: currentClient,
        summary: existingSummary,
        journalLines: entry.lines,
        obligations,
        signatories,
      });
      downloadBlob(blob, fileName);
    } catch (err) {
      reportError(err, { area: 'folha', op: 'exportar-excel' });
      setToast(err instanceof Error ? err.message : 'Não foi possível exportar a planilha Excel.');
    }
  };

  if (!currentClient) {
    return (
      <main className={PAGE}>
        <EmptyState
          title="Selecione uma empresa"
          description="Escolha um cliente na barra lateral para gerenciar a provisão e a conciliação da folha de pagamento."
        />
      </main>
    );
  }

  const settledCount = obligations.filter((o) => o.status === 'SETTLED').length;

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient.tradeName || currentClient.name}
        title="Folha de Pagamento e Pró-Labore"
        description="Contabilize o resumo mensal de salários, pró-labore, INSS, FGTS, IRRF e provisões de férias/13º pelo regime de competência e concilie os pagamentos no extrato bancário."
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="flex items-center gap-2 text-[12px] text-stone-500">
              Competência
              <input
                type="month"
                value={month}
                onChange={(e) => e.target.value && setMonth(e.target.value)}
                className={`${INPUT_COMPACT} w-40 font-mono tabular-nums`}
              />
            </label>
            {existingSummary && (
              <>
                <button
                  type="button"
                  onClick={handleExportPdf}
                  className={BUTTON.secondary}
                  title="Exportar Espelho Contábil da Folha em PDF"
                >
                  <Download className="w-3.5 h-3.5" />
                  PDF
                </button>
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className={BUTTON.secondary}
                  title="Exportar Espelho Contábil da Folha em Excel"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  Excel
                </button>
              </>
            )}
          </div>
        }
      />

      {error && (
        <div role="alert" className="rounded-2xl border border-rose-200 dark:border-rose-500/25 bg-rose-50 dark:bg-rose-500/10 px-4 py-3 text-[13px] text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {toast && (
        <div className="rounded-2xl border border-emerald-200 dark:border-emerald-500/25 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-2.5 text-[13px] text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-300 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      {/* Barra rápida de competências já contabilizadas */}
      {ctx && ctx.register && ctx.register.summaries.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] font-medium text-stone-500 mr-1">Competências lançadas:</span>
          {[...ctx.register.summaries]
            .sort((a, b) => b.month.localeCompare(a.month))
            .slice(0, 12)
            .map((s) => {
              const active = s.month === month;
              const isLocked = ctx.lockedMonths.has(s.month);
              return (
                <button
                  key={s.month}
                  type="button"
                  onClick={() => setMonth(s.month)}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-mono transition ${
                    active
                      ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 font-semibold'
                      : 'bg-surface border border-line text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-white/8'
                  }`}
                >
                  {isLocked && <Lock className="w-3 h-3 opacity-70" />}
                  {formatMonth(s.month)}
                </button>
              );
            })}
        </div>
      )}

      {/* Cards de Resumo da Competência */}
      {calc && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <div className={`${SURFACE} rounded-2xl p-4`}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">
              Proventos Brutos ({formatMonth(month)})
            </p>
            <p className="mt-1 text-[18px] font-semibold font-mono tabular-nums text-stone-900 dark:text-stone-100">
              {formatCurrency(calc.totalGross)}
            </p>
            <p className="mt-0.5 text-[11.5px] text-stone-500">
              Salários: {formatCurrency(calc.grossSalaries)} · Pró-labore: {formatCurrency(calc.grossProLabore)}
            </p>
          </div>
          <div className={`${SURFACE} rounded-2xl p-4`}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">
              Líquido a Pagar
            </p>
            <p className="mt-1 text-[18px] font-semibold font-mono tabular-nums text-stone-900 dark:text-stone-100">
              {formatCurrency(calc.totalNetPayable)}
            </p>
            <p className="mt-0.5 text-[11.5px] text-stone-500">
              Retenções em folha: {formatCurrency(calc.totalRetentions)}
            </p>
          </div>
          <div className={`${SURFACE} rounded-2xl p-4`}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">
              Guias a Recolher (INSS / FGTS / IRRF)
            </p>
            <p className="mt-1 text-[18px] font-semibold font-mono tabular-nums text-stone-900 dark:text-stone-100">
              {formatCurrency(calc.totalTaxesPayable)}
            </p>
            <p className="mt-0.5 text-[11.5px] text-stone-500">
              INSS: {formatCurrency(calc.totalInssPayable)} · FGTS: {formatCurrency(calc.fgts)}
            </p>
          </div>
          <div className={`${SURFACE} rounded-2xl p-4`}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">
              Conciliação no Extrato
            </p>
            <p className="mt-1 text-[18px] font-semibold font-mono tabular-nums text-emerald-700 dark:text-emerald-300">
              {settledCount} / {obligations.length} obrigações
            </p>
            <p className="mt-0.5 text-[11.5px] text-stone-500">
              Custo total c/ provisões: {formatCurrency(calc.totalExpense)}
            </p>
          </div>
        </div>
      )}

      {loading || !ctx ? (
        <TableSkeleton rows={5} label="Carregando folha de pagamento e conciliação bancária…" />
      ) : (
        <div className="space-y-6">
          <PayrollForm
            key={`${clientId}_${month}_${existingSummary?.updatedAt ?? 'new'}`}
            month={month}
            accounts={ctx.accounts}
            existingSummary={existingSummary}
            previousSummary={previousSummary}
            locked={locked}
            saving={saving}
            onSave={handleSave}
            onDelete={handleDelete}
            onNotify={setToast}
          />

          {existingSummary && (
            <PayrollReconciliationPanel
              month={month}
              obligations={obligations}
              onReconcile={handleReconcile}
            />
          )}
        </div>
      )}
    </main>
  );
}
