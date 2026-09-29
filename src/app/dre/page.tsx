'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  FileSpreadsheet,
  FileText,
  Loader2,
  Lock,
  Printer,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { BankTransaction, ChartAccount, OrgSettings, PeriodLock } from '@/types/firestore';
import { getAccounts, getLatestTransactionDate, getRepository, getTransactions } from '@/lib/services/data-service';
import { monthsBetween } from '@/lib/periods';
import { PeriodPicker, usePeriod } from '@/components/ui/PeriodPicker';
import { useClient } from '@/contexts/ClientContext';
import { buildDRE, type DREAccountLine } from '@/lib/dre/build';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import type { DREExportContext } from '@/lib/export/dre-rows';
import { BUTTON, EmptyState, PAGE, PageHeader, SegmentedControl, SURFACE } from '@/components/ui/primitives';
import { DRECompareTable } from '@/components/dre/DRECompareTable';
import { monthlyColumns, previousYearRange } from '@/lib/dre/compare';

/** Receita bruta do período, base da análise vertical (% s/ receita bruta). */
const GrossRevenueContext = createContext(0);

function Pct({ value, strong = false }: { value: number; strong?: boolean }) {
  const base = useContext(GrossRevenueContext);
  const text =
    base > 0 ? `${((value / base) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : '—';
  return (
    <span
      className={`hidden md:inline w-20 shrink-0 text-right font-mono tabular-nums text-[12px] ${
        strong ? 'text-stone-600 dark:text-stone-300' : 'text-stone-400'
      }`}
    >
      {text}
    </span>
  );
}

/** Valor contábil: negativos entre parênteses, como em demonstrativos impressos. */
function Amount({ value, strong = false }: { value: number; strong?: boolean }) {
  const abs = formatCurrency(Math.abs(value));
  return (
    <span className={`font-mono tabular-nums whitespace-nowrap ${strong ? 'font-semibold' : ''}`}>
      {value < 0 ? `(${abs})` : abs}
    </span>
  );
}

function AccountRows({ lines, sign }: { lines: DREAccountLine[]; sign: 1 | -1 }) {
  return (
    <>
      {lines.map((l) => (
        <div key={l.accountId} className="flex items-baseline gap-3 py-2 pl-8 pr-5 text-[13px] text-stone-600 dark:text-stone-400">
          <span className="w-20 shrink-0 font-mono tabular-nums text-[12px] text-stone-400">{l.code}</span>
          <span className="flex-1 min-w-0 truncate">{l.name}</span>
          <span className="hidden sm:inline font-mono tabular-nums text-[11px] text-stone-400 w-10 text-right">{l.count}×</span>
          <Pct value={sign * l.value} />
          <span className="w-36 xl:w-44 text-right">
            <Amount value={sign * l.value} />
          </span>
        </div>
      ))}
    </>
  );
}

function Row({ label, value, variant = 'line' }: { label: string; value: number; variant?: 'line' | 'subtotal' }) {
  const subtotal = variant === 'subtotal';
  return (
    <div
      className={`flex items-baseline gap-3 px-5 ${
        subtotal ? 'py-3.5 bg-stone-900/[0.03] dark:bg-white/[0.04]' : 'py-3'
      }`}
    >
      <span
        className={`flex-1 min-w-0 text-[14px] tracking-tight ${
          subtotal ? 'font-semibold text-stone-900 dark:text-stone-50' : 'font-medium text-stone-800 dark:text-stone-200'
        }`}
      >
        {label}
      </span>
      <Pct value={value} strong />
      <span className="w-36 xl:w-44 text-right text-[14px] text-stone-900 dark:text-stone-100">
        <Amount value={value} strong={subtotal} />
      </span>
    </div>
  );
}

interface SectionProps {
  id: string;
  label: string;
  value: number;
  parts: { lines: DREAccountLine[]; sign: 1 | -1 }[];
  open: boolean;
  onToggle: (id: string) => void;
}

/** Linha de grupo da DRE, recolhível, com o detalhamento por conta analítica. */
function Section({ id, label, value, parts, open, onToggle }: SectionProps) {
  const hasLines = parts.some((p) => p.lines.length > 0);
  return (
    <div className="print-avoid-break">
      <button
        type="button"
        onClick={() => hasLines && onToggle(id)}
        aria-expanded={hasLines ? open : undefined}
        disabled={!hasLines}
        className="w-full flex items-baseline gap-3 pl-3 pr-5 py-3 text-left enabled:hover:bg-black/[0.02] dark:enabled:hover:bg-white/[0.03] transition-colors"
      >
        <ChevronDown
          className={`w-3.5 h-3.5 self-center shrink-0 text-stone-400 transition-transform duration-200 print:invisible ${
            hasLines ? '' : 'invisible'
          } ${open ? '' : '-rotate-90'}`}
        />
        <span className="flex-1 min-w-0 text-[14px] font-medium tracking-tight text-stone-800 dark:text-stone-200">{label}</span>
        <Pct value={value} strong />
        <span className="w-36 xl:w-44 text-right text-[14px] text-stone-900 dark:text-stone-100">
          <Amount value={value} />
        </span>
      </button>
      {hasLines && (
        <div className={open ? '' : 'hidden print:block'}>
          {parts.map((p, i) => (
            <AccountRows key={i} lines={p.lines} sign={p.sign} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DREPage() {
  const { currentClient } = useClient();
  const clientId = currentClient?.id;

  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const period = usePeriod('year');
  const { range, label: periodLabel, jumpTo } = period;

  // 1) Ao trocar de cliente: plano de contas + posiciona o período no lançamento mais recente.
  const [positionedFor, setPositionedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    Promise.all([getAccounts(clientId), getLatestTransactionDate(clientId)])
      .then(([accs, latest]) => {
        if (!active) return;
        setAccounts(accs);
        if (latest) jumpTo(latest);
        setPositionedFor(clientId);
      })
      .catch((e: unknown) => {
        console.error('Erro ao carregar dados da DRE:', e);
        if (active) setLoadError(e instanceof Error ? e.message : 'Falha ao carregar a DRE.');
      });
    return () => {
      active = false;
    };
  }, [clientId, jumpTo]);

  // Competências fechadas (selo de DRE definitiva) e dados do escritório (assinaturas).
  const [locks, setLocks] = useState<PeriodLock[]>([]);
  const [org, setOrg] = useState<OrgSettings | null>(null);
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    const repo = getRepository();
    Promise.all([repo.listPeriodLocks(clientId), repo.getOrgSettings()])
      .then(([l, o]) => {
        if (!active) return;
        setLocks(l);
        setOrg(o);
      })
      .catch((e: unknown) => console.error('Erro ao carregar fechamentos/escritório:', e));
    return () => {
      active = false;
    };
  }, [clientId]);
  const lockStatus = useMemo(() => {
    const months = monthsBetween(range.start, range.end);
    const closed = months.filter((m) => locks.some((l) => l.month === m)).length;
    return { total: months.length, closed };
  }, [locks, range]);

  // 2) Busca no banco apenas os lançamentos do período selecionado.
  const ready = Boolean(clientId) && positionedFor === clientId;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const periodKey = `${clientId}|${range.start}|${range.end}`;
  useEffect(() => {
    if (!clientId || !ready) return;
    let active = true;
    getTransactions(clientId, range)
      .then((txs) => {
        if (!active) return;
        setTransactions(txs);
        setLoadError(null);
        setLoadedKey(`${clientId}|${range.start}|${range.end}`);
      })
      .catch((e: unknown) => {
        console.error('Erro ao carregar lançamentos da DRE:', e);
        if (active) setLoadError(e instanceof Error ? e.message : 'Falha ao carregar a DRE.');
      });
    return () => {
      active = false;
    };
  }, [clientId, ready, range]);

  // 3) DRE comparativa: mês a mês ou contra o mesmo período do ano anterior.
  const [view, setView] = useState<'simple' | 'monthly' | 'yoy'>('simple');
  const [withAccounts, setWithAccounts] = useState(false);
  const prevRange = useMemo(() => previousYearRange(range), [range]);
  const [prevTxs, setPrevTxs] = useState<{ key: string; list: BankTransaction[] } | null>(null);
  const prevKey = `${clientId}|${prevRange.start}|${prevRange.end}`;
  useEffect(() => {
    if (!clientId || !ready || view !== 'yoy') return;
    let active = true;
    getTransactions(clientId, prevRange)
      .then((list) => active && setPrevTxs({ key: `${clientId}|${prevRange.start}|${prevRange.end}`, list }))
      .catch((e: unknown) => active && setLoadError(e instanceof Error ? e.message : 'Falha ao carregar o ano anterior.'));
    return () => {
      active = false;
    };
  }, [clientId, ready, view, prevRange]);

  const dre = useMemo(() => buildDRE(transactions, accounts, range), [transactions, accounts, range]);
  const months = useMemo(() => (view === 'monthly' ? monthlyColumns(transactions, accounts, range) : []), [view, transactions, accounts, range]);
  const prevDre = useMemo(
    () => (prevTxs?.key === prevKey ? buildDRE(prevTxs.list, accounts, prevRange) : null),
    [prevTxs, prevKey, accounts, prevRange]
  );

  const isLoading = Boolean(clientId) && loadedKey !== periodKey && !loadError;
  const profit = dre.netResult >= 0;
  const hasData = dre.reconciledCount > 0;
  const tone: 'neutral' | 'profit' | 'loss' = !hasData || isLoading ? 'neutral' : profit ? 'profit' : 'loss';
  const TONE = {
    neutral: {
      card: 'bg-white/70 dark:bg-stone-900/60 border-black/[0.06] dark:border-white/[0.08]',
      label: 'text-stone-500',
      value: 'text-stone-400 dark:text-stone-500',
      icon: 'bg-stone-200 dark:bg-stone-700 text-stone-500',
    },
    profit: {
      card: 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-900/40',
      label: 'text-emerald-700 dark:text-emerald-400',
      value: 'text-emerald-700 dark:text-emerald-300',
      icon: 'bg-emerald-600 text-white',
    },
    loss: {
      card: 'bg-rose-50/70 dark:bg-rose-950/20 border-rose-200/60 dark:border-rose-900/40',
      label: 'text-rose-700 dark:text-rose-400',
      value: 'text-rose-700 dark:text-rose-300',
      icon: 'bg-rose-600 text-white',
    },
  }[tone];

  const toggle = (id: string) => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  const isOpen = (id: string) => !collapsed[id];
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isGeneratingExcel, setIsGeneratingExcel] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const canExport = hasData && !isLoading && Boolean(currentClient);
  const busy = isGeneratingPdf || isGeneratingExcel;

  const exportContext = (): DREExportContext | null =>
    currentClient
      ? {
          client: currentClient,
          range,
          statement: dre,
          issuedAt: new Date(),
          signatories: {
            legalRepresentative: { name: currentClient.legalRepresentativeName, cpf: currentClient.legalRepresentativeCpf },
            accountant: org ? { name: org.accountantName, crc: org.accountantCrc } : undefined,
          },
        }
      : null;

  /** Carrega o gerador sob demanda (jsPDF/ExcelJS ficam fora do bundle inicial). */
  const handleExport = async (format: 'pdf' | 'xlsx') => {
    const ctx = exportContext();
    if (!ctx || busy) return;
    const setBusy = format === 'pdf' ? setIsGeneratingPdf : setIsGeneratingExcel;
    setBusy(true);
    setExportError(null);
    try {
      const [{ downloadBlob }, file] = await Promise.all([
        import('@/lib/export/dre-rows'),
        format === 'pdf'
          ? import('@/lib/export/dre-pdf').then((m) => m.generateDREPdf(ctx))
          : import('@/lib/export/dre-excel').then((m) => m.generateDREExcel(ctx)),
      ]);
      downloadBlob(file.blob, file.fileName);
    } catch (e) {
      console.error('Erro ao exportar a DRE:', e);
      setExportError(`Não foi possível gerar o ${format === 'pdf' ? 'PDF' : 'Excel'}. Tente novamente.`);
    } finally {
      setBusy(false);
    }
  };


  return (
    <main className={`${PAGE} print:p-0 print:space-y-6`}>
      <PageHeader
        eyebrow={currentClient?.name}
        title="Demonstração do resultado"
        description={
          <>
            De <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{formatDateBR(range.start)}</span> a{' '}
            <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{formatDateBR(range.end)}</span>, somente
            lançamentos conciliados.
          </>
        }
        actions={
          <div role="group" aria-label="Exportar DRE" className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleExport('pdf')}
              disabled={!canExport || busy}
              aria-busy={isGeneratingPdf}
              className={BUTTON.primary}
            >
              {isGeneratingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" strokeWidth={1.75} />}
              {isGeneratingPdf ? 'Gerando…' : 'PDF Oficial'}
            </button>
            <button
              type="button"
              onClick={() => void handleExport('xlsx')}
              disabled={!canExport || busy}
              aria-busy={isGeneratingExcel}
              className={BUTTON.secondary}
            >
              {isGeneratingExcel ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="w-4 h-4" strokeWidth={1.75} />
              )}
              {isGeneratingExcel ? 'Gerando…' : 'Exportar Excel'}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              aria-label="Imprimir"
              title="Imprimir"
              className="inline-flex items-center justify-center w-9 h-9 shrink-0 rounded-full text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] active:scale-[0.96] transition-all duration-150"
            >
              <Printer className="w-4 h-4 shrink-0" strokeWidth={1.75} />
            </button>
          </div>
        }
      />

      {/* Seletor de período e visão */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <PeriodPicker period={period} />
        <SegmentedControl
          ariaLabel="Visão da DRE"
          value={view}
          onChange={setView}
          options={[
            { value: 'simple', label: 'Simples' },
            { value: 'monthly', label: 'Mês a mês' },
            { value: 'yoy', label: 'vs. ano anterior' },
          ]}
        />
      </div>
      {Boolean(clientId) && lockStatus.total > 0 && (
        <p className="-mt-4 text-[12px] text-stone-500 print:hidden">
          <Lock className="inline w-3 h-3 -mt-0.5 mr-1" />
          {lockStatus.closed === lockStatus.total
            ? 'Todas as competências deste período estão fechadas: esta DRE é definitiva.'
            : lockStatus.closed > 0
              ? `${lockStatus.closed} de ${lockStatus.total} competência(s) fechada(s); as demais ainda podem mudar.`
              : 'Nenhuma competência deste período foi fechada; os valores ainda podem mudar.'}
          {!org && ' Cadastre o contador em Escritório para assinar a DRE exportada.'}
        </p>
      )}
      {loadError && (
        <p role="alert" className="-mt-4 text-[13px] text-rose-600 print:hidden">
          Não foi possível carregar a DRE: {loadError}
        </p>
      )}

      {!isLoading && !hasData && (
        <p className="-mt-4 text-[13px] text-stone-500 print:hidden">
          Exportação indisponível: não há lançamentos conciliados neste período.
        </p>
      )}
      {exportError && (
        <p role="alert" className="-mt-4 text-[13px] text-rose-600 print:hidden animate-fade-in">
          {exportError}
        </p>
      )}

      {/* Resultado em destaque */}
      <section
        className={`print-avoid-break rounded-[22px] p-6 sm:p-7 border ${TONE.card}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className={`text-[13px] font-medium ${TONE.label}`}>
              Resultado líquido do exercício · {periodLabel}
            </p>
            <p
              className={`mt-2 text-[32px] sm:text-[40px] leading-none font-semibold tracking-tight font-mono tabular-nums ${TONE.value}`}
            >
              {isLoading ? '—' : formatCurrency(dre.netResult)}
            </p>
            <p className="mt-3 text-[13px] text-stone-600 dark:text-stone-400">
              {tone === 'neutral' ? 'Sem movimentação conciliada' : profit ? 'Lucro' : 'Prejuízo'}
              {dre.netMargin !== null && (
                <>
                  {' · margem líquida '}
                  <span className="font-mono tabular-nums">{dre.netMargin.toFixed(1).replace('.', ',')}%</span>
                </>
              )}
            </p>
          </div>
          <span
            className={`w-11 h-11 shrink-0 rounded-2xl flex items-center justify-center ${TONE.icon}`}
          >
            {profit ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
          </span>
        </div>
      </section>

      {dre.awaitingApproval > 0 && (
        <p className="text-[13px] text-stone-500 print:hidden">
          <span className="font-mono tabular-nums text-[#0071E3]">{dre.awaitingApproval}</span> lançamento(s) auto-classificado(s)
          neste período aguardam aprovação na Conciliação e ainda não entram na DRE.
        </p>
      )}

      {view !== 'simple' && (
        <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
          <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-black/[0.05] dark:border-white/[0.06]">
            <h2 className="flex-1 text-[14px] font-semibold tracking-tight">
              {view === 'monthly' ? `Mês a mês · ${periodLabel}` : `${periodLabel} vs. mesmo período de ${prevRange.start.slice(0, 4)}`}
            </h2>
            <label className="flex items-center gap-2 text-[12px] text-stone-500 print:hidden">
              <input type="checkbox" checked={withAccounts} onChange={(e) => setWithAccounts(e.target.checked)} /> Detalhar contas
            </label>
          </div>
          {isLoading || (view === 'yoy' && !prevDre) ? (
            <p className="px-5 py-10 text-center text-[13px] text-stone-400">Carregando…</p>
          ) : view === 'monthly' && months.length < 2 ? (
            <p className="px-5 py-10 text-center text-[13px] text-stone-500">Selecione Trimestre ou Ano para comparar os meses.</p>
          ) : view === 'monthly' ? (
            <DRECompareTable mode="monthly" columns={months} total={{ label: 'Total', statement: dre }} withAccounts={withAccounts} />
          ) : (
            <DRECompareTable
              mode="yoy"
              columns={[
                { label: periodLabel, statement: dre },
                { label: `${formatDateBR(prevRange.start)} – ${formatDateBR(prevRange.end)}`, statement: prevDre! },
              ]}
              withAccounts={withAccounts}
            />
          )}
        </section>
      )}

      {view === 'simple' && (
      <GrossRevenueContext.Provider value={dre.grossRevenue}>
      {/* Demonstrativo */}
      <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
        <div className="flex items-baseline gap-3 px-5 py-3 border-b border-black/[0.05] dark:border-white/[0.06] text-[11px] uppercase tracking-wider text-stone-400">
          <span className="flex-1">Demonstrativo</span>
          <span className="hidden md:inline w-20 text-right">% RB</span>
          <span className="w-36 xl:w-44 text-right">R$</span>
        </div>

        {isLoading ? (
          <div className="p-5 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-4 rounded bg-black/[0.05] animate-pulse" />
            ))}
          </div>
        ) : !hasData ? (
          <EmptyState title="Sem lançamentos conciliados" description="Não há movimentação conciliada neste período." />
        ) : (
          <div className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
            <Section
              id="rob"
              label="Receita operacional bruta"
              value={dre.grossRevenue}
              parts={[{ lines: dre.sections.GROSS_REVENUE.lines, sign: 1 }]}
              open={isOpen('rob')}
              onToggle={toggle}
            />
            <Section
              id="ded"
              label="(−) Deduções da receita bruta"
              value={-dre.deductions}
              parts={[{ lines: dre.sections.DEDUCTIONS.lines, sign: -1 }]}
              open={isOpen('ded')}
              onToggle={toggle}
            />
            <Row label="(=) Receita operacional líquida" value={dre.netRevenue} variant="subtotal" />
            <Section
              id="cus"
              label="(−) Custos das vendas"
              value={-dre.costs}
              parts={[{ lines: dre.sections.COSTS.lines, sign: -1 }]}
              open={isOpen('cus')}
              onToggle={toggle}
            />
            <Row label="(=) Lucro bruto" value={dre.grossProfit} variant="subtotal" />
            <Section
              id="dop"
              label="(−) Despesas operacionais"
              value={-dre.operatingExpenses}
              parts={[{ lines: dre.sections.OPERATING_EXPENSES.lines, sign: -1 }]}
              open={isOpen('dop')}
              onToggle={toggle}
            />
            <Section
              id="fin"
              label="(+/−) Resultado financeiro líquido"
              value={dre.financialResult}
              parts={[
                { lines: dre.sections.FINANCIAL_INCOME.lines, sign: 1 },
                { lines: dre.sections.FINANCIAL_EXPENSES.lines, sign: -1 },
              ]}
              open={isOpen('fin')}
              onToggle={toggle}
            />
            <Section
              id="out"
              label="(+/−) Outras receitas e despesas operacionais"
              value={dre.otherResult}
              parts={[
                { lines: dre.sections.OTHER_INCOME.lines, sign: 1 },
                { lines: dre.sections.OTHER_EXPENSES.lines, sign: -1 },
              ]}
              open={isOpen('out')}
              onToggle={toggle}
            />
            {dre.sections.INCOME_TAXES.lines.length > 0 && (
              <Section
                id="ir"
                label="(−) IRPJ e CSLL"
                value={-dre.incomeTaxes}
                parts={[{ lines: dre.sections.INCOME_TAXES.lines, sign: -1 }]}
                open={isOpen('ir')}
                onToggle={toggle}
              />
            )}

            <div
              className={`flex items-baseline gap-3 px-5 py-4 ${
                profit ? 'bg-emerald-50/60 dark:bg-emerald-950/20' : 'bg-rose-50/60 dark:bg-rose-950/20'
              }`}
            >
              <span className="flex-1 text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-50">
                (=) Resultado líquido do exercício
              </span>
              <Pct value={dre.netResult} strong />
              <span className={`w-36 xl:w-44 text-right text-[15px] ${profit ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                <Amount value={dre.netResult} strong />
              </span>
            </div>
          </div>
        )}
      </section>
      </GrossRevenueContext.Provider>
      )}

      <p className="text-[12px] text-stone-400">
        Baseado em <span className="font-mono tabular-nums">{dre.reconciledCount}</span> lançamento(s) conciliado(s). Valores entre
        parênteses reduzem o resultado.
      </p>
    </main>
  );
}
