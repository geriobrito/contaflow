'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { BUTTON, PAGE, SURFACE } from '@/components/ui/primitives';

/**
 * Erro inesperado numa tela: em vez de a página ficar em branco, mostra o que houve e
 * deixa tentar de novo. O menu lateral continua disponível (o layout fica fora deste limite).
 */
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error('Erro inesperado na tela:', error);
  }, [error]);

  return (
    <main className={PAGE}>
      <section role="alert" className={`${SURFACE} rounded-[22px] px-6 py-14 text-center`}>
        <span className="mx-auto w-12 h-12 rounded-full flex items-center justify-center bg-rose-100/80 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400">
          <AlertTriangle className="w-6 h-6" strokeWidth={1.75} />
        </span>
        <h1 className="mt-4 text-[19px] font-semibold tracking-tight text-stone-900 dark:text-stone-50">Esta tela encontrou um erro</h1>
        <p className="mt-2 text-[14px] text-stone-600 dark:text-stone-300 max-w-md mx-auto">
          Nada foi gravado pela metade por causa disto. Tente de novo; se o erro continuar, anote a mensagem abaixo.
        </p>
        {error.message && (
          <p className="mt-4 mx-auto max-w-xl px-4 py-2.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] font-mono text-[12px] text-stone-600 dark:text-stone-300 break-words">
            {error.message}
            {error.digest && <span className="block mt-1 text-stone-400">ref. {error.digest}</span>}
          </p>
        )}
        <div className="mt-6 flex justify-center">
          <button type="button" onClick={() => retry()} className={BUTTON.primary}>
            Tentar de novo
          </button>
        </div>
      </section>
    </main>
  );
}
