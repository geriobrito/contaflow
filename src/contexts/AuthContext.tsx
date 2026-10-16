'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  User,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type MultiFactorResolver,
} from 'firebase/auth';
import { auth, db, isFirebaseConfigured } from '@/lib/firebase';
import { needsSecondFactor, resolveSecondFactor, secondFactorResolver } from '@/lib/auth/two-factor';
import { ensureUserProfile } from '@/lib/data/profile';
import { setSession } from '@/lib/data/scope';
import { LOCAL_ORG_ID } from '@/lib/data/local-repository';
import {
  SESSION_END_MESSAGE,
  clearLastActivity,
  readLastActivity,
  sessionStatus,
  writeLastActivity,
  type SessionEndReason,
} from '@/lib/auth/session-policy';

export interface AuthContextType {
  user: User | null;
  /** Escritório do usuário; todos os dados lidos/gravados pertencem a ele. */
  orgId: string | null;
  loading: boolean;
  /** Autenticado E com escritório resolvido (pronto para acessar dados). */
  isAuthenticated: boolean;
  /** Falha ao resolver o perfil/escritório (ex.: regras recusaram, rede). */
  authError: string | null;
  /** Se a conta exige o código do autenticador, termina sem erro e liga `secondFactorPending`. */
  signIn: (email: string, password: string) => Promise<void>;
  /** A senha foi aceita e falta o código do aplicativo autenticador. */
  secondFactorPending: boolean;
  confirmSecondFactor: (code: string) => Promise<void>;
  cancelSecondFactor: () => void;
  /** Envia o e-mail de redefinição de senha (sem efeito no modo local). */
  resetPassword: (email: string) => Promise<void>;
  /** Com `reason`, é a saída automática (inatividade ou limite): a tela de login explica o motivo. */
  signOut: (reason?: SessionEndReason) => Promise<void>;
  /** Momento do login (ms), base da duração máxima da sessão; null sem usuário. */
  signedInAt: number | null;
  /** Por que a última sessão foi encerrada automaticamente, para a tela de login. */
  sessionNotice: string | null;
  isMockAuth: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Sessão do modo local (sem Firebase configurado).
const DEV_AUTH_KEY = 'contaflow_dev_user';

/** Momento do login: o `auth_time` do token (não muda na renovação); sem ele, o último login registrado. */
async function signInTime(user: User): Promise<number> {
  try {
    const at = Date.parse((await user.getIdTokenResult()).authTime);
    if (Number.isFinite(at)) return at;
  } catch {
    /* sem rede para renovar o token: usa o registro do perfil */
  }
  const meta = Date.parse(user.metadata.lastSignInTime ?? '');
  return Number.isFinite(meta) ? meta : 0;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const firestoreMode = isFirebaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [orgId, setOrg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signedInAt, setSignedInAt] = useState<number | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  // Login em duas etapas: o Firebase devolve um "resolver" que conclui a entrada com o código.
  const secondFactor = useRef<MultiFactorResolver | null>(null);
  const [secondFactorPending, setSecondFactorPending] = useState(false);

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
          setSignedInAt(null);
          applySession(null, null);
          setLoading(false);
          return;
        }
        setLoading(true);
        signInTime(currentUser)
          .then(async (at) => {
            // Sessão vencida (ex.: navegador reaberto no dia seguinte): sai antes de carregar qualquer dado.
            const { expired } = sessionStatus(at, readLastActivity(), Date.now());
            if (expired) {
              setSessionNotice(SESSION_END_MESSAGE[expired]);
              clearLastActivity();
              await firebaseSignOut(auth);
              return;
            }
            const org = await ensureUserProfile(db, currentUser);
            setAuthError(null);
            setSignedInAt(at);
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

    // Modo local: sessão salva no navegador, escritório fixo, com a mesma validade.
    let restored: (User & { signedInAt?: number }) | null = null;
    try {
      const saved = localStorage.getItem(DEV_AUTH_KEY);
      restored = saved ? (JSON.parse(saved) as User & { signedInAt?: number }) : null;
    } catch {
      restored = null;
    }
    const at = restored?.signedInAt ?? 0;
    const expired = restored ? sessionStatus(at, readLastActivity(), Date.now()).expired : null;
    if (expired) {
      localStorage.removeItem(DEV_AUTH_KEY);
      clearLastActivity();
      restored = null;
    }
    queueMicrotask(() => {
      if (expired) setSessionNotice(SESSION_END_MESSAGE[expired]);
      setSignedInAt(restored ? at : null);
      applySession(restored, restored ? LOCAL_ORG_ID : null);
      setLoading(false);
    });
  }, [firestoreMode]);

  const signIn = async (email: string, password: string): Promise<void> => {
    setAuthError(null);
    setSessionNotice(null);
    writeLastActivity(Date.now());
    if (firestoreMode) {
      // Erros (credencial, chave inválida, rede) sobem para a tela de login.
      // O perfil/escritório é resolvido pelo onAuthStateChanged.
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (e) {
        if (!needsSecondFactor(e)) throw e;
        secondFactor.current = secondFactorResolver(e);
        setSecondFactorPending(true);
      }
      return;
    }

    if (!email.includes('@') || password.length < 6) {
      throw Object.assign(new Error('E-mail inválido ou senha com menos de 6 caracteres.'), {
        code: 'auth/invalid-credential',
      });
    }
    const now = Date.now();
    const mockUser = { uid: 'mock-user-1', email, displayName: email.split('@')[0], signedInAt: now } as unknown as User;
    localStorage.setItem(DEV_AUTH_KEY, JSON.stringify(mockUser));
    setSignedInAt(now);
    applySession(mockUser, LOCAL_ORG_ID);
  };

  const cancelSecondFactor = () => {
    secondFactor.current = null;
    setSecondFactorPending(false);
  };

  const confirmSecondFactor = async (code: string): Promise<void> => {
    if (!secondFactor.current) throw new Error('A verificação expirou. Informe e-mail e senha de novo.');
    // Código errado mantém a etapa aberta para nova tentativa; o erro sobe para a tela.
    await resolveSecondFactor(secondFactor.current, code);
    cancelSecondFactor();
  };

  const resetPassword = async (email: string): Promise<void> => {
    if (firestoreMode) await sendPasswordResetEmail(auth, email);
  };

  const signOut = async (reason?: SessionEndReason): Promise<void> => {
    cancelSecondFactor();
    setSessionNotice(reason ? SESSION_END_MESSAGE[reason] : null);
    clearLastActivity();
    if (firestoreMode) await firebaseSignOut(auth);
    else localStorage.removeItem(DEV_AUTH_KEY);
    setSignedInAt(null);
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
        secondFactorPending,
        confirmSecondFactor,
        cancelSecondFactor,
        resetPassword,
        signOut,
        signedInAt,
        sessionNotice,
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
