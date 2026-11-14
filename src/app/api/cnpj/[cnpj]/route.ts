import { fetchCNPJFromProviders } from '@/lib/cnpj';
import { createCnpjHandler } from '@/lib/server/cnpj-handler';
import { lookupAllowedUids, resolveLookupAuth } from '@/lib/server/lookup-auth';

/**
 * Proxy server-side para consulta pública de CNPJ (cartão CNPJ e QSA): só para usuários logados,
 * com limite por usuário e cache em memória (detalhes em src/lib/server/cnpj-handler.ts). Mantém
 * a Content-Security-Policy estrita (`connect-src 'self'`) no navegador.
 */
export const GET = createCnpjHandler({
  auth: resolveLookupAuth(),
  lookup: fetchCNPJFromProviders,
  allowedUids: lookupAllowedUids(),
});
