import type { Firestore } from 'firebase/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { chartMethods } from './firestore/chart';
import { clientMethods } from './firestore/clients';
import { invoiceMethods } from './firestore/invoices';
import { journalMethods } from './firestore/journal';
import { officeMethods } from './firestore/office';
import { periodMethods } from './firestore/periods';
import { registerMethods } from './firestore/registers';
import { requestMethods } from './firestore/requests';
import { createFirestoreContext } from './firestore/shared';
import { transactionMethods } from './firestore/transactions';

export { COL, MONTHS_PER_BATCH } from './firestore/shared';

/**
 * Repositório Firestore com isolamento por escritório, montado por domínio (src/lib/data/firestore/).
 * - Toda consulta inclui `where('orgId', '==', org)` (exigido pelas regras).
 * - Toda criação carimba `orgId`; atualizações nunca o alteram.
 * - Erros sobem ao chamador.
 * Cada domínio espelha o de mesmo nome em src/lib/data/local/ (modo local).
 */
export function createFirestoreRepository(db: Firestore, getOrgId: () => string): DataRepository {
  const ctx = createFirestoreContext(db, getOrgId);
  return {
    mode: 'firestore',
    ...clientMethods(ctx),
    ...chartMethods(ctx),
    ...transactionMethods(ctx),
    ...periodMethods(ctx),
    ...requestMethods(ctx),
    ...journalMethods(ctx),
    ...invoiceMethods(ctx),
    ...registerMethods(ctx),
    ...officeMethods(ctx),
  };
}
