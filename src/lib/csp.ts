/**
 * Content-Security-Policy com nonce, montada a cada requisição pelo proxy (src/proxy.ts).
 *
 * Scripts: só os que levam o nonce da requisição (o Next aplica nos dele; o layout no script
 * do tema) e, por 'strict-dynamic', os que eles carregam — como o reCAPTCHA do App Check.
 * 'self' e os endereços do reCAPTCHA valem só para navegadores sem 'strict-dynamic'.
 * Estilos seguem com 'unsafe-inline' (next/font e atributos style={} dependem dele).
 * As conexões saem apenas para as APIs do Google (Firestore, Auth, App Check). Em
 * desenvolvimento o React precisa de `eval` e o HMR de WebSocket.
 */
const RECAPTCHA = 'https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/';

/** Nonce novo, imprevisível, por requisição. */
export const newNonce = (): string => btoa(crypto.randomUUID());

export function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''} ${RECAPTCHA}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src 'self' https://*.googleapis.com https://www.google.com/recaptcha/${isDev ? ' ws:' : ''}`,
    'frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/',
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
