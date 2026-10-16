import type { NextConfig } from "next";
import { execSync } from "node:child_process";

const isDev = process.env.NODE_ENV !== "production";

/** Commit do build: na Vercel vem da variável do sistema; fora dela, do git local. */
function buildCommit(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

const { VERCEL_ENV, VERCEL_GIT_REPO_OWNER, VERCEL_GIT_REPO_SLUG } = process.env;
const commit = buildCommit();

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
  // Versão publicada, exibida no rodapé da barra lateral (src/lib/app-version.ts).
  env: {
    NEXT_PUBLIC_APP_COMMIT: commit,
    NEXT_PUBLIC_APP_BUILT_AT: new Date().toISOString(),
    NEXT_PUBLIC_APP_ENV: VERCEL_ENV ?? (isDev ? "development" : "local"),
    NEXT_PUBLIC_APP_COMMIT_URL:
      commit && VERCEL_GIT_REPO_OWNER && VERCEL_GIT_REPO_SLUG ? `https://github.com/${VERCEL_GIT_REPO_OWNER}/${VERCEL_GIT_REPO_SLUG}/commit/${commit}` : "",
  },
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
