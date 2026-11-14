import { doc, setDoc } from 'firebase/firestore';
import type { FeeRegister, ObligationChecks } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { getDocs } from '@/lib/data/counted-reads';
import { COL, type FirestoreContext } from './shared';

/** Gestão do escritório: honorários e agenda de obrigações (um documento por empresa). */
export function officeMethods(ctx: FirestoreContext) {
  const { db, scoped, stamp } = ctx;
  // Listas aninhadas: `undefined` sai pelo JSON (o Firestore recusa).
  const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  return {
    async listFeeRegisters() {
      const snap = await getDocs(scoped(COL.fees));
      return snap.docs.map((d) => ({ ...(d.data() as FeeRegister), id: d.id }));
    },
    async saveFeeRegister(register) {
      await setDoc(doc(db, COL.fees, register.clientId), stamp(plain({ ...register, id: register.clientId })));
    },
    async listObligationChecks() {
      const snap = await getDocs(scoped(COL.obligations));
      return snap.docs.map((d) => ({ ...(d.data() as ObligationChecks), id: d.id }));
    },
    async saveObligationChecks(checks) {
      await setDoc(doc(db, COL.obligations, checks.clientId), stamp(plain({ ...checks, id: checks.clientId })));
    },
  } satisfies Partial<DataRepository>;
}
