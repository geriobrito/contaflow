import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import type { UserProfile, UserRole } from '@/types/firestore';

export interface UserAccess {
  orgId: string;
  role: UserRole;
}

/**
 * Garante o perfil `users/{uid}` e devolve o escritório (`orgId`) e o papel (`role`).
 *
 * No primeiro acesso o usuário vira dono de um escritório próprio (`orgId = uid`, `admin`).
 * Para colocar vários contadores no mesmo escritório, um administrador altera
 * `users/{uid}.orgId` pelo console ou Admin SDK — as regras não permitem que o
 * próprio usuário troque de escritório. No mesmo ato, defina `role: 'operator'` para
 * quem não deve reabrir competência nem excluir empresa, extrato, lançamento ou cadastros;
 * sem o campo, o usuário é administrador do escritório.
 */
export async function resolveUserAccess(
  db: Firestore,
  user: { uid: string; email?: string | null }
): Promise<UserAccess> {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data() as Partial<UserProfile>;
    if (!data.orgId) throw new Error('Perfil de usuário sem escritório (orgId). Contate o administrador.');
    return {
      orgId: data.orgId,
      role: data.role === 'operator' ? 'operator' : 'admin',
    };
  }
  const profile: UserProfile = {
    uid: user.uid,
    orgId: user.uid,
    createdAt: new Date().toISOString(),
    ...(user.email ? { email: user.email } : {}),
  };
  await setDoc(ref, profile);
  return { orgId: profile.orgId, role: 'admin' };
}

/** Garante o perfil `users/{uid}` e devolve o escritório (orgId) do usuário. */
export async function ensureUserProfile(
  db: Firestore,
  user: { uid: string; email?: string | null }
): Promise<string> {
  return (await resolveUserAccess(db, user)).orgId;
}
