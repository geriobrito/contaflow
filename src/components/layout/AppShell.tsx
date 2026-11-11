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
      <Sidebar />
      <CommandPalette />
      <div className="flex-1 min-w-0">
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
