'use client';

import { useRef, useState } from 'react';
import { FileUp, Loader2 } from 'lucide-react';

interface InvoiceDropzoneProps {
  busy: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}

/** Área para soltar ou escolher os XML das notas (vários de uma vez). */
export function InvoiceDropzone({ busy, disabled, onFiles }: InvoiceDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const blocked = busy || disabled;

  const take = (list: FileList | null) => {
    const files = list ? [...list] : [];
    if (files.length) onFiles(files);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!blocked) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!blocked) take(e.dataTransfer.files);
      }}
      className={`flex items-center gap-4 rounded-[22px] border border-dashed px-5 py-4 transition-colors ${
        over ? 'border-accent/60 bg-accent/5' : 'border-black/12 dark:border-white/14 bg-white/50 dark:bg-stone-900/40'
      }`}
    >
      <span className="w-10 h-10 shrink-0 rounded-2xl bg-accent/10 text-accent-ink flex items-center justify-center">
        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileUp className="w-5 h-5" strokeWidth={1.75} />}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium tracking-tight text-stone-900 dark:text-stone-100">
          {busy ? 'Lendo as notas…' : 'Solte aqui os XML das notas (compra e venda)'}
        </p>
        <p className="text-[12px] text-stone-500">
          NF-e, NFC-e, resumos da SEFAZ e eventos de cancelamento. O arquivo é lido neste navegador: só o resumo (partes, valor, data, CFOP
          e parcelas) é gravado.
        </p>
      </div>
      <button
        type="button"
        disabled={blocked}
        onClick={() => inputRef.current?.click()}
        className="shrink-0 h-9 px-4 rounded-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[13px] font-medium disabled:opacity-40 active:scale-[0.97] transition-all"
      >
        Escolher arquivos
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".xml,text/xml,application/xml"
        aria-label="Arquivos XML das notas fiscais"
        className="hidden"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
