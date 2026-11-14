import { fetchCEPFromProviders } from '@/lib/cep';
import { createCepHandler } from '@/lib/server/cep-handler';
import { lookupAllowedUids, resolveLookupAuth } from '@/lib/server/lookup-auth';

/**
 * Proxy server-side para consulta de endereço pelo CEP (BrasilAPI, que consulta a base dos
 * Correios, e ViaCEP como reserva): só para usuários logados, com limite por usuário e cache
 * (src/lib/server/cep-handler.ts). O navegador só fala com o próprio app (CSP).
 */
export const GET = createCepHandler({
  auth: resolveLookupAuth(),
  lookup: fetchCEPFromProviders,
  allowedUids: lookupAllowedUids(),
});
