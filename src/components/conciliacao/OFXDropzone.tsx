'use client';

import React, { useRef, useState } from 'react';
import { AlertCircle, FileText, Loader2, Upload } from 'lucide-react';
import { parseOFXFile, parseOFXString } from '@/lib/ofx/parser';
import type { OFXParseResult } from '@/lib/ofx/types';
import { SAMPLE_BRAZILIAN_OFX } from '@/lib/mock/sample-ofx';

export interface ParsedOFXItem {
  result: OFXParseResult;
  fileName: string;
}

interface OFXDropzoneProps {
  onParsed: (result: OFXParseResult, fileName: string) => void;
  onParsedBatch?: (items: ParsedOFXItem[]) => void;
  isLoading?: boolean;
}

export const OFXDropzone: React.FC<OFXDropzoneProps> = ({ onParsed, onParsedBatch, isLoading = false }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleProcessFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const ofxFiles = files.filter((f) => f.name.toLowerCase().endsWith('.ofx'));
    if (ofxFiles.length === 0) {
      setErrorMessage('Envie arquivo(s) com extensão .ofx.');
      return;
    }

    setErrorMessage(null);
    setWarnings([]);
    setIsProcessing(true);

    const parsedItems: ParsedOFXItem[] = [];
    const allWarnings: string[] = [];

    if (files.length > ofxFiles.length) {
      allWarnings.push(`${files.length - ofxFiles.length} arquivo(s) ignorado(s) por não ter(em) extensão .ofx.`);
    }

    try {
      for (let i = 0; i < ofxFiles.length; i++) {
        const file = ofxFiles[i];
        setProgressText(
          ofxFiles.length > 1
            ? `Processando arquivo ${i + 1} de ${ofxFiles.length}: ${file.name}...`
            : `Lendo ${file.name}...`
        );

        try {
          const parsed = await parseOFXFile(file);
          const filteredWarnings = parsed.warnings
            .filter((w) => !w.startsWith('Transação sem FITID'))
            .map((w) => `${file.name}: ${w}`);
          allWarnings.push(...filteredWarnings);

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
        setErrorMessage('Nenhum dos arquivos enviados contém lançamentos válidos.');
        return;
      }

      setActiveFileName(
        parsedItems.length === 1
          ? parsedItems[0].fileName
          : `${parsedItems.length} arquivos OFX lidos (${parsedItems.reduce((acc, it) => acc + it.result.transactions.length, 0)} lançamentos)`
      );

      if (onParsedBatch) {
        onParsedBatch(parsedItems);
      } else {
        // Fallback para manipulador de arquivo único
        for (const item of parsedItems) {
          onParsed(item.result, item.fileName);
        }
      }
    } finally {
      setIsProcessing(false);
      setProgressText(null);
    }
  };

  const handleLoadSample = () => {
    const name = 'extrato_modelo.ofx';
    setErrorMessage(null);
    setWarnings([]);
    setActiveFileName(name);
    const parsed = parseOFXString(SAMPLE_BRAZILIAN_OFX);
    if (onParsedBatch) {
      onParsedBatch([{ result: parsed, fileName: name }]);
    } else {
      onParsed(parsed, name);
    }
  };

  const busy = isLoading || isProcessing;

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={0}
        aria-label="Importar extratos OFX"
        onClick={() => !busy && fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (!busy && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (!busy && e.dataTransfer.files?.length) {
            void handleProcessFiles(e.dataTransfer.files);
          }
        }}
        className={`group flex items-center gap-4 rounded-2xl px-4 py-3.5 cursor-pointer border border-dashed transition-all duration-150 active:scale-[0.995] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0071E3]/40 ${
          isDragging
            ? 'border-[#0071E3]/50 bg-blue-50/60 dark:bg-blue-950/20'
            : 'border-black/[0.10] dark:border-white/[0.12] bg-white/50 dark:bg-white/[0.02] hover:bg-white/80 dark:hover:bg-white/[0.04] hover:border-black/[0.16]'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".ofx"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) {
              void handleProcessFiles(e.target.files);
            }
            e.target.value = '';
          }}
        />

        <span
          className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center transition-colors ${
            isDragging ? 'bg-[#0071E3] text-white' : 'bg-stone-100 dark:bg-stone-800 text-stone-500 group-hover:text-stone-800 dark:group-hover:text-stone-200'
          }`}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin text-[#0071E3]" /> : <Upload className="w-4 h-4" strokeWidth={1.75} />}
        </span>

        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-medium tracking-tight text-stone-900 dark:text-stone-100">
            {isDragging
              ? 'Solte os arquivos para importar'
              : progressText || 'Importar extrato(s) OFX'}
          </span>
          <span className="flex items-center gap-1.5 text-[12px] text-stone-500 truncate">
            {activeFileName ? (
              <>
                <FileText className="w-3 h-3 shrink-0" />
                <span className="truncate">{activeFileName}</span>
              </>
            ) : (
              'Arraste um ou mais arquivos OFX aqui ou clique para selecionar'
            )}
          </span>
        </span>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleLoadSample();
          }}
          className="hidden sm:inline-flex shrink-0 px-3 py-1.5 rounded-full text-[12px] font-medium text-stone-600 dark:text-stone-300 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-all duration-150 active:scale-[0.97]"
        >
          Usar arquivo modelo
        </button>
      </div>

      {errorMessage && (
        <p className="flex items-center gap-2 px-1 text-[12px] text-rose-600 animate-fade-in">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {errorMessage}
        </p>
      )}
      {warnings.length > 0 && (
        <details className="px-1 text-[12px] text-amber-700 dark:text-amber-400 animate-fade-in">
          <summary className="cursor-pointer select-none">
            {warnings.length} aviso(s) na leitura do(s) arquivo(s)
          </summary>
          <ul className="mt-1 ml-4 list-disc space-y-0.5 max-h-36 overflow-y-auto">
            {warnings.slice(0, 30).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};
