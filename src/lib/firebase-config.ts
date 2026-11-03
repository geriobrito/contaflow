/**
 * Se o Firebase está configurado (modo Firestore) ou não (modo local). Sem efeitos ao importar:
 * serve ao navegador e ao servidor (rotas de API), que não pode carregar o SDK do navegador.
 */
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
