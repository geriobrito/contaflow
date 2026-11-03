import * as Sentry from '@sentry/nextjs';
import { SENTRY_DSN, sentryOptions } from '@/lib/monitoring';

// Monitoramento de erros no navegador (src/lib/monitoring). Sem DSN, nada é iniciado.
if (SENTRY_DSN) Sentry.init(sentryOptions());

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
