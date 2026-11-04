'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpen, FileSpreadsheet, FileText, Loader2, Printer } from 'lucide-react';
import type { PeriodLock } from '@/types/firestore';
import { useClient } from '@/contexts/ClientContext';
import { PeriodPicker, usePeriod } from '@/components/ui/PeriodPicker';
import { EQUITY_GROUP_CODE, buildBalanceSheet, buildPostings, buildTrialBalance, sectionLines, type BalanceSheetLine } from '@/lib/ledger';
import { checkAccountingConsistency } from '@/lib/dre/consistency';
import { CAPITAL_GROUP_CODE, invertedBalances, missingShareCapital } from '@/lib/balance-sheet-checks';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { porteOf } from '@/lib/accounting-standard';
import { openingStatus } from '@/lib/opening';
import { bankSetupIssues, formatDC as dc, hasClosingIn, monthsWithData, standardNoteFor, statementSignatories, trialBalanceStage, withoutClosingIn, type StatementView } from '@/lib/balance-sheet-view';
import { buildDLPA, withoutClosingOf, yearEndOf } from '@/lib/year-closing';
import { buildCashFlow } from '@/lib/cash-flow';
import { useYearClosing } from '@/hooks/balanco/useYearClosing';
import { useBalanceSheetData } from '@/hooks/balanco/useBalanceSheetData';
import { BUTTON, EmptyState, PAGE, PageHeader, SegmentedControl, SURFACE } from '@/components/ui/primitives';
import { AccountLedgerDrawer } from '@/components/balanco/AccountLedgerDrawer';
import { DLPAStatement } from '@/components/balanco/DLPAStatement';
import { CashFlowStatement } from '@/components/balanco/CashFlowStatement';
import { YearClosingPanel } from '@/components/balanco/YearClosingPanel';
import { StatementChecks } from '@/components/ui/StatementChecks';
import { balanceSheetChecks, openingCheck } from '@/lib/statement-checks';
import { useSignatureReminder } from '@/hooks/useSignatureReminder';
import { LedgerPrintSignatures } from '@/components/razao/LedgerPrintSignatures';
import { StatementSkeleton } from '@/components/ui/Skeleton';
import { AccountingAmount } from '@/components/ui/Amount';

type View = StatementView;

const TITLE: Record<View, string> = {
  bs: 'Balanço patrimonial',
  tb: 'Balancete de verificação',
  dlpa: 'Lucros ou prejuízos acumulados',
  dfc: 'Fluxos de caixa',
};

