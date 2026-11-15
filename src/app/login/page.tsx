'use client';

import React, { useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { secondFactorMessage } from '@/lib/auth/two-factor';
import { APP_VERSION, versionLabel } from '@/lib/app-version';
import { AlertCircle, ArrowLeft, ArrowRight, ArrowUpFromLine, Check, CheckCircle2, Clock, Eye, EyeOff, KeyRound, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react';
import { reportError } from '@/lib/monitoring';
import { Brand } from '@/components/ui/BrandMark';

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

type FieldName = 'email' | 'password' | 'code';

const LABEL = 'block text-[12.5px] font-medium text-stone-700 dark:text-stone-300';

/** Campo com ícone à esquerda; o ícone vem depois do <input> no HTML para acompanhar o foco (`peer`). */
const FIELD =
  'peer w-full h-12 pl-11 pr-4 rounded-[14px] bg-surface border border-line-strong text-[15px] tracking-tight text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-500 outline-none shadow-[inset_0_1px_2px_rgba(28,25,23,0.035)] transition-[border-color,box-shadow] duration-150 hover:border-stone-400/70 dark:hover:border-white/25 focus:border-accent/70 focus:shadow-[0_0_0_4px_rgba(181,85,47,0.14)] aria-invalid:border-rose-400 dark:aria-invalid:border-rose-500/70 aria-invalid:focus:shadow-[0_0_0_4px_rgba(225,29,72,0.12)]';

const FIELD_ICON =
  'pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-stone-400 transition-colors duration-150 peer-focus:text-accent-ink';

const PRIMARY =
  'group w-full h-12 rounded-[14px] bg-linear-to-b from-[#C4623A] to-accent text-white text-[15px] font-medium tracking-tight flex items-center justify-center gap-2 shadow-accent hover:from-[#B85930] hover:to-accent-hover active:scale-[0.985] disabled:opacity-60 disabled:pointer-events-none transition-all duration-150';

const LINK = 'text-[12.5px] font-medium text-accent-ink hover:underline underline-offset-4 disabled:opacity-60 transition-colors';

const BANNER = 'mb-4 flex items-start gap-2.5 px-3.5 py-3 rounded-[14px] border text-[13px] animate-fade-in';

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Cumprimento pela hora do computador. A tela só monta no navegador (depois da checagem de sessão). */
const greetingNow = (): string => {
  const hour = new Date().getHours();
  return hour >= 5 && hour < 12 ? 'Bom dia' : hour >= 12 && hour < 18 ? 'Boa tarde' : 'Boa noite';
};
const noSubscription = () => () => {};

const STATEMENT: Array<{ day: string; memo: string; amount: string; credit: boolean; status: string; tone: string }> = [
  { day: '14/10', memo: 'PIX recebido · Padaria Aurora', amount: '+ 1.250,00', credit: true, status: 'Regra', tone: 'bg-[#D97757]/12 text-[#A84E30]' },
  { day: '15/10', memo: 'Tarifa de manutenção de conta', amount: '− 32,90', credit: false, status: 'Regra', tone: 'bg-[#D97757]/12 text-[#A84E30]' },
  { day: '16/10', memo: 'DARF Simples Nacional', amount: '− 486,12', credit: false, status: 'Sugestão', tone: 'bg-stone-900/6 text-stone-600' },
];

/** Os passos do mês, na mesma ordem do menu (seção "Rotina do mês"). */
const ROUTINE = [
  { title: 'Conciliar', text: 'Extrato importado e classificado.' },
  { title: 'Completar', text: 'Notas, folha, bens e ajustes.' },
  { title: 'Fechar', text: 'Competência travada e auditada.' },
  { title: 'Demonstrar', text: 'Balanço, DRE e livros prontos.' },
];

/** Painel de apresentação: folha de conciliação sobre a capa escura de livro-razão e a rotina do mês em ordem. */
function Showcase() {
  return (
    <aside className="hidden lg:block p-3 pl-0">
      <div className="relative h-full min-h-[560px] flex flex-col justify-between gap-8 overflow-hidden rounded-[28px] px-12 py-12 xl:px-16 xl:py-14 bg-[#1B1917] text-stone-100 ring-1 ring-inset ring-white/6 shadow-[0_30px_60px_-30px_rgba(28,25,23,0.55)]">
        {/* Brilho em terracota, pautas de livro contábil e a margem */}
        <div aria-hidden className="pointer-events-none absolute -top-48 -right-40 w-[680px] h-[680px] rounded-full bg-[radial-gradient(closest-side,rgba(217,119,87,0.24),transparent)]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-64 -left-48 w-[620px] h-[620px] rounded-full bg-[radial-gradient(closest-side,rgba(217,119,87,0.10),transparent)]" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_35px,rgba(255,255,255,0.045)_35px,rgba(255,255,255,0.045)_36px)] mask-[linear-gradient(to_bottom,black,transparent_85%)]"
        />
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-8 xl:left-10 w-px bg-[#D97757]/30" />

        <div className="relative max-w-[560px] space-y-5">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#E89A7E]">
            <span aria-hidden className="w-1.5 h-1.5 rotate-45 bg-[#D97757]" />
            Conciliação e demonstrações
          </p>
          <p className="font-serif text-[44px] xl:text-[54px] leading-[1.04] tracking-tight text-[#F6F4EE]">
            Do extrato ao balanço, <span className="italic text-[#E89A7E]">sem perder o fio.</span>
          </p>
          <p className="text-[15px] leading-relaxed text-stone-400 max-w-[460px] [@media(max-height:780px)]:hidden">
            O que entra pelo banco vira partida dobrada, as regras lembram das suas escolhas e o mês fecha com as demonstrações prontas para assinar.
          </p>
        </div>

        {/* Exemplo: as linhas do extrato viram lançamentos contábeis */}
        <div className="relative max-w-[560px]">
          <div aria-hidden className="absolute inset-x-5 -bottom-3 h-10 rounded-[22px] bg-[#F6F4EE]/25" />
          <div aria-hidden className="absolute inset-x-2.5 -bottom-1.5 h-10 rounded-[22px] bg-[#F6F4EE]/50" />
          <figure className="relative rounded-[22px] bg-[#FBFAF6] text-stone-900 shadow-[0_1px_0_rgba(255,255,255,0.6)_inset,0_30px_60px_-20px_rgba(0,0,0,0.6)] overflow-hidden">
            <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-stone-900/8">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-stone-500">Extrato · Outubro</p>
              <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-emerald-700">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />3 de 3 classificados
              </p>
            </div>
            <ul className="divide-y divide-stone-900/6">
              {STATEMENT.map((row) => (
                <li key={row.day} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                  <span className="font-mono tabular-nums text-[12px] text-stone-500">{row.day}</span>
                  <span className="flex-1 min-w-0 truncate font-medium tracking-tight">{row.memo}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${row.tone}`}>{row.status}</span>
                  <span className={`w-[84px] text-right font-mono tabular-nums ${row.credit ? 'text-emerald-700' : 'text-stone-700'}`}>{row.amount}</span>
                </li>
              ))}
            </ul>
            <div className="px-5 py-3.5 bg-[#F3F1EA] border-t border-stone-900/8 space-y-2.5">
              <dl className="space-y-1.5 font-mono tabular-nums text-[12.5px]">
                {[
                  ['D', '1.1.1.02', 'Bancos Conta Movimento'],
                  ['C', '3.1.1.01', 'Receita de Prestação de Serviços'],
                ].map(([side, code, name]) => (
                  <div key={code} className="flex items-center gap-3">
                    <dt className="w-4 font-semibold text-[#A84E30]">{side}</dt>
                    <dd className="flex-1 min-w-0 truncate text-stone-700">
                      <span className="text-stone-400">{code}</span> {name}
                    </dd>
                    <dd className="text-stone-700">1.250,00</dd>
                  </div>
                ))}
              </dl>
              <figcaption className="flex items-center justify-between gap-3 pt-2.5 border-t-[3px] border-double border-stone-900/12">
                <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[#A84E30]">
                  <Check className="w-3.5 h-3.5" strokeWidth={2.25} />
                  Conciliado pela regra “Padaria Aurora”
                </span>
                <span className="font-mono text-[11px] text-stone-500">débito = crédito</span>
              </figcaption>
            </div>
          </figure>
        </div>

        {/* A rotina do mês: os mesmos passos, na mesma ordem, do menu do sistema */}
        <div className="relative">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">A rotina do mês</p>
          <ol className="grid grid-cols-4 gap-5">
            {ROUTINE.map(({ title, text }, i) => (
              <li key={title} className="relative space-y-2.5">
                {/* Fio que liga um passo ao seguinte */}
                {i < ROUTINE.length - 1 && <span aria-hidden className="absolute top-3 left-9 -right-3 h-px bg-white/12" />}
                <span className="relative flex w-6 h-6 items-center justify-center rounded-full bg-[#D97757]/16 ring-1 ring-inset ring-[#D97757]/40 font-mono text-[11px] font-semibold text-[#E89A7E]">
                  {i + 1}
                </span>
                <p className="text-[13px] font-medium tracking-tight text-stone-100">{title}</p>
                <p className="text-[12px] leading-snug text-stone-500 [@media(max-height:780px)]:hidden">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </aside>
  );
}

export default function LoginPage() {
  const { signIn, isMockAuth, authError, sessionNotice, secondFactorPending, confirmSecondFactor, cancelSecondFactor, resetPassword } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** Campo a que o erro se refere: recebe o foco e a marca de inválido. */
  const [invalid, setInvalid] = useState<FieldName | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const greeting = useSyncExternalStore(noSubscription, greetingNow, () => 'Bem-vindo de volta');

  /** Mostra o erro e leva o foco ao campo que precisa de correção. */
  const fail = (message: string, field: FieldName | null = null) => {
    setErrorMessage(message);
    setInvalid(field);
    const target = field === 'email' ? emailRef : field === 'password' ? passwordRef : field === 'code' ? codeRef : null;
    target?.current?.focus();
  };
  const clearError = () => {
    setErrorMessage(null);
    setInvalid(null);
  };

  /** Segunda etapa: código de 6 dígitos do aplicativo autenticador. */
  const verify = async (digits: string) => {
    if (loading) return;
    if (digits.length !== 6) {
      fail('Informe os 6 dígitos do aplicativo autenticador.', 'code');
      return;
    }
    setLoading(true);
    clearError();
    try {
      await confirmSecondFactor(digits);
    } catch (err: unknown) {
      reportError(err, { area: 'login', op: 'verificação em duas etapas' });
      setCode('');
      fail(secondFactorMessage(err), 'code');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    clearError();
    setNotice(null);
    const address = email.trim();
    if (!EMAIL_SHAPE.test(address)) {
      fail('Informe seu e-mail no campo abaixo para receber o link de redefinição.', 'email');
      return;
    }
    setLoading(true);
    try {
      await resetPassword(address);
      // A mesma mensagem exista ou não a conta: a tela não revela quais e-mails têm cadastro.
      setNotice(`Se houver uma conta para ${address}, enviamos um link para redefinir a senha. Confira também a caixa de spam.`);
    } catch (err: unknown) {
      reportError(err, { area: 'login', op: 'redefinir senha' });
      const failure = errorCode(err);
      if (failure === 'auth/user-not-found') {
        setNotice(`Se houver uma conta para ${address}, enviamos um link para redefinir a senha. Confira também a caixa de spam.`);
      } else {
        fail(
          failure === 'auth/too-many-requests' || failure === 'auth/network-request-failed' || failure === 'auth/invalid-email'
            ? friendlyError(failure)
            : 'Não foi possível enviar o e-mail de redefinição. Tente de novo em instantes.',
          failure === 'auth/invalid-email' ? 'email' : null
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.SubmitEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address || !password) {
      fail(!address && !password ? 'Informe e-mail e senha.' : !address ? 'Informe o e-mail.' : 'Informe a senha.', address ? 'password' : 'email');
      return;
    }
    setLoading(true);
    clearError();
    setNotice(null);
    try {
      // O redirecionamento acontece no ProtectedRoute assim que o escritório do usuário é resolvido.
      await signIn(address, password);
    } catch (err: unknown) {
      reportError(err, { area: 'login', op: 'entrar' });
      const failure = errorCode(err);
      fail(friendlyError(failure), failure === 'auth/invalid-email' ? 'email' : null);
    } finally {
      setLoading(false);
    }
  };

  const trackCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState('CapsLock'));

  const error = errorMessage ?? authError;

  return (
    <div className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-[minmax(460px,540px)_minmax(0,1fr)] bg-canvas text-stone-900 dark:text-stone-100">
      <div className="relative flex flex-col min-h-screen">
        <header className="px-8 sm:px-12 pt-8">
          <Brand size="md" />
        </header>

        <main className="flex-1 flex items-center justify-center px-8 sm:px-12 py-10">
          <div className="w-full max-w-[380px] animate-sheet-in">
            <div className="mb-7">
              <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-ink">
                <span aria-hidden className="w-1.5 h-1.5 rotate-45 bg-accent" />
                {secondFactorPending ? 'Verificação em duas etapas' : 'Acesso do escritório'}
              </p>
              <h1 className="font-serif text-[40px] leading-[1.05] tracking-tight">{secondFactorPending ? 'Só mais um passo' : greeting}</h1>
              <p className="mt-2.5 text-[14.5px] leading-relaxed text-stone-500 dark:text-stone-400">
                {secondFactorPending ? 'Abra o aplicativo autenticador e informe o código de 6 dígitos do ContaFlow.' : 'Entre com o e-mail e a senha do escritório para continuar.'}
              </p>
            </div>

            {error && (
              <div id="login-error" role="alert" className={`${BANNER} bg-rose-50 dark:bg-rose-950/30 border-rose-200/70 dark:border-rose-900/50 text-rose-700 dark:text-rose-300`}>
                <AlertCircle className="w-4 h-4 mt-px shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {sessionNotice && !notice && !error && (
              <div role="status" className={`${BANNER} bg-[#D97757]/8 dark:bg-[#D97757]/12 border-[#D97757]/25 text-[#8F4128] dark:text-[#E89A7E]`}>
                <Clock className="w-4 h-4 mt-px shrink-0" />
                <span>{sessionNotice}</span>
              </div>
            )}

            {notice && (
              <div role="status" className={`${BANNER} bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200/70 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300`}>
                <CheckCircle2 className="w-4 h-4 mt-px shrink-0" />
                <span>{notice}</span>
              </div>
            )}

            {secondFactorPending ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void verify(code);
                }}
                noValidate
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <label htmlFor="code" className={LABEL}>
                    Código de verificação
                  </label>
                  <div className="relative">
                    <input
                      id="code"
                      ref={codeRef}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoFocus
                      maxLength={6}
                      value={code}
                      aria-invalid={invalid === 'code' || undefined}
                      aria-describedby={invalid === 'code' ? 'login-error' : undefined}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                        setCode(digits);
                        if (invalid === 'code') clearError();
                        // Com os 6 dígitos, confere sem precisar do botão.
                        if (digits.length === 6) void verify(digits);
                      }}
                      placeholder="000000"
                      className={`${FIELD} font-mono tabular-nums text-[17px] tracking-[0.35em]`}
                    />
                    <KeyRound aria-hidden className={FIELD_ICON} strokeWidth={1.75} />
                  </div>
                </div>
                <button type="submit" disabled={loading} className={PRIMARY}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verificar'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    cancelSecondFactor();
                    setCode('');
                    clearError();
                  }}
                  className="mx-auto flex items-center gap-1.5 text-[13px] text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Voltar para e-mail e senha
                </button>
              </form>
            ) : (
              <form onSubmit={handleSubmit} noValidate className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="email" className={LABEL}>
                    E-mail
                  </label>
                  <div className="relative">
                    <input
                      id="email"
                      ref={emailRef}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      autoFocus
                      value={email}
                      aria-invalid={invalid === 'email' || undefined}
                      aria-describedby={invalid === 'email' ? 'login-error' : undefined}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (invalid === 'email') setInvalid(null);
                      }}
                      placeholder="voce@escritorio.com.br"
                      className={FIELD}
                    />
                    <Mail aria-hidden className={FIELD_ICON} strokeWidth={1.75} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <label htmlFor="password" className={LABEL}>
                      Senha
                    </label>
                    {!isMockAuth && (
                      <button type="button" disabled={loading} onClick={() => void handleReset()} className={LINK}>
                        Esqueci minha senha
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      id="password"
                      ref={passwordRef}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      aria-invalid={invalid === 'password' || undefined}
                      aria-describedby={invalid === 'password' ? 'login-error' : capsLock ? 'caps-lock-hint' : undefined}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (invalid === 'password') setInvalid(null);
                      }}
                      onKeyDown={trackCapsLock}
                      onKeyUp={trackCapsLock}
                      onBlur={() => setCapsLock(false)}
                      placeholder="Sua senha"
                      className={`${FIELD} pr-12`}
                    />
                    <Lock aria-hidden className={FIELD_ICON} strokeWidth={1.75} />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                      aria-pressed={showPassword}
                      title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 rounded-[10px] text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-900/5 dark:hover:bg-white/8 active:scale-[0.92] transition-all duration-150"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {capsLock && (
                    <p id="caps-lock-hint" className="flex items-center gap-1.5 text-[12px] text-amber-700 dark:text-amber-400 animate-fade-in">
                      <ArrowUpFromLine className="w-3.5 h-3.5" />
                      Caps Lock está ligado.
                    </p>
                  )}
                </div>

                <button type="submit" disabled={loading} className={`${PRIMARY} mt-1`}>
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

            {isMockAuth && !secondFactorPending && (
              <button
                type="button"
                onClick={() => {
                  setEmail('admin@contaflow.com.br');
                  setPassword('contaflow123');
                  clearError();
                }}
                className="mt-3 w-full h-11 rounded-[14px] border border-dashed border-line-strong text-[13px] text-stone-600 dark:text-stone-300 hover:border-accent/50 hover:text-accent-ink hover:bg-accent/5 active:scale-[0.98] transition-all duration-150"
              >
                Usar credenciais de teste local
              </button>
            )}

            <p className="mt-8 pt-5 border-t-[3px] border-double border-line-strong flex items-start gap-2.5 text-[12px] leading-relaxed text-stone-500 dark:text-stone-400">
              <ShieldCheck className="w-4 h-4 mt-px shrink-0 text-stone-400" strokeWidth={1.75} />
              <span>Acesso restrito à equipe contábil. Por segurança, a sessão termina após 30 minutos sem uso.</span>
            </p>
          </div>
        </main>

        <footer className="flex items-center justify-between gap-4 px-8 sm:px-12 h-14 text-[11px] text-stone-500 dark:text-stone-400">
          <span>© {new Date().getFullYear()} ContaFlow</span>
          <span className="font-mono tabular-nums">{versionLabel(APP_VERSION)}</span>
        </footer>
      </div>

      <Showcase />
    </div>
  );
}
