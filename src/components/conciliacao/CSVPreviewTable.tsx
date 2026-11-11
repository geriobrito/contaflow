'use client';

import React from 'react';
import { Table } from 'lucide-react';
import type { previewCSV } from '@/lib/csv/parser';

interface CSVPreviewTableProps {
  preview: ReturnType<typeof previewCSV>;
  hasHeader: boolean;
  onHasHeaderChange: (hasHeader: boolean) => void;
}

/** Prévia das primeiras linhas do CSV, com a opção de tratar a primeira como cabeçalho. */
export function CSVPreviewTable({ preview, hasHeader, onHasHeaderChange }: CSVPreviewTableProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-stone-500 flex items-center gap-1">
          <Table className="w-3.5 h-3.5" /> Prévia das linhas do arquivo ({preview.totalRows} linhas no total)
        </span>
        <label className="inline-flex items-center gap-2 text-[12px] text-stone-600 dark:text-stone-300 cursor-pointer">
          <input
            type="checkbox"
            checked={hasHeader}
            onChange={(e) => onHasHeaderChange(e.target.checked)}
            className="rounded border-stone-300 text-accent-ink focus:ring-accent"
          />
          Primeira linha contém cabeçalhos
        </label>
      </div>

      <div className="border border-line-strong rounded-xl overflow-hidden bg-stone-50/40 dark:bg-stone-900/40">
        <div className="overflow-x-auto max-h-44">
          <table className="w-full text-left text-[12px] border-collapse font-mono">
            <thead>
              <tr className="bg-stone-100/70 dark:bg-stone-800/70 border-b border-black/6 text-stone-600">
                {preview.headers.map((h, i) => (
                  <th key={i} className="py-2 px-3 whitespace-nowrap">
                    <span className="text-[10px] text-stone-400 block font-normal">Col {i + 1}</span>
                    {h || '—'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black/4 dark:divide-white/6">
              {preview.previewRows.slice(hasHeader ? 1 : 0, 5).map((row, rIdx) => (
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
  );
}

