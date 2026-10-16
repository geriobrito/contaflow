'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, BookOpen, CheckCircle2, FileSpreadsheet, FileText, Info, Loader2, Printer } from 'lucide-react';
import type { BankAccount, BankTransaction, ChartAccount, JournalEntry, OpeningBalances, OrgSettings, PeriodLock } from '@/types/firestore';
import { getLatestTransactionDate, getRepository } from '@/lib/services/data-service';
import { useClient } from '@/contexts/ClientContext';
import { PeriodPicker, usePeriod } from '@/components/ui/PeriodPicker';
import { loadLedgerWindow } from '@/lib/services/ledger-loader';
import { EQUITY_GROUP_CODE, buildBalanceSheet, buildPostings, buildTrialBalance, sectionLines, type BalanceSheetLine, type Posting } from '@/lib/ledger';
import { checkAccountingConsistency } from '@/lib/dre/consistency';
import { CAPITAL_GROUP_CODE, invertedBalances, missingShareCapital } from '@/lib/balance-sheet-checks';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { porteOf } from '@/lib/accounting-standard';
import { openingStatus } from '@/lib/opening';
import { monthOf } from '@/lib/periods';
import { buildDLPA, withoutClosingOf, yearEndOf } from '@/lib/year-closing';
import { useYearClosing } from '@/hooks/balanco/useYearClosing';
import { BUTTON, EmptyState, PAGE, PageHeader, SegmentedControl, SURFACE } from '@/components/ui/primitives';
import { AccountLedgerDrawer } from '@/components/balanco/AccountLedgerDrawer';
import { DLPAStatement } from '@/components/balanco/DLPAStatement';
import { YearClosingPanel } from '@/components/balanco/YearClosingPanel';
import { OpeningStatusNotice } from '@/components/abertura/OpeningStatusNotice';
import { AccountantNotice } from '@/components/ui/AccountantNotice';
import { LedgerPrintSignatures } from '@/components/razao/LedgerPrintSignatures';
import { StatementSkeleton } from '@/components/ui/Skeleton';

type View = 'bs' | 'tb' | 'dlpa';

const TITLE: Record<View, string> = {
  bs: 'Balanço patrimonial',
  tb: 'Balancete de verificação',
  dlpa: 'Lucros ou prejuízos acumulados',
};

const EMPTY_LOCKS: PeriodLock[] = [];

const money = (v: number) => (v < 0 ? `(${formatCurrency(-v)})` : formatCurrency(v));
/** Saldo de balancete com natureza: D (devedor) ou C (credor). */
const dc = (v: number) => (Math.abs(v) < 0.005 ? '—' : `${formatCurrency(Math.abs(v))} ${v > 0 ? 'D' : 'C'}`);

