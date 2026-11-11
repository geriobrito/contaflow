'use client';

import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { secondFactorMessage } from '@/lib/auth/two-factor';
import { APP_VERSION, versionLabel } from '@/lib/app-version';
import { AlertCircle, ArrowRight, Check, CheckCircle2, Clock, Eye, EyeOff, FileSpreadsheet, Loader2, Lock, Scale, Wand2 } from 'lucide-react';
import { reportError } from '@/lib/monitoring';
import { BrandMark } from '@/components/ui/BrandMark';

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
  'peer w-full h-14 px-4 pt-5 pb-1.5 rounded-2xl bg-surface border border-line-strong text-[15px] tracking-tight text-stone-900 dark:text-stone-100 placeholder-transparent outline-none shadow-[0_1px_2px_rgba(28,25,23,0.04)] transition-all duration-150 hover:border-stone-900/25 dark:hover:border-white/22 focus:border-accent/60 focus:shadow-[0_0_0_4px_rgba(217,119,87,0.16)]';

const FLOAT_LABEL =
  'pointer-events-none absolute left-4 top-1.5 text-[11px] font-medium text-stone-500 transition-all duration-150 peer-placeholder-shown:top-[17px] peer-placeholder-shown:text-[15px] peer-placeholder-shown:font-normal peer-placeholder-shown:text-stone-400 peer-focus:top-1.5 peer-focus:text-[11px] peer-focus:font-medium peer-focus:text-accent-ink';

const PRIMARY =
  'group w-full h-12 rounded-2xl bg-linear-to-b from-stone-800 to-stone-950 dark:from-white dark:to-[#EDEBE3] text-white dark:text-stone-900 text-[15px] font-medium tracking-tight flex items-center justify-center gap-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(28,25,23,0.3),0_10px_24px_-8px_rgba(28,25,23,0.35)] hover:from-stone-700 hover:to-stone-900 dark:hover:from-white dark:hover:to-white active:scale-[0.98] disabled:opacity-60 transition-all duration-150';

const LINK = 'text-[13px] text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 disabled:opacity-60 transition-colors';

const STATEMENT: Array<{ day: string; memo: string; amount: string; credit: boolean; status: string; tone: string }> = [
  { day: '14/10', memo: 'PIX recebido · Padaria Aurora', amount: '+ 1.250,00', credit: true, status: 'Regra', tone: 'bg-[#D97757]/12 text-[#A84E30]' },
  { day: '15/10', memo: 'Tarifa de manutenção de conta', amount: '− 32,90', credit: false, status: 'Regra', tone: 'bg-[#D97757]/12 text-[#A84E30]' },
  { day: '16/10', memo: 'DARF Simples Nacional', amount: '− 486,12', credit: false, status: 'Sugestão', tone: 'bg-stone-900/6 text-stone-600' },
];

const PILLARS = [
  { icon: FileSpreadsheet, title: 'Extrato OFX', text: 'Importe e concilie em minutos.' },
  { icon: Wand2, title: 'Regras que aprendem', text: 'Cada escolha vira automação.' },
  { icon: Scale, title: 'Demonstrações', text: 'DRE, Balanço e DLPA prontos.' },
];

