import * as Sentry from '@sentry/nextjs';
import { isPermissionDenied } from '@/lib/utils/errors';
import { keepBreadcrumb, scrubEvent } from '@/lib/monitoring/scrub';

/**
 * Monitoramento de erros (Sentry). Sem `NEXT_PUBLIC_SENTRY_DSN` não envia nada: desenvolvimento,
 * modo local e testes E2E ficam de fora. Os eventos saem pela rota do próprio app (`/monitoring`,
 * o túnel), então a CSP segue com `connect-src 'self'`, e passam pela limpeza de scrub.ts.
 */
export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? '';

/** Rota do túnel (a mesma de `tunnelRoute` em next.config.ts). */
export const SENTRY_TUNNEL_ROUTE = '/monitoring';

/** Opções comuns ao navegador e ao servidor. */
export function sentryOptions(): Parameters<typeof Sentry.init>[0] {
  return {
    dsn: SENTRY_DSN || undefined,
    enabled: Boolean(SENTRY_DSN),
    environment: process.env.NEXT_PUBLIC_APP_ENV || undefined,
    release: process.env.NEXT_PUBLIC_APP_COMMIT || undefined,
    // Nada de dados do usuário, cookies, cabeçalhos, consulta da URL, corpos de requisição nem
    // variáveis da pilha; sem gravação de sessão nem rastreamento de desempenho.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
    },
    tracesSampleRate: 0,
    maxBreadcrumbs: 20,
    beforeBreadcrumb: (crumb) => keepBreadcrumb(crumb),
    beforeSend: (event) => scrubEvent(event),
  };
}

/** Recusas que são erro de digitação do usuário, não falha do sistema: não vão ao monitoramento. */
const USER_INPUT_CODES = new Set([
  'auth/invalid-credential',
  'auth/wrong-password',
  'auth/user-not-found',
  'auth/invalid-email',
  'auth/missing-password',
  'auth/too-many-requests',
  'auth/invalid-verification-code',
  'auth/missing-code',
  'auth/code-expired',
  'auth/network-request-failed',
]);

const codeOf = (e: unknown): string | undefined => {
  const code = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : undefined;
};

export interface ErrorContext {
  /** Parte do app (ex.: 'importacao', 'dre', 'clientes'). */
  area: string;
  /** O que estava sendo feito (ex.: 'carregar', 'excluir lançamento'). */
  op?: string;
  /** 'warning' para falhas contornadas (o app seguiu por outro caminho). */
  level?: 'error' | 'warning';
}

/** Tipo da falha, para filtrar no Sentry: recusa das regras, importação ou erro comum. */
export function errorKind(error: unknown, area: string): 'regra' | 'importacao' | 'erro' {
  if (isPermissionDenied(error)) return 'regra';
  return area === 'importacao' ? 'importacao' : 'erro';
}

/**
 * Ponto único de registro de erros: escreve no console (como antes) e envia ao Sentry com as
 * etiquetas `area`, `op` e `kind`. Erros de digitação no login não são enviados.
 */
export function reportError(error: unknown, context: ErrorContext): void {
  const label = context.op ? `${context.area} · ${context.op}` : context.area;
  if (context.level === 'warning') console.warn(`[${label}]`, error);
  else console.error(`[${label}]`, error);

  const code = codeOf(error);
  if (code && USER_INPUT_CODES.has(code)) return;
  Sentry.withScope((scope) => {
    scope.setLevel(context.level ?? 'error');
    scope.setTag('area', context.area);
    if (context.op) scope.setTag('op', context.op);
    scope.setTag('kind', errorKind(error, context.area));
    if (code) scope.setTag('code', code);
    Sentry.captureException(error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'erro sem mensagem'));
  });
}

/** Usuário do escopo: só o uid (nunca e-mail). */
export function setMonitoringUser(uid: string | null): void {
  Sentry.setUser(uid ? { id: uid } : null);
}
