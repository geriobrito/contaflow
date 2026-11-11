'use client';

import React, { useMemo, useState } from 'react';
import { ModalPortal } from '@/components/ui/ModalPortal';
import {
  AlertCircle,
  ArrowRightLeft,
  CheckCircle2,
  FileSpreadsheet,
  Landmark,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import type { BankAccount, BankAccountKind, ChartAccount } from '@/types/firestore';
import type { OFXParseResult } from '@/lib/ofx/types';
import { type CSVColumnMapping, type CSVDelimiter, previewCSV } from '@/lib/csv/parser';
import { BUILTIN_CSV_PRESETS, clampMappingToColumns, resolveInitialCSVConfig, toOFXAccountInfo } from '@/lib/csv/presets';
import {
  applyFormatToQueue,
  csvColumnOptions,
  quickBankAccount,
  simulateCSVImport,
  withCSVPreset,
  type CSVQueueFile,
  type ParsedCSVBatchItem,
} from '@/lib/csv/batch';
import { bankLedgerCandidates } from '@/lib/bank-accounts';
import { getRepository } from '@/lib/services/data-service';
import { describeError } from '@/lib/utils/errors';
import { BUTTON, INPUT, FIELD_LABEL } from '@/components/ui/primitives';
import { reportError } from '@/lib/monitoring';
import { CSVQuickBankForm } from '@/components/conciliacao/CSVQuickBankForm';
import { CSVPreviewTable } from '@/components/conciliacao/CSVPreviewTable';
import { CSVColumnFields } from '@/components/conciliacao/CSVColumnFields';

export type { CSVQueueFile, ParsedCSVBatchItem };

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

  // Configuração inicial calculada uma vez na montagem; trocas de banco, modelo ou arquivo da fila
  // atualizam o estado explicitamente. Um lote novo remonta o modal (`key` em StatementImport).
  const [initialResolved] = useState(() => resolveInitialCSVConfig(currentFile.content, initialBank));

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

  const columns = useMemo(() => csvColumnOptions(activePreview.headers), [activePreview]);

  // Simulação em tempo real do arquivo atual
  const parseSimulation = useMemo(
    () => simulateCSVImport(currentFile.content, { mapping, delimiter }, clientId, selectedBankKey),
    [currentFile.content, mapping, clientId, selectedBankKey, delimiter]
  );

  if (!isOpen || queue.length === 0) return null;

  /** Edição manual do mapeamento de colunas. */
  const editMapping = (update: (m: CSVColumnMapping) => CSVColumnMapping) => {
    setMapping(update);
    setConfigSource('manual');
  };

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
      const created = quickBankAccount({
        clientId,
        nickname: trimmed,
        kind: newBankKind,
        ledger: ledgerCandidates.find((a) => a.id === newBankLedgerId),
        existingKeys: new Set(allBanks.map((b) => b.accountKey)),
        now: new Date().toISOString(),
      });
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
        const updatedBank = withCSVPreset(bankAcc, { mapping, delimiter }, activePreview.headers, new Date().toISOString());
        try {
          await getRepository().saveBankAccount(updatedBank);
          bankAcc = updatedBank;
          setCreatedOrUpdatedBanks((prev) => [...prev.filter((b) => b.id !== updatedBank.id), updatedBank]);
          onBankAccountUpdated?.(updatedBank);
        } catch (presetErr) {
          reportError(presetErr, { area: 'importacao', op: 'memorizar preset CSV', level: 'warning' });
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
        const { items, stopAt } = applyFormatToQueue({
          queue,
          from: queueIndex + 1,
          format: { mapping, delimiter },
          headers: activePreview.headers,
          clientId,
          accountKey: selectedBankKey,
          accountInfo,
        });
        nextCollected.push(...items);

        if (stopAt === null) {
          finishBatch(nextCollected);
          return;
        }

        // Parou em um arquivo de layout diferente: avança o modal para ele
        setCollected(nextCollected);
        setQueueIndex(stopAt);
        applyForFileAndBank(queue[stopAt].content, bankAcc);
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
      <div className="w-full max-w-4xl max-h-[calc(100vh-2rem)] my-auto flex flex-col bg-surface rounded-2xl shadow-overlay border border-line-strong overflow-hidden">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-line bg-stone-50/50 dark:bg-stone-800/40">
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
            className="w-8 h-8 rounded-full inline-flex items-center justify-center text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6 space-y-5">
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/40 text-rose-800 dark:text-rose-200 text-[13px] flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-300" />
              <span>{error}</span>
            </div>
          )}

          {configSource === 'saved' && (
            <div className="px-3.5 py-2.5 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/40 text-emerald-800 dark:text-emerald-200 text-[12px] flex items-center gap-2">
              <Sparkles className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
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
                <label className={`${FIELD_LABEL} mb-1.5 flex items-center gap-1.5`}>
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
                <label className={`${FIELD_LABEL} mb-1.5 flex items-center gap-1.5`}>
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
            <CSVQuickBankForm
              kind={newBankKind}
              onKindChange={setNewBankKind}
              nickname={newBankNickname}
              onNicknameChange={setNewBankNickname}
              ledgerId={newBankLedgerId}
              onLedgerIdChange={setNewBankLedgerId}
              ledgerCandidates={ledgerCandidates}
              creating={creatingBank}
              onCreate={() => void handleCreateQuickBank()}
            />
          )}

          {/* Pré-visualização das 5 primeiras linhas */}
          <CSVPreviewTable
            preview={activePreview}
            hasHeader={mapping.hasHeader}
            onHasHeaderChange={(hasHeader) => editMapping((m) => ({ ...m, hasHeader }))}
          />

          {/* Mapeamento de Colunas */}
          <CSVColumnFields mapping={mapping} columns={columns} onEdit={editMapping} />

          {/* Resumo da Validação e opção de lote para fila */}
          <div className="space-y-2.5">
            <div className="p-3.5 rounded-xl bg-stone-100/70 dark:bg-stone-800/60 flex items-center justify-between text-[13px]">
              <div className="flex items-center gap-2">
                {parseSimulation.count > 0 ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-300 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-300 shrink-0" />
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
              <label className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-line text-[13px] text-stone-700 dark:text-stone-300 cursor-pointer">
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
        <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-4 border-t border-line bg-stone-50/50 dark:bg-stone-800/40">
          <span className="text-[12px] text-stone-500 dark:text-stone-400">
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
