'use client';

import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Sparkles } from 'lucide-react';

function friendlyError(code?: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'E-mail ou senha incorretos.';
    case 'auth/invalid-email':
      return 'Formato de e-mail inválido.';
    case 'auth/user-disabled':
      return 'Esta conta foi desativada.';
    case 'auth/too-many-requests':
      return 'Muitas tentativas. Tente novamente em alguns minutos.';
    case 'auth/network-request-failed':
      return 'Sem conexão com o servidor. Verifique sua internet.';
    case 'auth/api-key-not-valid':
      return 'Chave do Firebase ausente ou inválida. Configure o .env.local.';
    default:
      return 'Não foi possível entrar. Verifique suas credenciais.';
  }
}

function errorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const { code } = err as { code: unknown };
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

const FIELD =
  'peer w-full h-14 px-4 pt-5 pb-1.5 rounded-2xl bg-white/80 dark:bg-stone-800/70 border border-black/[0.08] dark:border-white/[0.10] text-[15px] tracking-tight text-stone-900 dark:text-stone-100 placeholder-transparent outline-none transition-all duration-150 hover:border-black/[0.14] focus:border-[#0071E3]/60 focus:bg-white dark:focus:bg-stone-800 focus:shadow-[0_0_0_4px_rgba(0,113,227,0.12)]';

const FLOAT_LABEL =
  'pointer-events-none absolute left-4 top-1.5 text-[11px] font-medium text-stone-500 transition-all duration-150 peer-placeholder-shown:top-[17px] peer-placeholder-shown:text-[15px] peer-placeholder-shown:font-normal peer-placeholder-shown:text-stone-400 peer-focus:top-1.5 peer-focus:text-[11px] peer-focus:font-medium peer-focus:text-[#0071E3]';

export default function LoginPage() {
  const { signIn, isMockAuth, authError } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMessage('Informe e-mail e senha.');
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    try {
      // O redirecionamento acontece no ProtectedRoute assim que o escritório do usuário é resolvido.
      await signIn(email, password);
    } catch (err: unknown) {
      console.error('Erro de login:', err);
      setErrorMessage(friendlyError(errorCode(err)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#F9F9F8] dark:bg-stone-950 flex flex-col">
      {/* Textura ambiente: dois halos quentes e muito difusos */}
      <div aria-hidden className="pointer-events-none absolute -top-40 -left-32 w-[520px] h-[520px] rounded-full bg-[#D97757]/[0.10] blur-[120px]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-48 -right-24 w-[560px] h-[560px] rounded-full bg-[#0071E3]/[0.07] blur-[120px]" />

      <header className="relative z-10 flex items-center gap-2 px-6 sm:px-10 h-16">
        <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-[#D97757] to-[#C15F3C] flex items-center justify-center">
          <Sparkles className="w-3.5 h-3.5 text-white" />
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">ContaFlow</span>
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center px-4 pb-16">
        <div className="w-full max-w-[400px] animate-sheet-in">
          <div className="text-center mb-8">
            <h1 className="font-serif text-[34px] sm:text-[40px] leading-[1.1] tracking-tight text-stone-900 dark:text-stone-50">
              Contabilidade que
              <br />
              <span className="italic text-[#C15F3C]">aprende</span> com você.
            </h1>
            <p className="mt-3 text-[14px] text-stone-500">Entre para continuar a conciliação.</p>
          </div>

          <div className="rounded-[28px] p-6 sm:p-7 backdrop-blur-2xl bg-white/60 dark:bg-stone-900/60 border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.04),0_24px_48px_-12px_rgba(0,0,0,0.08)]">
            {(errorMessage ?? authError) && (
              <div role="alert" className="mb-4 flex items-start gap-2.5 px-3.5 py-3 rounded-2xl bg-rose-50/80 dark:bg-rose-950/30 border border-rose-200/60 text-[13px] text-rose-700 dark:text-rose-300 animate-fade-in">
                <AlertCircle className="w-4 h-4 mt-px shrink-0" />
                <span>{errorMessage ?? authError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="space-y-3">
              <div className="relative">
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="E-mail"
                  className={FIELD}
                />
                <label htmlFor="email" className={FLOAT_LABEL}>
                  E-mail
                </label>
              </div>

              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Senha"
                  className={`${FIELD} pr-12`}
                />
                <label htmlFor="password" className={FLOAT_LABEL}>
                  Senha
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-xl text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 active:scale-[0.92] transition-all duration-150"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="group w-full h-12 mt-2 rounded-2xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[15px] font-medium tracking-tight flex items-center justify-center gap-2 shadow-[0_6px_20px_rgba(28,25,23,0.18)] hover:bg-stone-800 dark:hover:bg-white active:scale-[0.98] disabled:opacity-60 transition-all duration-150"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    Entrar
                    <ArrowRight className="w-4 h-4 transition-transform duration-150 group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </form>

            {isMockAuth && (
              <button
                type="button"
                onClick={() => {
                  setEmail('admin@contaflow.com.br');
                  setPassword('contaflow123');
                  setErrorMessage(null);
                }}
                className="mt-4 w-full text-center text-[13px] text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
              >
                Usar credenciais de teste local
              </button>
            )}
          </div>

          <p className="mt-6 text-center text-[12px] text-stone-400">Acesso restrito à equipe contábil.</p>
        </div>
      </main>
    </div>
  );
}
