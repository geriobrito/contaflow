import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = (): boolean => {
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (!key || !project) return false;

  // Reconhece placeholders ou chaves dummy de desenvolvimento
  if (
    key.includes('your_api_key_here') ||
    key.includes('DummyKey') ||
    key.includes('mock-key') ||
    project.includes('your_project_id') ||
    project === 'contaflow-dev'
  ) {
    return false;
  }

  return true;
};

// Evita múltiplas instâncias no ciclo de hot-reload do Next.js
const isNewApp = !getApps().length;
const app = isNewApp
  ? initializeApp(
      isFirebaseConfigured()
        ? firebaseConfig
        : { apiKey: 'mock-key', projectId: 'mock-project' }
    )
  : getApp();

// App Check (opcional): com a chave do reCAPTCHA Enterprise, cada chamada ao Firebase leva um
// atestado de que partiu deste app — inclusive a leitura pública dos links de pendências. Só
// barra chamadas de fora depois de ativada a exigência no console (ver README). Precisa vir
// antes do primeiro uso do Firestore/Auth, e só no navegador.
const appCheckSiteKey = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY;
if (isNewApp && typeof window !== 'undefined' && isFirebaseConfigured() && appCheckSiteKey) {
  initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey), isTokenAutoRefreshEnabled: true });
}

export const db = getFirestore(app);
export const auth = getAuth(app);
