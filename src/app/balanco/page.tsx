'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { BookOpen, FileSpreadsheet, FileText, Loader2, Printer } from 'lucide-react';
import type { PeriodLock } from '@/types/firestore';
import { useClient } from '@/contexts/ClientContext';
import { PeriodPicker, usePeriod } from '@/components/ui/PeriodPicker';
import { EQUITY_GROUP_CODE, OPENING_ACCOUNT_CODE, buildBalanceSheet, buildPostings, buildTrialBalance, sectionLines, type BalanceSheetLine } from '@/lib/ledger';
import { formatDateBR } from '@/lib/utils/formatters';
import { comparativeLines, hasClosingIn, hasComparable, previousYearEnd, monthsWithData, statementSignatories, trialBalanceStage, withoutClosingIn, type StatementView } from '@/lib/balance-sheet-view';
import { buildDLPA, withoutClosingOf, yearEndOf } from '@/lib/year-closing';
import { buildDMPL } from '@/lib/dmpl';
import { buildCashFlow } from '@/lib/cash-flow';
import { useYearClosing } from '@/hooks/balanco/useYearClosing';
import { useBalanceSheetData } from '@/hooks/balanco/useBalanceSheetData';
import { useBalanceSheetChecks } from '@/hooks/balanco/useBalanceSheetChecks';
import { BUTTON, EmptyState, PAGE, PageHeader, SegmentedControl, Sheet, SURFACE } from '@/components/ui/primitives';
import { AccountLedgerDrawer } from '@/components/balanco/AccountLedgerDrawer';
import { DLPAStatement } from '@/components/balanco/DLPAStatement';
import { DMPLStatement } from '@/components/balanco/DMPLStatement';
import { CashFlowStatement } from '@/components/balanco/CashFlowStatement';
import { YearClosingPanel } from '@/components/balanco/YearClosingPanel';
import { TrialBalanceTable } from '@/components/balanco/TrialBalanceTable';
import { StatementChecks } from '@/components/ui/StatementChecks';
import { describeTransitory } from '@/lib/opening-transitory';
import { useSignatureReminder } from '@/hooks/useSignatureReminder';
import { LedgerPrintSignatures } from '@/components/razao/LedgerPrintSignatures';
import { StatementSkeleton } from '@/components/ui/Skeleton';
import { AccountingAmount } from '@/components/ui/Amount';

type View = StatementView;

const TITLE: Record<View, string> = {
  bs: 'Balanço patrimonial',
  tb: 'Balancete de verificação',
  dlpa: 'Lucros ou prejuízos acumulados',
  dmpl: 'Mutações do patrimônio líquido',
  dfc: 'Fluxos de caixa',
};

const EMPTY_LOCKS: PeriodLock[] = [];


