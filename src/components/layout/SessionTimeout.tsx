'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { BUTTON } from '@/components/ui/primitives';
import { LAST_ACTIVITY_KEY, readLastActivity, sessionStatus, writeLastActivity, type SessionEndReason } from '@/lib/auth/session-policy';

/** Uso da tela que mantém a sessão ativa. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'mousemove', 'wheel', 'touchstart', 'scroll'] as const;
/** Intervalo mínimo entre gravações do último uso (o relógio da aba guarda o valor exato). */
const RECORD_EVERY_MS = 15_000;

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * Encerra a sessão após 30 minutos sem uso ou 12 horas depois do login (ver session-policy), com
 * aviso antes. A conferência roda a cada segundo e também ao voltar para a aba (o computador pode
 * ter dormido) ou quando outra aba registra uso.
 */
export function SessionTimeout() {
  const { user, signedInAt, signOut } = useAuth();
  const [view, setView] = useState<{ warning: SessionEndReason; seconds: number } | null>(null);
  // Aviso do limite de 12 horas dispensado nesta sessão (identificada pelo momento do login).
  const [dismissedFor, setDismissedFor] = useState<number | null>(null);
  const lastActivity = useRef(0);
  const ending = useRef(false);
  // `signOut` muda a cada render do AuthProvider; como dependência, reiniciaria a contagem sem uso real.
  const signOutRef = useRef(signOut);
  useEffect(() => {
    signOutRef.current = signOut;
  });

  useEffect(() => {
    if (!user || signedInAt === null) return;
    ending.current = false;
    lastActivity.current = Date.now();
    writeLastActivity(lastActivity.current);

    const check = () => {
      if (ending.current) return;
      const s = sessionStatus(signedInAt, Math.max(readLastActivity() ?? 0, lastActivity.current), Date.now());
      if (s.expired) {
        ending.current = true;
        setView(null);
        void signOutRef.current(s.expired);
        return;
      }
      setView(s.warning ? { warning: s.warning, seconds: Math.ceil(s.remainingMs / 1000) } : null);
    };

    let lastWrite = 0;
    const onActivity = () => {
      const now = Date.now();
      lastActivity.current = now;
      if (now - lastWrite >= RECORD_EVERY_MS) {
        lastWrite = now;
        writeLastActivity(now);
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === LAST_ACTIVITY_KEY) check();
    };

    const timer = window.setInterval(check, 1000);
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { passive: true, capture: true });
    document.addEventListener('visibilitychange', check);
    window.addEventListener('storage', onStorage);
    return () => {
      window.clearInterval(timer);
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity, { capture: true });
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('storage', onStorage);
    };
  }, [user, signedInAt]);

  if (!user || !view || (view.warning === 'max' && dismissedFor === signedInAt)) return null;

  const idle = view.warning === 'idle';
  const keepAlive = () => {
    lastActivity.current = Date.now();
    writeLastActivity(lastActivity.current);
    setView(null);
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-timeout-title"
      aria-describedby="session-timeout-text"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in print:hidden"
    >
      <div className="w-full max-w-sm rounded-[24px] bg-white dark:bg-stone-900 border border-black/[0.08] dark:border-white/[0.10] shadow-[0_24px_60px_rgba(0,0,0,0.25)] p-6 space-y-4">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 shrink-0 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 flex items-center justify-center">
            <Clock className="w-[18px] h-[18px]" />
          </span>
          <div className="min-w-0 space-y-1">
            <h2 id="session-timeout-title" className="text-[15px] font-semibold tracking-tight">
              {idle ? 'Você ainda está aí?' : 'A sessão está terminando'}
            </h2>
            <p id="session-timeout-text" className="text-[13px] text-stone-600 dark:text-stone-400">
              {idle ? (
                <>
                  Por inatividade, a sessão será encerrada em <span className="font-mono tabular-nums font-medium text-stone-900 dark:text-stone-100">{clock(view.seconds)}</span>.
                </>
              ) : (
                <>
                  Por segurança, a sessão dura no máximo 12 horas e termina em{' '}
                  <span className="font-mono tabular-nums font-medium text-stone-900 dark:text-stone-100">{clock(view.seconds)}</span>. Salve o que estiver fazendo; depois,
                  entre novamente.
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => void signOut()} className={BUTTON.secondary}>
            Sair agora
          </button>
          {idle ? (
            <button type="button" autoFocus onClick={keepAlive} className={BUTTON.primary}>
              Continuar conectado
            </button>
          ) : (
            <button type="button" autoFocus onClick={() => setDismissedFor(signedInAt)} className={BUTTON.primary}>
              Entendi
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
