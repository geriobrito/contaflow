import { db, isFirebaseConfigured } from '@/lib/firebase';
import type { BankTransaction, ChartAccount, ClassificationRule, ClientCompany } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import type { DataRepository, DateRange } from '@/lib/data/repository';
import { createFirestoreRepository } from '@/lib/data/firestore-repository';
import { createLocalRepository, type KeyValueStore } from '@/lib/data/local-repository';
import { getOrgId } from '@/lib/data/scope';

/**
 * Ponto único de acesso a dados.
 *
 * O modo é decidido UMA vez por execução: Firestore quando o Firebase está
 * configurado, localStorage caso contrário. Não existe escrita dupla nem fallback
 * silencioso — se o Firestore recusar uma operação, o erro chega à interface.
 */

/** Armazenamento em memória para ambientes sem `window` (SSR/build). */
function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

let repository: DataRepository | null = null;

export function getRepository(): DataRepository {
  if (!repository) {
    repository = isFirebaseConfigured()
      ? createFirestoreRepository(db, getOrgId)
      : createLocalRepository(typeof window === 'undefined' ? memoryStore() : window.localStorage);
  }
  return repository;
}

export const dataMode = (): DataRepository['mode'] => getRepository().mode;

/* =========================================================================
   Clientes
   ========================================================================= */

export const getClients = (): Promise<ClientCompany[]> => getRepository().listClients();
export const saveClient = (client: ClientCompany): Promise<void> => getRepository().saveClient(client);
/** Exclui a empresa e, em cascata, contas, regras, lançamentos e lotes de importação. */
export const deleteClient = (clientId: string): Promise<void> => getRepository().deleteClient(clientId);

/* =========================================================================
   Plano de contas
   ========================================================================= */

export const getAccounts = (clientId: string): Promise<ChartAccount[]> => getRepository().listAccounts(clientId);
export const saveAccount = (account: ChartAccount): Promise<void> => getRepository().saveAccount(account);
export const deleteAccount = (accountId: string): Promise<void> => getRepository().deleteAccount(accountId);

/**
 * Aplica o Plano de Contas da ITG 1000 (CFC, 15/12/2022 — NBC TG 1002, Anexo 11)
 * como contas próprias do cliente. Códigos já existentes são preservados.
 * Retorna quantas contas foram criadas.
 */
export async function applyDefaultChartTemplate(clientId: string): Promise<number> {
  const existingCodes = new Set((await getAccounts(clientId)).map((a) => a.code));
  const toCreate = buildITG1000Chart(clientId).filter((a) => !existingCodes.has(a.code));
  if (toCreate.length > 0) await getRepository().insertAccounts(toCreate);
  return toCreate.length;
}

/* =========================================================================
   Regras
   ========================================================================= */

export const getRules = (clientId: string): Promise<ClassificationRule[]> => getRepository().listRules(clientId);
export const saveRule = (rule: ClassificationRule): Promise<void> => getRepository().saveRule(rule);
export const deleteRule = (ruleId: string): Promise<void> => getRepository().deleteRule(ruleId);

/* =========================================================================
   Lançamentos
   ========================================================================= */

/** Lançamentos do cliente (mais recentes primeiro). Informe `range` para limitar a consulta. */
export const getTransactions = (clientId: string, range?: DateRange): Promise<BankTransaction[]> =>
  getRepository().listTransactions(clientId, range);

/** Data (YYYY-MM-DD) do lançamento mais recente do cliente, ou null. */
export const getLatestTransactionDate = (clientId: string): Promise<string | null> =>
  getRepository().latestTransactionDate(clientId);
