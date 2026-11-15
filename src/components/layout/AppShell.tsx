'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { useClient } from '@/contexts/ClientContext';

/** Rotas públicas renderizadas sem a moldura da aplicação. */
const BARE_ROUTES = new Set(['/login', '/responder']);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { loadError } = useClient();
  if (BARE_ROUTES.has(pathname)) return <>{children}</>;

  return (
    <div className="min-h-screen print:bg-white flex min-w-[900px] print:min-w-0">
      {/* Atalho de teclado: o primeiro Tab da página leva direto ao conteúdo, sem passar pelo menu. */}
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:z-80 focus:top-3 focus:left-3 focus:px-4 focus:py-2 focus:rounded-full focus:bg-stone-900 focus:text-white focus:text-[13px] focus:font-medium focus:shadow-raised print:hidden"
      >
        Pular para o conteúdo
      </a>
      <Sidebar />
      <CommandPalette />
      <div id="conteudo" tabIndex={-1} className="flex-1 min-w-0 outline-none">
        {loadError && (
          <div role="alert" className="mx-5 xl:mx-8 mt-6 px-4 py-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-900/50 text-[13px] text-rose-700 dark:text-rose-300">
            Não foi possível carregar os dados do escritório: {loadError}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
