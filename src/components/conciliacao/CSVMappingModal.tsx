'use client';

import React, { useMemo, useState } from 'react';
import { ModalPortal } from '@/components/ui/ModalPortal';
import {
  AlertCircle,
  ArrowRightLeft,
  Calendar,
  CheckCircle2,
  CreditCard,
  DollarSign,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  Landmark,
  Plus,
  Sparkles,
  Table,
  X,
} from 'lucide-react';
import type { BankAccount, BankAccountKind, ChartAccount } from '@/types/firestore';
import type { OFXParseResult } from '@/lib/ofx/types';
import {
  type CSVColumnMapping,
  type CSVDelimiter,
  parseCSVToOFXResult,
  previewCSV,
} from '@/lib/csv/parser';
import {
  BUILTIN_CSV_PRESETS,
  clampMappingToColumns,
  headersMatchSignature,
  isMappingCompatible,
  normalizeHeaderSignature,
  resolveInitialCSVConfig,
  toOFXAccountInfo,
} from '@/lib/csv/presets';
import { bankAccountId, bankLedgerCandidates, newManualAccountKey } from '@/lib/bank-accounts';
import { getRepository } from '@/lib/services/data-service';
import { describeError } from '@/lib/utils/errors';
import { BUTTON, INPUT } from '@/components/ui/primitives';

export interface CSVQueueFile {
  fileName: string;
  content: string;
}

export interface ParsedCSVBatchItem {
  result: OFXParseResult;
  fileName: string;
}

interface CSVMappingModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Fila de arquivos CSV (preferencial para múltiplos arquivos). */
  files?: readonly CSVQueueFile[];
  /** Props legadas para arquivo único. */
  fileName?: string;
  fileContent?: string;
  bankAccounts: readonly BankAccount[];
  accounts?: readonly ChartAccount[];
  clientId: string;
  onConfirm?: (result: OFXParseResult, fileName: string) => void;
  onConfirmBatch?: (items: ParsedCSVBatchItem[]) => void;
  /** Chamado quando uma conta/cartão é criado ou tem seu preset CSV atualizado. */
  onBankAccountUpdated?: (bank: BankAccount) => void;
}

