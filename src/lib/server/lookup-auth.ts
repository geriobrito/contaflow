import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { isFirebaseConfigured } from '@/lib/firebase-config';
import type { CnpjAuth } from '@/lib/server/cnpj-handler';

/**
 * Como as rotas de consulta do cadastro (CNPJ e CEP) conferem quem chama. Validar o ID token só
 * exige o projectId (chaves públicas do Google), sem conta de serviço.
 */
const ADMIN_APP = 'cnpj-auth';

function firebaseAuth(projectId: string): CnpjAuth {
  return {
    kind: 'firebase',
    verify: async (idToken) => {
      const app = getApps().find((a) => a.name === ADMIN_APP) ?? initializeApp({ projectId }, ADMIN_APP);
      return (await getAuth(app).verifyIdToken(idToken)).uid;
    },
  };
}

export function resolveLookupAuth(): CnpjAuth {
  if (isFirebaseConfigured()) return firebaseAuth(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!);
  return process.env.NODE_ENV === 'production' ? { kind: 'unavailable' } : { kind: 'local' };
}

/** CNPJ_ALLOWED_UIDS: se preenchida, só estes usuários consultam (vale para CNPJ e CEP). */
export const lookupAllowedUids = (): string[] =>
  (process.env.CNPJ_ALLOWED_UIDS ?? '')
    .split(',')
    .map((uid) => uid.trim())
    .filter(Boolean);
