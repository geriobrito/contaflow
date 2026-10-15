import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy sem nonce (as páginas são estáticas): scripts e estilos só da própria
 * origem, mais o reCAPTCHA usado pelo App Check. As conexões saem apenas para as APIs do Google
 * (Firestore, Auth, App Check). Em desenvolvimento o React precisa de `eval` e o HMR de WebSocket.
 */
const RECAPTCHA = "https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} ${RECAPTCHA}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data: https://fonts.gstatic.com",
  `connect-src 'self' https://*.googleapis.com https://www.google.com/recaptcha/${isDev ? " ws:" : ""}`,
  "frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Nenhuma página revela o próprio endereço a outros sites (o link do cliente é uma credencial).
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        // Página pública de resposta do cliente: fora dos buscadores.
        source: "/responder",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
