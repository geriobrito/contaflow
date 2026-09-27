'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { ShieldCheck, Lock, Mail, ArrowRight, Loader2, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const { signIn, isMockAuth } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const getFriendlyErrorMessage = (code?: string): string => {
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'E-mail ou senha incorretos.';
      case 'auth/invalid-email':
        return 'Formato de e-mail inválido.';
      case 'auth/user-disabled':
        return 'Esta conta de usuário foi desativada.';
      case 'auth/too-many-requests':
        return 'Muitas tentativas sem sucesso. Tente novamente em alguns minutos.';
      case 'auth/network-request-failed':
        return 'Erro de conexão com o Firebase. Verifique sua internet.';
      case 'auth/api-key-not-valid':
        return 'Chave de API do Firebase ausente ou inválida. Configure as credenciais reais no .env.local.';
      default:
        return 'Falha ao autenticar. Verifique suas credenciais.';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMessage('Preencha seu e-mail e sua senha.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      await signIn(email, password);
      router.replace('/');
    } catch (err: any) {
      console.error('Erro de login:', err);
      setErrorMessage(getFriendlyErrorMessage(err?.code));
    } finally {
      setLoading(false);
    }
  };

  // Preenchimento de credenciais para teste rápido em ambiente local
  const handleQuickFill = () => {
    setEmail('admin@contaflow.com.br');
    setPassword('contaflow123');
    setErrorMessage(null);
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#F5F5F7] dark:bg-black p-4 relative overflow-hidden select-none">
      {/* Background Ambient Lighting (iOS blur glow) */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-gradient-to-tr from-blue-400/20 to-indigo-400/20 rounded-full blur-3xl pointer-events-none" />

      {/* Floating Centered Glassmorphism Card */}
      <div className="relative z-10 w-full max-w-sm rounded-3xl backdrop-blur-xl bg-white/80 dark:bg-zinc-900/80 border border-black/5 dark:border-white/10 shadow-xl p-8 flex flex-col items-center animate-in fade-in zoom-in-95 duration-300">
        {/* Top Icon with Subtle Circle */}
        <div className="w-16 h-16 rounded-full bg-[#0071E3]/10 dark:bg-blue-500/10 flex items-center justify-center text-[#0071E3] dark:text-blue-400 mb-4 border border-[#0071E3]/20 shadow-sm">
          <ShieldCheck className="w-8 h-8" />
        </div>

        {/* Title & Subtitle (SF Pro Style) */}
        <h1 className="text-xl font-semibold tracking-tight text-[#1D1D1F] dark:text-white text-center">
          ContaFlow
        </h1>
        <p className="text-xs text-[#86868B] dark:text-zinc-400 text-center mt-1 mb-6">
          Acesso exclusivo para gestão contábil interna
        </p>

        {/* Error Alert */}
        {errorMessage && (
          <div className="w-full mb-4 p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2.5 animate-in fade-in duration-200">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span className="leading-tight">{errorMessage}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="w-full space-y-3.5">
          {/* Email Input */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[#1D1D1F] dark:text-zinc-300 block">
              E-mail
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu.email@exemplo.com"
                className="w-full pl-10 pr-4 py-3 text-sm rounded-xl bg-[#F5F5F7]/80 dark:bg-zinc-800/80 border border-black/10 dark:border-white/10 text-[#1D1D1F] dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#0071E3] transition-all"
              />
            </div>
          </div>

          {/* Password Input */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[#1D1D1F] dark:text-zinc-300 block">
              Senha
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-3 text-sm rounded-xl bg-[#F5F5F7]/80 dark:bg-zinc-800/80 border border-black/10 dark:border-white/10 text-[#1D1D1F] dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#0071E3] transition-all"
              />
            </div>
          </div>

          {/* Native iOS Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 bg-[#0071E3] hover:bg-[#0077ED] active:scale-[0.98] text-white font-medium rounded-xl py-3 text-sm transition-all shadow-md shadow-blue-500/20 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Autenticando...</span>
              </>
            ) : (
              <>
                <span>Entrar no Sistema</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Quick Fill Helper for Local Testing */}
        {isMockAuth && (
          <div className="w-full mt-5 pt-4 border-t border-black/5 dark:border-white/5 text-center">
            <button
              type="button"
              onClick={handleQuickFill}
              className="text-xs font-medium text-[#0071E3] hover:underline"
            >
              Preencher dados de teste local
            </button>
          </div>
        )}

        {/* Footer info */}
        <div className="mt-6 text-center">
          <span className="text-[11px] text-zinc-400 font-medium">
            Protegido por Firebase Authentication
          </span>
        </div>
      </div>
    </div>
  );
}
