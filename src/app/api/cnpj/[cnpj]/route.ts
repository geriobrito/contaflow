import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { fetchCNPJFromProviders } from '@/lib/cnpj';
import { isFirebaseConfigured } from '@/lib/firebase-config';
import { createCnpjHandler, type CnpjAuth } from '@/lib/server/cnpj-handler';

/**
 * Proxy server-side para consulta pública de CNPJ: só para usuários logados, com limite por
 * usuário e cache em memória (detalhes em src/lib/server/cnpj-handler.ts). Mantém a
 * Content-Security-Policy estrita (`connect-src 'self'`) no navegador.
 */

const ADMIN_APP = 'cnpj-auth';

/** Validar o ID token só exige o projectId (chaves públicas do Google), sem conta de serviço. */
function firebaseAuth(projectId: string): CnpjAuth {
  return {
    kind: 'firebase',
    verify: async (idToken) => {
      const app = getApps().find((a) => a.name === ADMIN_APP) ?? initializeApp({ projectId }, ADMIN_APP);
      return (await getAuth(app).verifyIdToken(idToken)).uid;
    },
  };
}

function resolveAuth(): CnpjAuth {
  if (isFirebaseConfigured()) return firebaseAuth(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!);
  return process.env.NODE_ENV === 'production' ? { kind: 'unavailable' } : { kind: 'local' };
}

export const GET = createCnpjHandler({
  auth: resolveAuth(),
  lookup: fetchCNPJFromProviders,
  allowedUids: (process.env.CNPJ_ALLOWED_UIDS ?? '')
    .split(',')
    .map((uid) => uid.trim())
    .filter(Boolean),
});
