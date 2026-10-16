'use client';

import React, { useState, useMemo } from 'react';
import {
  X,
  FileSpreadsheet,
  Calendar,
  FileText,
  DollarSign,
  CreditCard,
  AlertCircle,
  CheckCircle2,
  Table,
  HelpCircle,
  ArrowRightLeft,
  Landmark,
} from 'lucide-react';
import type { BankAccount } from '@/types/firestore';
import type { OFXParseResult } from '@/lib/ofx/types';
import {
  type CSVColumnMapping,
  type CSVDelimiter,
  parseCSVToOFXResult,
  previewCSV,
} from '@/lib/csv/parser';
import { BUTTON, INPUT } from '@/components/ui/primitives';

interface CSVMappingModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  fileContent: string;
  bankAccounts: readonly BankAccount[];
  clientId: string;
  onConfirm: (result: OFXParseResult, fileName: string) => void;
}

export const CSVMappingModal: React.FC<CSVMappingModalProps> = ({
  isOpen,
  onClose,
  fileName,
  fileContent,
  bankAccounts,
  clientId,
  onConfirm,
}) => {
  // Gera o preview inicial
  const preview = useMemo(() => {
    return previewCSV(fileContent);
  }, [fileContent]);

  const [delimiter, setDelimiter] = useState<CSVDelimiter>(preview.delimiter);
  const [mapping, setMapping] = useState<CSVColumnMapping>(preview.guessedMapping);
  const [selectedBankKey, setSelectedBankKey] = useState<string>(() => {
    return bankAccounts[0]?.accountKey || 'csv-extrato';
  });
  const [error, setError] = useState<string | null>(null);

  // Recalcula preview se o delimitador mudar manualmente
  const activePreview = useMemo(() => {
    return previewCSV(fileContent, delimiter);
  }, [fileContent, delimiter]);

  // Lista de colunas disponíveis
  const columns = useMemo(() => {
    if (activePreview.headers.length > 0) {
      return activePreview.headers.map((h, i) => ({
        index: i,
        label: `[Col ${i + 1}] ${h || `Coluna ${i + 1}`}`,
      }));
    }
    return [];
  }, [activePreview]);

  // Executa uma simulação rápida de parse para mostrar quantidade de linhas válidas
  const parseSimulation = useMemo(() => {
    try {
      const res = parseCSVToOFXResult({
        content: fileContent,
        mapping,
        clientId,
        accountKey: selectedBankKey,
        delimiter,
      });
      return {
        count: res.transactions.length,
        hasErrors: res.hasErrors,
        warnings: res.warnings,
        res,
      };
    } catch (err) {
      return {
        count: 0,
        hasErrors: true,
        warnings: [err instanceof Error ? err.message : 'Falha ao interpretar mapeamento.'],
        res: null,
      };
    }
  }, [fileContent, mapping, clientId, selectedBankKey, delimiter]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (!parseSimulation.res || parseSimulation.count === 0) {
      setError('Nenhum lançamento válido pôde ser extraído com a configuração atual.');
      return;
    }

    const bankAcc = bankAccounts.find((b) => b.accountKey === selectedBankKey);
    const finalResult: OFXParseResult = {
      ...parseSimulation.res,
      account: {
        accountId: selectedBankKey,
        org: bankAcc?.nickname || bankAcc?.bankName || 'Extrato CSV',
        bankId: bankAcc?.bankId,
        branchId: bankAcc?.branchId,
      },
    };

    onConfirm(finalResult, fileName);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="csv-mapping-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="w-full max-w-4xl max-h-[92vh] flex flex-col bg-white dark:bg-stone-900 rounded-2xl shadow-2xl border border-black/[0.08] dark:border-white/[0.1] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.06] dark:border-white/[0.08] bg-stone-50/50 dark:bg-stone-800/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 id="csv-mapping-title" className="text-[17px] font-semibold text-stone-900 dark:text-stone-100">
                Importar Extrato CSV / Cartão de Crédito
              </h2>
              <p className="text-[13px] text-stone-500">
                Confirme as colunas de data, histórico e valor do arquivo <span className="font-mono font-medium text-stone-700 dark:text-stone-300">{fileName}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="w-8 h-8 rounded-full inline-flex items-center justify-center text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-black/[0.05] dark:hover:bg-white/[0.05] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/40 text-rose-800 dark:text-rose-200 text-[13px] flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Seleção de Conta Bancária e Delimitador */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-medium text-stone-500 dark:text-stone-400 mb-1.5 flex items-center gap-1.5">
                <Landmark className="w-3.5 h-3.5 text-stone-400" />
                Conta Bancária / Cartão de Destino *
              </label>
              <select
                value={selectedBankKey}
                onChange={(e) => setSelectedBankKey(e.target.value)}
                className={INPUT}
              >
                {bankAccounts.map((b) => (
                  <option key={b.id} value={b.accountKey}>
                    {b.nickname || b.bankName || 'Conta Bancária'} ({b.accountNumber ? `Ag: ${b.branchId || '—'} / CC: ${b.accountNumber}` : b.accountKey})
                  </option>
                ))}
                {bankAccounts.length === 0 && (
                  <option value="csv-extrato">Extrato Padrão (Sem conta bancária pré-cadastrada)</option>
                )}
              </select>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-stone-500 dark:text-stone-400 mb-1.5 flex items-center gap-1.5">
                <ArrowRightLeft className="w-3.5 h-3.5 text-stone-400" />
                Separador de Colunas (Delimitador)
              </label>
              <select
                value={delimiter}
                onChange={(e) => setDelimiter(e.target.value as CSVDelimiter)}
                className={INPUT}
              >
                <option value=";">Ponto e vírgula (;)</option>
                <option value=",">Vírgula (,)</option>
                <option value={"\t"}>Tabulação (\t)</option>
                <option value="|">Barra vertical (|)</option>
              </select>
            </div>
          </div>

          {/* Pré-visualização das 5 primeiras linhas */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-stone-500 flex items-center gap-1">
                <Table className="w-3.5 h-3.5" /> Prévia das linhas do arquivo ({activePreview.totalRows} linhas no total)
              </span>
              <label className="inline-flex items-center gap-2 text-[12px] text-stone-600 dark:text-stone-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={mapping.hasHeader}
                  onChange={(e) => setMapping((m) => ({ ...m, hasHeader: e.target.checked }))}
                  className="rounded border-stone-300 text-accent-ink focus:ring-accent"
                />
                Primeira linha contém cabeçalhos
              </label>
            </div>

            <div className="border border-black/[0.08] dark:border-white/[0.1] rounded-xl overflow-hidden bg-stone-50/40 dark:bg-stone-900/40">
              <div className="overflow-x-auto max-h-48">
                <table className="w-full text-left text-[12px] border-collapse font-mono">
                  <thead>
                    <tr className="bg-stone-100/70 dark:bg-stone-800/70 border-b border-black/[0.06] text-stone-600">
                      {activePreview.headers.map((h, i) => (
                        <th key={i} className="py-2 px-3 whitespace-nowrap">
                          <span className="text-[10px] text-stone-400 block font-normal">Col {i + 1}</span>
                          {h || '—'}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                    {activePreview.previewRows.slice(mapping.hasHeader ? 1 : 0, 5).map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-white dark:hover:bg-stone-800/40">
                        {row.map((cell, cIdx) => (
                          <td key={cIdx} className="py-1.5 px-3 whitespace-nowrap text-stone-700 dark:text-stone-300">
                            {cell || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Mapeamento de Colunas */}
          <div className="p-4 rounded-xl border border-black/[0.06] dark:border-white/[0.08] bg-stone-50/50 dark:bg-stone-800/30 space-y-4">
            <h3 className="text-[14px] font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-2">
              Mapeamento de Campos
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-[12px] font-medium text-stone-600 dark:text-stone-300 mb-1.5 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-accent-ink" />
                  Coluna da Data *
                </label>
                <select
                  value={mapping.dateCol}
                  onChange={(e) => setMapping((m) => ({ ...m, dateCol: parseInt(e.target.value, 10) }))}
                  className="w-full h-10 px-3 rounded-xl bg-white dark:bg-stone-800 border border-black/[0.08] text-[13px] outline-none"
                >
                  {columns.map((c) => (
                    <option key={c.index} value={c.index}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[12px] font-medium text-stone-600 dark:text-stone-300 mb-1.5 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-purple-600" />
                  Coluna da Descrição / Histórico *
                </label>
                <select
                  value={mapping.memoCol}
                  onChange={(e) => setMapping((m) => ({ ...m, memoCol: parseInt(e.target.value, 10) }))}
                  className="w-full h-10 px-3 rounded-xl bg-white dark:bg-stone-800 border border-black/[0.08] text-[13px] outline-none"
                >
                  {columns.map((c) => (
                    <option key={c.index} value={c.index}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[12px] font-medium text-stone-600 dark:text-stone-300 mb-1.5 flex items-center gap-1.5">
                  <HelpCircle className="w-3.5 h-3.5 text-stone-400" />
                  Coluna de Documento / FITID (Opcional)
                </label>
                <select
                  value={mapping.docCol ?? -1}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    setMapping((m) => ({ ...m, docCol: val === -1 ? undefined : val }));
                  }}
                  className="w-full h-10 px-3 rounded-xl bg-white dark:bg-stone-800 border border-black/[0.08] text-[13px] outline-none"
                >
                  <option value="-1">Gerar identificador automático (Recomendado)</option>
                  {columns.map((c) => (
                    <option key={c.index} value={c.index}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Configuração de Valores (Único vs Separado) */}
            <div className="space-y-3 pt-2 border-t border-black/[0.04] dark:border-white/[0.06]">
              <div className="flex items-center gap-6">
                <span className="text-[12px] font-medium text-stone-600 dark:text-stone-300">
                  Formato do Valor:
                </span>
                <label className="inline-flex items-center gap-2 text-[13px] text-stone-700 dark:text-stone-300 cursor-pointer">
                  <input
                    type="radio"
                    name="valueMode"
                    checked={mapping.valueMode === 'single'}
                    onChange={() => setMapping((m) => ({ ...m, valueMode: 'single' }))}
                    className="text-accent-ink"
                  />
                  Coluna Única com sinal (+ / -)
                </label>
                <label className="inline-flex items-center gap-2 text-[13px] text-stone-700 dark:text-stone-300 cursor-pointer">
                  <input
                    type="radio"
                    name="valueMode"
                    checked={mapping.valueMode === 'split'}
                    onChange={() => setMapping((m) => ({ ...m, valueMode: 'split' }))}
                    className="text-accent-ink"
                  />
                  Colunas Separadas (Débito e Crédito)
                </label>
              </div>

              {mapping.valueMode === 'single' ? (
                <div className="w-full sm:w-1/2">
                  <label className="block text-[12px] font-medium text-stone-600 dark:text-stone-300 mb-1.5 flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                    Coluna do Valor *
                  </label>
                  <select
                    value={mapping.amountCol ?? 0}
                    onChange={(e) => setMapping((m) => ({ ...m, amountCol: parseInt(e.target.value, 10) }))}
                    className="w-full h-10 px-3 rounded-xl bg-white dark:bg-stone-800 border border-black/[0.08] text-[13px] outline-none"
                  >
                    {columns.map((c) => (
                      <option key={c.index} value={c.index}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[12px] font-medium text-stone-600 dark:text-stone-300 mb-1.5 flex items-center gap-1.5">
                      <DollarSign className="w-3.5 h-3.5 text-rose-600" />
                      Coluna de Saída (Débito) *
                    </label>
                    <select
                      value={mapping.debitCol ?? 0}
                      onChange={(e) => setMapping((m) => ({ ...m, debitCol: parseInt(e.target.value, 10) }))}
                      className="w-full h-10 px-3 rounded-xl bg-white dark:bg-stone-800 border border-black/[0.08] text-[13px] outline-none"
                    >
                      {columns.map((c) => (
                        <option key={c.index} value={c.index}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[12px] font-medium text-stone-600 dark:text-stone-300 mb-1.5 flex items-center gap-1.5">
                      <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                      Coluna de Entrada (Crédito) *
                    </label>
                    <select
                      value={mapping.creditCol ?? 0}
                      onChange={(e) => setMapping((m) => ({ ...m, creditCol: parseInt(e.target.value, 10) }))}
                      className="w-full h-10 px-3 rounded-xl bg-white dark:bg-stone-800 border border-black/[0.08] text-[13px] outline-none"
                    >
                      {columns.map((c) => (
                        <option key={c.index} value={c.index}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Inversão de Sinal (Fatura de Cartão) */}
            <div className="pt-2 border-t border-black/[0.04] dark:border-white/[0.06]">
              <label className="flex items-start gap-3 p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/30 cursor-pointer">
                <input
                  type="checkbox"
                  checked={mapping.invertSigns ?? false}
                  onChange={(e) => setMapping((m) => ({ ...m, invertSigns: e.target.checked }))}
                  className="mt-0.5 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                />
                <div className="text-[12px]">
                  <span className="font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5" /> Inverter sinais (+/-) — Recomendado para Faturas de Cartão de Crédito
                  </span>
                  <p className="text-amber-700 dark:text-amber-300/80 mt-0.5 leading-relaxed">
                    Na maioria das faturas de cartão, compras vêm com valores positivos e pagamentos como negativos. Ao marcar esta opção, o sistema inverte os sinais para que as compras sejam registradas como saídas (débitos) no extrato.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Resumo da Validação */}
          <div className="p-3.5 rounded-xl bg-stone-100/70 dark:bg-stone-800/60 flex items-center justify-between text-[13px]">
            <div className="flex items-center gap-2">
              {parseSimulation.count > 0 ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              )}
              <span>
                <strong>{parseSimulation.count}</strong> lançamento(s) prontos para importação
                {parseSimulation.warnings.length > 0 && ` (${parseSimulation.warnings.length} linhas ignoradas)`}
              </span>
            </div>

            {parseSimulation.res?.startDate && parseSimulation.res?.endDate && (
              <span className="text-[12px] font-mono text-stone-500">
                Período: {parseSimulation.res.startDate} a {parseSimulation.res.endDate}
              </span>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-black/[0.06] dark:border-white/[0.08] bg-stone-50/50 dark:bg-stone-800/40">
          <button
            type="button"
            onClick={onClose}
            className={BUTTON.ghost}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={parseSimulation.count === 0}
            className={BUTTON.primary}
          >
            Confirmar e Importar {parseSimulation.count > 0 ? `(${parseSimulation.count})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
};
