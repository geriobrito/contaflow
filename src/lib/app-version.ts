/**
 * Versão publicada (commit e data do build), definida em next.config.ts. Serve para conferir de
 * relance se a produção está no último commit da `main`.
 */

export interface AppVersion {
  commit: string;
  builtAt: string;
  /** 'production', 'preview' (Vercel), 'development' (npm run dev) ou 'local' (build fora da Vercel). */
  env: string;
  commitUrl: string;
}

// Acesso literal: o Next só embute no bundle `process.env.NEXT_PUBLIC_*` escrito por extenso.
export const APP_VERSION: AppVersion = {
  commit: process.env.NEXT_PUBLIC_APP_COMMIT ?? '',
  builtAt: process.env.NEXT_PUBLIC_APP_BUILT_AT ?? '',
  env: process.env.NEXT_PUBLIC_APP_ENV ?? '',
  commitUrl: process.env.NEXT_PUBLIC_APP_COMMIT_URL ?? '',
};

const ENV_LABEL: Record<string, string> = { preview: 'prévia', development: 'desenvolvimento', local: 'build local' };

/** "Versão 139880e", com o ambiente quando não é produção: "Versão 139880e (prévia)". */
export function versionLabel(v: Pick<AppVersion, 'commit' | 'env'>): string {
  const short = v.commit ? v.commit.slice(0, 7) : 'sem commit';
  const env = ENV_LABEL[v.env];
  return `Versão ${short}${env ? ` (${env})` : ''}`;
}

/** Versão curta para espaços estreitos (o ambiente fica na dica): "Versão 139880e". */
export const versionShort = (v: Pick<AppVersion, 'commit'>): string => `Versão ${v.commit ? v.commit.slice(0, 7) : 'sem commit'}`;

/** Detalhe para a dica: commit completo e data do build no fuso do navegador. */
export function versionDetail(v: Pick<AppVersion, 'commit' | 'builtAt'> & Partial<Pick<AppVersion, 'env'>>): string {
  const built = v.builtAt ? new Date(v.builtAt) : null;
  const when = built && !Number.isNaN(built.getTime()) ? built.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null;
  const env = v.env ? ENV_LABEL[v.env] : undefined;
  return [v.commit && `Commit ${v.commit}`, when && `Publicado em ${when}`, env && `Ambiente: ${env}`].filter(Boolean).join(' · ');
}
