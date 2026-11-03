import * as Sentry from '@sentry/nextjs';

/** Monitoramento de erros no servidor (rotas de API e renderização). Sem DSN, nada é iniciado. */
export async function register() {
  const { SENTRY_DSN, sentryOptions } = await import('@/lib/monitoring');
  if (SENTRY_DSN) Sentry.init(sentryOptions());
}

export const onRequestError = Sentry.captureRequestError;