export const CSVMappingModal: React.FC<CSVMappingModalProps> = ({
  isOpen,
  onClose,
  files,
  fileName,
  fileContent,
  bankAccounts,
  accounts = [],
  clientId,
  onConfirm,
  onConfirmBatch,
  onBankAccountUpdated,
}) => {
  const queue = useMemo<CSVQueueFile[]>(() => {
    if (files && files.length > 0) return [...files];
    if (fileContent !== undefined && fileName) return [{ fileName, content: fileContent }];
    return [];
  }, [files, fileContent, fileName]);

  const [createdOrUpdatedBanks, setCreatedOrUpdatedBanks] = useState<BankAccount[]>([]);
  const allBanks = useMemo(() => {
    const byId = new Map<string, BankAccount>();
    for (const b of bankAccounts) byId.set(b.id, b);
    for (const b of createdOrUpdatedBanks) byId.set(b.id, b);
    return [...byId.values()];
  }, [bankAccounts, createdOrUpdatedBanks]);

  const [queueIndex, setQueueIndex] = useState(0);
  const [collected, setCollected] = useState<ParsedCSVBatchItem[]>([]);

  const currentFile = queue[queueIndex] ?? { fileName: fileName ?? 'extrato.csv', content: fileContent ?? '' };
  const initialBank = allBanks[0] ?? null;

  const initialResolved = useMemo(
    () => resolveInitialCSVConfig(currentFile.content, initialBank),
    // Computed once for initial state setup; manual/queue transitions update state explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [selectedBankKey, setSelectedBankKey] = useState<string>(() => initialBank?.accountKey || 'csv-extrato');
  const [delimiter, setDelimiter] = useState<CSVDelimiter>(initialResolved.delimiter);
  const [mapping, setMapping] = useState<CSVColumnMapping>(initialResolved.mapping);
  const [configSource, setConfigSource] = useState<'saved' | 'preset' | 'auto' | 'manual'>(initialResolved.source);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(initialResolved.presetId ?? '');
  const [applyToRemaining, setApplyToRemaining] = useState(true);
  const [isSavingConfirm, setIsSavingConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estado do formulário rápido de criação de conta/cartão sem OFX prévio
  const [showNewBankForm, setShowNewBankForm] = useState(false);
  const [newBankKind, setNewBankKind] = useState<BankAccountKind>('CARD');
  const [newBankNickname, setNewBankNickname] = useState('');
  const [newBankLedgerId, setNewBankLedgerId] = useState('');
  const [creatingBank, setCreatingBank] = useState(false);

  const ledgerCandidates = useMemo(
    () => bankLedgerCandidates(accounts, newBankKind),
    [accounts, newBankKind]
  );

  // Recalcula preview se o arquivo da fila ou o delimitador mudar
  const activePreview = useMemo(() => {
    return previewCSV(currentFile.content, delimiter);
  }, [currentFile.content, delimiter]);

  const columns = useMemo(() => {
    if (activePreview.headers.length > 0) {
      return activePreview.headers.map((h, i) => ({
        index: i,
        label: `[Col ${i + 1}] ${h || `Coluna ${i + 1}`}`,
      }));
    }
    return [];
  }, [activePreview]);

  // Simulação em tempo real do arquivo atual
  const parseSimulation = useMemo(() => {
    try {
      const res = parseCSVToOFXResult({
        content: currentFile.content,
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
  }, [currentFile.content, mapping, clientId, selectedBankKey, delimiter]);

  if (!isOpen || queue.length === 0) return null;

  const applyForFileAndBank = (content: string, bank: BankAccount | undefined) => {
    const resolved = resolveInitialCSVConfig(content, bank);
    setDelimiter(resolved.delimiter);
    setMapping(resolved.mapping);
    setConfigSource(resolved.source);
    setSelectedPresetId(resolved.presetId ?? '');
    setError(null);
  };

  const handleSelectBank = (nextKey: string) => {
    setSelectedBankKey(nextKey);
    const bank = allBanks.find((b) => b.accountKey === nextKey);
    if (bank?.csvPreset) {
      const resolved = resolveInitialCSVConfig(currentFile.content, bank);
      if (resolved.source === 'saved') {
        setDelimiter(resolved.delimiter);
        setMapping(resolved.mapping);
        setConfigSource('saved');
        setSelectedPresetId('');
        setError(null);
      }
    }
  };

  const handleSelectPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    if (!presetId) {
      const auto = previewCSV(currentFile.content);
      setDelimiter(auto.delimiter);
      setMapping(auto.guessedMapping);
      setConfigSource('auto');
      return;
    }
    const preset = BUILTIN_CSV_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const nextPreview = previewCSV(currentFile.content, preset.delimiter);
    setDelimiter(preset.delimiter);
    setMapping(clampMappingToColumns(preset.mapping, nextPreview.headers.length));
    setConfigSource('preset');
    setError(null);
  };

  const handleCreateQuickBank = async () => {
    const trimmed = newBankNickname.trim();
    if (!trimmed) return;
    if (!clientId) {
      setError('Selecione uma empresa antes de cadastrar uma conta ou cartão.');
      return;
    }
    setCreatingBank(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      const existingKeys = new Set(allBanks.map((b) => b.accountKey));
      const accountKey = newManualAccountKey(trimmed, newBankKind, existingKeys);
      const ledger = ledgerCandidates.find((a) => a.id === newBankLedgerId);
      const created: BankAccount = {
        id: bankAccountId(clientId, accountKey),
        clientId,
        accountKey,
        kind: newBankKind,
        nickname: trimmed,
        ...(ledger
          ? { ledgerAccountId: ledger.id, ledgerAccountCode: ledger.code, ledgerAccountName: ledger.name }
          : {}),
        createdAt: now,
        updatedAt: now,
      };
      await getRepository().saveBankAccount(created);
      setCreatedOrUpdatedBanks((prev) => [...prev, created]);
      onBankAccountUpdated?.(created);
      setSelectedBankKey(created.accountKey);
      if (newBankKind === 'CARD' && configSource === 'auto') {
        setMapping((m) => ({ ...m, invertSigns: true }));
      }
      setNewBankNickname('');
      setNewBankLedgerId('');
      setShowNewBankForm(false);
    } catch (e) {
      setError(`Não foi possível cadastrar a conta/cartão (${describeError(e)}).`);
    } finally {
      setCreatingBank(false);
    }
  };

  const finishBatch = (items: ParsedCSVBatchItem[]) => {
    if (onConfirmBatch) {
      onConfirmBatch(items);
    } else if (onConfirm) {
      for (const item of items) {
        onConfirm(item.result, item.fileName);
      }
    }
    onClose();
  };

  const handleConfirm = async () => {
    if (!parseSimulation.res || parseSimulation.count === 0) {
      setError('Nenhum lançamento válido pôde ser extraído com a configuração atual.');
      return;
    }

    setIsSavingConfirm(true);
    setError(null);
    try {
      let bankAcc = allBanks.find((b) => b.accountKey === selectedBankKey);

      // Memoriza o formato CSV na conta selecionada para as próximas importações
      if (bankAcc && clientId) {
        const csvPreset = {
          delimiter,
          mapping,
          ...(activePreview.headers.length > 0
            ? { headerSignature: normalizeHeaderSignature(activePreview.headers) }
            : {}),
        };
        const updatedBank: BankAccount = {
          ...bankAcc,
          csvPreset,
          updatedAt: new Date().toISOString(),
        };
        try {
          await getRepository().saveBankAccount(updatedBank);
          bankAcc = updatedBank;
          setCreatedOrUpdatedBanks((prev) => [...prev.filter((b) => b.id !== updatedBank.id), updatedBank]);
          onBankAccountUpdated?.(updatedBank);
        } catch (presetErr) {
          console.warn('Não foi possível memorizar preset CSV na conta:', presetErr);
        }
      }

      const accountInfo = toOFXAccountInfo(bankAcc, selectedBankKey);
      const currentParsed: ParsedCSVBatchItem = {
        fileName: currentFile.fileName,
        result: {
          ...parseSimulation.res,
          account: accountInfo,
        },
      };

      const nextCollected = [...collected, currentParsed];
      const remainingCount = queue.length - (queueIndex + 1);

      if (remainingCount <= 0) {
        finishBatch(nextCollected);
        return;
      }

      if (applyToRemaining) {
        const currentSig = normalizeHeaderSignature(activePreview.headers);
        let stopAtIndex = -1;

        for (let i = queueIndex + 1; i < queue.length; i++) {
          const nextFile = queue[i];
          const nextPrev = previewCSV(nextFile.content, delimiter);
          const sameHeaderCount = nextPrev.headers.length === activePreview.headers.length;
          const compatibleHeaders =
            !mapping.hasHeader ||
            headersMatchSignature(nextPrev.headers, currentSig) ||
            sameHeaderCount;

          if (!isMappingCompatible(mapping, nextPrev.headers.length) || !compatibleHeaders) {
            stopAtIndex = i;
            break;
          }

          const parsedNext = parseCSVToOFXResult({
            content: nextFile.content,
            mapping,
            clientId,
            accountKey: selectedBankKey,
            bankAccountInfo: accountInfo,
            delimiter,
          });

          if (parsedNext.transactions.length === 0) {
            stopAtIndex = i;
            break;
          }

          nextCollected.push({
            fileName: nextFile.fileName,
            result: {
              ...parsedNext,
              account: accountInfo,
            },
          });
        }

        if (stopAtIndex === -1) {
          finishBatch(nextCollected);
          return;
        }

        // Parou em um arquivo de layout diferente: avança o modal para ele
        setCollected(nextCollected);
        setQueueIndex(stopAtIndex);
        applyForFileAndBank(queue[stopAtIndex].content, bankAcc);
        return;
      }

      // Avança manualmente para o próximo arquivo da fila
      const nextIdx = queueIndex + 1;
      setCollected(nextCollected);
      setQueueIndex(nextIdx);
      applyForFileAndBank(queue[nextIdx].content, bankAcc);
    } finally {
      setIsSavingConfirm(false);
    }
  };

  const remainingFiles = queue.length - (queueIndex + 1);

  const dialog = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="csv-mapping-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto bg-black/40 backdrop-blur-sm animate-fade-in"
    >
      <div className="w-full max-w-4xl max-h-[calc(100vh-2rem)] my-auto flex flex-col bg-white dark:bg-stone-900 rounded-2xl shadow-2xl border border-black/[0.08] dark:border-white/[0.1] overflow-hidden">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-black/[0.06] dark:border-white/[0.08] bg-stone-50/50 dark:bg-stone-800/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="csv-mapping-title" className="text-[17px] font-semibold text-stone-900 dark:text-stone-100">
                  Importar Extrato CSV / Cartão de Crédito
                </h2>
                {queue.length > 1 && (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900">
                    Arquivo {queueIndex + 1} de {queue.length}
                  </span>
                )}
              </div>
              <p className="text-[13px] text-stone-500">
                Confirme a conta e as colunas do arquivo{' '}
                <span className="font-mono font-medium text-stone-700 dark:text-stone-300">{currentFile.fileName}</span>
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
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6 space-y-5">
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/40 text-rose-800 dark:text-rose-200 text-[13px] flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {configSource === 'saved' && (
            <div className="px-3.5 py-2.5 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/40 text-emerald-800 dark:text-emerald-200 text-[12px] flex items-center gap-2">
              <Sparkles className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>Formato memorizado desta conta aplicado automaticamente.</span>
            </div>
          )}

          {/* Seleção de Conta Bancária, Preset e Delimitador */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-5">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[12px] font-medium text-stone-500 dark:text-stone-400 flex items-center gap-1.5">
                  <Landmark className="w-3.5 h-3.5 text-stone-400" />
                  Conta / Cartão de Destino *
                </label>
                {clientId && (
                  <button
                    type="button"
                    onClick={() => setShowNewBankForm((v) => !v)}
                    className="inline-flex items-center gap-1 text-[12px] font-medium text-accent-ink hover:underline"
                  >
                    <Plus className="w-3 h-3" />
                    {showNewBankForm ? 'Cancelar' : 'Nova conta / cartão'}
                  </button>
                )}
              </div>
              <select
                value={selectedBankKey}
                onChange={(e) => handleSelectBank(e.target.value)}
                className={INPUT}
              >
                {allBanks.map((b) => (
                  <option key={b.id} value={b.accountKey}>
                    {b.kind === 'CARD' ? '[Cartão] ' : ''}
                    {b.nickname || b.bankName || 'Conta Bancária'} (
                    {b.accountNumber ? `Ag: ${b.branchId || '—'} / CC: ${b.accountNumber}` : b.accountKey})
                  </option>
                ))}
                {allBanks.length === 0 && (
                  <option value="csv-extrato">Extrato Padrão (Sem conta pré-cadastrada)</option>
                )}
              </select>
            </div>

            <div className="md:col-span-4">
                <label className="text-[12px] font-medium text-stone-500 dark:text-stone-400 mb-1.5 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-stone-400" />
                  Modelo de Banco / Fatura
                </label>
                <select
                  value={selectedPresetId}
                  onChange={(e) => handleSelectPreset(e.target.value)}
                  className={INPUT}
                >
                  <option value="">
                    {configSource === 'saved' ? 'Formato salvo na conta' : 'Detectar automaticamente'}
                  </option>
                  {BUILTIN_CSV_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
            </div>

            <div className="md:col-span-3">
                <label className="text-[12px] font-medium text-stone-500 dark:text-stone-400 mb-1.5 flex items-center gap-1.5">
                  <ArrowRightLeft className="w-3.5 h-3.5 text-stone-400" />
                  Separador (Delimitador)
                </label>
                <select
                  value={delimiter}
                  onChange={(e) => {
                    const nextDelim = e.target.value as CSVDelimiter;
                    const nextPrev = previewCSV(currentFile.content, nextDelim);
                    setDelimiter(nextDelim);
                    setMapping((m) => clampMappingToColumns(m, nextPrev.headers.length));
                    setConfigSource('manual');
                    setSelectedPresetId('');
                  }}
                  className={INPUT}
                >
                  <option value=";">Ponto e vírgula (;)</option>
                  <option value=",">Vírgula (,)</option>
                  <option value={"\t"}>Tabulação (\t)</option>
                  <option value="|">Barra vertical (|)</option>
                </select>
            </div>
          </div>

          {/* Formulário rápido para cadastrar conta ou cartão sem OFX prévio */}
          {showNewBankForm && (
            <div className="p-4 rounded-xl border border-accent/25 bg-accent/[0.04] dark:bg-accent/[0.08] space-y-3 animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-stone-900 dark:text-stone-100">
                  Cadastrar nova conta bancária ou cartão de crédito
                </span>
                <div className="inline-flex rounded-lg p-0.5 bg-black/[0.05] dark:bg-white/[0.08] text-[12px]">
                  <button
                    type="button"
                    onClick={() => setNewBankKind('CARD')}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${newBankKind === 'CARD'
                        ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-sm'
                        : 'text-stone-500'
                      }`}
                  >
                    Cartão de crédito
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewBankKind('BANK')}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${newBankKind === 'BANK'
                        ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-sm'
                        : 'text-stone-500'
                      }`}
                  >
                    Conta bancária
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                <div className="md:col-span-5">
                  <label className="block text-[11px] font-medium text-stone-500 mb-1">
                    {newBankKind === 'CARD' ? 'Nome do cartão *' : 'Nome da conta *'}
                  </label>
                  <input
                    value={newBankNickname}
                    onChange={(e) => setNewBankNickname(e.target.value)}
                    placeholder={newBankKind === 'CARD' ? 'ex.: Cartão Nubank Corporativo' : 'ex.: Banco Inter PJ'}
                    className={INPUT}
                  />
                </div>
                <div className="md:col-span-5">
                  <label className="block text-[11px] font-medium text-stone-500 mb-1">
                    Conta contábil vinculada (opcional)
                  </label>
                  <select
                    value={newBankLedgerId}
                    onChange={(e) => setNewBankLedgerId(e.target.value)}
                    className={INPUT}
                  >
                    <option value="">Definir depois em Contas e Extratos</option>
                    {ledgerCandidates.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <button
                    type="button"
                    disabled={creatingBank || !newBankNickname.trim()}
                    onClick={() => void handleCreateQuickBank()}
                    className={`${BUTTON.primary} w-full h-10`}
                  >
                    {creatingBank ? 'Salvando…' : 'Criar'}
                  </button>
                </div>
              </div>
            </div>
          )}

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
                  onChange={(e) => {
                    setMapping((m) => ({ ...m, hasHeader: e.target.checked }));
                    setConfigSource('manual');
                  }}
                  className="rounded border-stone-300 text-accent-ink focus:ring-accent"
                />
                Primeira linha contém cabeçalhos
              </label>
            </div>

            <div className="border border-black/[0.08] dark:border-white/[0.1] rounded-xl overflow-hidden bg-stone-50/40 dark:bg-stone-900/40">
              <div className="overflow-x-auto max-h-44">
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

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                  <label className="text-[12px] font-medium text-stone-600 dark:text-stone-300 mb-1.5 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-accent-ink" />
                    Coluna da Data *
                  </label>
                  <select
                    value={mapping.dateCol}
                    onChange={(e) => {
                      setMapping((m) => ({ ...m, dateCol: parseInt(e.target.value, 10) }));
                      setConfigSource('manual');
                    }}
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
                  <label className="text-[12px] font-medium text-stone-600 dark:text-stone-300 mb-1.5 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-purple-600" />
                    Coluna da Descrição / Histórico *
                  </label>
                  <select
                    value={mapping.memoCol}
                    onChange={(e) => {
                      setMapping((m) => ({ ...m, memoCol: parseInt(e.target.value, 10) }));
                      setConfigSource('manual');
                    }}
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
                  <label className="text-[12px] font-medium text-stone-600 dark:text-stone-300 mb-1.5 flex items-center gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5 text-stone-400" />
                    Coluna de Documento / FITID (Opcional)
                  </label>
                  <select
                    value={mapping.docCol ?? -1}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setMapping((m) => ({ ...m, docCol: val === -1 ? undefined : val }));
                      setConfigSource('manual');
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
              <div className="flex flex-wrap items-center gap-6">
                <span className="text-[12px] font-medium text-stone-600 dark:text-stone-300">
                  Formato do Valor:
                </span>
                <label className="inline-flex items-center gap-2 text-[13px] text-stone-700 dark:text-stone-300 cursor-pointer">
                  <input
                    type="radio"
                    name="valueMode"
                    checked={mapping.valueMode === 'single'}
                    onChange={() => {
                      setMapping((m) => ({ ...m, valueMode: 'single', amountCol: m.amountCol ?? 0 }));
                      setConfigSource('manual');
                    }}
                    className="text-accent-ink"
                  />
                  Coluna Única com sinal (+ / -)
                </label>
                <label className="inline-flex items-center gap-2 text-[13px] text-stone-700 dark:text-stone-300 cursor-pointer">
                  <input
                    type="radio"
                    name="valueMode"
                    checked={mapping.valueMode === 'split'}
                    onChange={() => {
                      setMapping((m) => ({
                        ...m,
                        valueMode: 'split',
                        debitCol: m.debitCol ?? 0,
                        creditCol: m.creditCol ?? Math.min(1, Math.max(0, columns.length - 1)),
                      }));
                      setConfigSource('manual');
                    }}
                    className="text-accent-ink"
                  />
                  Colunas Separadas (Débito e Crédito)
                </label>
              </div>

              {mapping.valueMode === 'single' ? (
                <div className="w-full md:w-1/2">
                    <label className="text-[12px] font-medium text-stone-600 dark:text-stone-300 mb-1.5 flex items-center gap-1.5">
                      <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                      Coluna do Valor *
                    </label>
                    <select
                      value={mapping.amountCol ?? 0}
                      onChange={(e) => {
                        setMapping((m) => ({ ...m, amountCol: parseInt(e.target.value, 10) }));
                        setConfigSource('manual');
                      }}
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                      <label className="text-[12px] font-medium text-stone-600 dark:text-stone-300 mb-1.5 flex items-center gap-1.5">
                        <DollarSign className="w-3.5 h-3.5 text-rose-600" />
                        Coluna de Saída (Débito) *
                      </label>
                      <select
                        value={mapping.debitCol ?? 0}
                        onChange={(e) => {
                          setMapping((m) => ({ ...m, debitCol: parseInt(e.target.value, 10) }));
                          setConfigSource('manual');
                        }}
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
                      <label className="text-[12px] font-medium text-stone-600 dark:text-stone-300 mb-1.5 flex items-center gap-1.5">
                        <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                        Coluna de Entrada (Crédito) *
                      </label>
                      <select
                        value={mapping.creditCol ?? 0}
                        onChange={(e) => {
                          setMapping((m) => ({ ...m, creditCol: parseInt(e.target.value, 10) }));
                          setConfigSource('manual');
                        }}
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
                  onChange={(e) => {
                    setMapping((m) => ({ ...m, invertSigns: e.target.checked }));
                    setConfigSource('manual');
                  }}
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

          {/* Resumo da Validação e opção de lote para fila */}
          <div className="space-y-2.5">
            <div className="p-3.5 rounded-xl bg-stone-100/70 dark:bg-stone-800/60 flex items-center justify-between text-[13px]">
              <div className="flex items-center gap-2">
                {parseSimulation.count > 0 ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                )}
                <span>
                  <strong>{parseSimulation.count}</strong> lançamento(s) prontos neste arquivo
                  {parseSimulation.warnings.length > 0 && ` (${parseSimulation.warnings.length} linhas ignoradas)`}
                </span>
              </div>

              {parseSimulation.res?.startDate && parseSimulation.res?.endDate && (
                <span className="text-[12px] font-mono text-stone-500">
                  Período: {parseSimulation.res.startDate} a {parseSimulation.res.endDate}
                </span>
              )}
            </div>

            {remainingFiles > 0 && (
              <label className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-black/[0.06] dark:border-white/[0.08] text-[13px] text-stone-700 dark:text-stone-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={applyToRemaining}
                  onChange={(e) => setApplyToRemaining(e.target.checked)}
                  className="rounded border-stone-300 text-accent-ink focus:ring-accent"
                />
                <span>
                  Aplicar esta mesma conta e mapeamento aos demais <strong>{remainingFiles}</strong> arquivo(s) compatíveis da fila
                </span>
              </label>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-4 border-t border-black/[0.06] dark:border-white/[0.08] bg-stone-50/50 dark:bg-stone-800/40">
          <span className="text-[12px] text-stone-400">
            {allBanks.some((b) => b.accountKey === selectedBankKey)
              ? 'O mapeamento escolhido será memorizado nesta conta para os próximos meses.'
              : 'Cadastre ou selecione uma conta para memorizar este formato.'}
          </span>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} className={BUTTON.ghost}>
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={parseSimulation.count === 0 || isSavingConfirm}
              className={BUTTON.primary}
            >
              {isSavingConfirm
                ? 'Processando…'
                : remainingFiles > 0 && !applyToRemaining
                  ? `Confirmar e Próximo (${parseSimulation.count})`
                  : `Confirmar e Importar ${parseSimulation.count > 0 ? `(${parseSimulation.count})` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return <ModalPortal>{dialog}</ModalPortal>;
};
