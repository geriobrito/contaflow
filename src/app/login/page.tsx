'use client';

import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { secondFactorMessage } from '@/lib/auth/two-factor';
import { APP_VERSION, versionLabel } from '@/lib/app-version';
import { AlertCircle, ArrowRight, Check, CheckCircle2, Clock, Eye, EyeOff, Loader2, Lock, Sparkles } from 'lucide-react';

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
  'peer w-full h-14 px-4 pt-5 pb-1.5 rounded-2xl bg-white dark:bg-white/[0.04] border border-black/[0.09] dark:border-white/[0.10] text-[15px] tracking-tight text-stone-900 dark:text-stone-100 placeholder-transparent outline-none transition-all duration-150 hover:border-black/[0.16] dark:hover:border-white/[0.18] focus:border-accent/60 focus:shadow-[0_0_0_4px_rgba(217,119,87,0.16)]';

const FLOAT_LABEL =
  'pointer-events-none absolute left-4 top-1.5 text-[11px] font-medium text-stone-500 transition-all duration-150 peer-placeholder-shown:top-[17px] peer-placeholder-shown:text-[15px] peer-placeholder-shown:font-normal peer-placeholder-shown:text-stone-400 peer-focus:top-1.5 peer-focus:text-[11px] peer-focus:font-medium peer-focus:text-accent-ink';

const PRIMARY =
  'group w-full h-12 rounded-2xl bg-stone-900 dark:bg-[#F5F4EF] text-white dark:text-stone-900 text-[15px] font-medium tracking-tight flex items-center justify-center gap-2 shadow-[0_6px_20px_rgba(28,25,23,0.16)] hover:bg-stone-800 dark:hover:bg-white active:scale-[0.98] disabled:opacity-60 transition-all duration-150';

const LINK = 'text-[13px] text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 disabled:opacity-60 transition-colors';

function Brand() {
  return (
    <span className="flex items-center gap-2">
      <span className="w-7 h-7 rounded-[9px] bg-gradient-to-br from-[#D97757] to-[#C15F3C] flex items-center justify-center shadow-[0_2px_8px_rgba(193,95,60,0.35)]">
        <Sparkles className="w-4 h-4 text-white" />
      </span>
      <span className="text-[16px] font-semibold tracking-tight">ContaFlow</span>
    </span>
  );
}

