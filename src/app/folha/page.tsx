'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Banknote, Download, FileSpreadsheet, Landmark, ReceiptText, Wallet } from 'lucide-react';
import type { BankTransaction } from '@/types/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import {
  buildPayrollJournalDraft,
  calculateNetPayroll,
  matchBankTransactionsWithPayroll,
  payrollRoutineStatus,
  payrollYearOverview,
  prevMonthOf,
  resolvePayrollMapping,
  type PayrollInput,
  type PayrollObligationMatch,
} from '@/lib/payroll';
import { deletePayrollMonth, loadPayrollContext, reconcilePayrollBankTransaction, savePayrollMonth, type PayrollContext } from '@/lib/services/payroll-service';
import { generatePayrollExcel, generatePayrollPdf } from '@/lib/export/payroll-export';
import { PayrollForm } from '@/components/folha/PayrollForm';
import { PayrollMonthNav } from '@/components/folha/PayrollMonthNav';
import { PayrollReconciliationPanel } from '@/components/folha/PayrollReconciliationPanel';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { todayISO } from '@/lib/business-days';
import { formatMonth } from '@/lib/periods';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { isRegisterConflictError } from '@/lib/utils/errors';
import { reportError } from '@/lib/monitoring';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { BUTTON, EmptyState, PAGE, PageHeader, StatCard, SURFACE, type StatTone } from '@/components/ui/primitives';
import { CardsSkeleton, TableSkeleton } from '@/components/ui/Skeleton';
import { Toast, useToast } from '@/components/ui/Toast';

