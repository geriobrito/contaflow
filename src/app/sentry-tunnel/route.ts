import { createSentryTunnelRoute } from '@sentry/nextjs/tunnel';
import { SENTRY_DSN } from '@/lib/monitoring';

/**
 * Túnel do Sentry: o navegador envia os erros para `/monitoring` (mesma origem; a CSP segue com
 * `connect-src 'self'`) e o Next reescreve para cá. Só repassa ao DSN do próprio app — não é um
 * repasse aberto — e só o conteúdo do evento, sem os cabeçalhos do navegador.
 */
const tunnel = SENTRY_DSN ? createSentryTunnelRoute({ allowedDsns: [SENTRY_DSN] }) : null;

export async function POST(request: Request): Promise<Response> {
  if (!tunnel) return new Response(null, { status: 404 });
  return tunnel.POST(request);
}
