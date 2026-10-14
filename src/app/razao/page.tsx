'use client';

import React, { useMemo, useState } from 'react';
import { FileSpreadsheet, Loader2, Printer } from 'lucide-react';
import { useClient } from '@/contexts/ClientContext';
import { useLedgerData } from '@/hooks/useLedgerData';
import { PeriodPicker, usePeriod } from '@/components/ui/PeriodPicker';
import { buildAccountLedger, type AccountLedger } from '@/lib/ledger';
import { describeError } from '@/lib/utils/errors';
import { accountingStandardCode } from '@/lib/accounting-standard';
import { BUTTON, EmptyState, PAGE, PageHeader, SURFACE } from '@/components/ui/primitives';
import { AccountSelect } from '@/components/razao/AccountSelect';
import { LedgerEntriesTable } from '@/components/razao/LedgerEntriesTable';
import { LedgerPrintSignatures } from '@/components/razao/LedgerPrintSignatures';
import { LedgerSummary } from '@/components/razao/LedgerSummary';

/**
 * Livro Razão: ficha de uma conta no período. Os dados vêm de `useLedgerData` (o mesmo do
 * Livro Diário), e os blocos da tela ficam em src/components/razao/.
 */
export default function RazaoPage() {
  const { currentClient } = useClient();
  const period = usePeriod('month');
  const { range, jumpTo } = period;
  const { data, accounts, banks, transactions, carry, loading, error, setError } = useLedgerData(currentClient?.id, range, jumpTo);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [exportingExcel, setExportingExcel] = useState(false);

  // Conta aberta: a escolhida, ou a do primeiro banco vinculado, ou a primeira analítica.
  const effectiveAccountId = useMemo(() => {
    if (selectedAccountId) return selectedAccountId;
    const bankLedgerId = banks.find((b) => b.ledgerAccountId)?.ledgerAccountId;
    if (bankLedgerId && accounts.some((a) => a.id === bankLedgerId)) return bankLedgerId;
    return accounts.find((a) => a.nature === 'ANALYTIC')?.id ?? null;
  }, [selectedAccountId, banks, accounts]);

  const ledger: AccountLedger | null = useMemo(() => {
    if (!effectiveAccountId || !transactions || !data) return null;
    return buildAccountLedger({
      accountId: effectiveAccountId,
      accounts,
      bankAccounts: banks,
      transactions,
      range,
      openings: data.openings,
      journalEntries: data.journalEntries,
      carry,
    });
  }, [effectiveAccountId, transactions, carry, data, accounts, banks, range]);

  const handleExportExcel = async () => {
    if (!ledger || !currentClient) return;
    setExportingExcel(true);
    try {
      const [{ generateAccountLedgerExcel }, { downloadBlob }] = await Promise.all([import('@/lib/export/ledger-excel'), import('@/lib/export/dre-rows')]);
      const { blob, fileName } = await generateAccountLedgerExcel({
        client: currentClient,
        ledger,
        signatories: {
          legalRepresentative: { name: currentClient.legalRepresentativeName, cpf: currentClient.legalRepresentativeCpf },
          accountant: { name: data?.org?.accountantName, crc: data?.org?.accountantCrc },
        },
      });
      downloadBlob(blob, fileName);
    } catch (e) {
      console.error('Falha ao exportar Livro Razão em Excel:', e);
      setError(`Não foi possível gerar a planilha (${describeError(e)}).`);
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
        eyebrow={`${accountingStandardCode(currentClient)} — Demonstrações Contábeis`}
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
        <AccountSelect accounts={accounts} value={effectiveAccountId} onChange={setSelectedAccountId} />
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
          <LedgerSummary ledger={ledger} range={range} />

          {/* Tabela de Lançamentos do Livro Razão */}
          <LedgerEntriesTable key={ledger.accountId} ledger={ledger} range={range} />
        </div>
      )}

      {/* Assinaturas Contábeis Oficiais na Impressão */}
      {ledger && (
        <LedgerPrintSignatures client={currentClient} org={data?.org} />
      )}
    </main>
  );
}
