'use client';

import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CopySlash } from 'lucide-react';
import { formatDateBR } from '@/lib/utils/formatters';

export interface DuplicateImportInfo {
  kind: 'full' | 'partial';
  fileName: string;
  clientName: string;
  startDate?: string;
  endDate?: string;
  totalInFile: number;
  alreadyImportedCount: number;
  newCount: number;
  /** Descrições já importadas que o arquivo traz diferentes (ex.: agora com o favorecido). */
  memoUpdateCount: number;
}

interface DuplicateImportModalProps {
  info: DuplicateImportInfo;
  busy?: boolean;
  /** Fecha sem gravar nada ("Entendi" / "Cancelar"). */
  onClose: () => void;
  /** Só na sobreposição parcial: importa apenas os lançamentos novos. */
  onImportNew?: () => void;
  /** Atualiza a descrição dos lançamentos já importados, sem importar nada novo. */
  onUpdateMemos?: () => void;
}

/**
 * Alerta de extrato já importado (bloqueio total) ou com dias sobrepostos (confirmação
 * para importar apenas os lançamentos novos). Nada é gravado enquanto o diálogo está aberto.
 */
export function DuplicateImportModal({ info, busy = false, onClose, onImportNew, onUpdateMemos }: DuplicateImportModalProps) {
  const titleId = useId();
  const descId = useId();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const full = info.kind === 'full';

  useEffect(() => {
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose, busy]);

  const period =
    info.startDate && info.endDate ? `${formatDateBR(info.startDate)} – ${formatDateBR(info.endDate)}` : 'não informado no arquivo';

  // Portal no <body>: fica acima de qualquer contexto de empilhamento da página.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-900/30 backdrop-blur-sm animate-fade-in" onClick={() => !busy && onClose()} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative w-full max-w-md rounded-3xl p-6 backdrop-blur-xl bg-white/90 dark:bg-stone-900/90 border border-black/10 dark:border-white/10 shadow-2xl animate-pop-in"
      >
        <div className="flex flex-col items-center text-center">
          <span className="w-12 h-12 rounded-full flex items-center justify-center bg-amber-100/80 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400">
            {full ? <CopySlash className="w-6 h-6" strokeWidth={1.75} /> : <AlertCircle className="w-6 h-6" strokeWidth={1.75} />}
          </span>
          <h2 id={titleId} className="mt-4 text-[19px] font-semibold tracking-tight text-stone-900 dark:text-stone-50">
            {full ? 'Extrato Já Importado' : 'Lançamentos Já Importados'}
          </h2>
          <p id={descId} className="mt-2 text-[14px] leading-relaxed text-stone-600 dark:text-stone-300">
            {full ? (
              <>
                Todas as <b className="font-semibold text-stone-900 dark:text-stone-100">{info.totalInFile}</b> transações deste arquivo já
                foram importadas para a empresa <b className="font-semibold text-stone-900 dark:text-stone-100">{info.clientName}</b>.
                Nenhuma alteração foi realizada para evitar duplicidades na DRE.
              </>
            ) : (
              <>
                Detectamos <b className="font-semibold text-stone-900 dark:text-stone-100">{info.alreadyImportedCount}</b> lançamento(s) já
                importado(s) anteriormente. Deseja importar apenas os{' '}
                <b className="font-semibold text-stone-900 dark:text-stone-100">{info.newCount}</b> lançamento(s) novo(s)?
              </>
            )}
          </p>
        </div>

        <dl className="mt-5 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.05] dark:border-white/[0.06] px-4 py-3 space-y-1.5 font-mono text-[12px] text-stone-500 dark:text-stone-400">
          <div className="flex justify-between gap-4">
            <dt>Arquivo</dt>
            <dd className="truncate text-stone-700 dark:text-stone-200" title={info.fileName}>
              {info.fileName}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Período</dt>
            <dd className="tabular-nums text-stone-700 dark:text-stone-200">{period}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Registros</dt>
            <dd className="tabular-nums text-stone-700 dark:text-stone-200">
              {info.totalInFile} no arquivo · {info.alreadyImportedCount} já importado(s)
            </dd>
          </div>
        </dl>

        {info.memoUpdateCount > 0 && (
          <p className="mt-4 text-[13px] leading-relaxed text-stone-600 dark:text-stone-300">
            Neste arquivo, <b className="font-semibold text-stone-900 dark:text-stone-100">{info.memoUpdateCount}</b> lançamento(s) já importado(s) têm uma
            descrição mais completa do que a gravada. Você pode atualizá-las sem perder as classificações.
          </p>
        )}

        <div className={`mt-6 flex gap-2.5 ${full ? 'justify-center' : ''}`}>
          {full ? (
            <>
              {info.memoUpdateCount > 0 && (
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="rounded-xl py-2.5 px-5 font-medium text-stone-700 dark:text-stone-200 bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/[0.08] disabled:opacity-40 transition-all active:scale-[0.98]"
                >
                  Entendi
                </button>
              )}
              <button
                ref={primaryRef}
                type="button"
                disabled={busy}
                onClick={info.memoUpdateCount > 0 ? onUpdateMemos : onClose}
                className="bg-[#0071E3] hover:bg-[#0077ED] text-white font-medium rounded-xl py-2.5 px-6 disabled:opacity-50 transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#0071E3]/25"
              >
                {info.memoUpdateCount > 0 ? (busy ? 'Atualizando…' : `Atualizar ${info.memoUpdateCount} descrições`) : 'Entendi'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="flex-1 rounded-xl py-2.5 px-4 font-medium text-stone-700 dark:text-stone-200 bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/[0.08] disabled:opacity-40 transition-all active:scale-[0.98]"
              >
                Cancelar
              </button>
              <button
                ref={primaryRef}
                type="button"
                onClick={onImportNew}
                disabled={busy}
                className="flex-[1.4] whitespace-nowrap bg-[#0071E3] hover:bg-[#0077ED] text-white font-medium rounded-xl py-2.5 px-4 disabled:opacity-50 transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#0071E3]/25"
              >
                {busy ? 'Importando…' : 'Importar Apenas Novos'}
              </button>
            </>
          )}
        </div>
        {!full && info.memoUpdateCount > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={onUpdateMemos}
            className="mt-3 w-full text-center text-[13px] font-medium text-[#0071E3] hover:underline disabled:opacity-40"
          >
            Só atualizar {info.memoUpdateCount} descrições já importadas
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
