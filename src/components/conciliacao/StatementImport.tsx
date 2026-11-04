'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, Upload } from 'lucide-react';
import { parseOFXFile, parseOFXString } from '@/lib/ofx/parser';
import type { OFXParseResult } from '@/lib/ofx/types';
import type { BankAccount, ChartAccount } from '@/types/firestore';
import { SAMPLE_BRAZILIAN_OFX } from '@/lib/mock/sample-ofx';
import { CSVMappingModal, type CSVQueueFile } from '@/components/conciliacao/CSVMappingModal';
import { readCSVFileContent } from '@/lib/csv/parser';
import { BUTTON } from '@/components/ui/primitives';
import { ModalPortal } from '@/components/ui/ModalPortal';

/**
 * Importação de extratos na Conciliação: a leitura dos arquivos (`useStatementFiles`) serve ao
 * botão do cabeçalho, ao arrastar arquivos em qualquer lugar da página e à tabela vazia.
 */

/** Campo de arquivo único da tela (fica junto ao botão do cabeçalho). */
const FILE_INPUT_ID = 'statement-file-input';

export interface ParsedOFXItem {
  result: OFXParseResult;
  fileName: string;
}

interface StatementFilesParams {
  /** Extratos lidos (OFX direto; CSV depois do mapeamento das colunas). */
  onParsedBatch: (items: ParsedOFXItem[]) => void;
  /** Uma gravação em andamento: novos arquivos esperam. */
  isSaving?: boolean;
}

export function useStatementFiles({ onParsedBatch, isSaving = false }: StatementFilesParams) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [csvQueue, setCsvQueue] = useState<CSVQueueFile[]>([]);

  const processFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const ofxFiles = files.filter((f) => f.name.toLowerCase().endsWith('.ofx'));
    const csvFiles = files.filter((f) => {
      const lower = f.name.toLowerCase();
      return lower.endsWith('.csv') || lower.endsWith('.txt');
    });

    if (ofxFiles.length === 0 && csvFiles.length === 0) {
      setErrorMessage('Envie arquivo(s) com extensão .ofx, .csv ou .txt.');
      return;
    }

    setErrorMessage(null);
    setWarnings([]);
    const allWarnings: string[] = [];

    // CSV / TXT vão para a fila do mapeamento de colunas.
    if (csvFiles.length > 0) {
      const loadedCsvs: CSVQueueFile[] = [];
      for (const csvFile of csvFiles) {
        try {
          const { text } = await readCSVFileContent(csvFile);
          loadedCsvs.push({ content: text, fileName: csvFile.name });
        } catch (err) {
          allWarnings.push(`${csvFile.name}: ${err instanceof Error ? err.message : 'Falha ao ler arquivo CSV.'}`);
        }
      }
      if (loadedCsvs.length > 0) {
        setCsvQueue(loadedCsvs);
      } else if (ofxFiles.length === 0) {
        setWarnings(allWarnings);
        setErrorMessage('Não foi possível ler nenhum dos arquivos CSV selecionados.');
        return;
      }
      if (ofxFiles.length === 0) {
        if (allWarnings.length > 0) setWarnings(allWarnings);
        return;
      }
    }

    setIsProcessing(true);
    const parsedItems: ParsedOFXItem[] = [];
    try {
      for (let i = 0; i < ofxFiles.length; i++) {
        const file = ofxFiles[i];
        setProgressText(ofxFiles.length > 1 ? `Lendo arquivo ${i + 1} de ${ofxFiles.length}: ${file.name}…` : `Lendo ${file.name}…`);
        try {
          const parsed = await parseOFXFile(file);
          allWarnings.push(...parsed.warnings.filter((w) => !w.startsWith('Transação sem FITID')).map((w) => `${file.name}: ${w}`));
          if (parsed.transactions.length === 0) {
            allWarnings.push(
              parsed.hasErrors
                ? `${file.name}: Nenhum lançamento pôde ser lido (datas ou valores inválidos).`
                : `${file.name}: Nenhuma transação encontrada no arquivo.`
            );
          } else {
            parsedItems.push({ result: parsed, fileName: file.name });
          }
        } catch (err: unknown) {
          allWarnings.push(`${file.name}: ${err instanceof Error ? err.message : 'Falha ao processar arquivo.'}`);
        }
      }

      setWarnings(allWarnings);
      if (parsedItems.length === 0) {
        if (csvFiles.length === 0) setErrorMessage('Nenhum dos arquivos enviados contém lançamentos válidos.');
        return;
      }
      onParsedBatch(parsedItems);
    } finally {
      setIsProcessing(false);
      setProgressText(null);
    }
  };

  const loadSample = () => {
    setErrorMessage(null);
    setWarnings([]);
    onParsedBatch([{ result: parseOFXString(SAMPLE_BRAZILIAN_OFX), fileName: 'extrato_modelo.ofx' }]);
  };

  const busy = isSaving || isProcessing;

  return {
    busy,
    progressText,
    errorMessage,
    warnings,
    csvQueue,
    processFiles,
    loadSample,
    openPicker: () => {
      if (!busy) document.getElementById(FILE_INPUT_ID)?.click();
    },
    dismissMessages: () => {
      setErrorMessage(null);
      setWarnings([]);
    },
    closeCsv: () => setCsvQueue([]),
    confirmCsv: (items: ParsedOFXItem[]) => {
      setCsvQueue([]);
      if (items.length > 0) onParsedBatch(items);
    },
  };
}

export type StatementFiles = ReturnType<typeof useStatementFiles>;

const ACCEPT = '.ofx,.csv,.txt';

