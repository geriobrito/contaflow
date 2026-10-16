'use client';

import React, { useReducer, useState } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import type { TotpSecret } from 'firebase/auth';
import { useAuth } from '@/contexts/AuthContext';
import {
  enrolledAuthenticators,
  finishAuthenticatorEnrollment,
  removeAuthenticators,
  secondFactorMessage,
  sendVerificationEmail,
  startAuthenticatorEnrollment,
} from '@/lib/auth/two-factor';
import { BUTTON, ConfirmButton, Field, INPUT, SURFACE } from '@/components/ui/primitives';

/** Chave em grupos de 4, como os aplicativos autenticadores mostram. */
const grouped = (key: string) => key.replace(/(.{4})/g, '$1 ').trim();

/**
 * Verificação em duas etapas da conta de quem está logado: cadastro e remoção do aplicativo
 * autenticador (TOTP). Não aparece no modo local, que não tem contas de verdade.
 */
export function TwoFactorSection() {
  const { user, isMockAuth } = useAuth();
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [secret, setSecret] = useState<TotpSecret | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (isMockAuth || !user) return null;
  const enrolled = enrolledAuthenticators(user).length > 0;

  /** Executa uma operação da conta mostrando o resultado; devolve se deu certo. */
  const run = async (action: () => Promise<void>, done?: string): Promise<boolean> => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (done) setMessage({ ok: true, text: done });
      return true;
    } catch (e) {
      console.error('Erro na verificação em duas etapas:', e);
      setMessage({ ok: false, text: secondFactorMessage(e) });
      return false;
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const start = () => run(async () => setSecret(await startAuthenticatorEnrollment(user)));

  const confirm = async () => {
    if (!secret || code.length !== 6) return;
    const ok = await run(() => finishAuthenticatorEnrollment(user, secret, code), 'Verificação em duas etapas ativada. O código será pedido a cada login.');
    setCode('');
    if (ok) setSecret(null);
  };

  return (
    <section className={`${SURFACE} rounded-[22px] p-7 max-w-3xl space-y-4`} aria-label="Verificação em duas etapas">
      <div className="flex items-start gap-3">
        <span
          className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center ${
            enrolled ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700' : 'bg-black/[0.05] dark:bg-white/[0.08] text-stone-500'
          }`}
        >
          {enrolled ? <ShieldCheck className="w-4 h-4" /> : <ShieldOff className="w-4 h-4" />}
        </span>
        <div className="flex-1 min-w-0 space-y-1">
          <h2 className="text-[15px] font-semibold tracking-tight">Verificação em duas etapas</h2>
          <p className="text-[13px] text-stone-600 dark:text-stone-300">
            {enrolled
              ? `Ativada para ${user.email ?? 'esta conta'}: além da senha, o login pede o código do aplicativo autenticador.`
              : 'Além da senha, o login passa a pedir um código de 6 dígitos gerado por um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy…) no seu celular.'}
          </p>
        </div>
        {enrolled && (
          <ConfirmButton
            ariaLabel="Desativar a verificação em duas etapas"
            label={<ShieldOff className="w-3.5 h-3.5" />}
            confirmLabel="Desativar"
            onConfirm={() => void run(() => removeAuthenticators(user), 'Verificação em duas etapas desativada.')}
          />
        )}
      </div>

      {!enrolled && !user.emailVerified && (
        <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 px-4 py-3 space-y-2 text-[13px] text-amber-800 dark:text-amber-300">
          <p>O Firebase exige o e-mail confirmado antes de ativar. Envie o e-mail de verificação, abra o link recebido e volte aqui.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void run(() => sendVerificationEmail(user), `E-mail de verificação enviado para ${user.email ?? 'sua conta'}.`)} className={`${BUTTON.secondary} h-8`}>
              Enviar e-mail de verificação
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await user.reload();
                  await user.getIdToken(true);
                })
              }
              className={`${BUTTON.ghost} h-8`}
            >
              Já confirmei
            </button>
          </div>
        </div>
      )}

      {!enrolled && !secret && (
        <button type="button" disabled={busy || !user.emailVerified} onClick={() => void start()} className={BUTTON.accent}>
          {busy ? 'Aguarde…' : 'Ativar com aplicativo autenticador'}
        </button>
      )}

      {!enrolled && secret && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void confirm();
          }}
        >
          <ol className="space-y-3 text-[13px] text-stone-600 dark:text-stone-300 list-decimal pl-5">
            <li>
              No aplicativo autenticador, adicione uma conta escolhendo <b>inserir chave de configuração</b> (tipo: baseada em tempo) e digite:
              <p className="mt-2 px-3.5 py-2.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] font-mono text-[14px] tracking-wider text-stone-900 dark:text-stone-100 break-all select-all">
                {grouped(secret.secretKey)}
              </p>
              <a href={secret.generateQrCodeUrl(user.email ?? 'conta', 'ContaFlow')} className="mt-1.5 inline-block text-[12px] text-accent-ink hover:underline">
                Ou abra direto no aplicativo deste aparelho
              </a>
            </li>
            <li>Digite abaixo o código de 6 dígitos que o aplicativo passou a mostrar.</li>
          </ol>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-44">
              <Field label="Código">
                <input
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className={`${INPUT} font-mono tabular-nums tracking-[0.3em]`}
                />
              </Field>
            </div>
            <button type="submit" disabled={busy || code.length !== 6} className={`${BUTTON.accent} h-11 px-6`}>
              {busy ? 'Confirmando…' : 'Confirmar'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setSecret(null);
                setCode('');
                setMessage(null);
              }}
              className={`${BUTTON.ghost} h-11`}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`text-[13px] ${message.ok ? 'text-emerald-700' : 'text-rose-600'}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
