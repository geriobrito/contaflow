'use client';

import React, { useMemo, useState, useEffect } from 'react';
import {
  X,
  FileSpreadsheet,
  Printer,
  Search,
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  Calendar,
} from 'lucide-react';
import type { BankAccount, BankTransaction, ChartAccount, ClientCompany, JournalEntry, OpeningBalances, OrgSettings } from '@/types/firestore';
import type { DateRange } from '@/lib/data/repository';
import { buildAccountLedger, type AccountLedger, type Posting } from '@/lib/ledger';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON } from '@/components/ui/primitives';
import { generateAccountLedgerExcel } from '@/lib/export/ledger-excel';

interface AccountLedgerDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string | null;
  accounts: readonly ChartAccount[];
  bankAccounts: readonly BankAccount[];
  transactions: readonly BankTransaction[];
  /** Saldos consolidados anteriores a `transactions` (competências fechadas). */
  carry?: readonly Posting[];
  journalEntries?: readonly JournalEntry[];
  range: DateRange;
  openings?: OpeningBalances | null;
  client?: ClientCompany | null;
  org?: OrgSettings | null;
}

export const AccountLedgerDrawer: React.FC<AccountLedgerDrawerProps> = ({
  isOpen,
  onClose,
  accountId,
  accounts,
  bankAccounts,
  transactions,
  carry,
  journalEntries,
  range,
  openings,
  client,
  org,
}) => {
  const [search, setSearch] = useState('');
  const [exportingExcel, setExportingExcel] = useState(false);

  // Fecha com tecla ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const ledger: AccountLedger | null = useMemo(() => {
    if (!accountId || !isOpen) return null;
    return buildAccountLedger({
      accountId,
      accounts,
      bankAccounts,
      transactions,
      range,
      openings,
      journalEntries,
      carry,
    });
  }, [accountId, isOpen, accounts, bankAccounts, transactions, range, openings, journalEntries, carry]);

  const filteredEntries = useMemo(() => {
    if (!ledger) return [];
    if (!search.trim()) return ledger.entries;
    const term = search.toLowerCase();
    return ledger.entries.filter(
      (e) =>
        e.memo.toLowerCase().includes(term) ||
        (e.documentId && e.documentId.toLowerCase().includes(term)) ||
        (e.contraAccountCode && e.contraAccountCode.toLowerCase().includes(term)) ||
        (e.contraAccountName && e.contraAccountName.toLowerCase().includes(term))
    );
  }, [ledger, search]);

  const handleExportExcel = async () => {
    if (!ledger || !client) return;
    setExportingExcel(true);
    try {
      const { blob, fileName } = await generateAccountLedgerExcel({
        client,
        ledger,
        signatories: {
          legalRepresentative: {
            name: client.legalRepresentativeName,
            cpf: client.legalRepresentativeCpf,
          },
          accountant: {
            name: org?.accountantName,
            crc: org?.accountantCrc,
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

  if (!isOpen || !ledger) return null;

  const kindLabel =
    ledger.kind === 'ASSET'
      ? 'Ativo'
      : ledger.kind === 'LIABILITY'
        ? 'Passivo'
        : ledger.kind === 'EQUITY'
          ? 'Patrimônio Líquido'
          : 'Resultado';

  return (
    <div className="fixed inset-0 z-50 flex justify-end animate-fade-in print:static print:z-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity print:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Panel */}
      <div
        className="relative z-10 w-full max-w-4xl bg-white dark:bg-stone-900 border-l border-black/[0.08] dark:border-white/[0.08] shadow-2xl flex flex-col h-full overflow-hidden print:w-full print:max-w-none print:border-none print:shadow-none print:h-auto"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <header className="p-6 border-b border-black/[0.06] dark:border-white/[0.08] flex items-start justify-between gap-4 bg-stone-50/50 dark:bg-stone-900/50">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[13px] font-semibold text-stone-700 dark:text-stone-300 bg-black/[0.04] dark:bg-white/[0.06] px-2 py-0.5 rounded">
                {ledger.code || 'Conta'}
              </span>
              <span className="text-[11px] font-medium uppercase tracking-wider text-stone-400 bg-stone-100 dark:bg-stone-800 px-2 py-0.5 rounded">
                {kindLabel}
              </span>
              {ledger.synthetic ? (
                <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                  Conta Sintética (Agrupada)
                </span>
              ) : (
                <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                  Conta Analítica
                </span>
              )}
            </div>
            <h2 className="text-[20px] font-semibold text-stone-900 dark:text-stone-100 leading-snug">
              {ledger.name}
            </h2>
            <p className="text-[12px] text-stone-500 flex items-center gap-1.5 pt-0.5">
              <Calendar className="w-3.5 h-3.5 text-stone-400" />
              Período de {formatDateBR(range.start)} até {formatDateBR(range.end)}
            </p>
          </div>

          <div className="flex items-center gap-2 print:hidden">
            <button
              onClick={handleExportExcel}
              disabled={exportingExcel}
              className={`${BUTTON.secondary} px-3 py-1.5 text-[12px] flex items-center gap-1.5`}
              title="Baixar planilha Excel do Razão"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span>{exportingExcel ? 'Gerando…' : 'Excel'}</span>
            </button>
            <button
              onClick={handlePrint}
              className={`${BUTTON.secondary} px-3 py-1.5 text-[12px] flex items-center gap-1.5`}
              title="Imprimir ficha do Razão"
            >
              <Printer className="w-4 h-4 text-stone-600" />
              <span>Imprimir</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-black/[0.05] dark:hover:bg-white/[0.05] transition-colors ml-1"
              aria-label="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Resumo dos Saldos e Movimentação */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-black/[0.06] dark:bg-white/[0.08] border-b border-black/[0.06] dark:border-white/[0.08]">
          <div className="bg-white dark:bg-stone-900 p-4">
            <span className="text-[11px] uppercase tracking-wider text-stone-400 font-medium">Saldo Anterior</span>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="font-mono tabular-nums text-[16px] font-semibold text-stone-900 dark:text-stone-100">
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
              <ArrowDownLeft className="w-3 h-3 text-emerald-600" /> Total Débitos
            </span>
            <div className="mt-1 font-mono tabular-nums text-[16px] font-semibold text-emerald-700 dark:text-emerald-400">
              {formatCurrency(ledger.totals.debits)}
            </div>
          </div>

          <div className="bg-white dark:bg-stone-900 p-4">
            <span className="text-[11px] uppercase tracking-wider text-stone-400 font-medium flex items-center gap-1">
              <ArrowUpRight className="w-3 h-3 text-rose-600" /> Total Créditos
            </span>
            <div className="mt-1 font-mono tabular-nums text-[16px] font-semibold text-rose-700 dark:text-rose-400">
              {formatCurrency(ledger.totals.credits)}
            </div>
          </div>

          <div className="bg-white dark:bg-stone-900 p-4">
            <span className="text-[11px] uppercase tracking-wider text-stone-400 font-medium">Saldo Atual</span>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="font-mono tabular-nums text-[16px] font-semibold text-stone-900 dark:text-stone-100">
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
        </section>

        {/* Barra de Filtro de Texto */}
        <div className="p-3 bg-stone-50/50 dark:bg-stone-900/50 border-b border-black/[0.05] dark:border-white/[0.06] flex items-center gap-2 print:hidden">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar por histórico, documento ou contrapartida..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-[12px] bg-white dark:bg-stone-800 border border-black/[0.08] dark:border-white/[0.1] rounded-lg focus:outline-none focus:ring-1 focus:ring-stone-400 placeholder:text-stone-400"
            />
          </div>
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-[11px] text-stone-400 hover:text-stone-600 px-2 py-1"
            >
              Limpar
            </button>
          )}
          <span className="text-[11px] text-stone-400 tabular-nums font-mono whitespace-nowrap pl-2">
            {filteredEntries.length} {filteredEntries.length === 1 ? 'partida' : 'partidas'}
          </span>
        </div>

        {/* Tabela de Lançamentos do Razão */}
        <div className="flex-1 overflow-y-auto overflow-x-auto">
          {ledger.entries.length === 0 ? (
            <div className="py-20 text-center text-stone-400 space-y-2">
              <BookOpen className="w-8 h-8 mx-auto opacity-30" />
              <p className="text-[13px] font-medium">Sem lançamentos no período</p>
              <p className="text-[12px]">Esta conta não teve débitos nem créditos entre as datas selecionadas.</p>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="py-16 text-center text-stone-400 text-[13px]">
              Nenhum lançamento corresponde ao filtro de busca.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-[12px]">
              <thead>
                <tr className="sticky top-0 bg-stone-100 dark:bg-stone-800/90 text-stone-500 uppercase tracking-wider text-[10px] font-semibold border-b border-black/[0.06] dark:border-white/[0.08] backdrop-blur z-10">
                  <th className="pl-6 pr-3 py-2.5 w-24">Data</th>
                  <th className="px-3 py-2.5 w-28">Doc / FITID</th>
                  <th className="px-3 py-2.5">Histórico</th>
                  <th className="px-3 py-2.5 w-44">Contrapartida</th>
                  <th className="px-3 py-2.5 text-right w-28">Débito</th>
                  <th className="px-3 py-2.5 text-right w-28">Crédito</th>
                  <th className="pl-3 pr-6 py-2.5 text-right w-36">Saldo Atual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                {/* Linha inicial: Saldo Anterior */}
                <tr className="bg-stone-50/60 dark:bg-stone-800/40 text-stone-500 italic font-medium">
                  <td className="pl-6 pr-3 py-2 font-mono text-[11px]">{formatDateBR(range.start)}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">—</td>
                  <td className="px-3 py-2" colSpan={2}>
                    SALDO ANTERIOR TRANSPORTADO
                  </td>
                  <td className="px-3 py-2 text-right font-mono">—</td>
                  <td className="px-3 py-2 text-right font-mono">—</td>
                  <td className="pl-3 pr-6 py-2 text-right font-mono font-semibold tabular-nums text-stone-700 dark:text-stone-300">
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

                {/* Linhas de movimentação */}
                {filteredEntries.map((e) => (
                  <tr
                    key={e.id}
                    className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="pl-6 pr-3 py-2 font-mono tabular-nums text-stone-600 dark:text-stone-400 whitespace-nowrap">
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
                      <div className="truncate max-w-[180px]" title={`${e.contraAccountCode ? `${e.contraAccountCode} - ` : ''}${e.contraAccountName || ''}`}>
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
                    <td className="pl-3 pr-6 py-2 text-right font-mono tabular-nums whitespace-nowrap">
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
              <tfoot className="sticky bottom-0 bg-stone-50 dark:bg-stone-800/95 border-t-2 border-black/[0.08] dark:border-white/[0.08] font-semibold text-stone-900 dark:text-stone-100 backdrop-blur z-10">
                <tr>
                  <td className="pl-6 pr-3 py-2.5" colSpan={4}>
                    Totais do período ({filteredEntries.length} partidas)
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                    {formatCurrency(ledger.totals.debits)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-rose-700 dark:text-rose-400">
                    {formatCurrency(ledger.totals.credits)}
                  </td>
                  <td className="pl-3 pr-6 py-2.5 text-right font-mono tabular-nums">
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
      </div>
    </div>
  );
};
