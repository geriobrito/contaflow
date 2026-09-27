'use client';

import React, { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Sparkles } from 'lucide-react';

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading, isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading) {
      // Se não autenticado e rota privada
      if (!isAuthenticated && pathname !== '/login') {
        router.replace('/login');
      }
      // Se autenticado e tentando acessar login
      else if (isAuthenticated && pathname === '/login') {
        router.replace('/');
      }
    }
  }, [isAuthenticated, loading, pathname, router]);

  // Spinner refinado no padrão Apple enquanto checa autenticação
  if (loading) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#F5F5F7] dark:bg-black">
        <div className="flex flex-col items-center gap-4 animate-in fade-in duration-300">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#0071E3] to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
            <Sparkles className="w-6 h-6 animate-pulse" />
          </div>
          {/* iOS circular activity spinner */}
          <div className="relative w-6 h-6">
            <div className="w-6 h-6 rounded-full border-2 border-black/10 dark:border-white/10 border-t-[#0071E3] animate-spin" />
          </div>
          <span className="text-xs font-medium text-[#86868B] dark:text-zinc-400">
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
