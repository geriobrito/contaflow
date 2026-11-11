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

  // Spinner refinado no padrão Apple enquanto checa autenticação
  if (loading) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-canvas">
        <div className="flex flex-col items-center gap-4 animate-in fade-in duration-300">
          <BrandMark size="lg" className="animate-pulse" />
          {/* iOS circular activity spinner */}
          <div className="relative w-6 h-6">
            <div className="w-6 h-6 rounded-full border-2 border-line-strong border-t-accent animate-spin" />
          </div>
          <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
            Carregando ContaFlow...
          </span>
        </div>
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
