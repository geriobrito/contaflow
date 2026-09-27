'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Printer, TrendingDown, TrendingUp } from 'lucide-react';
import type { BankTransaction, ChartAccount } from '@/types/firestore';
import { getAccounts, getTransactions } from '@/lib/services/data-service';
import { useClient } from '@/contexts/ClientContext';
import { buildDRE, periodRange, type DREAccountLine, type PeriodMode } from '@/lib/dre/build';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, EmptyState, PageHeader, SegmentedControl, SURFACE } from '@/components/ui/primitives';

const MODES: readonly { value: PeriodMode; label: string }[] = [
  { value: 'month', label: 'Mês' },
  { value: 'quarter', label: 'Trimestre' },
  { value: 'year', label: 'Ano' },
];

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'] as const;
const QUARTERS = ['T1', 'T2', 'T3', 'T4'] as const;

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
          <span className="w-36 text-right">
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
      <span className="w-36 text-right text-[14px] text-stone-900 dark:text-stone-100">
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
        <span className="w-36 text-right text-[14px] text-stone-900 dark:text-stone-100">
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
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const [mode, setMode] = useState<PeriodMode>('year');
  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [month, setMonth] = useState<number>(() => new Date().getMonth() + 1);
  const [quarter, setQuarter] = useState<number>(() => Math.floor(new Date().getMonth() / 3) + 1);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    Promise.all([getTransactions(clientId), getAccounts(clientId)])
      .then(([txs, accs]) => {
        if (!active) return;
        setTransactions(txs);
        setAccounts(accs);
        setLoadedFor(clientId);
        // Posiciona o período no lançamento mais recente, se houver.
        const latest = txs.reduce<string>((max, t) => (t.date > max ? t.date : max), '');
        if (latest) {
          const [y, m] = latest.split('-').map(Number);
          setYear(y);
          setMonth(m);
          setQuarter(Math.floor((m - 1) / 3) + 1);
        }
      })
      .catch((e) => console.error('Erro ao carregar dados da DRE:', e));
    return () => {
      active = false;
    };
  }, [clientId]);

  const range = useMemo(
    () => periodRange(mode, year, mode === 'month' ? month : quarter),
    [mode, year, month, quarter]
  );
  const dre = useMemo(() => buildDRE(transactions, accounts, range), [transactions, accounts, range]);

  const isLoading = Boolean(clientId) && loadedFor !== clientId;
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
  const periodLabel =
    mode === 'year' ? String(year) : mode === 'quarter' ? `${quarter}º trimestre de ${year}` : `${MONTHS[month - 1]}/${year}`;

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-8 py-8 sm:py-12 space-y-8 print:p-0 print:space-y-6">
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
          <button type="button" onClick={() => window.print()} className={BUTTON.secondary}>
            <Printer className="w-4 h-4" strokeWidth={1.75} />
            Imprimir / PDF
          </button>
        }
      />

      {/* Seletor de período */}
      <section className="flex flex-wrap items-center gap-3 print:hidden">
        <SegmentedControl ariaLabel="Tipo de período" value={mode} onChange={setMode} options={MODES} />

        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => setYear((y) => y - 1)}
            aria-label="Ano anterior"
            className="w-8 h-8 rounded-full flex items-center justify-center text-stone-500 hover:bg-black/[0.05] active:scale-[0.94] transition-all duration-150"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="w-12 text-center font-mono tabular-nums text-[14px] font-medium text-stone-900 dark:text-stone-100">{year}</span>
          <button
            type="button"
            onClick={() => setYear((y) => y + 1)}
            aria-label="Próximo ano"
            className="w-8 h-8 rounded-full flex items-center justify-center text-stone-500 hover:bg-black/[0.05] active:scale-[0.94] transition-all duration-150"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {mode === 'quarter' && (
          <SegmentedControl
            ariaLabel="Trimestre"
            value={String(quarter)}
            onChange={(v) => setQuarter(Number(v))}
            options={QUARTERS.map((q, i) => ({ value: String(i + 1), label: q }))}
          />
        )}
        {mode === 'month' && (
          <div className="w-full sm:w-auto overflow-x-auto">
            <SegmentedControl
              ariaLabel="Mês"
              value={String(month)}
              onChange={(v) => setMonth(Number(v))}
              options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
            />
          </div>
        )}
      </section>

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

      {/* Demonstrativo */}
      <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
        <div className="flex items-baseline justify-between px-5 py-3 border-b border-black/[0.05] dark:border-white/[0.06] text-[11px] uppercase tracking-wider text-stone-400">
          <span>Demonstrativo</span>
          <span>R$</span>
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
              <span className={`w-36 text-right text-[15px] ${profit ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                <Amount value={dre.netResult} strong />
              </span>
            </div>
          </div>
        )}
      </section>

      <p className="text-[12px] text-stone-400">
        Baseado em <span className="font-mono tabular-nums">{dre.reconciledCount}</span> lançamento(s) conciliado(s). Valores entre
        parênteses reduzem o resultado.
      </p>
    </main>
  );
}
