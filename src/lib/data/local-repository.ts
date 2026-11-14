import type { DataRepository } from '@/lib/data/repository';
import { chartMethods } from './local/chart';
import { clientMethods } from './local/clients';
import { invoiceMethods } from './local/invoices';
import { journalMethods } from './local/journal';
import { officeMethods } from './local/office';
import { periodMethods } from './local/periods';
import { registerMethods } from './local/registers';
import { requestMethods } from './local/requests';
import { restoreMethods } from './local/restore';
import { createLocalContext, type KeyValueStore } from './local/store';
import { transactionMethods } from './local/transactions';

export { LOCAL_KEYS, LOCAL_ORG_ID, type KeyValueStore } from './local/store';

/**
 * Repositório de desenvolvimento/demonstração em modo local (IndexedDB + localStorage + cache em memória),
 * montado por domínio (src/lib/data/local/), cada um espelhando o de mesmo nome do Firestore.
 * Usado apenas quando o Firebase não está configurado — nunca em paralelo ao Firestore.
 * Falhas de leitura ou escrita (JSON corrompido, cota excedida) são propagadas.
 */
export function createLocalRepository(store: KeyValueStore): DataRepository {
  const ctx = createLocalContext(store);
  return {
    mode: 'local',
    ...clientMethods(ctx),
    ...chartMethods(ctx),
    ...transactionMethods(ctx),
    ...periodMethods(ctx),
    ...requestMethods(ctx),
    ...journalMethods(ctx),
    ...invoiceMethods(ctx),
    ...registerMethods(ctx),
    ...officeMethods(ctx),
    ...restoreMethods(ctx),
  };
}