const MONTH_SHAPE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Competência inicial: a do endereço (`?mes=AAAA-MM`, atalho das rotinas do mês) ou o mês corrente. */
function initialMonth(): string {
  if (typeof window !== 'undefined') {
    const fromUrl = new URLSearchParams(window.location.search).get('mes');
    if (fromUrl && MONTH_SHAPE.test(fromUrl)) return fromUrl;
  }
  return todayISO().slice(0, 7);
}

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

  const [month, setMonthState] = useState(initialMonth);
  const [loadedState, setLoadedState] = useState<{ key: string; value: PayrollContext } | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useToast(3600);
  // Valores digitados e ainda não contabilizados: trocar de competência ou sair pede confirmação.
  const [dirty, setDirty] = useState(false);
  const [pendingMonth, setPendingMonth] = useState<string | null>(null);
  const leave = useUnsavedChangesGuard(dirty);

  const stateKey = `${clientId ?? ''}|${month}|${reloadCount}`;
  const ctx = loadedState?.key === stateKey ? loadedState.value : null;
  const loading = Boolean(clientId && !ctx && !error);
  const today = todayISO();

  /** Troca a competência e a deixa no endereço, para recarregar ou voltar na mesma. */
  const setMonth = useCallback((next: string) => {
    setMonthState(next);
    setError(null);
    window.history.replaceState(null, '', `?mes=${next}`);
  }, []);
  const requestMonth = (next: string) => (dirty ? setPendingMonth(next) : setMonth(next));

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

  const existingSummary = useMemo(() => ctx?.register?.summaries.find((s) => s.month === month) ?? null, [ctx, month]);

  const previousSummary = useMemo(() => {
    if (!ctx?.register?.summaries.length) return null;
    const prev = prevMonthOf(month);
    return (
      ctx.register.summaries.find((s) => s.month === prev) ??
      [...ctx.register.summaries].filter((s) => s.month < month).sort((a, b) => b.month.localeCompare(a.month))[0] ??
      null
    );
  }, [ctx, month]);

  const locked = Boolean(ctx?.lockedMonths.has(month));
  const year = Number(month.slice(0, 4));

  const mapping = useMemo(() => resolvePayrollMapping(ctx?.register?.defaultMapping, existingSummary?.mappedAccounts), [ctx, existingSummary]);

  const overview = useMemo(() => payrollYearOverview(ctx?.register, year, ctx?.lockedMonths ?? new Set(), today), [ctx, year, today]);

  const obligations = useMemo(() => {
    if (!existingSummary || !ctx) return [];
    return matchBankTransactionsWithPayroll(existingSummary, ctx.windowTransactions, ctx.accounts, mapping, { priorBalances: ctx.priorBalances, today });
  }, [existingSummary, ctx, mapping, today]);

  const calc = useMemo(() => (existingSummary ? calculateNetPayroll(existingSummary) : null), [existingSummary]);

  // O lançamento do Diário ainda confere com o resumo gravado? (plano alterado, lançamento apagado…)
  const entryStatus = useMemo(() => {
    if (!ctx || !existingSummary) return null;
    return payrollRoutineStatus({ register: ctx.register, month, accounts: ctx.accounts, existing: ctx.monthEntries.find((e) => e.payrollMonth === month) });
  }, [ctx, existingSummary, month]);
  const needsRepost = !locked && entryStatus?.kind === 'PENDING';

  const handleSave = async (input: PayrollInput) => {
    if (!clientId || !ctx) return;
    setSaving(true);
    setError(null);
    try {
      await savePayrollMonth(clientId, input, ctx, user?.uid ?? 'local');
      reload();
      setToast(`Folha de ${formatMonth(month)} contabilizada no Diário.`);
    } catch (err) {
      reportError(err, { area: 'folha', op: 'salvar' });
      setError(err instanceof Error ? err.message : 'Erro ao contabilizar a folha de pagamento.');
      if (isRegisterConflictError(err)) reload();
    } finally {
      setSaving(false);
    }
  };

  /** Falha sobe para o diálogo de confirmação, que mostra a mensagem e deixa tentar de novo. */
  const handleDelete = async () => {
    if (!clientId || !ctx) return;
    setSaving(true);
    setError(null);
    try {
      await deletePayrollMonth(clientId, month, ctx);
      reload();
      setToast(`Folha de ${formatMonth(month)} excluída.`);
    } catch (err) {
      reportError(err, { area: 'folha', op: 'excluir' });
      if (isRegisterConflictError(err)) reload();
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const handleReconcile = async (tx: BankTransaction, obligation: PayrollObligationMatch) => {
    if (!clientId || !ctx) return;
    setError(null);
    try {
      await reconcilePayrollBankTransaction({ clientId, transaction: tx, obligation, ctx });
      reload();
      setToast(`Pagamento conciliado em ${obligation.accountCode} ${obligation.accountName}.`);
    } catch (err) {
      reportError(err, { area: 'folha', op: 'conciliar' });
      setError(err instanceof Error ? err.message : 'Erro ao conciliar o lançamento bancário.');
    }
  };

  const exportArgs = () => {
    if (!currentClient || !existingSummary || !ctx) return null;
    const entry = ctx.monthEntries.find((e) => e.payrollMonth === month) ?? buildPayrollJournalDraft(existingSummary, ctx.accounts, mapping);
    return {
      client: currentClient,
      summary: existingSummary,
      journalLines: entry.lines,
      obligations,
      signatories: { legalRepresentative: { name: currentClient.legalRepresentativeName, cpf: currentClient.legalRepresentativeCpf } },
    };
  };

  const handleExport = async (kind: 'pdf' | 'excel') => {
    try {
      const args = exportArgs();
      if (!args) return;
      const { blob, fileName } = kind === 'pdf' ? generatePayrollPdf(args) : await generatePayrollExcel(args);
      downloadBlob(blob, fileName);
    } catch (err) {
      reportError(err, { area: 'folha', op: kind === 'pdf' ? 'exportar-pdf' : 'exportar-excel' });
      setError(err instanceof Error ? err.message : kind === 'pdf' ? 'Não foi possível exportar o PDF.' : 'Não foi possível exportar a planilha.');
    }
  };

  if (!currentClient) {
    return (
      <main className={PAGE}>
        <PageHeader title="Folha de Pagamento" />
        <section className={`${SURFACE} rounded-[22px]`}>
          <EmptyState title="Selecione uma empresa" description="Escolha um cliente na barra lateral para lançar a folha e conferir os pagamentos no extrato." />
        </section>
      </main>
    );
  }

  // Situação dos pagamentos, para o cartão de resumo.
  const settled = obligations.filter((o) => o.status === 'SETTLED').length;
  const overdue = obligations.filter((o) => o.overdue);
  const openAmount = obligations.reduce((s, o) => s + o.remaining, 0);
  const nextDue = obligations
    .filter((o) => o.remaining > 0 && o.dueDate && !o.overdue)
    .map((o) => o.dueDate as string)
    .sort()[0];
  const paymentsTone: StatTone = obligations.length === 0 ? 'neutral' : overdue.length > 0 ? 'alert' : settled === obligations.length ? 'good' : 'warn';
  const paymentsCaption =
    overdue.length > 0
      ? `${overdue.length} vencida(s) · falta ${formatCurrency(openAmount)}`
      : settled === obligations.length
        ? 'tudo quitado no extrato'
        : nextDue
          ? `falta ${formatCurrency(openAmount)} · próximo vencimento ${formatDateBR(nextDue).slice(0, 5)}`
          : `falta ${formatCurrency(openAmount)}`;

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient.tradeName || currentClient.name}
        title="Folha de Pagamento"
        description="Lance o resumo da folha e do pró-labore de cada competência e acompanhe o pagamento dos líquidos e das guias no extrato."
        actions={
          existingSummary && (
            <>
              <button type="button" onClick={() => void handleExport('pdf')} className={BUTTON.secondary} title="Espelho contábil da folha em PDF">
                <Download className="w-3.5 h-3.5" />
                PDF
              </button>
              <button type="button" onClick={() => void handleExport('excel')} className={BUTTON.secondary} title="Espelho contábil da folha em Excel">
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Excel
              </button>
            </>
          )
        }
      />

      <PayrollMonthNav month={month} overview={overview} onChange={requestMonth} />

      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-2xl border border-rose-200/70 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-[13px] text-rose-700 dark:text-rose-300">
          <AlertTriangle className="w-4 h-4 mt-px shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {entryStatus?.kind === 'BLOCKED' && (
        <div role="alert" className="flex items-start gap-2.5 rounded-2xl border border-amber-200/80 dark:border-amber-500/25 bg-amber-50/70 dark:bg-amber-500/10 px-4 py-3 text-[13px] text-amber-900 dark:text-amber-200">
          <AlertTriangle className="w-4 h-4 mt-px shrink-0" />
          <span>{entryStatus.problem}</span>
        </div>
      )}

      {loading || !ctx ? (
        !error && (
          <>
            <CardsSkeleton count={4} className="grid grid-cols-2 lg:grid-cols-4 gap-3" cardClassName="h-[112px] rounded-[20px]" label="Carregando a folha de pagamento…" />
            <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
              <TableSkeleton rows={6} />
            </section>
          </>
        )
      ) : (
        <>
          {calc && (
            <section aria-label={`Resumo da folha de ${formatMonth(month)}`} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard icon={ReceiptText} label="Custo total da folha" value={formatCurrency(calc.totalExpense)} caption={`proventos de ${formatCurrency(calc.totalGross)}`} />
              <StatCard icon={Wallet} label="Líquido a pagar" value={formatCurrency(calc.totalNetPayable)} caption={`retenções de ${formatCurrency(calc.totalRetentions)}`} />
              <StatCard icon={Banknote} label="Guias a recolher" value={formatCurrency(calc.totalTaxesPayable)} caption={`INSS ${formatCurrency(calc.totalInssPayable)} · FGTS ${formatCurrency(calc.fgts)}`} />
              <StatCard icon={Landmark} label="Pagamentos no extrato" value={`${settled}/${obligations.length}`} tone={paymentsTone} caption={paymentsCaption} />
            </section>
          )}

          <PayrollForm
            key={`${clientId}_${month}_${existingSummary?.updatedAt ?? 'new'}`}
            clientId={currentClient.id}
            month={month}
            accounts={ctx.accounts}
            mapping={mapping}
            existingSummary={existingSummary}
            previousSummary={previousSummary}
            locked={locked}
            saving={saving}
            needsRepost={needsRepost}
            onSave={handleSave}
            onDelete={handleDelete}
            onNotify={setToast}
            onDirtyChange={setDirty}
          />

          {existingSummary && <PayrollReconciliationPanel month={month} obligations={obligations} onReconcile={handleReconcile} />}
        </>
      )}

      {pendingMonth && (
        <ConfirmDialog
          title="Trocar de competência sem contabilizar?"
          description={`Os valores digitados em ${formatMonth(month)} ainda não foram contabilizados e vão ser descartados.`}
          confirmLabel={`Ir para ${formatMonth(pendingMonth)}`}
          cancelLabel="Continuar editando"
          destructive
          onConfirm={() => {
            setMonth(pendingMonth);
            setPendingMonth(null);
          }}
          onCancel={() => setPendingMonth(null)}
        />
      )}
      {leave.pending && (
        <ConfirmDialog
          title="Sair sem contabilizar?"
          description="Os valores da folha digitados nesta tela ainda não foram contabilizados e vão ser descartados."
          confirmLabel="Sair sem contabilizar"
          cancelLabel="Continuar editando"
          destructive
          onConfirm={leave.confirm}
          onCancel={leave.cancel}
        />
      )}

      <Toast toast={toast} />
    </main>
  );
}
