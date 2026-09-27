'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';

/** Rotas públicas renderizadas sem a moldura da aplicação. */
const BARE_ROUTES = new Set(['/login']);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (BARE_ROUTES.has(pathname)) return <>{children}</>;

  return (
    <div className="min-h-screen bg-[#F9F9F8] dark:bg-stone-950 lg:flex">
      <Sidebar />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
