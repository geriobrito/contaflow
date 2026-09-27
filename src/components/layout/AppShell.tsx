'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { useClient } from '@/contexts/ClientContext';

/** Rotas públicas renderizadas sem a moldura da aplicação. */
const BARE_ROUTES = new Set(['/login']);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { loadError } = useClient();
  if (BARE_ROUTES.has(pathname)) return <>{children}</>;

  return (
    <div className="min-h-screen bg-[#F9F9F8] dark:bg-stone-950 print:bg-white lg:flex">
      <Sidebar />
      <div className="flex-1 min-w-0">
        {loadError && (
          <div role="alert" className="mx-4 sm:mx-6 md:mx-10 lg:mx-12 mt-6 px-4 py-3 rounded-2xl bg-rose-50 border border-rose-200/60 text-[13px] text-rose-700">
            Não foi possível carregar os dados do escritório: {loadError}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
