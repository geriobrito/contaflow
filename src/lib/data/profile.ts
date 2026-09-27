import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import type { UserProfile } from '@/types/firestore';

/**
 * Garante o perfil `users/{uid}` e devolve o escritório (orgId) do usuário.
 *
 * No primeiro acesso o usuário vira dono de um escritório próprio (`orgId = uid`).
 * Para colocar vários contadores no mesmo escritório, um administrador altera
 * `users/{uid}.orgId` pelo console ou Admin SDK — as regras não permitem que o
 * próprio usuário troque de escritório.
 */
export async function ensureUserProfile(
  db: Firestore,
  user: { uid: string; email?: string | null }
): Promise<string> {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const orgId = (snap.data() as Partial<UserProfile>).orgId;
    if (!orgId) throw new Error('Perfil de usuário sem escritório (orgId). Contate o administrador.');
    return orgId;
  }
  const profile: UserProfile = {
    uid: user.uid,
    orgId: user.uid,
    createdAt: new Date().toISOString(),
    ...(user.email ? { email: user.email } : {}),
  };
  await setDoc(ref, profile);
  return profile.orgId;
}