function Side({
  title,
  lines,
  total,
  previous,
  onSelectAccount,
}: {
  title: string;
  lines: BalanceSheetLine[];
  total: number;
  /** Fim do exercício anterior: linhas e total da coluna de comparação. */
  previous?: { lines: BalanceSheetLine[]; total: number } | null;
  onSelectAccount?: (accountId: string) => void;
}) {
  const rows = previous ? comparativeLines(lines, previous.lines) : lines.map((l) => ({ ...l, previous: 0 }));
  return (
    <div className="print-avoid-break">
      <div className="flex items-baseline justify-between gap-3 px-5 py-3 bg-black/3 dark:bg-white/4 border-b border-black/5">
        <h3 className="flex-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-stone-600 dark:text-stone-300">{title}</h3>
        <AccountingAmount value={total} className="text-[13px] font-semibold" />
        {previous && <AccountingAmount value={previous.total} className="w-32 text-right text-[13px] font-semibold text-stone-400" />}
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-3 text-[12px] text-stone-500 dark:text-stone-400">Sem saldo.</p>
      ) : (
        <ul>
          {rows.map((l) => (
            <li
              key={l.accountId}
              onClick={() => onSelectAccount?.(l.accountId)}
              className={`flex items-baseline gap-3 pl-5 pr-5 py-1.5 text-[13px] transition-colors cursor-pointer hover:bg-black/3 dark:hover:bg-white/4 group ${
                l.synthetic ? 'font-medium text-stone-900 dark:text-stone-100' : 'text-stone-600 dark:text-stone-400'
              }`}
              title="Clique para abrir o Livro Razão desta conta"
            >
              <span className="w-24 shrink-0 font-mono tabular-nums text-[11px] text-stone-500 dark:text-stone-400 group-hover:text-stone-700 dark:group-hover:text-stone-200">
                {l.code}
              </span>
              <span className="flex-1 min-w-0 truncate" style={{ paddingLeft: `${Math.max(0, l.level - 1) * 12}px` }}>
                {l.name}
              </span>
              <AccountingAmount value={l.value} />
              {previous && <AccountingAmount value={l.previous} className="w-32 text-right text-stone-400" />}
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
  const [exporting, setExporting] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [drawerAccountId, setDrawerAccountId] = useState<string | null>(null);

  const { static_, ready, accounts, banks, journalEntries, txs, loading, error, setError, reload } = useBalanceSheetData(clientId, range, jumpTo);
  const postings = useMemo(
    () => (!txs ? [] : buildPostings(txs.list, banks, accounts, range.end, static_?.openings, journalEntries, txs.carry)),
    [txs, banks, accounts, range.end, static_?.openings, journalEntries]
  );
  const bs = useMemo(() => buildBalanceSheet(postings, accounts, range.end), [postings, accounts, range.end]);
  // Comparabilidade: a posição no fim do exercício anterior, ao lado (sem saldo então, sem coluna).
  const prevDate = previousYearEnd(range.end);
  const bsPrev = useMemo(() => {
    const prev = buildBalanceSheet(postings, accounts, prevDate);
    return hasComparable(prev) ? prev : null;
  }, [postings, accounts, prevDate]);
  // Balancete antes (padrão) ou depois do encerramento do exercício que cai no período: antes, as
  // contas de resultado aparecem com os saldos do ano; depois, zeradas contra a ARE.
  const [ignoreClosing, setIgnoreClosing] = useState(true);
  const closingInRange = hasClosingIn(journalEntries, range);
  const tbPostings = useMemo(
    () =>
      !ignoreClosing || !closingInRange || !txs
        ? postings
        : buildPostings(txs.list, banks, accounts, range.end, static_?.openings, withoutClosingIn(journalEntries, range), txs.carry),
    [ignoreClosing, closingInRange, txs, postings, banks, accounts, range, static_?.openings, journalEntries]
  );
  const tb = useMemo(() => buildTrialBalance(tbPostings, accounts, range), [tbPostings, accounts, range]);
  const tbStage = trialBalanceStage(closingInRange, ignoreClosing);

  const { opening, openLines, transitory, transitoryDue, transitoryIssue, checks } = useBalanceSheetChecks({
    client: currentClient,
    range,
    view,
    ready,
    loading,
    accounts,
    banks,
    postings,
    bs,
    tb,
    txs,
    static_,
    journalEntries,
  });

  /** Balanço de 31/12 com a conta transitória: o PDF oficial é recusado (só rascunho). */
  const [pdfBlocked, setPdfBlocked] = useState(false);
  /** "Ir para o encerramento": rola até o painel quando ele aparecer (o período pode ter de recarregar). */
  const scrollToClosing = useRef(false);
  const goToClosing = () => {
    // Encerramento do exercício que deve zerar a conta: dezembro dele, na aba DLPA.
    if (transitoryDue) jumpTo(`${transitoryDue.year}-12-31`);
    setView('dlpa');
    scrollToClosing.current = true;
  };

  // Encerramento, DLPA e DMPL do exercício da data final.
  const year = range.end.slice(0, 4);
  const postingsBeforeClosing = useMemo(
    () =>
      !txs ? null : buildPostings(txs.list, banks, accounts, yearEndOf(year), static_?.openings, withoutClosingOf(journalEntries, year), txs.carry),
    [txs, banks, accounts, year, static_?.openings, journalEntries]
  );
  const months = useMemo(() => monthsWithData(txs?.list ?? [], journalEntries), [txs, journalEntries]);
  const yearClosing = useYearClosing({
    clientId,
    year,
    postings: postingsBeforeClosing,
    accounts,
    journalEntries,
    locks: static_?.locks ?? EMPTY_LOCKS,
    monthsWithData: months,
    implantation: opening?.date ?? null,
    onChanged: reload,
  });
  useEffect(() => {
    if (!scrollToClosing.current || (view !== 'dlpa' && view !== 'dmpl') || !yearClosing.state) return;
    const panel = document.getElementById('encerramento');
    if (!panel) return;
    scrollToClosing.current = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [view, yearClosing.state]);
  const dlpa = useMemo(() => buildDLPA(postings, accounts, journalEntries, range.end), [postings, accounts, journalEntries, range.end]);
  const dmpl = useMemo(
    () => buildDMPL(postings, accounts, journalEntries, range.end, openLines),
    [postings, accounts, journalEntries, range.end, openLines]
  );
  // DFC do período escolhido: os lançamentos do exercício já vêm um a um; o consolidado só compõe o caixa inicial.
  const [cashFlowDetail, setCashFlowDetail] = useState(false);
  const cashFlow = useMemo(
    () => (!txs ? null : buildCashFlow({ transactions: txs.list, banks, accounts, range, openings: static_?.openings, journalEntries, carry: txs.carry })),
    [txs, banks, accounts, range, static_?.openings, journalEntries]
  );

  const hasData = postings.length > 0;
  const signatories = () => statementSignatories(currentClient, static_?.org);
  const signature = useSignatureReminder(static_?.org);

  const exportPdf = async (draft?: string) => {
    if (!currentClient) return;
    setGeneratingPdf(true);
    try {
      const { downloadBlob } = await import('@/lib/export/dre-rows');
      if (view === 'dfc') {
        if (!cashFlow) return;
        const { generateCashFlowPdf } = await import('@/lib/export/cash-flow-export');
        const file = generateCashFlowPdf({ client: currentClient, statement: cashFlow, detail: cashFlowDetail, issuedAt: new Date(), signatories: signatories() });
        downloadBlob(file.blob, file.fileName);
        signature.remind();
        return;
      }
      if (view === 'dlpa') {
        const { generateDLPAPdf } = await import('@/lib/export/dlpa-export');
        const file = generateDLPAPdf({ client: currentClient, dlpa, issuedAt: new Date(), signatories: signatories() });
        downloadBlob(file.blob, file.fileName);
        signature.remind();
        return;
      }
      if (view === 'dmpl') {
        const { generateDMPLPdf } = await import('@/lib/export/dmpl-export');
        const file = generateDMPLPdf({ client: currentClient, dmpl, issuedAt: new Date(), signatories: signatories() });
        downloadBlob(file.blob, file.fileName);
        signature.remind();
        return;
      }
      const { generateLedgerPdf } = await import('@/lib/export/ledger-pdf');
      const file = generateLedgerPdf({
        client: currentClient,
        range,
        balanceSheet: bs,
        previousBalanceSheet: view === 'bs' ? bsPrev : null,
        trialBalance: tb,
        documentType: view,
        showSynthetic,
        trialBalanceStage: tbStage,
        issuedAt: new Date(),
        signatories: signatories(),
        ...(draft ? { draft } : {}),
      });
      downloadBlob(file.blob, file.fileName);
      if (!draft) signature.remind();
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
      if (view === 'dfc') {
        if (!cashFlow) return;
        const { generateCashFlowExcel } = await import('@/lib/export/cash-flow-export');
        const file = await generateCashFlowExcel({ client: currentClient, statement: cashFlow, detail: cashFlowDetail, issuedAt: new Date(), signatories: signatories() });
        downloadBlob(file.blob, file.fileName);
        signature.remind();
        return;
      }
      if (view === 'dlpa') {
        const { generateDLPAExcel } = await import('@/lib/export/dlpa-export');
        const file = await generateDLPAExcel({ client: currentClient, dlpa, issuedAt: new Date(), signatories: signatories() });
        downloadBlob(file.blob, file.fileName);
        signature.remind();
        return;
      }
      if (view === 'dmpl') {
        const { generateDMPLExcel } = await import('@/lib/export/dmpl-export');
        const file = await generateDMPLExcel({ client: currentClient, dmpl, issuedAt: new Date(), signatories: signatories() });
        downloadBlob(file.blob, file.fileName);
        signature.remind();
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
      signature.remind();
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
          ) : view === 'dfc' ? (
            <>
              De <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{formatDateBR(range.start)}</span> a{' '}
              <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{formatDateBR(range.end)}</span>, pelo método direto. Para o exercício, escolha Ano no período.
            </>
          ) : view === 'dlpa' ? (
            <>
              Exercício de {year} até <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{formatDateBR(range.end)}</span>: saldo inicial, resultado, distribuições e
              encerramento do exercício.
            </>
          ) : view === 'dmpl' ? (
            <>
              Exercício de {year} até <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{formatDateBR(range.end)}</span>: mutações em todas as contas do Patrimônio
              Líquido (capital social, reservas e lucros ou prejuízos acumulados).
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
              onClick={() => (view === 'bs' && transitoryIssue?.level === 'block' ? setPdfBlocked(true) : void exportPdf())}
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
              title={
                view === 'dlpa'
                  ? 'Exportar a DLPA em planilha Excel (.xlsx)'
                  : view === 'dmpl'
                    ? 'Exportar a DMPL em planilha Excel (.xlsx)'
                    : view === 'dfc'
                      ? 'Exportar a DFC em planilha Excel (.xlsx)'
                      : 'Exportar planilha Excel (.xlsx) com Balanço e Balancete'
              }
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" strokeWidth={1.75} />}
              {exporting ? 'Gerando…' : 'Exportar Excel'}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              aria-label="Imprimir"
              title="Imprimir"
              className="w-9 h-9 rounded-full inline-flex items-center justify-center text-stone-500 hover:bg-black/5"
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
              { value: 'dmpl', label: 'DMPL' },
              { value: 'dfc', label: 'DFC' },
            ]}
          />
          <PeriodPicker period={period} />
        </div>
        <Link
          href="/razao"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-stone-700 dark:text-stone-300 bg-black/4 dark:bg-white/6 hover:bg-black/8 dark:hover:bg-white/10 rounded-lg transition-colors border border-line"
          title="Abrir página dedicada do Livro Razão Analítico"
        >
          <BookOpen className="w-3.5 h-3.5 text-stone-500" />
          <span>Ficha do Livro Razão</span>
        </Link>
      </div>

      {error && <p role="alert" className="text-[13px] text-rose-600 dark:text-rose-300">{error}</p>}

      {/* Abertura, pendências e conferências do balanço, num bloco só. */}
      <StatementChecks
        actions={{
          transitory: {
            label: 'Ir para o encerramento',
            onClick: goToClosing,
          },
          dmpl: {
            label: 'Abrir DMPL',
            onClick: () => setView('dmpl'),
          },
        }}
        checks={checks}
      />

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
      ) : view === 'dfc' ? (
        cashFlow && <CashFlowStatement statement={cashFlow} detail={cashFlowDetail} onDetailChange={setCashFlowDetail} />
      ) : view === 'dlpa' || view === 'dmpl' ? (
        <div className="space-y-6">
          {view === 'dlpa' ? <DLPAStatement dlpa={dlpa} /> : <DMPLStatement dmpl={dmpl} />}
          {yearClosing.state && (
            <YearClosingPanel state={yearClosing.state} busy={yearClosing.busy} onClose={yearClosing.close} onReopen={yearClosing.reopen} />
          )}
        </div>
      ) : view === 'bs' ? (
        <div className="grid grid-cols-2 gap-6 items-start">
          <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            {bsPrev && (
              <p className="flex justify-end gap-3 px-5 pt-3 text-[11px] font-mono tabular-nums text-stone-500 dark:text-stone-400">
                <span>{formatDateBR(range.end)}</span>
                <span className="w-32 text-right">{formatDateBR(prevDate)}</span>
              </p>
            )}
            <Side title="Ativo" lines={sectionLines(bs.assets)} total={bs.totalAssets} previous={bsPrev && { lines: sectionLines(bsPrev.assets), total: bsPrev.totalAssets }} onSelectAccount={setDrawerAccountId} />
          </section>
          <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            {bsPrev && (
              <p className="flex justify-end gap-3 px-5 pt-3 text-[11px] font-mono tabular-nums text-stone-500 dark:text-stone-400">
                <span>{formatDateBR(range.end)}</span>
                <span className="w-32 text-right">{formatDateBR(prevDate)}</span>
              </p>
            )}
            <Side title="Passivo" lines={sectionLines(bs.liabilities)} total={bs.totalLiabilities} previous={bsPrev && { lines: sectionLines(bsPrev.liabilities), total: bsPrev.totalLiabilities }} onSelectAccount={setDrawerAccountId} />
            <Side
              title="Patrimônio líquido"
              lines={sectionLines(bs.equity, EQUITY_GROUP_CODE)}
              total={bs.totalEquity}
              previous={bsPrev && { lines: sectionLines(bsPrev.equity, EQUITY_GROUP_CODE), total: bsPrev.totalEquity }}
              onSelectAccount={setDrawerAccountId}
            />
            <div className="flex items-baseline justify-between gap-3 px-5 py-3 border-t border-black/8 text-[13px] font-semibold">
              <span className="flex-1">Total do passivo e do PL</span>
              <AccountingAmount value={bs.totalLiabilities + bs.totalEquity} />
              {bsPrev && <AccountingAmount value={bsPrev.totalLiabilities + bsPrev.totalEquity} className="w-32 text-right text-stone-400" />}
            </div>
          </section>
        </div>
      ) : (
        <TrialBalanceTable
          tb={tb}
          tbStage={tbStage}
          showSynthetic={showSynthetic}
          onShowSyntheticChange={setShowSynthetic}
          ignoreClosing={ignoreClosing}
          onIgnoreClosingChange={setIgnoreClosing}
          closingInRange={closingInRange}
          onSelectAccount={setDrawerAccountId}
        />
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
      {signature.toast}

      {pdfBlocked && (
        <Sheet
          title="Balanço oficial bloqueado"
          subtitle={`Posição em ${formatDateBR(range.end)}`}
          onClose={() => setPdfBlocked(false)}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPdfBlocked(false);
                  void exportPdf(`a conta transitória ${OPENING_ACCOUNT_CODE} Balanço de Abertura tem saldo ${describeTransitory(transitory)}; encerre o exercício de ${transitoryDue?.year} para zerá-la.`);
                }}
                className={BUTTON.secondary}
              >
                Gerar rascunho
              </button>
              <button
                type="button"
                onClick={() => {
                  setPdfBlocked(false);
                  goToClosing();
                }}
                className={BUTTON.primary}
              >
                Ir para o encerramento
              </button>
            </div>
          }
        >
          <p className="pb-3 text-[14px] leading-relaxed text-stone-600 dark:text-stone-300">
            A conta transitória {OPENING_ACCOUNT_CODE} Balanço de Abertura tem saldo {describeTransitory(transitory)} e não pode aparecer no balanço patrimonial
            oficial. Encerre o exercício de {transitoryDue?.year}: o encerramento a zera contra {transitory > 0 ? 'Lucros Acumulados' : 'Prejuízos Acumulados'}. Até lá, dá para
            gerar um rascunho com marca d&apos;água.
          </p>
        </Sheet>
      )}
    </main>
  );
}
