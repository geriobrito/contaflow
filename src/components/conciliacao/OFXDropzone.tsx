'use client';

import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  FileCheck2,
  AlertCircle,
  Building,
  Calendar,
  DollarSign,
  Sparkles,
} from 'lucide-react';
import { parseOFXFile, parseOFXString } from '@/lib/ofx/parser';
import { OFXParseResult } from '@/lib/ofx/types';
import { SAMPLE_BRAZILIAN_OFX } from '@/lib/mock/sample-ofx';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

interface OFXDropzoneProps {
  onParsed: (result: OFXParseResult, fileName: string) => void;
  isLoading?: boolean;
}

export const OFXDropzone: React.FC<OFXDropzoneProps> = ({
  onParsed,
  isLoading = false,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleProcessFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.ofx')) {
      setErrorMessage('Por favor, envie um arquivo bancário com extensão .ofx válido.');
      return;
    }
    setErrorMessage(null);
    setActiveFileName(file.name);

    try {
      const parsed = await parseOFXFile(file);
      if (parsed.transactions.length === 0) {
        setErrorMessage('Nenhuma transação foi encontrada no arquivo OFX enviado.');
        return;
      }
      onParsed(parsed, file.name);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao processar o arquivo OFX.';
      setErrorMessage(message);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleProcessFile(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleLoadSample = () => {
    setErrorMessage(null);
    const sampleFileName = 'extrato_inter_marco_2024.ofx';
    setActiveFileName(sampleFileName);
    const parsed = parseOFXString(SAMPLE_BRAZILIAN_OFX);
    onParsed(parsed, sampleFileName);
  };

  return (
    <div className="w-full space-y-3">
      {/* Drop Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={`relative group cursor-pointer rounded-3xl p-8 border-2 border-dashed transition-all duration-300 text-center flex flex-col items-center justify-center ${
          isDragging
            ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/20 scale-[0.99]'
            : 'border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/40 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-white/80'
        } ios-card`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".ofx"
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) {
              handleProcessFile(e.target.files[0]);
            }
          }}
        />

        <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-200">
          <UploadCloud className="w-7 h-7" />
        </div>

        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
          Arraste seu arquivo bancário OFX aqui
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mb-4">
          Compatível com extratos de todos os bancos brasileiros (Itaú, Bradesco, Santander, BB, Nubank, Inter, etc.)
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="ios-button px-4 py-2 rounded-xl text-xs font-medium bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 shadow-sm hover:opacity-90"
          >
            Selecionar do Computador
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleLoadSample();
            }}
            className="ios-button px-4 py-2 rounded-xl text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Testar com OFX Modelo</span>
          </button>
        </div>
      </div>

      {/* Error alert */}
      {errorMessage && (
        <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
};
