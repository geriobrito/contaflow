'use client';

import React, { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Sparkles } from 'lucide-react';

export const AuthGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading) {
      // Se não estiver autenticado e tentar acessar qualquer tela privada
      if (!user && pathname !== '/login') {
        router.replace('/login');
      }
      // Se já estiver autenticado e tentar acessar a tela de login
      else if (user && pathname === '/login') {
        router.replace('/');
      }
    }
  }, [user, loading, pathname, router]);

  // Enquanto verifica o estado de autenticação no Firebase
  if (loading) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#F5F5F7] dark:bg-black">
        <div className="flex flex-col items-center gap-4 animate-in fade-in duration-300">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#0071E3] to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 animate-pulse">
            <Sparkles className="w-6 h-6" />
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#0071E3] animate-bounce [animation-delay:-0.3s]" />
            <div className="w-2 h-2 rounded-full bg-[#0071E3] animate-bounce [animation-delay:-0.15s]" />
            <div className="w-2 h-2 rounded-full bg-[#0071E3] animate-bounce" />
          </div>
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Carregando ContaFlow...
          </span>
        </div>
      </div>
    );
  }

  // Se não estiver logado e não for a página de login, bloqueia exibição durante o redirect
  if (!user && pathname !== '/login') {
    return null;
  }

  // Se estiver logado e for a página de login, bloqueia exibição durante o redirect
  if (user && pathname === '/login') {
    return null;
  }

  return <>{children}</>;
};