/** Painel de apresentação: capa escura de livro-razão com uma folha de conciliação por cima. */
function Showcase() {
  return (
    <aside className="relative flex flex-col justify-between gap-10 overflow-hidden p-12 xl:p-16 bg-[#1B1917] text-stone-100 dark:border-r dark:border-white/6">
      {/* Brilho em terracota, pautas de livro contábil e a margem */}
      <div aria-hidden className="pointer-events-none absolute -top-40 -left-40 w-[640px] h-[640px] rounded-full bg-[radial-gradient(closest-side,rgba(217,119,87,0.22),transparent)]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-56 right-[-180px] w-[620px] h-[620px] rounded-full bg-[radial-gradient(closest-side,rgba(217,119,87,0.10),transparent)]" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_35px,rgba(255,255,255,0.045)_35px,rgba(255,255,255,0.045)_36px)] mask-[linear-gradient(to_bottom,black,transparent_90%)]"
      />
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-8 xl:left-10 w-px bg-[#D97757]/35" />

      <div className="relative flex items-center gap-2.5">
        <BrandMark size="md" />
        <span className="text-[17px] font-semibold tracking-tight">
          Conta<span className="text-[#E89A7E]">Flow</span>
        </span>
      </div>

      <div className="relative max-w-[540px] space-y-9">
        <div className="space-y-5">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#E89A7E]">
            <span aria-hidden className="w-1.5 h-1.5 rotate-45 bg-[#D97757]" />
            Conciliação contábil
          </p>
          <p className="font-serif text-[52px] xl:text-[60px] leading-[1.02] tracking-tight text-[#F6F4EE]">
            Contabilidade que <span className="italic text-[#E89A7E]">aprende</span> com você.
          </p>
          <p className="text-[15px] leading-relaxed text-stone-400 max-w-[440px]">
            Extratos OFX conciliados em partidas dobradas, regras que lembram das suas escolhas e demonstrações prontas para assinar.
          </p>
        </div>

        {/* Exemplo: as linhas do extrato viram lançamentos contábeis */}
        <div className="relative">
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
                  <span className="font-mono tabular-nums text-[12px] text-stone-400">{row.day}</span>
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
      </div>

      <ul className="relative grid grid-cols-3 gap-6 pt-6 border-t border-white/8">
        {PILLARS.map(({ icon: Icon, title, text }) => (
          <li key={title} className="space-y-1.5">
            <Icon className="w-4 h-4 text-[#E89A7E]" strokeWidth={1.75} />
            <p className="text-[13px] font-medium tracking-tight text-stone-100">{title}</p>
            <p className="text-[12px] leading-snug text-stone-500">{text}</p>
          </li>
        ))}
      </ul>
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
      reportError(err, { area: 'login', op: 'verificação em duas etapas' });
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
      reportError(err, { area: 'login', op: 'redefinir senha' });
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
      reportError(err, { area: 'login', op: 'entrar' });
      setErrorMessage(friendlyError(errorCode(err)));
    } finally {
      setLoading(false);
    }
  };

  const error = errorMessage ?? authError;

  return (
    <div className="min-h-screen w-full min-w-[1080px] grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] bg-canvas text-stone-900 dark:text-stone-100">
      <Showcase />

      <div className="relative flex flex-col min-h-screen">
        <main className="flex-1 flex items-center justify-center px-8 py-10">
          <div className="w-full max-w-[380px] animate-sheet-in">
            <div className="mb-8">
              <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-ink">
                <span aria-hidden className="w-1.5 h-1.5 rotate-45 bg-accent" />
                Acesso do escritório
              </p>
              <h1 className="font-serif text-[38px] leading-[1.05] tracking-tight">{secondFactorPending ? 'Verificação em duas etapas' : 'Bem-vindo de volta'}</h1>
              <p className="mt-2.5 text-[14.5px] text-stone-500 dark:text-stone-400">
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
              <div role="status" className="mb-4 flex items-start gap-2.5 px-3.5 py-3 rounded-2xl bg-[#D97757]/8 dark:bg-[#D97757]/12 border border-[#D97757]/25 text-[13px] text-[#8F4128] dark:text-[#E89A7E] animate-fade-in">
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
                className="mt-3 w-full h-11 rounded-2xl border border-dashed border-line-strong text-[13px] text-stone-600 dark:text-stone-300 hover:border-accent/50 hover:text-accent-ink hover:bg-accent/5 active:scale-[0.98] transition-all duration-150"
              >
                Usar credenciais de teste local
              </button>
            )}

            <p className="mt-8 pt-5 border-t-[3px] border-double border-line-strong flex items-start gap-2 text-[12px] leading-relaxed text-stone-500 dark:text-stone-400">
              <Lock className="w-3.5 h-3.5 mt-[3px] shrink-0" />
              <span>Acesso restrito à equipe contábil. Por segurança, a sessão termina após 30 minutos sem uso.</span>
            </p>
          </div>
        </main>

        <footer className="flex items-center justify-between gap-4 px-8 h-14 border-t border-line text-[11px] text-stone-400">
          <span>© {new Date().getFullYear()} ContaFlow</span>
          <span className="font-mono tabular-nums">{versionLabel(APP_VERSION)}</span>
        </footer>
      </div>
    </div>
  );
}
