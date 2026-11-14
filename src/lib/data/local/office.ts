import type { FeeRegister, ObligationChecks } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { LOCAL_KEYS, type LocalContext } from './store';

/** Gestão do escritório: honorários e agenda de obrigações (um documento por empresa). */
export function officeMethods(ctx: LocalContext) {
  const { ready, read, replace, stamp } = ctx;
  const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  return {
    async listFeeRegisters() {
      await ready();
      return read<FeeRegister>(LOCAL_KEYS.fees);
    },
    async saveFeeRegister(register) {
      replace(LOCAL_KEYS.fees, stamp(plain({ ...register, id: register.clientId })));
    },
    async listObligationChecks() {
      await ready();
      return read<ObligationChecks>(LOCAL_KEYS.obligations);
    },
    async saveObligationChecks(checks) {
      replace(LOCAL_KEYS.obligations, stamp(plain({ ...checks, id: checks.clientId })));
    },
  } satisfies Partial<DataRepository>;
}
