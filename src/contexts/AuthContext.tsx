'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth, isFirebaseConfigured } from '@/lib/firebase';

export interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  isMockAuth: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Chave local para sessão em ambiente de desenvolvimento sem Firebase configurado
const DEV_AUTH_KEY = 'contaflow_dev_user';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMockAuth, setIsMockAuth] = useState(false);

  useEffect(() => {
    // Se o Firebase tiver credenciais reais configuradas
    if (isFirebaseConfigured() && auth) {
      const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        setUser(currentUser);
        setLoading(false);
      });
      return () => unsubscribe();
    } else {
      // Modo de contingência para desenvolvimento local (quando sem chaves reais no .env.local)
      setIsMockAuth(true);
      const savedMockUser = typeof window !== 'undefined' ? localStorage.getItem(DEV_AUTH_KEY) : null;
      if (savedMockUser) {
        try {
          setUser(JSON.parse(savedMockUser));
        } catch {
          setUser(null);
        }
      }
      setLoading(false);
    }
  }, []);

  const signIn = async (email: string, password: string): Promise<void> => {
    setLoading(true);
    try {
      if (isFirebaseConfigured() && auth) {
        try {
          const userCredential = await signInWithEmailAndPassword(auth, email, password);
          setUser(userCredential.user);
          return;
        } catch (firebaseErr: any) {
          // Se a chave no .env.local for inválida, expirada ou placeholder
          if (
            firebaseErr?.code === 'auth/api-key-not-valid' ||
            firebaseErr?.message?.includes('api-key-not-valid')
          ) {
            console.warn(
              'Aviso: Chave do Firebase no .env.local é inválida ou de teste. Prosseguindo com autenticação local de desenvolvimento.'
            );
          } else {
            throw firebaseErr;
          }
        }
      }

      // Validação no modo de desenvolvimento / fallback
      if (!email.includes('@') || password.length < 6) {
        const error: any = new Error('E-mail inválido ou senha com menos de 6 caracteres.');
        error.code = 'auth/invalid-credential';
        throw error;
      }

      const mockUser = {
        uid: 'mock-user-1',
        email,
        displayName: email.split('@')[0],
      } as unknown as User;

      if (typeof window !== 'undefined') {
        localStorage.setItem(DEV_AUTH_KEY, JSON.stringify(mockUser));
      }
      setUser(mockUser);
    } finally {
      setLoading(false);
    }
  };

  const signOut = async (): Promise<void> => {
    setLoading(true);
    try {
      if (isFirebaseConfigured() && auth) {
        await firebaseSignOut(auth);
      }
      if (typeof window !== 'undefined') {
        localStorage.removeItem(DEV_AUTH_KEY);
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: Boolean(user),
        signIn,
        signOut,
        isMockAuth,
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