/** Painel de apresentação (telas largas): folha de livro-razão com um exemplo de conciliação. */
function Showcase() {
  return (
    <aside className="relative flex flex-col justify-between overflow-hidden p-12 xl:p-16 bg-[#EFEDE5] dark:bg-[#181715] border-r border-black/[0.06] dark:border-white/[0.06]">
      {/* Pautas de livro contábil, esmaecendo para baixo, e a margem em terracota */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_35px,rgba(28,25,23,0.06)_35px,rgba(28,25,23,0.06)_36px)] dark:bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_35px,rgba(255,255,255,0.05)_35px,rgba(255,255,255,0.05)_36px)] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
      />
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-8 xl:left-10 w-px bg-[#D97757]/30" />

      <div className="relative">
        <Brand />
      </div>

      <div className="relative max-w-[520px] space-y-10">
        <div className="space-y-5">
          <p className="font-serif text-[52px] xl:text-[60px] leading-[1.02] tracking-tight text-stone-900 dark:text-stone-50">
            Contabilidade que <span className="italic text-accent-ink">aprende</span> com você.
          </p>
          <p className="text-[15px] leading-relaxed text-stone-600 dark:text-stone-400 max-w-[440px]">
            Extratos OFX conciliados em partidas dobradas, regras que lembram das suas escolhas e demonstrações prontas para assinar.
          </p>
        </div>

        {/* Exemplo: a linha do extrato vira lançamento contábil */}
        <figure className="rounded-[22px] bg-white/80 dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_18px_40px_-16px_rgba(28,25,23,0.18)] p-5 space-y-4">
          <div className="flex items-baseline justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-stone-400">Extrato · 14/10</p>
              <p className="mt-1 text-[14px] font-medium tracking-tight truncate">PIX recebido — Padaria Aurora</p>
            </div>
            <p className="font-mono tabular-nums text-[14px] text-emerald-700 dark:text-emerald-400">+ 1.250,00</p>
          </div>
          <div className="border-t border-dashed border-black/[0.10] dark:border-white/[0.10]" />
          <dl className="space-y-1.5 font-mono tabular-nums text-[12.5px]">
            {[
              ['D', '1.1.1.02', 'Bancos Conta Movimento'],
              ['C', '3.1.1.01', 'Receita de Prestação de Serviços'],
            ].map(([side, code, name]) => (
              <div key={code} className="flex items-center gap-3">
                <dt className="w-4 text-stone-400">{side}</dt>
                <dd className="flex-1 min-w-0 truncate text-stone-700 dark:text-stone-300">
                  <span className="text-stone-400">{code}</span> {name}
                </dd>
                <dd className="text-stone-700 dark:text-stone-300">1.250,00</dd>
              </div>
            ))}
          </dl>
          <figcaption className="inline-flex items-center gap-1.5 rounded-full bg-[#D97757]/[0.10] dark:bg-[#D97757]/[0.16] px-2.5 py-1 text-[11.5px] font-medium text-[#A84E30] dark:text-[#E89A7E]">
            <Check className="w-3.5 h-3.5" strokeWidth={2.25} />
            Conciliado pela regra “Padaria Aurora”
          </figcaption>
        </figure>
      </div>

      <p className="relative text-[12px] text-stone-500 dark:text-stone-500">Conciliação OFX · Partidas dobradas · DRE, Balanço e DLPA</p>
    </aside>
  );
}