function Side({
  title,
  lines,
  total,
  onSelectAccount,
}: {
  title: string;
  lines: BalanceSheetLine[];
  total: number;
  onSelectAccount?: (accountId: string) => void;
}) {
  return (
    <div className="print-avoid-break">
      <div className="flex items-baseline justify-between px-5 py-3 bg-black/[0.03] dark:bg-white/[0.04] border-b border-black/[0.05]">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-stone-600 dark:text-stone-300">{title}</h3>
        <span className="font-mono tabular-nums text-[14px] font-semibold">{money(total)}</span>
      </div>
      {lines.length === 0 ? (
        <p className="px-5 py-3 text-[12px] text-stone-400">Sem saldo.</p>
      ) : (
        <ul>
          {lines.map((l) => (
            <li
              key={l.accountId}
              onClick={() => onSelectAccount?.(l.accountId)}
              className={`flex items-baseline gap-3 pl-5 pr-5 py-1.5 text-[13px] transition-colors cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.04] group ${
                l.synthetic ? 'font-medium text-stone-900 dark:text-stone-100' : 'text-stone-600 dark:text-stone-400'
              }`}
              title="Clique para abrir o Livro Razão desta conta"
            >
              <span className="w-24 shrink-0 font-mono tabular-nums text-[11px] text-stone-400 group-hover:text-stone-700 dark:group-hover:text-stone-200">
                {l.code}
              </span>
              <span className="flex-1 min-w-0 truncate" style={{ paddingLeft: `${Math.max(0, l.level - 1) * 12}px` }}>
                {l.name}
              </span>
              <span className="font-mono tabular-nums whitespace-nowrap">{money(l.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function BalancoPage() {
  const { currentClient } = useClient();
  const clientId = currentClient?.id;
  const period = usePeriod('month');
  const { range, jumpTo } = period;
  const [view, setView] = useState<View>('bs');
  const [showSynthetic, setShowSynthetic] = useState(true);
  const [static_, setStatic] = useState<{
    id: string;
    accounts: ChartAccount[];
    banks: BankAccount[];
    org: OrgSettings | null;
    openings: OpeningBalances | null;
    journalEntries: JournalEntry[];
    locks: PeriodLock[];
  } | null>(null);
  /** Muda depois de encerrar ou reabrir o exercício: relê plano e lançamentos manuais. */
  const [reloadCount, setReloadCount] = useState(0);
  const [txs, setTxs] = useState<{ key: string; list: BankTransaction[]; carry: Posting[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [drawerAccountId, setDrawerAccountId] = useState<string | null>(null);

  // Plano, bancos, escritório e lançamentos manuais; posiciona no mês do lançamento mais recente.
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    const repo = getRepository();
    Promise.all([
      repo.listAccounts(clientId),
      repo.listBankAccounts(clientId),
      repo.getOrgSettings(),
      getLatestTransactionDate(clientId),
      repo.getOpeningBalances(clientId),
      // Sem os lançamentos manuais o balanço sairia com valores errados: a falha bloqueia o relatório.
      repo.listJournalEntries(clientId),
      repo.listPeriodLocks(clientId),
    ])
      .then(([accounts, banks, org, latest, openings, journalEntries, locks]) => {
        if (!active) return;
        // Recarga depois do encerramento: fica no período escolhido.
        if (latest && reloadCount === 0) jumpTo(latest);
        setStatic({ id: clientId, accounts, banks, org, openings, journalEntries, locks });
        setError(null);
      })
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : 'Falha ao carregar.'));
    return () => {
      active = false;
    };
  }, [clientId, jumpTo, reloadCount]);

  // O balanço acumula desde o início, mas só os lançamentos do exercício são lidos um a um:
  // o que veio antes entra pelo saldo consolidado das competências fechadas (`carry`).
  // Navegar entre meses do mesmo exercício não refaz a leitura.
  const ready = static_?.id === clientId;
  const accounts = useMemo(() => static_?.accounts ?? [], [static_]);
  const banks = useMemo(() => static_?.banks ?? [], [static_]);
  const from = `${range.start.slice(0, 4)}-01-01`;
  const until = `${range.end.slice(0, 4)}-12-31`;
  const key = `${clientId}|${from}|${until}`;
  useEffect(() => {
    if (!clientId || !ready) return;
    let active = true;
    loadLedgerWindow({ clientId, accounts, banks, from, until })
      .then((w) => active && setTxs({ key: `${clientId}|${from}|${until}`, list: w.transactions, carry: w.carry }))
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : 'Falha ao carregar lançamentos.'));
    return () => {
      active = false;
    };
  }, [clientId, ready, accounts, banks, from, until]);

  const loading = !ready || txs?.key !== key;
  const postings = useMemo(
    () => (loading || !txs ? [] : buildPostings(txs.list, banks, accounts, range.end, static_?.openings, static_?.journalEntries, txs.carry)),
    [loading, txs, banks, accounts, range.end, static_?.openings, static_?.journalEntries]
  );
  const bs = useMemo(() => buildBalanceSheet(postings, accounts, range.end), [postings, accounts, range.end]);
  const inverted = useMemo(() => invertedBalances(bs), [bs]);
  const missingCapital = useMemo(() => missingShareCapital(bs), [bs]);
  // Balancete antes (padrão) ou depois do encerramento do exercício que cai no período: antes, as
  // contas de resultado aparecem com os saldos do ano; depois, zeradas contra a ARE.
  const [ignoreClosing, setIgnoreClosing] = useState(true);
  const inRangeClosing = (j: JournalEntry) => Boolean(j.yearClosing) && j.date >= range.start && j.date <= range.end;
  const closingInRange = (static_?.journalEntries ?? []).some(inRangeClosing);
  const tbPostings = useMemo(
    () =>
      !ignoreClosing || !closingInRange || loading || !txs
        ? postings
        : buildPostings(txs.list, banks, accounts, range.end, static_?.openings, (static_?.journalEntries ?? []).filter((j) => !inRangeClosing(j)), txs.carry),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inRangeClosing só depende de `range`
    [ignoreClosing, closingInRange, loading, txs, postings, banks, accounts, range, static_?.openings, static_?.journalEntries]
  );
  const tb = useMemo(() => buildTrialBalance(tbPostings, accounts, range), [tbPostings, accounts, range]);
  const tbStage = closingInRange ? (ignoreClosing ? 'Antes do encerramento do exercício' : 'Após o encerramento do exercício (ARE)') : undefined;
  const tbRows = showSynthetic ? tb.rows : tb.rows.filter((r) => !r.synthetic);

  const consistency = useMemo(() => {
    if (loading || !txs) return null;
    return checkAccountingConsistency({
      transactions: txs.list,
      accounts,
      banks,
      date: range.end,
      openings: static_?.openings,
      journalEntries: static_?.journalEntries,
      carry: txs.carry,
    });
  }, [loading, txs, accounts, banks, range.end, static_?.openings, static_?.journalEntries]);

  const opening = useMemo(
    () => (ready && accounts.length > 0 ? openingStatus(static_?.openings, accounts, banks) : null),
    [ready, static_?.openings, accounts, banks]
  );

  // Encerramento e DLPA do exercício da data final.
  const year = range.end.slice(0, 4);
  const journalEntries = useMemo(() => static_?.journalEntries ?? [], [static_]);
  const postingsBeforeClosing = useMemo(
    () =>
      loading || !txs
        ? null
        : buildPostings(txs.list, banks, accounts, yearEndOf(year), static_?.openings, withoutClosingOf(journalEntries, year), txs.carry),
    [loading, txs, banks, accounts, year, static_?.openings, journalEntries]
  );
  const monthsWithData = useMemo(
    () => new Set([...(txs?.list ?? []).map((t) => monthOf(t.date)), ...journalEntries.filter((j) => !j.yearClosing).map((j) => monthOf(j.date))]),
    [txs, journalEntries]
  );
  const yearClosing = useYearClosing({
    clientId,
    year,
    postings: postingsBeforeClosing,
    accounts,
    journalEntries,
    locks: static_?.locks ?? EMPTY_LOCKS,
    monthsWithData,
    implantation: opening?.date ?? null,
    onChanged: () => setReloadCount((c) => c + 1),
  });
  const dlpa = useMemo(() => buildDLPA(postings, accounts, journalEntries, range.end), [postings, accounts, journalEntries, range.end]);

  const missingOpening = banks.filter((b) => b.openingBalance === undefined);
  const unlinked = banks.filter((b) => !b.ledgerAccountId);
  const hasData = postings.length > 0;

  const signatories = () => ({
    legalRepresentative: { name: currentClient?.legalRepresentativeName, cpf: currentClient?.legalRepresentativeCpf },
    accountant: static_?.org ? { name: static_.org.accountantName, crc: static_.org.accountantCrc } : undefined,
  });

  const exportPdf = async () => {
    if (!currentClient) return;
    setGeneratingPdf(true);
    try {
      const { downloadBlob } = await import('@/lib/export/dre-rows');
      if (view === 'dlpa') {
        const { generateDLPAPdf } = await import('@/lib/export/dlpa-export');
        const file = generateDLPAPdf({ client: currentClient, dlpa, issuedAt: new Date(), signatories: signatories() });
        downloadBlob(file.blob, file.fileName);
        return;
      }
      const { generateLedgerPdf } = await import('@/lib/export/ledger-pdf');
      const file = generateLedgerPdf({
        client: currentClient,
        range,
        balanceSheet: bs,
        trialBalance: tb,
        documentType: view,
        showSynthetic,
        trialBalanceStage: tbStage,
        issuedAt: new Date(),
        signatories: signatories(),
      });
      downloadBlob(file.blob, file.fileName);
    } catch (e) {
      setError(`Não foi possível gerar o PDF (${e instanceof Error ? e.message : 'erro'}).`);
    } finally {
      setGeneratingPdf(false);
    }
  };

  const exportExcel = async () => {
    if (!currentClient) return;
    setExporting(true);
    try {
      const { downloadBlob } = await import('@/lib/export/dre-rows');
      if (view === 'dlpa') {
        const { generateDLPAExcel } = await import('@/lib/export/dlpa-export');
        const file = await generateDLPAExcel({ client: currentClient, dlpa, issuedAt: new Date(), signatories: signatories() });
        downloadBlob(file.blob, file.fileName);
        return;
      }
      const { generateLedgerExcel } = await import('@/lib/export/ledger-excel');
      const file = await generateLedgerExcel({
        client: currentClient,
        range,
        balanceSheet: bs,
        trialBalance: tb,
        trialBalanceStage: tbStage,
        issuedAt: new Date(),
        signatories: signatories(),
      });
      downloadBlob(file.blob, file.fileName);
    } catch (e) {
      setError(`Não foi possível gerar o Excel (${e instanceof Error ? e.message : 'erro'}).`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className={`${PAGE} print:p-0 print:space-y-4`}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title={TITLE[view]}
        description={
          view === 'bs' ? (
            <>Posição em <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{formatDateBR(range.end)}</span>, por partidas dobradas a partir dos extratos e das classificações.</>
          ) : view === 'dlpa' ? (
            <>
              Exercício de {year} até <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{formatDateBR(range.end)}</span>: saldo inicial, resultado, distribuições e
              encerramento do exercício.
            </>
          ) : (
            <>De <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{formatDateBR(range.start)}</span> a <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{formatDateBR(range.end)}</span>. Contas de resultado acumulam desde 1º de janeiro.</>
          )
        }
        actions={
          <div role="group" aria-label="Exportar relatório contábil" className="flex items-center gap-2">
            <button
              type="button"
              disabled={!hasData || generatingPdf || exporting}
              onClick={() => void exportPdf()}
              className={BUTTON.primary}
              title={`Gerar PDF oficial: ${TITLE[view]}`}
            >
              {generatingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" strokeWidth={1.75} />}
              {generatingPdf ? 'Gerando…' : 'PDF Oficial'}
            </button>
            <button
              type="button"
              disabled={!hasData || exporting || generatingPdf}
              onClick={() => void exportExcel()}
              className={BUTTON.secondary}
              title={view === 'dlpa' ? 'Exportar a DLPA em planilha Excel (.xlsx)' : 'Exportar planilha Excel (.xlsx) com Balanço e Balancete'}
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" strokeWidth={1.75} />}
              {exporting ? 'Gerando…' : 'Exportar Excel'}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              aria-label="Imprimir"
              title="Imprimir"
              className="w-9 h-9 rounded-full inline-flex items-center justify-center text-stone-500 hover:bg-black/[0.05]"
            >
              <Printer className="w-4 h-4" strokeWidth={1.75} />
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            ariaLabel="Demonstração"
            value={view}
            onChange={setView}
            options={[
              { value: 'bs', label: 'Balanço patrimonial' },
              { value: 'tb', label: 'Balancete' },
              { value: 'dlpa', label: 'DLPA' },
            ]}
          />
          <PeriodPicker period={period} />
        </div>
        <Link
          href="/razao"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-stone-700 dark:text-stone-300 bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] rounded-lg transition-colors border border-black/[0.06] dark:border-white/[0.08]"
          title="Abrir página dedicada do Livro Razão Analítico"
        >
          <BookOpen className="w-3.5 h-3.5 text-stone-500" />
          <span>Ficha do Livro Razão</span>
        </Link>
      </div>

      {error && <p role="alert" className="text-[13px] text-rose-600">{error}</p>}

      <AccountantNotice org={static_?.org} ready={ready} />

      <OpeningStatusNotice status={opening} />

      {view !== 'tb' && porteOf(currentClient) === 'PEQUENA_EMPRESA' && (
        <p role="note" className="flex items-start gap-2 rounded-2xl px-4 py-3 bg-sky-50 dark:bg-sky-950/20 border border-sky-200/60 dark:border-sky-900/40 text-[13px] text-sky-900 dark:text-sky-200 print:hidden">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Pequena empresa (NBC TG 1001): além do Balanço, da DRE e da DLPA, a norma pede a Demonstração dos Fluxos de Caixa (DFC), que o ContaFlow ainda não
            gera. Elabore-a à parte para completar o conjunto das demonstrações.
          </span>
        </p>
      )}

      {!loading && hasData && (
        <div className="space-y-2 print:hidden">
          {bs.suspense !== 0 && (
            <p className="flex items-start gap-2 text-[13px] text-amber-700">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              {formatCurrency(Math.abs(bs.suspense))} em lançamentos ainda não conciliados até {formatDateBR(range.end)} aparecem como “Lançamentos a classificar”. Concilie-os para um balanço definitivo.
            </p>
          )}
          {unlinked.length > 0 && (
            <p className="flex items-start gap-2 text-[13px] text-amber-700">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              {unlinked.length} conta(s) bancária(s) sem conta contábil ({unlinked.map((b) => b.nickname).join(', ')}). Vincule em Contas e extratos.
            </p>
          )}
          {missingOpening.length > 0 && (
            <p className="flex items-start gap-2 text-[13px] text-amber-700">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              Sem saldo inicial: {missingOpening.map((b) => b.nickname).join(', ')}. O saldo dos bancos parte de zero até ser informado em Contas e extratos.
            </p>
          )}
          {view === 'bs' && inverted.length > 0 && (
            <div role="note" className="flex items-start gap-2 text-[13px] text-amber-700">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p>Saldo invertido: confira {inverted.length === 1 ? 'a conta abaixo' : `as ${inverted.length} contas abaixo`}, com saldo contrário à natureza do grupo.</p>
                <ul className="mt-1 space-y-0.5">
                  {inverted.map(({ line, side }) => (
                    <li key={line.accountId}>
                      <span className="font-mono tabular-nums">{line.code}</span> {line.name}: {formatCurrency(-line.value)}{' '}
                      {side === 'ASSET' ? 'credor no ativo' : 'devedor no passivo'}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {view === 'bs' && missingCapital && (
            <p role="note" className="flex items-start gap-2 text-[12px] text-stone-500 dark:text-stone-400">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                Capital social ({CAPITAL_GROUP_CODE}) sem saldo. Registre-o na{' '}
                <Link href="/abertura" className="underline underline-offset-2 hover:text-stone-800 dark:hover:text-stone-200">Abertura</Link> ou por{' '}
                <Link href="/lancamentos" className="underline underline-offset-2 hover:text-stone-800 dark:hover:text-stone-200">lançamento contábil</Link>.
              </span>
            </p>
          )}
          <p className={`flex items-center gap-2 text-[13px] ${(view !== 'tb' ? bs.difference === 0 : tb.balanced) ? 'text-emerald-700' : 'text-rose-700'}`}>
            {(view !== 'tb' ? bs.difference === 0 : tb.balanced) ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {view !== 'tb'
              ? bs.difference === 0
                ? 'Ativo = Passivo + Patrimônio líquido'
                : `Diferença de ${formatCurrency(bs.difference)} entre ativo e passivo + PL`
              : tb.balanced
                ? 'Débitos = créditos'
                : 'Débitos e créditos não conferem'}
          </p>
          {consistency && (
            <p className={`flex items-center gap-2 text-[13px] ${consistency.isConsistent ? 'text-emerald-700' : 'text-amber-700'}`}>
              {consistency.isConsistent ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              {consistency.isConsistent
                ? `Conferência DRE: O Resultado do Exercício no PL (${formatCurrency(consistency.balanceCurrentResult)}) confere exatamente com a DRE do exercício.`
                : `Conferência DRE: Resultado no PL (${formatCurrency(consistency.balanceCurrentResult)}) difere da DRE (${formatCurrency(consistency.dreNetResult)}) em ${formatCurrency(Math.abs(consistency.difference))}${
                    consistency.suspenseAmount !== 0 ? ` (${formatCurrency(Math.abs(consistency.suspenseAmount))} em lançamentos a classificar)` : ''
                  }.`}
            </p>
          )}
        </div>
      )}

      {loading ? (
        // Falha de carga: fica só o erro acima, sem relatório parcial nem "carregando" eterno.
        error ? null : (
          <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            <StatementSkeleton rows={14} label="Carregando balanço…" />
          </section>
        )
      ) : !hasData ? (
        <section className={`${SURFACE} rounded-[22px]`}>
          <EmptyState title="Sem movimento até esta data" description="Importe extratos e concilie lançamentos para gerar o balanço e o balancete." />
        </section>
      ) : view === 'dlpa' ? (
        <div className="space-y-6">
          <DLPAStatement dlpa={dlpa} />
          {yearClosing.state && (
            <YearClosingPanel state={yearClosing.state} busy={yearClosing.busy} onClose={yearClosing.close} onReopen={yearClosing.reopen} />
          )}
        </div>
      ) : view === 'bs' ? (
        <div className="grid lg:grid-cols-2 gap-6 items-start">
          <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            <Side title="Ativo" lines={sectionLines(bs.assets)} total={bs.totalAssets} onSelectAccount={setDrawerAccountId} />
          </section>
          <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            <Side title="Passivo" lines={sectionLines(bs.liabilities)} total={bs.totalLiabilities} onSelectAccount={setDrawerAccountId} />
            <Side title="Patrimônio líquido" lines={sectionLines(bs.equity, EQUITY_GROUP_CODE)} total={bs.totalEquity} onSelectAccount={setDrawerAccountId} />
            <div className="flex items-baseline justify-between px-5 py-3 border-t border-black/[0.08] text-[13px] font-semibold">
              <span>Total do passivo e do PL</span>
              <span className="font-mono tabular-nums">{money(bs.totalLiabilities + bs.totalEquity)}</span>
            </div>
          </section>
        </div>
      ) : (
        <section className={`${SURFACE} rounded-[22px] overflow-hidden print:rounded-none print:border-0 print:shadow-none print:bg-transparent print:p-0`}>
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 border-b border-black/[0.04] print:hidden">
            <span className="text-[12px] text-stone-400 flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-stone-400" />
              Clique em qualquer conta para abrir a ficha do Livro Razão
            </span>
            <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
              <label className="flex items-center gap-2 text-[12px] text-stone-500">
                <input type="checkbox" checked={showSynthetic} onChange={(e) => setShowSynthetic(e.target.checked)} /> Mostrar contas sintéticas
              </label>
              <label className="flex items-center gap-2 text-[12px] text-stone-500" title="Desmarcado, o balancete sai depois do encerramento: contas de resultado zeradas contra a ARE">
                <input type="checkbox" checked={ignoreClosing} onChange={(e) => setIgnoreClosing(e.target.checked)} /> Ignorar lançamentos de encerramento (ARE)
                {!closingInRange && <span className="text-stone-400">(nenhum no período)</span>}
              </label>
            </div>
          </div>
          {tbStage && (
            <p className="px-5 py-2 border-b border-black/[0.04] text-[12px] text-stone-600 dark:text-stone-300 print:px-1.5 print:text-[9px]">
              Balancete {tbStage.toLowerCase()}.
            </p>
          )}
          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full text-left print-fit-table">
              <thead>
                <tr className="text-[11px] print:text-[9.5px] uppercase tracking-wider text-stone-400 print:text-stone-700 border-b border-black/[0.04] print:border-b-2 print:border-black/40">
                  <th className="font-medium pl-5 pr-3 py-2.5 w-32 print:w-[15%] print:pl-1.5 print:pr-1 print:py-1.5">Código</th>
                  <th className="font-medium px-3 py-2.5 print:w-[33%] print:px-1.5 print:py-1.5">Conta</th>
                  <th className="font-medium px-3 py-2.5 text-right print:w-[13%] print:px-1 print:py-1.5">Saldo anterior</th>
                  <th className="font-medium px-3 py-2.5 text-right print:w-[13%] print:px-1 print:py-1.5">Débitos</th>
                  <th className="font-medium px-3 py-2.5 text-right print:w-[13%] print:px-1 print:py-1.5">Créditos</th>
                  <th className="font-medium pl-3 pr-5 py-2.5 text-right print:w-[13%] print:pl-1 print:pr-1.5 print:py-1.5">Saldo atual</th>
                </tr>
              </thead>
              <tbody>
                {tbRows.map((r) => (
                  <tr
                    key={r.accountId}
                    onClick={() => setDrawerAccountId(r.accountId)}
                    className={`border-b border-black/[0.03] print:border-black/[0.06] last:border-0 text-[13px] print:text-[9.5px] print:leading-tight print:break-inside-avoid cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors group ${
                      r.synthetic ? 'font-medium text-stone-900 dark:text-stone-100 print:font-semibold print:text-black' : 'text-stone-600 dark:text-stone-400 print:text-stone-800'
                    }`}
                    title="Clique para abrir o Livro Razão desta conta"
                  >
                    <td className="pl-5 pr-3 py-1.5 print:pl-1.5 print:pr-1 print:py-1 font-mono tabular-nums text-[12px] print:text-[9px] text-stone-400 group-hover:text-stone-700 dark:group-hover:text-stone-200 print:text-stone-600 whitespace-nowrap">
                      {r.code}
                    </td>
                    <td className="px-3 py-1.5 print:px-1.5 print:py-1 leading-snug">
                      <span
                        className="inline-block"
                        style={{ paddingLeft: `${Math.max(0, r.level - 1) * 7}px` }}
                      >
                        {r.name}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 print:px-1 print:py-1 text-right font-mono tabular-nums text-[13px] print:text-[9.5px] whitespace-nowrap">
                      {dc(r.previous)}
                    </td>
                    <td className="px-3 py-1.5 print:px-1 print:py-1 text-right font-mono tabular-nums text-[13px] print:text-[9.5px] whitespace-nowrap">
                      {r.debits ? formatCurrency(r.debits) : '—'}
                    </td>
                    <td className="px-3 py-1.5 print:px-1 print:py-1 text-right font-mono tabular-nums text-[13px] print:text-[9.5px] whitespace-nowrap">
                      {r.credits ? formatCurrency(r.credits) : '—'}
                    </td>
                    <td className="pl-3 pr-5 py-1.5 print:pl-1 print:pr-1.5 print:py-1 text-right font-mono tabular-nums text-[13px] print:text-[9.5px] whitespace-nowrap">
                      {dc(r.final)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-black/[0.08] print:border-t-2 print:border-b-2 print:border-black text-[13px] print:text-[10px] font-semibold print:break-inside-avoid">
                  <td className="pl-5 pr-3 py-2.5 print:pl-1.5 print:pr-1 print:py-1.5" />
                  <td className="px-3 py-2.5 print:px-1.5 print:py-1.5">Totais (contas analíticas)</td>
                  <td className="px-3 py-2.5 print:px-1 print:py-1.5 text-right font-mono tabular-nums">{dc(tb.totals.previous)}</td>
                  <td className="px-3 py-2.5 print:px-1 print:py-1.5 text-right font-mono tabular-nums">{formatCurrency(tb.totals.debits)}</td>
                  <td className="px-3 py-2.5 print:px-1 print:py-1.5 text-right font-mono tabular-nums">{formatCurrency(tb.totals.credits)}</td>
                  <td className="pl-3 pr-5 py-2.5 print:pl-1 print:pr-1.5 print:py-1.5 text-right font-mono tabular-nums">{dc(tb.totals.final)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {/* Assinaturas contábeis oficiais para impressão (Balanço e Balancete) */}
      {hasData && <LedgerPrintSignatures client={currentClient} org={static_?.org} document={TITLE[view]} />}

      <AccountLedgerDrawer
        isOpen={Boolean(drawerAccountId)}
        onClose={() => setDrawerAccountId(null)}
        accountId={drawerAccountId}
        accounts={accounts}
        bankAccounts={banks}
        transactions={txs?.list ?? []}
        carry={txs?.carry}
        journalEntries={static_?.journalEntries}
        range={range}
        openings={static_?.openings}
        client={currentClient}
        org={static_?.org}
      />
    </main>
  );
}