/** Botão do cabeçalho; guarda o seletor de arquivos usado também pela tabela vazia. */
export function ImportButton({ files }: { files: StatementFiles }) {
  return (
    <>
      <input
        id={FILE_INPUT_ID}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        aria-label="Arquivos de extrato"
        onChange={(e) => {
          if (e.target.files?.length) void files.processFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={files.openPicker}
        disabled={files.busy}
        title="OFX, CSV ou fatura de cartão. Também dá para arrastar os arquivos para a página."
        className={`${BUTTON.primary} h-10 px-4 shrink-0`}
      >
        {files.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" strokeWidth={2} />}
        Importar extrato
      </button>
    </>
  );
}

/** Leitura em andamento, erro e avisos da leitura dos arquivos. */
export function ImportFeedback({ files }: { files: StatementFiles }) {
  if (!files.progressText && !files.errorMessage && files.warnings.length === 0) return null;
  return (
    <div className="space-y-1 animate-fade-in">
      {files.progressText && (
        <p role="status" className="flex items-center gap-2 px-1 text-[12px] text-stone-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-ink" />
          {files.progressText}
        </p>
      )}
      {files.errorMessage && (
        <p role="alert" className="flex items-center gap-2 px-1 text-[12px] text-rose-600">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {files.errorMessage}
        </p>
      )}
      {files.warnings.length > 0 && (
        <details className="px-1 text-[12px] text-amber-700 dark:text-amber-400">
          <summary className="cursor-pointer select-none">{files.warnings.length} aviso(s) na leitura do(s) arquivo(s)</summary>
          <ul className="mt-1 ml-4 list-disc space-y-0.5 max-h-36 overflow-y-auto">
            {files.warnings.slice(0, 30).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Arrastar arquivos em qualquer lugar da página: mostra o aviso e importa ao soltar. */
export function FileDropOverlay({ files, disabled = false }: { files: StatementFiles; disabled?: boolean }) {
  const [active, setActive] = useState(false);
  const processRef = useRef(files.processFiles);
  useEffect(() => {
    processRef.current = files.processFiles;
  });
  const off = disabled || files.busy;

  const hasFiles = useCallback((e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files'), []);

  useEffect(() => {
    if (off) return;
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setActive(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setActive(false);
      if (e.dataTransfer?.files.length) void processRef.current(e.dataTransfer.files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      setActive(false);
    };
  }, [off, hasFiles]);

  if (!active || off) return null;
  return (
    <ModalPortal>
      <div aria-hidden className="fixed inset-3 z-[70] pointer-events-none rounded-[28px] border-2 border-dashed border-accent/60 bg-accent/5 backdrop-blur-[2px] flex items-center justify-center animate-fade-in">
        <div className="flex items-center gap-3 px-5 py-4 rounded-2xl bg-white dark:bg-stone-900 shadow-[0_12px_32px_rgba(0,0,0,0.14)]">
          <span className="w-9 h-9 rounded-xl bg-accent text-white flex items-center justify-center">
            <Upload className="w-4 h-4" strokeWidth={2} />
          </span>
          <span>
            <span className="block text-[14px] font-medium text-stone-900 dark:text-stone-100">Solte para importar os extratos</span>
            <span className="block text-[12px] text-stone-500">OFX, CSV ou fatura de cartão</span>
          </span>
        </div>
      </div>
    </ModalPortal>
  );
}

/** Tabela vazia: convite a importar, com o extrato modelo para experimentar. */
export function ImportEmptyState({ files, hasAnyTransaction }: { files: StatementFiles; hasAnyTransaction: boolean }) {
  return (
    <div className="px-6 py-12 flex flex-col items-center text-center gap-3">
      <span className="w-11 h-11 rounded-2xl bg-stone-100 dark:bg-stone-800 text-stone-500 flex items-center justify-center">
        <Upload className="w-5 h-5" strokeWidth={1.75} />
      </span>
      <div>
        <p className="text-[15px] font-medium tracking-tight text-stone-800 dark:text-stone-200">
          {hasAnyTransaction ? 'Nada por aqui' : 'Nenhum lançamento ainda'}
        </p>
        <p className="mt-1 text-[13px] text-stone-500 max-w-md">
          {hasAnyTransaction
            ? 'Nenhum lançamento neste filtro ou busca.'
            : 'Importe um extrato OFX, CSV ou fatura de cartão: use o botão abaixo ou arraste os arquivos para a página.'}
        </p>
      </div>
      {!hasAnyTransaction && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={files.openPicker} disabled={files.busy} className={`${BUTTON.primary} h-10 px-4`}>
            <Upload className="w-4 h-4" strokeWidth={2} />
            Importar extrato
          </button>
          <button type="button" onClick={files.loadSample} disabled={files.busy} className={`${BUTTON.ghost} h-10 px-4`}>
            Usar arquivo modelo
          </button>
        </div>
      )}
    </div>
  );
}

/** Mapeamento das colunas dos CSV na fila. */
export function CSVImportModal({
  files,
  bankAccounts,
  accounts,
  clientId,
  onBankAccountUpdated,
}: {
  files: StatementFiles;
  bankAccounts: readonly BankAccount[];
  accounts: readonly ChartAccount[];
  clientId: string;
  onBankAccountUpdated?: (bank: BankAccount) => void;
}) {
  if (files.csvQueue.length === 0) return null;
  return (
    <CSVMappingModal
      key={files.csvQueue.map((f) => f.fileName).join('|')}
      isOpen
      onClose={files.closeCsv}
      files={files.csvQueue}
      bankAccounts={bankAccounts}
      accounts={accounts}
      clientId={clientId}
      onBankAccountUpdated={onBankAccountUpdated}
      onConfirmBatch={files.confirmCsv}
    />
  );
}
