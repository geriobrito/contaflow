import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, newNonce } from '@/lib/csp';

/**
 * Gera um nonce por requisição e a CSP que o usa (src/lib/csp.ts). O Next lê o nonce do
 * cabeçalho `Content-Security-Policy` da requisição e o aplica nos próprios scripts; o layout
 * lê `x-nonce` para o script do tema. Por isso todas as páginas são renderizadas a cada acesso.
 */
export function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = buildCsp(nonce, process.env.NODE_ENV === 'development');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Fora: rotas de API, túnel do monitoramento, arquivos estáticos, imagens e prefetch (não são páginas HTML).
      source: '/((?!api|monitoring|sentry-tunnel|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
