'use client';

import React, { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { BrandMark } from '@/components/ui/BrandMark';

/** Rotas abertas sem login (o cliente responde às pendências pelo link). */
const PUBLIC_ROUTES = new Set(['/responder']);

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { loading, isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isPublic = PUBLIC_ROUTES.has(pathname);

  useEffect(() => {
    if (!loading && !isPublic) {
      // Se não autenticado e rota privada
      if (!isAuthenticated && pathname !== '/login') {
        router.replace('/login');
      }
      // Se autenticado e tentando acessar login
      else if (isAuthenticated && pathname === '/login') {
        router.replace('/painel');
      }
    }
  }, [isAuthenticated, loading, pathname, router, isPublic]);

  if (isPublic) return <>{children}</>;

  // Enquanto a sessão é conferida: a marca e uma barra de progresso discreta.
  if (loading) {
    return (
      <div role="status" aria-live="polite" className="min-h-screen w-full flex flex-col items-center justify-center gap-5 bg-canvas animate-fade-in">
        <BrandMark size="xl" />
        <div aria-hidden className="loading-bar w-28" />
        <span className="text-[12.5px] font-medium text-stone-500 dark:text-stone-400">Abrindo o ContaFlow…</span>
      </div>
    );
  }

  // Previne "flash" de conteúdo não autorizado durante redirect
  if (!isAuthenticated && pathname !== '/login') {
    return null;
  }

  // Previne "flash" da tela de login se já autenticado
  if (isAuthenticated && pathname === '/login') {
    return null;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
