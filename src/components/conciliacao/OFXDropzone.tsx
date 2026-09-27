'use client';

import React, { useRef, useState } from 'react';
import { AlertCircle, FileText, Loader2, Upload } from 'lucide-react';
import { parseOFXFile, parseOFXString } from '@/lib/ofx/parser';
import type { OFXParseResult } from '@/lib/ofx/types';
import { SAMPLE_BRAZILIAN_OFX } from '@/lib/mock/sample-ofx';

interface OFXDropzoneProps {
  onParsed: (result: OFXParseResult, fileName: string) => void;
  isLoading?: boolean;
}

export const OFXDropzone: React.FC<OFXDropzoneProps> = ({ onParsed, isLoading = false }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleProcessFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.ofx')) {
      setErrorMessage('Envie um arquivo com extensão .ofx.');
      return;
    }
    setErrorMessage(null);
    setWarnings([]);
    setActiveFileName(file.name);
    try {
      const parsed = await parseOFXFile(file);
      setWarnings(parsed.warnings.filter((w) => !w.startsWith('Transação sem FITID')));
      if (parsed.transactions.length === 0) {
        setErrorMessage(
          parsed.hasErrors ? 'Nenhum lançamento do arquivo pôde ser lido (datas ou valores inválidos).' : 'Nenhuma transação encontrada no arquivo.'
        );
        return;
      }
      onParsed(parsed, file.name);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Falha ao processar o arquivo OFX.');
    }
  };

  const handleLoadSample = () => {
    const name = 'extrato_modelo.ofx';
    setErrorMessage(null);
    setWarnings([]);
    setActiveFileName(name);
    onParsed(parseOFXString(SAMPLE_BRAZILIAN_OFX), name);
  };

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={0}
        aria-label="Importar extrato OFX"
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handleProcessFile(file);
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
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleProcessFile(file);
            e.target.value = '';
          }}
        />

        <span
          className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center transition-colors ${
            isDragging ? 'bg-[#0071E3] text-white' : 'bg-stone-100 dark:bg-stone-800 text-stone-500 group-hover:text-stone-800 dark:group-hover:text-stone-200'
          }`}
        >
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" strokeWidth={1.75} />}
        </span>

        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-medium tracking-tight text-stone-900 dark:text-stone-100">
            {isDragging ? 'Solte para importar' : 'Importar extrato OFX'}
          </span>
          <span className="flex items-center gap-1.5 text-[12px] text-stone-500 truncate">
            {activeFileName ? (
              <>
                <FileText className="w-3 h-3 shrink-0" />
                <span className="truncate">{activeFileName}</span>
              </>
            ) : (
              'Arraste o arquivo aqui ou clique para selecionar'
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
            {warnings.length} aviso(s) na leitura do arquivo
          </summary>
          <ul className="mt-1 ml-4 list-disc space-y-0.5">
            {warnings.slice(0, 20).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};
