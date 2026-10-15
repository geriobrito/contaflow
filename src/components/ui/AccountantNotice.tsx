import React from 'react';
import Link from 'next/link';
import { Info } from 'lucide-react';
import type { OrgSettings } from '@/types/firestore';

/**
 * Aviso discreto nas telas que geram demonstrações: sem nome e CRC do contador no cadastro do
 * escritório, a assinatura do profissional da contabilidade sai em branco nos PDFs.
 */
export function AccountantNotice({ org, ready = true }: { org: Pick<OrgSettings, 'accountantName' | 'accountantCrc'> | null | undefined; ready?: boolean }) {
  if (!ready || (org?.accountantName?.trim() && org?.accountantCrc?.trim())) return null;
  return (
    <p role="note" className="flex items-start gap-2 text-[12px] text-stone-500 dark:text-stone-400 print:hidden">
      <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span>
        Nome e CRC do contador não cadastrados: a assinatura do profissional da contabilidade sai em branco.{' '}
        <Link href="/escritorio" className="underline underline-offset-2 hover:text-stone-800 dark:hover:text-stone-200">
          Preencher em Escritório
        </Link>
      </span>
    </p>
  );
}
