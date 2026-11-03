import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
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

const nextConfig: NextConfig = {
  // Versão publicada, exibida no rodapé da barra lateral (src/lib/app-version.ts).
  env: {
    NEXT_PUBLIC_APP_COMMIT: commit,
    NEXT_PUBLIC_APP_BUILT_AT: new Date().toISOString(),
    NEXT_PUBLIC_APP_ENV: VERCEL_ENV ?? (isDev ? "development" : "local"),
    NEXT_PUBLIC_APP_COMMIT_URL:
      commit && VERCEL_GIT_REPO_OWNER && VERCEL_GIT_REPO_SLUG ? `https://github.com/${VERCEL_GIT_REPO_OWNER}/${VERCEL_GIT_REPO_SLUG}/commit/${commit}` : "",
  },
  // A Content-Security-Policy (com nonce por requisição) vem de src/proxy.ts.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
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

/**
 * Monitoramento de erros (src/lib/monitoring). Os eventos saem por `/monitoring` (túnel na
 * própria origem, src/app/sentry-tunnel/route.ts). Os source maps só são enviados com
 * SENTRY_AUTH_TOKEN, SENTRY_ORG e SENTRY_PROJECT no build (Vercel) e apagados depois do envio,
 * para não ficarem públicos.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
  telemetry: false,
  widenClientFileUpload: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN, deleteSourcemapsAfterUpload: true },
});
