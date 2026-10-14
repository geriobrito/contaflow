import React from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import type { OpeningStatus } from '@/lib/opening';

/**
 * Aviso de "abertura não conferida" no topo das demonstrações (Balanço, DRE, Diário): sem uma
 * abertura que fecha numa data única, o patrimônio parte de uma posição incompleta.
 */
export function OpeningStatusNotice({ status }: { status: OpeningStatus | null }) {
  if (!status || status.verified) return null;
  return (
    <div role="status" className="flex gap-2 rounded-2xl px-4 py-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 text-[13px] text-amber-800 dark:text-amber-300 print:hidden">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="space-y-0.5 min-w-0">
        <p className="font-medium">Abertura não conferida</p>
        <ul className="space-y-0.5">
          {status.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <Link href="/abertura" className="inline-block font-medium underline">
          Conferir saldos de abertura
        </Link>
      </div>
    </div>
  );
}
