'use client';

import { useEffect } from 'react';
import { reportError } from '@/lib/monitoring';

/**
 * Erro na moldura do sistema (menu, sessão, layout raiz), que o `error.tsx` das telas não cobre.
 * Substitui o documento inteiro e não recebe os estilos globais: as cores vêm daqui mesmo e
 * seguem o tema do sistema operacional.
 */
const STYLE = `
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; background: #F6F4EE; color: #1c1917; }
  main { width: 100%; max-width: 440px; padding: 32px; border-radius: 22px; text-align: center; background: #fff;
    border: 1px solid rgba(28, 25, 23, 0.1); box-shadow: 0 8px 24px -14px rgba(28, 25, 23, 0.2); }
  h1 { margin: 0; font-size: 20px; letter-spacing: -0.02em; }
  p { margin: 10px 0 0; font-size: 14px; line-height: 1.6; color: #57534e; }
  code { display: block; margin-top: 16px; padding: 10px 14px; border-radius: 12px; font-size: 12px; word-break: break-word;
    background: rgba(28, 25, 23, 0.05); color: #57534e; }
  div { margin-top: 22px; display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
  button, a { height: 38px; padding: 0 18px; border-radius: 999px; font: inherit; font-size: 13px; font-weight: 500; cursor: pointer;
    display: inline-flex; align-items: center; text-decoration: none; }
  button { border: 0; background: #B5552F; color: #fff; }
  a { border: 1px solid rgba(28, 25, 23, 0.16); color: inherit; }
  @media (prefers-color-scheme: dark) {
    body { background: #131211; color: #f5f4ef; }
    main { background: #1C1A18; border-color: rgba(255, 255, 255, 0.1); box-shadow: none; }
    p, code { color: #a8a29e; }
    code { background: rgba(255, 255, 255, 0.06); }
    a { border-color: rgba(255, 255, 255, 0.18); }
  }
`;

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportError(error, { area: 'sistema', op: 'erro inesperado na moldura' });
  }, [error]);

  return (
    <html lang="pt-BR">
      <head>
        <title>Erro · ContaFlow</title>
        <style>{STYLE}</style>
      </head>
      <body>
        <main role="alert">
          <h1>O ContaFlow encontrou um erro</h1>
          <p>Nada foi gravado pela metade por causa disto. Tente de novo; se o erro continuar, recarregue a página e anote a mensagem abaixo.</p>
          {(error.message || error.digest) && (
            <code>
              {error.message}
              {error.digest ? ` (ref. ${error.digest})` : ''}
            </code>
          )}
          <div>
            <button type="button" onClick={() => retry()}>
              Tentar de novo
            </button>
            {/* Navegação completa de propósito: recarrega o sistema inteiro, o que o <Link> não faz. */}
            <a href="/painel">Recarregar o sistema</a>
          </div>
        </main>
      </body>
    </html>
  );
}
