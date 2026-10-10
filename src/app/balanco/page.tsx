'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, FileText, Loader2, Printer } from 'lucide-react';
import type { BankAccount, BankTransaction, ChartAccount, OpeningBalances, OrgSettings } from '@/types/firestore';
import { getLatestTransactionDate, getRepository } from '@/lib/services/data-service';
import { useClient } from '@/contexts/ClientContext';
import { PeriodPicker, usePeriod } from '@/components/ui/PeriodPicker';
import { buildBalanceSheet, buildPostings, buildTrialBalance, VIRTUAL, type BalanceSheetLine } from '@/lib/ledger';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, EmptyState, PAGE, PageHeader, SegmentedControl, SURFACE } from '@/components/ui/primitives';

type View = 'bs' | 'tb';

const money = (v: number) => (v < 0 ? `(${formatCurrency(-v)})` : formatCurrency(v));
/** Saldo de balancete com natureza: D (devedor) ou C (credor). */
const dc = (v: number) => (Math.abs(v) < 0.005 ? '—' : `${formatCurrency(Math.abs(v))} ${v > 0 ? 'D' : 'C'}`);

function Side({ title, lines, total }: { title: string; lines: BalanceSheetLine[]; total: number }) {
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
              className={`flex items-baseline gap-3 pl-5 pr-5 py-1.5 text-[13px] ${l.synthetic ? 'font-medium text-stone-900 dark:text-stone-100' : 'text-stone-600 dark:text-stone-400'}`}
            >
              <span className="w-24 shrink-0 font-mono tabular-nums text-[11px] text-stone-400">{l.code}</span>
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
  const [static_, setStatic] = useState<{ id: string; accounts: ChartAccount[]; banks: BankAccount[]; org: OrgSettings | null; openings: OpeningBalances | null } | null>(null);
  const [txs, setTxs] = useState<{ key: string; list: BankTransaction[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  // Plano, bancos e escritório; posiciona no mês do lançamento mais recente.
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    const repo = getRepository();
    Promise.all([repo.listAccounts(clientId), repo.listBankAccounts(clientId), repo.getOrgSettings(), getLatestTransactionDate(clientId), repo.getOpeningBalances(clientId)])
      .then(([accounts, banks, org, latest, openings]) => {
        if (!active) return;
        if (latest) jumpTo(latest);
        setStatic({ id: clientId, accounts, banks, org, openings });
      })
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : 'Falha ao carregar.'));
    return () => {
      active = false;
    };
  }, [clientId, jumpTo]);

  // Todos os lançamentos até o fim do período (o balanço acumula desde o início).
  const ready = static_?.id === clientId;
  const key = `${clientId}|${range.end}`;
  useEffect(() => {
    if (!clientId || !ready) return;
    let active = true;
    getRepository()
      .listTransactions(clientId, { start: '1900-01-01', end: range.end })
      .then((list) => active && setTxs({ key: `${clientId}|${range.end}`, list }))
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : 'Falha ao carregar lançamentos.'));
    return () => {
      active = false;
    };
  }, [clientId, ready, range.end]);

  const loading = !ready || txs?.key !== key;
  const accounts = useMemo(() => static_?.accounts ?? [], [static_]);
  const banks = useMemo(() => static_?.banks ?? [], [static_]);
  const postings = useMemo(() => (loading || !txs ? [] : buildPostings(txs.list, banks, accounts, range.end, static_?.openings)), [loading, txs, banks, accounts, range.end, static_?.openings]);
  const bs = useMemo(() => buildBalanceSheet(postings, accounts, range.end), [postings, accounts, range.end]);
  const tb = useMemo(() => buildTrialBalance(postings, accounts, range), [postings, accounts, range]);
  const tbRows = showSynthetic ? tb.rows : tb.rows.filter((r) => !r.synthetic);

  const openingGap = bs.equity.find((l) => l.accountId === VIRTUAL.OPENING)?.value ?? 0;
  const missingOpening = banks.filter((b) => b.openingBalance === undefined);
  const unlinked = banks.filter((b) => !b.ledgerAccountId);
  const hasData = postings.length > 0;

  const exportPdf = async () => {
    if (!currentClient) return;
    setGeneratingPdf(true);
    try {
      const [{ generateLedgerPdf }, { downloadBlob }] = await Promise.all([
        import('@/lib/export/ledger-pdf'),
        import('@/lib/export/dre-rows'),
      ]);
      const org = static_?.org;
      const file = generateLedgerPdf({
        client: currentClient,
        range,
        balanceSheet: bs,
        trialBalance: tb,
        documentType: view,
        showSynthetic,
        issuedAt: new Date(),
        signatories: {
          legalRepresentative: { name: currentClient.legalRepresentativeName, cpf: currentClient.legalRepresentativeCpf },
          accountant: org ? { name: org.accountantName, crc: org.accountantCrc } : undefined,
        },
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
      const [{ generateLedgerExcel }, { downloadBlob }] = await Promise.all([
        import('@/lib/export/ledger-excel'),
        import('@/lib/export/dre-rows'),
      ]);
      const org = static_?.org;
      const file = await generateLedgerExcel({
        client: currentClient,
        range,
        balanceSheet: bs,
        trialBalance: tb,
        issuedAt: new Date(),
        signatories: {
          legalRepresentative: { name: currentClient.legalRepresentativeName, cpf: currentClient.legalRepresentativeCpf },
          accountant: org ? { name: org.accountantName, crc: org.accountantCrc } : undefined,
        },
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
        title={view === 'bs' ? 'Balanço patrimonial' : 'Balancete de verificação'}
        description={
          view === 'bs' ? (
            <>Posição em <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{formatDateBR(range.end)}</span>, por partidas dobradas a partir dos extratos e das classificações.</>
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
              title={`Gerar PDF oficial do ${view === 'bs' ? 'Balanço Patrimonial' : 'Balancete'}`}
            >
              {generatingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" strokeWidth={1.75} />}
              {generatingPdf ? 'Gerando…' : 'PDF Oficial'}
            </button>
            <button
              type="button"
              disabled={!hasData || exporting || generatingPdf}
              onClick={() => void exportExcel()}
              className={BUTTON.secondary}
              title="Exportar planilha Excel (.xlsx) com Balanço e Balancete"
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

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <SegmentedControl
          ariaLabel="Demonstração"
          value={view}
          onChange={setView}
          options={[
            { value: 'bs', label: 'Balanço patrimonial' },
            { value: 'tb', label: 'Balancete' },
          ]}
        />
        <PeriodPicker period={period} />
      </div>

      {error && <p role="alert" className="text-[13px] text-rose-600">{error}</p>}

      {!loading && hasData && (
        <div className="space-y-2 print:hidden">
          {bs.suspense !== 0 && (
            <p className="flex items-start gap-2 text-[13px] text-amber-700">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              {formatCurrency(Math.abs(bs.suspense))} em lançamentos ainda não conciliados até {formatDateBR(range.end)} aparecem como “Lançamentos a classificar”. Concilie-os para um balanço definitivo.
            </p>
          )}
          {openingGap !== 0 && (
            <p className="flex items-start gap-2 text-[13px] text-amber-700">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Há {formatCurrency(Math.abs(openingGap))} em “Saldos de abertura (a detalhar)”: os saldos de abertura de clientes, fornecedores, capital etc. ainda não
                fecham com os dos bancos. <a href="/abertura" className="font-medium underline">Completar saldos de abertura</a>
              </span>
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
          <p className={`flex items-center gap-2 text-[13px] ${(view === 'bs' ? bs.difference === 0 : tb.balanced) ? 'text-emerald-700' : 'text-rose-700'}`}>
            {(view === 'bs' ? bs.difference === 0 : tb.balanced) ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {view === 'bs'
              ? bs.difference === 0
                ? 'Ativo = Passivo + Patrimônio líquido'
                : `Diferença de ${formatCurrency(bs.difference)} entre ativo e passivo + PL`
              : tb.balanced
                ? 'Débitos = créditos'
                : 'Débitos e créditos não conferem'}
          </p>
        </div>
      )}

      {loading ? (
        <p className="py-16 text-center text-[13px] text-stone-400">Carregando…</p>
      ) : !hasData ? (
        <section className={`${SURFACE} rounded-[22px]`}>
          <EmptyState title="Sem movimento até esta data" description="Importe extratos e concilie lançamentos para gerar o balanço e o balancete." />
        </section>
      ) : view === 'bs' ? (
        <div className="grid lg:grid-cols-2 gap-6 items-start">
          <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            <Side title="Ativo" lines={bs.assets} total={bs.totalAssets} />
          </section>
          <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            <Side title="Passivo" lines={bs.liabilities} total={bs.totalLiabilities} />
            <Side title="Patrimônio líquido" lines={bs.equity} total={bs.totalEquity} />
            <div className="flex items-baseline justify-between px-5 py-3 border-t border-black/[0.08] text-[13px] font-semibold">
              <span>Total do passivo e do PL</span>
              <span className="font-mono tabular-nums">{money(bs.totalLiabilities + bs.totalEquity)}</span>
            </div>
          </section>
        </div>
      ) : (
        <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
          <div className="flex items-center justify-end px-5 py-2.5 border-b border-black/[0.04] print:hidden">
            <label className="flex items-center gap-2 text-[12px] text-stone-500">
              <input type="checkbox" checked={showSynthetic} onChange={(e) => setShowSynthetic(e.target.checked)} /> Mostrar contas sintéticas
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-stone-400 border-b border-black/[0.04]">
                  <th className="font-medium pl-5 pr-3 py-2.5 w-32">Código</th>
                  <th className="font-medium px-3 py-2.5">Conta</th>
                  <th className="font-medium px-3 py-2.5 text-right">Saldo anterior</th>
                  <th className="font-medium px-3 py-2.5 text-right">Débitos</th>
                  <th className="font-medium px-3 py-2.5 text-right">Créditos</th>
                  <th className="font-medium pl-3 pr-5 py-2.5 text-right">Saldo atual</th>
                </tr>
              </thead>
              <tbody>
                {tbRows.map((r) => (
                  <tr key={r.accountId} className={`border-b border-black/[0.03] last:border-0 text-[13px] ${r.synthetic ? 'font-medium text-stone-900 dark:text-stone-100' : 'text-stone-600 dark:text-stone-400'}`}>
                    <td className="pl-5 pr-3 py-1.5 font-mono tabular-nums text-[12px] text-stone-400">{r.code}</td>
                    <td className="px-3 py-1.5" style={{ paddingLeft: `${12 + Math.max(0, r.level - 1) * 12}px` }}>{r.name}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums whitespace-nowrap">{dc(r.previous)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums whitespace-nowrap">{r.debits ? formatCurrency(r.debits) : '—'}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums whitespace-nowrap">{r.credits ? formatCurrency(r.credits) : '—'}</td>
                    <td className="pl-3 pr-5 py-1.5 text-right font-mono tabular-nums whitespace-nowrap">{dc(r.final)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-black/[0.08] text-[13px] font-semibold">
                  <td className="pl-5 pr-3 py-2.5" />
                  <td className="px-3 py-2.5">Totais (contas analíticas)</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">{dc(tb.totals.previous)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">{formatCurrency(tb.totals.debits)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">{formatCurrency(tb.totals.credits)}</td>
                  <td className="pl-3 pr-5 py-2.5 text-right font-mono tabular-nums">{dc(tb.totals.final)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
