'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, signInWithEmailAndPassword, signOut as firebaseSignOut, onAuthStateChanged } from 'firebase/auth';
import { auth, db, isFirebaseConfigured } from '@/lib/firebase';
import { ensureUserProfile } from '@/lib/data/profile';
import { setSession } from '@/lib/data/scope';
import { LOCAL_ORG_ID } from '@/lib/data/local-repository';

export interface AuthContextType {
  user: User | null;
  /** Escritório do usuário; todos os dados lidos/gravados pertencem a ele. */
  orgId: string | null;
  loading: boolean;
  /** Autenticado E com escritório resolvido (pronto para acessar dados). */
  isAuthenticated: boolean;
  /** Falha ao resolver o perfil/escritório (ex.: regras recusaram, rede). */
  authError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  isMockAuth: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Sessão do modo local (sem Firebase configurado).
const DEV_AUTH_KEY = 'contaflow_dev_user';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const firestoreMode = isFirebaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [orgId, setOrg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  /** Define o escopo de dados ANTES de expor o usuário, para nenhuma leitura sair sem orgId. */
  const applySession = (nextUser: User | null, nextOrg: string | null) => {
    setSession(nextOrg, nextUser ? { uid: nextUser.uid, ...(nextUser.email ? { email: nextUser.email } : {}) } : null);
    setOrg(nextOrg);
    setUser(nextUser);
  };

  useEffect(() => {
    if (firestoreMode) {
      return onAuthStateChanged(auth, (currentUser) => {
        if (!currentUser) {
          applySession(null, null);
          setLoading(false);
          return;
        }
        setLoading(true);
        ensureUserProfile(db, currentUser)
          .then((org) => {
            setAuthError(null);
            applySession(currentUser, org);
          })
          .catch((e: unknown) => {
            console.error('Falha ao resolver o escritório do usuário:', e);
            setAuthError('Não foi possível carregar seu perfil de acesso. Tente novamente ou contate o administrador.');
            applySession(null, null);
          })
          .finally(() => setLoading(false));
      });
    }

    // Modo local: sessão salva no navegador, escritório fixo.
    let restored: User | null = null;
    try {
      const saved = localStorage.getItem(DEV_AUTH_KEY);
      restored = saved ? (JSON.parse(saved) as User) : null;
    } catch {
      restored = null;
    }
    queueMicrotask(() => {
      applySession(restored, restored ? LOCAL_ORG_ID : null);
      setLoading(false);
    });
  }, [firestoreMode]);

  const signIn = async (email: string, password: string): Promise<void> => {
    setAuthError(null);
    if (firestoreMode) {
      // Erros (credencial, chave inválida, rede) sobem para a tela de login.
      // O perfil/escritório é resolvido pelo onAuthStateChanged.
      await signInWithEmailAndPassword(auth, email, password);
      return;
    }

    if (!email.includes('@') || password.length < 6) {
      throw Object.assign(new Error('E-mail inválido ou senha com menos de 6 caracteres.'), {
        code: 'auth/invalid-credential',
      });
    }
    const mockUser = { uid: 'mock-user-1', email, displayName: email.split('@')[0] } as unknown as User;
    localStorage.setItem(DEV_AUTH_KEY, JSON.stringify(mockUser));
    applySession(mockUser, LOCAL_ORG_ID);
  };

  const signOut = async (): Promise<void> => {
    if (firestoreMode) await firebaseSignOut(auth);
    else localStorage.removeItem(DEV_AUTH_KEY);
    applySession(null, null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        orgId,
        loading,
        isAuthenticated: Boolean(user && orgId),
        authError,
        signIn,
        signOut,
        isMockAuth: !firestoreMode,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser utilizado dentro de um <AuthProvider>');
  }
  return context;
};