export default function LoginPage() {
  const { signIn, isMockAuth, authError, sessionNotice, secondFactorPending, confirmSecondFactor, cancelSecondFactor, resetPassword } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Segunda etapa: código de 6 dígitos do aplicativo autenticador. */
  const handleCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) {
      setErrorMessage('Informe os 6 dígitos do aplicativo autenticador.');
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    try {
      await confirmSecondFactor(code);
    } catch (err: unknown) {
      console.error('Erro na verificação em duas etapas:', err);
      setErrorMessage(secondFactorMessage(err));
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    setErrorMessage(null);
    setNotice(null);
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setErrorMessage('Informe seu e-mail no campo acima para receber o link de redefinição.');
      return;
    }
    setLoading(true);
    try {
      await resetPassword(address);
      // A mesma mensagem exista ou não a conta: a tela não revela quais e-mails têm cadastro.
      setNotice(`Se houver uma conta para ${address}, enviamos um link para redefinir a senha. Confira também a caixa de spam.`);
    } catch (err: unknown) {
      console.error('Erro ao enviar redefinição de senha:', err);
      const failure = errorCode(err);
      if (failure === 'auth/user-not-found') {
        setNotice(`Se houver uma conta para ${address}, enviamos um link para redefinir a senha. Confira também a caixa de spam.`);
      } else {
        setErrorMessage(failure === 'auth/too-many-requests' || failure === 'auth/network-request-failed' || failure === 'auth/invalid-email' ? friendlyError(failure) : 'Não foi possível enviar o e-mail de redefinição. Tente de novo em instantes.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMessage('Informe e-mail e senha.');
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    setNotice(null);
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

  const error = errorMessage ?? authError;

  return (
    <div className="min-h-screen w-full min-w-[1080px] grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] bg-[#F5F4EF] dark:bg-[#1F1E1C] text-stone-900 dark:text-stone-100">
      <Showcase />

      <div className="relative flex flex-col min-h-screen">
        <main className="flex-1 flex items-center justify-center px-8 py-10">
          <div className="w-full max-w-[380px] animate-sheet-in">
            <div className="mb-8">
              <h1 className="font-serif text-[30px] leading-tight tracking-tight">{secondFactorPending ? 'Verificação em duas etapas' : 'Bem-vindo de volta'}</h1>
              <p className="mt-2 text-[14px] text-stone-500 dark:text-stone-400">
                {secondFactorPending ? 'Falta só o código do aplicativo autenticador.' : 'Entre com o e-mail e a senha do escritório.'}
              </p>
            </div>

            {error && (
              <div role="alert" className="mb-4 flex items-start gap-2.5 px-3.5 py-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200/70 dark:border-rose-900/50 text-[13px] text-rose-700 dark:text-rose-300 animate-fade-in">
                <AlertCircle className="w-4 h-4 mt-px shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {sessionNotice && !notice && !error && (
              <div role="status" className="mb-4 flex items-start gap-2.5 px-3.5 py-3 rounded-2xl bg-[#D97757]/[0.08] dark:bg-[#D97757]/[0.12] border border-[#D97757]/25 text-[13px] text-[#8F4128] dark:text-[#E89A7E] animate-fade-in">
                <Clock className="w-4 h-4 mt-px shrink-0" />
                <span>{sessionNotice}</span>
              </div>
            )}

            {notice && (
              <div role="status" className="mb-4 flex items-start gap-2.5 px-3.5 py-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-900/50 text-[13px] text-emerald-800 dark:text-emerald-300 animate-fade-in">
                <CheckCircle2 className="w-4 h-4 mt-px shrink-0" />
                <span>{notice}</span>
              </div>
            )}

            {secondFactorPending ? (
              <form onSubmit={handleCode} noValidate className="space-y-3">
                <p className="text-[13px] text-stone-600 dark:text-stone-300">Abra o aplicativo autenticador e informe o código de 6 dígitos do ContaFlow.</p>
                <div className="relative">
                  <input
                    id="code"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Código"
                    className={`${FIELD} font-mono tabular-nums tracking-[0.3em]`}
                  />
                  <label htmlFor="code" className={FLOAT_LABEL}>
                    Código de verificação
                  </label>
                </div>
                <button type="submit" disabled={loading} className={`${PRIMARY} mt-2`}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verificar'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    cancelSecondFactor();
                    setCode('');
                    setErrorMessage(null);
                  }}
                  className={`w-full text-center ${LINK}`}
                >
                  Voltar
                </button>
              </form>
            ) : (
              <form onSubmit={handleSubmit} noValidate className="space-y-3">
                <div className="relative">
                  <input id="email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" className={FIELD} />
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

                {!isMockAuth && (
                  <div className="flex justify-end">
                    <button type="button" disabled={loading} onClick={() => void handleReset()} className={LINK}>
                      Esqueci minha senha
                    </button>
                  </div>
                )}

                <button type="submit" disabled={loading} className={`${PRIMARY} mt-2`}>
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
            )}

            {isMockAuth && (
              <button
                type="button"
                onClick={() => {
                  setEmail('admin@contaflow.com.br');
                  setPassword('contaflow123');
                  setErrorMessage(null);
                }}
                className={`mt-4 w-full text-center ${LINK}`}
              >
                Usar credenciais de teste local
              </button>
            )}

            <p className="mt-8 pt-5 border-t border-black/[0.06] dark:border-white/[0.08] flex items-start gap-2 text-[12px] leading-relaxed text-stone-500 dark:text-stone-400">
              <Lock className="w-3.5 h-3.5 mt-[3px] shrink-0" />
              <span>Acesso restrito à equipe contábil. Por segurança, a sessão termina após 30 minutos sem uso.</span>
            </p>
          </div>
        </main>

        <footer className="flex items-center justify-between gap-4 px-8 h-14 text-[11px] text-stone-400">
          <span>© {new Date().getFullYear()} ContaFlow</span>
          <span className="font-mono tabular-nums">{versionLabel(APP_VERSION)}</span>
        </footer>
      </div>
    </div>
  );
}
