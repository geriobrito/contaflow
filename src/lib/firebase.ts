import { initializeApp, getApps, getApp } from 'firebase/app';
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
const app = !getApps().length
  ? initializeApp(
      isFirebaseConfigured()
        ? firebaseConfig
        : { apiKey: 'mock-key', projectId: 'mock-project' }
    )
  : getApp();

export const db = getFirestore(app);
export const auth = getAuth(app);