const EMPTY_LOCKS: PeriodLock[] = [];


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
      <div className="flex items-baseline justify-between px-5 py-3 bg-black/3 dark:bg-white/4 border-b border-black/5">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-stone-600 dark:text-stone-300">{title}</h3>
        <AccountingAmount value={total} className="text-[13px] font-semibold" />
      </div>
      {lines.length === 0 ? (
        <p className="px-5 py-3 text-[12px] text-stone-400">Sem saldo.</p>
      ) : (
        <ul>
          {lines.map((l) => (
            <li
              key={l.accountId}
              onClick={() => onSelectAccount?.(l.accountId)}
              className={`flex items-baseline gap-3 pl-5 pr-5 py-1.5 text-[13px] transition-colors cursor-pointer hover:bg-black/3 dark:hover:bg-white/4 group ${
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
              <AccountingAmount value={l.value} />
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
  const inverted = useMemo(() => invertedBalances(bs), [bs]);
  const missingCapital = useMemo(() => missingShareCapital(bs), [bs]);
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
  const tbRows = showSynthetic ? tb.rows : tb.rows.filter((r) => !r.synthetic);

  const consistency = useMemo(() => {
    if (!txs) return null;
    return checkAccountingConsistency({
      transactions: txs.list,
      accounts,
      banks,
      date: range.end,
      openings: static_?.openings,
      journalEntries,
      carry: txs.carry,
    });
  }, [txs, accounts, banks, range.end, static_?.openings, journalEntries]);

  const opening = useMemo(
    () => (ready && accounts.length > 0 ? openingStatus(static_?.openings, accounts, banks) : null),
    [ready, static_?.openings, accounts, banks]
  );

  // Encerramento e DLPA do exercício da data final.
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
  const dlpa = useMemo(() => buildDLPA(postings, accounts, journalEntries, range.end), [postings, accounts, journalEntries, range.end]);
  // DFC do período escolhido: os lançamentos do exercício já vêm um a um; o consolidado só compõe o caixa inicial.
  const [cashFlowDetail, setCashFlowDetail] = useState(false);
  const cashFlow = useMemo(
    () => (!txs ? null : buildCashFlow({ transactions: txs.list, banks, accounts, range, openings: static_?.openings, journalEntries, carry: txs.carry })),
    [txs, banks, accounts, range, static_?.openings, journalEntries]
  );

  const standardNote = standardNoteFor(view, porteOf(currentClient));
  const { missingOpening, unlinked } = bankSetupIssues(banks);
  const hasData = postings.length > 0;
  const signatories = () => statementSignatories(currentClient, static_?.org);
  const signature = useSignatureReminder(static_?.org);

  const exportPdf = async () => {
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
      signature.remind();
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
              title={
                view === 'dlpa'
                  ? 'Exportar a DLPA em planilha Excel (.xlsx)'
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
              { value: 'dfc', label: 'DFC' },
            ]}
          />
          <PeriodPicker period={period} />
        </div>
        <Link
          href="/razao"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-stone-700 dark:text-stone-300 bg-black/4 dark:bg-white/6 hover:bg-black/8 dark:hover:bg-white/10 rounded-lg transition-colors border border-black/6 dark:border-white/8"
          title="Abrir página dedicada do Livro Razão Analítico"
        >
          <BookOpen className="w-3.5 h-3.5 text-stone-500" />
          <span>Ficha do Livro Razão</span>
        </Link>
      </div>

      {error && <p role="alert" className="text-[13px] text-rose-600">{error}</p>}

      {/* Abertura, pendências e conferências do balanço, num bloco só. */}
      <StatementChecks
        checks={[
          openingCheck(opening),
          ...(!loading && hasData
            ? balanceSheetChecks({
                trialBalance: view === 'tb',
                date: range.end,
                suspense: bs.suspense,
                unlinkedBanks: unlinked.map((b) => b.nickname),
                missingOpeningBanks: missingOpening.map((b) => b.nickname),
                inverted: view === 'bs' ? inverted.map(({ line, side }) => ({ code: line.code, name: line.name, value: line.value, side })) : [],
                missingCapitalCode: view === 'bs' && missingCapital ? CAPITAL_GROUP_CODE : null,
                difference: bs.difference,
                trialBalanced: tb.balanced,
                consistency,
                standardNote,
              })
            : standardNote
              ? [{ id: 'standard', level: 'info' as const, title: standardNote }]
              : []),
        ]}
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
      ) : view === 'dlpa' ? (
        <div className="space-y-6">
          <DLPAStatement dlpa={dlpa} />
          {yearClosing.state && (
            <YearClosingPanel state={yearClosing.state} busy={yearClosing.busy} onClose={yearClosing.close} onReopen={yearClosing.reopen} />
          )}
        </div>
      ) : view === 'bs' ? (
        <div className="grid grid-cols-2 gap-6 items-start">
          <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            <Side title="Ativo" lines={sectionLines(bs.assets)} total={bs.totalAssets} onSelectAccount={setDrawerAccountId} />
          </section>
          <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            <Side title="Passivo" lines={sectionLines(bs.liabilities)} total={bs.totalLiabilities} onSelectAccount={setDrawerAccountId} />
            <Side title="Patrimônio líquido" lines={sectionLines(bs.equity, EQUITY_GROUP_CODE)} total={bs.totalEquity} onSelectAccount={setDrawerAccountId} />
            <div className="flex items-baseline justify-between px-5 py-3 border-t border-black/8 text-[13px] font-semibold">
              <span>Total do passivo e do PL</span>
              <AccountingAmount value={bs.totalLiabilities + bs.totalEquity} />
            </div>
          </section>
        </div>
      ) : (
        <section className={`${SURFACE} rounded-[22px] overflow-hidden print:rounded-none print:border-0 print:shadow-none print:bg-transparent print:p-0`}>
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 border-b border-black/4 print:hidden">
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
            <p className="px-5 py-2 border-b border-black/4 text-[12px] text-stone-600 dark:text-stone-300 print:px-1.5 print:text-[9px]">
              Balancete {tbStage.toLowerCase()}.
            </p>
          )}
          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full text-left print-fit-table">
              <thead>
                <tr className="text-[11px] print:text-[9.5px] uppercase tracking-wider text-stone-400 print:text-stone-700 border-b border-black/4 print:border-b-2 print:border-black/40">
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
                    className={`border-b border-black/3 print:border-black/6 last:border-0 text-[13px] print:text-[9.5px] print:leading-tight print:break-inside-avoid cursor-pointer hover:bg-black/3 dark:hover:bg-white/4 transition-colors group ${
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
                <tr className="border-t border-black/8 print:border-t-2 print:border-b-2 print:border-black text-[13px] print:text-[10px] font-semibold print:break-inside-avoid">
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
      {signature.toast}
    </main>
  );
}
