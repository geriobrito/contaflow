'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  FileSpreadsheet,
  Printer,
  Search,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import type { BankAccount, BankTransaction, ChartAccount, JournalEntry, OpeningBalances, OrgSettings } from '@/types/firestore';
import { getLatestTransactionDate, getRepository } from '@/lib/services/data-service';
import { useClient } from '@/contexts/ClientContext';
import { PeriodPicker, usePeriod } from '@/components/ui/PeriodPicker';
import { loadLedgerWindow } from '@/lib/services/ledger-loader';
import { buildAccountLedger, type AccountLedger, type Posting } from '@/lib/ledger';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, EmptyState, PAGE, PageHeader, SURFACE } from '@/components/ui/primitives';
import { generateAccountLedgerExcel } from '@/lib/export/ledger-excel';

export default function RazaoPage() {
  const { currentClient } = useClient();
  const clientId = currentClient?.id;
  const period = usePeriod('month');
  const { range, jumpTo } = period;

  const [static_, setStatic] = useState<{
    id: string;
    accounts: ChartAccount[];
    banks: BankAccount[];
    org: OrgSettings | null;
    openings: OpeningBalances | null;
    journalEntries: JournalEntry[];
  } | null>(null);
  const [txs, setTxs] = useState<{ key: string; list: BankTransaction[]; carry: Posting[] } | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [accountSearch, setAccountSearch] = useState('');
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
  const [tableSearch, setTableSearch] = useState('');
  const [exportingExcel, setExportingExcel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Carrega plano de contas, contas bancárias, saldos e lançamentos manuais
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
      // Sem os lançamentos manuais o razão sairia com valores errados: a falha bloqueia o relatório.
      repo.listJournalEntries(clientId),
    ])
      .then(([accounts, banks, org, latest, openings, journalEntries]) => {
        if (!active) return;
        if (latest) jumpTo(latest);
        setStatic({ id: clientId, accounts, banks, org, openings, journalEntries });
        setError(null);
      })
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : 'Falha ao carregar plano de contas.'));
    return () => {
      active = false;
    };
  }, [clientId, jumpTo]);

  // Só os lançamentos do exercício são lidos um a um; o saldo anterior vem consolidado das
  // competências fechadas (`carry`). Navegar entre meses do mesmo exercício não refaz a leitura.
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

  // Deriva a conta ativa sem disparar re-renderizações cíclicas
  const effectiveAccountId = useMemo(() => {
    if (selectedAccountId) return selectedAccountId;
    const bankLedgerId = banks.find((b) => b.ledgerAccountId)?.ledgerAccountId;
    if (bankLedgerId && accounts.some((a) => a.id === bankLedgerId)) {
      return bankLedgerId;
    }
    const firstAnalytic = accounts.find((a) => a.nature === 'ANALYTIC');
    return firstAnalytic?.id ?? null;
  }, [selectedAccountId, banks, accounts]);

  // Contas filtradas para o dropdown de seleção
  const filteredAccountsForPicker = useMemo(() => {
    if (!accountSearch.trim()) return accounts;
    const term = accountSearch.toLowerCase();
    return accounts.filter((a) => a.code.toLowerCase().includes(term) || a.name.toLowerCase().includes(term));
  }, [accounts, accountSearch]);

  const activeAccount = useMemo(() => {
    if (!effectiveAccountId) return null;
    return accounts.find((a) => a.id === effectiveAccountId) ?? null;
  }, [effectiveAccountId, accounts]);

  // Calcula o Livro Razão da conta selecionada
  const ledger: AccountLedger | null = useMemo(() => {
    if (!effectiveAccountId || loading || !txs) return null;
    return buildAccountLedger({
      accountId: effectiveAccountId,
      accounts,
      bankAccounts: banks,
      transactions: txs.list,
      range,
      openings: static_?.openings,
      journalEntries: static_?.journalEntries,
      carry: txs.carry,
    });
  }, [effectiveAccountId, loading, txs, accounts, banks, range, static_?.openings, static_?.journalEntries]);

  // Filtra as linhas da tabela pelo campo de busca
  const visibleEntries = useMemo(() => {
    if (!ledger) return [];
    if (!tableSearch.trim()) return ledger.entries;
    const term = tableSearch.toLowerCase();
    return ledger.entries.filter(
      (e) =>
        e.memo.toLowerCase().includes(term) ||
        (e.documentId && e.documentId.toLowerCase().includes(term)) ||
        (e.contraAccountCode && e.contraAccountCode.toLowerCase().includes(term)) ||
        (e.contraAccountName && e.contraAccountName.toLowerCase().includes(term))
    );
  }, [ledger, tableSearch]);

  const handleExportExcel = async () => {
    if (!ledger || !currentClient) return;
    setExportingExcel(true);
    try {
      const { blob, fileName } = await generateAccountLedgerExcel({
        client: currentClient,
        ledger,
        signatories: {
          legalRepresentative: {
            name: currentClient.legalRepresentativeName,
            cpf: currentClient.legalRepresentativeCpf,
          },
          accountant: {
            name: static_?.org?.accountantName,
            crc: static_?.org?.accountantCrc,
          },
        },
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Falha ao exportar Livro Razão em Excel:', e);
    } finally {
      setExportingExcel(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <main className={PAGE}>
      {/* Cabeçalho da Página */}
      <PageHeader
        eyebrow="NBC TG 1002 / ITG 1000 — Demonstrações Contábeis"
        title="Livro Razão Analítico"
        description="Ficha detalhada de movimentação por conta contábil, saldo anterior, débitos/créditos com contrapartida e saldo progressivo acumulado."
        actions={
          <div className="flex items-center gap-2 print:hidden">
            <button
              type="button"
              disabled={!ledger || exportingExcel}
              onClick={() => void handleExportExcel()}
              className={BUTTON.secondary}
              title="Exportar esta ficha do Razão em planilha Excel (.xlsx)"
            >
              {exportingExcel ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 text-emerald-600" strokeWidth={1.75} />}
              <span>{exportingExcel ? 'Gerando…' : 'Exportar Excel'}</span>
            </button>
            <button
              type="button"
              disabled={!ledger}
              onClick={handlePrint}
              aria-label="Imprimir Ficha do Razão"
              title="Imprimir Ficha do Razão"
              className="w-9 h-9 rounded-full inline-flex items-center justify-center text-stone-500 hover:bg-black/[0.05] transition-colors"
            >
              <Printer className="w-4 h-4" strokeWidth={1.75} />
            </button>
          </div>
        }
      />

      {/* Barra de Período e Seletor de Conta */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <PeriodPicker period={period} />

        {/* Seletor de Conta com Dropdown Pesquisável */}
        <div className="relative min-w-[280px] sm:min-w-[360px]">
          <button
            type="button"
            onClick={() => setIsAccountDropdownOpen((prev) => !prev)}
            className="w-full flex items-center justify-between gap-3 px-3.5 py-2 bg-white dark:bg-stone-900 border border-black/[0.08] dark:border-white/[0.08] rounded-xl text-[13px] font-medium text-stone-800 dark:text-stone-200 shadow-sm hover:border-black/20 dark:hover:border-white/20 transition-all text-left"
          >
            <div className="flex items-center gap-2 truncate">
              {activeAccount ? (
                <>
                  <span className="font-mono text-[12px] text-stone-400 font-semibold">{activeAccount.code}</span>
                  <span className="truncate">{activeAccount.name}</span>
                </>
              ) : (
                <span className="text-stone-400">Selecione uma conta contábil...</span>
              )}
            </div>
            <ChevronDown className="w-4 h-4 text-stone-400 shrink-0" />
          </button>

          {isAccountDropdownOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-full sm:w-[420px] max-h-[380px] bg-white dark:bg-stone-900 border border-black/[0.08] dark:border-white/[0.08] rounded-xl shadow-xl z-30 flex flex-col overflow-hidden animate-fade-in">
              <div className="p-2 border-b border-black/[0.05] dark:border-white/[0.06]">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Filtrar por código ou nome..."
                    value={accountSearch}
                    onChange={(e) => setAccountSearch(e.target.value)}
                    autoFocus
                    className="w-full pl-8 pr-3 py-1.5 text-[12px] bg-stone-50 dark:bg-stone-800 border-none rounded-lg focus:outline-none focus:ring-1 focus:ring-stone-400 placeholder:text-stone-400"
                  />
                </div>
              </div>
              <div className="overflow-y-auto flex-1 divide-y divide-black/[0.03] dark:divide-white/[0.03] p-1">
                {filteredAccountsForPicker.length === 0 ? (
                  <p className="p-4 text-center text-[12px] text-stone-400">Nenhuma conta encontrada.</p>
                ) : (
                  filteredAccountsForPicker.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setSelectedAccountId(a.id);
                        setIsAccountDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-[12px] rounded-lg flex items-center justify-between gap-2 transition-colors ${
                        a.id === effectiveAccountId
                          ? 'bg-stone-100 dark:bg-stone-800 font-semibold text-stone-900 dark:text-stone-100'
                          : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.03] text-stone-700 dark:text-stone-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="font-mono text-[11px] text-stone-400 font-medium shrink-0">{a.code}</span>
                        <span className="truncate">{a.name}</span>
                      </div>
                      <span className="text-[10px] uppercase text-stone-400 font-mono shrink-0">
                        {a.nature === 'SYNTHETIC' ? 'Sintética' : 'Analítica'}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {error && <p role="alert" className="text-[13px] text-rose-600">{error}</p>}

      {/* Conteúdo Principal do Livro Razão */}
      {loading ? (
        // Falha de carga: fica só o erro acima, sem razão parcial nem "carregando" eterno.
        error ? null : <p className="py-16 text-center text-[13px] text-stone-400">Carregando movimentação contábil…</p>
      ) : !ledger ? (
        <section className={`${SURFACE} rounded-[22px]`}>
          <EmptyState title="Nenhuma conta selecionada" description="Escolha uma conta contábil no seletor acima para abrir sua ficha do Razão." />
        </section>
      ) : (
        <div className="space-y-4">
          {/* Identificação da Conta & Indicadores Principais */}
          <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            <div className="p-5 border-b border-black/[0.05] dark:border-white/[0.06] flex flex-wrap items-center justify-between gap-3 bg-stone-50/50 dark:bg-stone-900/50">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[13px] font-semibold text-stone-800 dark:text-stone-200 bg-black/[0.04] dark:bg-white/[0.06] px-2 py-0.5 rounded">
                    {ledger.code}
                  </span>
                  <span className="text-[11px] uppercase tracking-wider text-stone-400 bg-stone-100 dark:bg-stone-800 px-2 py-0.5 rounded">
                    {ledger.kind === 'ASSET' ? 'Ativo' : ledger.kind === 'LIABILITY' ? 'Passivo' : ledger.kind === 'EQUITY' ? 'Patrimônio Líquido' : 'Resultado'}
                  </span>
                  {ledger.synthetic && (
                    <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                      Conta Sintética (Movimentação Agrupada)
                    </span>
                  )}
                </div>
                <h2 className="text-[20px] font-semibold text-stone-900 dark:text-stone-100">{ledger.name}</h2>
              </div>
              <div className="text-right text-[12px] text-stone-500 font-mono">
                {formatDateBR(range.start)} a {formatDateBR(range.end)}
              </div>
            </div>

            {/* 4 Cards de Resumo */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-black/[0.05] dark:bg-white/[0.06]">
              <div className="bg-white dark:bg-stone-900 p-4">
                <span className="text-[11px] uppercase tracking-wider text-stone-400 font-medium">Saldo Anterior</span>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="font-mono tabular-nums text-[17px] font-semibold text-stone-900 dark:text-stone-100">
                    {formatCurrency(ledger.openingBalance)}
                  </span>
                  <span
                    className={`text-[12px] font-bold ${
                      ledger.openingNature === 'D' ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {ledger.openingNature}
                  </span>
                </div>
              </div>

              <div className="bg-white dark:bg-stone-900 p-4">
                <span className="text-[11px] uppercase tracking-wider text-stone-400 font-medium flex items-center gap-1">
                  <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-600" /> Total Débitos
                </span>
                <div className="mt-1 font-mono tabular-nums text-[17px] font-semibold text-emerald-700 dark:text-emerald-400">
                  {formatCurrency(ledger.totals.debits)}
                </div>
              </div>

              <div className="bg-white dark:bg-stone-900 p-4">
                <span className="text-[11px] uppercase tracking-wider text-stone-400 font-medium flex items-center gap-1">
                  <ArrowUpRight className="w-3.5 h-3.5 text-rose-600" /> Total Créditos
                </span>
                <div className="mt-1 font-mono tabular-nums text-[17px] font-semibold text-rose-700 dark:text-rose-400">
                  {formatCurrency(ledger.totals.credits)}
                </div>
              </div>

              <div className="bg-white dark:bg-stone-900 p-4">
                <span className="text-[11px] uppercase tracking-wider text-stone-400 font-medium">Saldo Atual</span>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="font-mono tabular-nums text-[17px] font-semibold text-stone-900 dark:text-stone-100">
                    {formatCurrency(ledger.totals.closingBalance)}
                  </span>
                  <span
                    className={`text-[12px] font-bold ${
                      ledger.totals.closingNature === 'D' ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {ledger.totals.closingNature}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Tabela de Lançamentos do Livro Razão */}
          <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            <div className="p-3 bg-stone-50/50 dark:bg-stone-900/50 border-b border-black/[0.04] dark:border-white/[0.06] flex items-center justify-between gap-3 print:hidden">
              <div className="relative flex-1 max-w-md">
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filtrar por histórico, documento ou contrapartida..."
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-[12px] bg-white dark:bg-stone-800 border border-black/[0.08] dark:border-white/[0.1] rounded-lg focus:outline-none focus:ring-1 focus:ring-stone-400 placeholder:text-stone-400"
                />
              </div>
              <span className="text-[11px] text-stone-400 tabular-nums font-mono whitespace-nowrap">
                {visibleEntries.length} {visibleEntries.length === 1 ? 'partida' : 'partidas'} no período
              </span>
            </div>

            <div className="overflow-x-auto print:overflow-visible">
              {ledger.entries.length === 0 ? (
                <div className="py-20 text-center text-stone-400 space-y-2">
                  <BookOpen className="w-8 h-8 mx-auto opacity-30" />
                  <p className="text-[13px] font-medium">Sem movimentação no período</p>
                  <p className="text-[12px]">Esta conta não teve débitos nem créditos entre as datas selecionadas.</p>
                </div>
              ) : visibleEntries.length === 0 ? (
                <div className="py-16 text-center text-stone-400 text-[13px]">
                  Nenhum lançamento corresponde ao filtro de busca.
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-[12px] print-fit-table">
                  <thead>
                    <tr className="bg-stone-100/70 dark:bg-stone-800/80 text-stone-500 uppercase tracking-wider text-[10px] font-semibold border-b border-black/[0.05] dark:border-white/[0.06]">
                      <th className="pl-5 pr-3 py-2.5 w-24">Data</th>
                      <th className="px-3 py-2.5 w-28">Doc / FITID</th>
                      <th className="px-3 py-2.5">Histórico</th>
                      <th className="px-3 py-2.5 w-48">Contrapartida</th>
                      <th className="px-3 py-2.5 text-right w-28">Débito</th>
                      <th className="px-3 py-2.5 text-right w-28">Crédito</th>
                      <th className="pl-3 pr-5 py-2.5 text-right w-36">Saldo Atual</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.03] dark:divide-white/[0.03]">
                    {/* Linha inicial: Saldo Anterior Transportado */}
                    <tr className="bg-stone-50/60 dark:bg-stone-800/40 text-stone-500 italic font-medium">
                      <td className="pl-5 pr-3 py-2 font-mono text-[11px]">{formatDateBR(range.start)}</td>
                      <td className="px-3 py-2 font-mono text-[11px]">—</td>
                      <td className="px-3 py-2" colSpan={2}>
                        SALDO ANTERIOR TRANSPORTADO
                      </td>
                      <td className="px-3 py-2 text-right font-mono">—</td>
                      <td className="px-3 py-2 text-right font-mono">—</td>
                      <td className="pl-3 pr-5 py-2 text-right font-mono font-semibold tabular-nums text-stone-700 dark:text-stone-300">
                        {formatCurrency(ledger.openingBalance)}{' '}
                        <span
                          className={`text-[10px] font-bold ${
                            ledger.openingNature === 'D' ? 'text-blue-600' : 'text-amber-600'
                          }`}
                        >
                          {ledger.openingNature}
                        </span>
                      </td>
                    </tr>

                    {/* Linhas de movimentação cronológica */}
                    {visibleEntries.map((e) => (
                      <tr key={e.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                        <td className="pl-5 pr-3 py-2 font-mono tabular-nums text-stone-600 dark:text-stone-400 whitespace-nowrap">
                          {formatDateBR(e.date)}
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums text-[11px] text-stone-400 truncate max-w-[120px]" title={e.documentId}>
                          {e.documentId || '—'}
                        </td>
                        <td className="px-3 py-2 text-stone-800 dark:text-stone-200 font-medium">
                          <div className="max-w-md truncate" title={e.memo}>
                            {e.memo}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-stone-600 dark:text-stone-400">
                          <div className="truncate max-w-[200px]" title={`${e.contraAccountCode ? `${e.contraAccountCode} - ` : ''}${e.contraAccountName || ''}`}>
                            {e.contraAccountCode && (
                              <span className="font-mono text-[10px] bg-stone-100 dark:bg-stone-800 px-1 py-0.5 rounded mr-1 text-stone-500">
                                {e.contraAccountCode}
                              </span>
                            )}
                            <span className="text-[11px]">{e.contraAccountName || '—'}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                          {e.debit > 0 ? formatCurrency(e.debit) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums font-medium text-rose-700 dark:text-rose-400 whitespace-nowrap">
                          {e.credit > 0 ? formatCurrency(e.credit) : '—'}
                        </td>
                        <td className="pl-3 pr-5 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                          <span className="font-semibold text-stone-900 dark:text-stone-100">
                            {formatCurrency(e.balance)}
                          </span>{' '}
                          <span
                            className={`text-[10px] font-bold ${
                              e.balanceNature === 'D' ? 'text-blue-600' : 'text-amber-600'
                            }`}
                          >
                            {e.balanceNature}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-black/[0.08] dark:border-white/[0.08] font-semibold text-stone-900 dark:text-stone-100 bg-stone-50 dark:bg-stone-800/95">
                    <tr>
                      <td className="pl-5 pr-3 py-2.5" colSpan={4}>
                        Totais do período ({visibleEntries.length} partidas)
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                        {formatCurrency(ledger.totals.debits)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-rose-700 dark:text-rose-400">
                        {formatCurrency(ledger.totals.credits)}
                      </td>
                      <td className="pl-3 pr-5 py-2.5 text-right font-mono tabular-nums">
                        {formatCurrency(ledger.totals.closingBalance)}{' '}
                        <span
                          className={`text-[10px] font-bold ${
                            ledger.totals.closingNature === 'D' ? 'text-blue-600' : 'text-amber-600'
                          }`}
                        >
                          {ledger.totals.closingNature}
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Assinaturas Contábeis Oficiais na Impressão */}
      {ledger && (
        <section aria-label="Assinaturas contábeis" className="hidden print:block pt-8 print-avoid-break">
          <div className="text-[9px] text-stone-500 mb-6 text-center">
            NBC TG 1002 / ITG 1000 — Livro Razão emitido em {new Date().toLocaleDateString('pt-BR')} via ContaFlow
          </div>
          <div className="grid grid-cols-2 gap-8 pt-4">
            <div className="text-center">
              <div className="border-t border-stone-800 pt-1.5 w-64 mx-auto">
                <p className="text-[10px] font-semibold text-stone-900 uppercase">
                  {currentClient?.legalRepresentativeName || currentClient?.name || 'Representante Legal'}
                </p>
                <p className="text-[9px] text-stone-600">
                  {currentClient?.legalRepresentativeCpf ? `CPF: ${currentClient.legalRepresentativeCpf}` : 'Representante Legal'}
                </p>
              </div>
            </div>
            <div className="text-center">
              <div className="border-t border-stone-800 pt-1.5 w-64 mx-auto">
                <p className="text-[10px] font-semibold text-stone-900 uppercase">
                  {static_?.org?.accountantName || 'Contador Responsável'}
                </p>
                <p className="text-[9px] text-stone-600">
                  {static_?.org?.accountantCrc ? `CRC: ${static_.org.accountantCrc}` : 'Contador'}
                </p>
              </div>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
