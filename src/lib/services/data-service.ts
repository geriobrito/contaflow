import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import {
  ClientCompany,
  ChartAccount,
  BankTransaction,
  ClassificationRule,
  ImportBatch,
} from '@/types/firestore';
import {
  INITIAL_CLIENT,
  INITIAL_CHART_OF_ACCOUNTS,
  INITIAL_CLASSIFICATION_RULES,
} from '@/lib/mock/initial-data';

// Chaves do LocalStorage para modo fallback / desenvolvimento local
const STORAGE_KEYS = {
  CLIENTS: 'contaflow_clients',
  ACCOUNTS: 'contaflow_accounts',
  TRANSACTIONS: 'contaflow_transactions',
  RULES: 'contaflow_rules',
  BATCHES: 'contaflow_batches',
};

function getLocalData<T>(key: string, defaultValue: T): T {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function setLocalData<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error(`Erro ao salvar no LocalStorage [${key}]:`, e);
  }
}

/** Firestore rejeita campos `undefined`. */
const withoutUndefined = <T extends object>(obj: T): Partial<T> =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;

/* =========================================================================
   CLIENTES / EMPRESAS
   ========================================================================= */

export async function getClients(): Promise<ClientCompany[]> {
  if (isFirebaseConfigured() && db) {
    try {
      const snap = await getDocs(collection(db, 'clients'));
      if (!snap.empty) {
        return snap.docs.map((d) => d.data() as ClientCompany);
      }
    } catch (e) {
      console.warn('Erro ao carregar do Firestore, usando fallback local:', e);
    }
  }
  return getLocalData<ClientCompany[]>(STORAGE_KEYS.CLIENTS, [INITIAL_CLIENT]);
}

export async function saveClient(client: ClientCompany): Promise<void> {
  if (isFirebaseConfigured() && db) {
    try {
      await setDoc(doc(db, 'clients', client.id), withoutUndefined(client), { merge: true });
    } catch (e) {
      console.error('Erro ao salvar cliente no Firestore:', e);
    }
  }
  const current = await getClients();
  const index = current.findIndex((c) => c.id === client.id);
  const updated = index >= 0 ? [...current] : [client, ...current];
  if (index >= 0) updated[index] = client;
  setLocalData(STORAGE_KEYS.CLIENTS, updated);
}

/* =========================================================================
   PLANO DE CONTAS
   ========================================================================= */

const byCode = (a: ChartAccount, b: ChartAccount): number =>
  a.code.localeCompare(b.code, undefined, { numeric: true });

/** Escopo visível para um cliente: contas próprias + plano 'global' compartilhado. */
const inClientScope = (owner: string, clientId?: string): boolean =>
  !clientId || owner === clientId || owner === 'global';

/** Converte Timestamp do Firestore (ou valores ausentes) em ISO string. */
function toISO(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toDate' in value) {
    const toDate = (value as { toDate: () => Date }).toDate;
    if (typeof toDate === 'function') return toDate.call(value).toISOString();
  }
  return '';
}

export async function getAccounts(clientId?: string): Promise<ChartAccount[]> {
  if (isFirebaseConfigured() && db) {
    try {
      const ref = collection(db, 'chart_of_accounts');
      const q = clientId ? query(ref, where('clientId', 'in', [clientId, 'global'])) : ref;
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...(d.data() as ChartAccount), id: d.id })).sort(byCode);
    } catch (e) {
      console.warn('Erro ao carregar contas do Firestore, usando fallback:', e);
    }
  }
  const local = getLocalData<ChartAccount[]>(STORAGE_KEYS.ACCOUNTS, INITIAL_CHART_OF_ACCOUNTS);
  return local.filter((a) => inClientScope(a.clientId, clientId)).sort(byCode);
}

/**
 * Aplica o modelo padrão (CFC/SPED simplificado) como contas próprias do cliente.
 * Códigos já existentes no escopo do cliente são preservados. Retorna quantas contas foram criadas.
 */
export async function applyDefaultChartTemplate(clientId: string): Promise<number> {
  const existingCodes = new Set((await getAccounts(clientId)).map((a) => a.code));
  const now = new Date().toISOString();
  const remap = (id: string) => `${clientId}_${id}`;
  const toCreate: ChartAccount[] = INITIAL_CHART_OF_ACCOUNTS.filter(
    (a) => !existingCodes.has(a.code)
  ).map((a) => ({
    ...a,
    id: remap(a.id),
    clientId,
    parentId: a.parentId ? remap(a.parentId) : undefined,
    createdAt: now,
    updatedAt: now,
  }));
  if (toCreate.length === 0) return 0;

  if (isFirebaseConfigured() && db) {
    try {
      const batch = writeBatch(db);
      for (const acc of toCreate) {
        batch.set(doc(db, 'chart_of_accounts', acc.id), withoutUndefined(acc));
      }
      await batch.commit();
    } catch (e) {
      console.error('Erro ao aplicar modelo padrão no Firestore:', e);
      throw e;
    }
  }
  const all = getLocalData<ChartAccount[]>(STORAGE_KEYS.ACCOUNTS, INITIAL_CHART_OF_ACCOUNTS);
  setLocalData(STORAGE_KEYS.ACCOUNTS, [...all, ...toCreate]);
  return toCreate.length;
}

export async function saveAccount(account: ChartAccount): Promise<void> {
  if (isFirebaseConfigured() && db) {
    try {
      await setDoc(doc(db, 'chart_of_accounts', account.id), withoutUndefined(account), { merge: true });
    } catch (e) {
      console.error('Erro ao salvar conta no Firestore:', e);
    }
  }
  const current = await getAccounts();
  const index = current.findIndex((a) => a.id === account.id);
  const updated = index >= 0 ? [...current] : [...current, account];
  if (index >= 0) updated[index] = account;
  setLocalData(STORAGE_KEYS.ACCOUNTS, updated);
}

export async function deleteAccount(accountId: string): Promise<void> {
  if (isFirebaseConfigured() && db) {
    try {
      await deleteDoc(doc(db, 'chart_of_accounts', accountId));
    } catch (e) {
      console.error('Erro ao excluir conta no Firestore:', e);
    }
  }
  const current = await getAccounts();
  const updated = current.filter((a) => a.id !== accountId);
  setLocalData(STORAGE_KEYS.ACCOUNTS, updated);
}

/* =========================================================================
   REGRAS DE CLASSIFICAÇÃO / APRENDIZADO CONTÍNUO
   ========================================================================= */

export async function getRules(clientId?: string): Promise<ClassificationRule[]> {
  if (isFirebaseConfigured() && db) {
    try {
      const ref = collection(db, 'classification_rules');
      const q = clientId ? query(ref, where('clientId', 'in', [clientId, 'global'])) : ref;
      const snap = await getDocs(q);
      if (!snap.empty) {
        return snap.docs.map((d) => {
          const data = d.data();
          return {
            ...(data as ClassificationRule),
            id: d.id,
            createdAt: toISO(data.createdAt),
            updatedAt: toISO(data.updatedAt),
          };
        });
      }
    } catch (e) {
      console.warn('Erro ao buscar regras no Firestore:', e);
    }
  }
  return getLocalData<ClassificationRule[]>(STORAGE_KEYS.RULES, INITIAL_CLASSIFICATION_RULES).filter(
    (r) => inClientScope(r.clientId, clientId)
  );
}

export async function deleteRule(ruleId: string): Promise<void> {
  if (isFirebaseConfigured() && db) {
    try {
      await deleteDoc(doc(db, 'classification_rules', ruleId));
    } catch (e) {
      console.error('Erro ao excluir regra no Firestore:', e);
      throw e;
    }
  }
  const current = getLocalData<ClassificationRule[]>(STORAGE_KEYS.RULES, INITIAL_CLASSIFICATION_RULES);
  setLocalData(
    STORAGE_KEYS.RULES,
    current.filter((r) => r.id !== ruleId)
  );
}

export async function saveRule(rule: ClassificationRule): Promise<void> {
  if (isFirebaseConfigured() && db) {
    try {
      await setDoc(doc(db, 'classification_rules', rule.id), withoutUndefined(rule), { merge: true });
    } catch (e) {
      console.error('Erro ao salvar regra no Firestore:', e);
    }
  }
  const current = await getRules();
  const index = current.findIndex((r) => r.id === rule.id || r.pattern === rule.pattern);
  const updated = index >= 0 ? [...current] : [rule, ...current];
  if (index >= 0) updated[index] = rule;
  setLocalData(STORAGE_KEYS.RULES, updated);
}

/* =========================================================================
   TRANSAÇÕES / CONCILIAÇÃO BANCÁRIA
   ========================================================================= */

export async function getTransactions(clientId?: string): Promise<BankTransaction[]> {
  if (isFirebaseConfigured() && db) {
    try {
      const q = clientId
        ? query(collection(db, 'transactions'), where('clientId', '==', clientId))
        : collection(db, 'transactions');
      const snap = await getDocs(q);
      if (!snap.empty) {
        return snap.docs
          .map((d) => d.data() as BankTransaction)
          .sort((a, b) => b.date.localeCompare(a.date));
      }
    } catch (e) {
      console.warn('Erro ao buscar transações no Firestore:', e);
    }
  }
  const local = getLocalData<BankTransaction[]>(STORAGE_KEYS.TRANSACTIONS, []);
  const filtered = clientId ? local.filter((t) => t.clientId === clientId) : local;
  return filtered.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Salva um lote de transações verificando duplicidades por FITID
 */
export async function saveTransactionsBatch(
  clientId: string,
  transactions: BankTransaction[],
  batchInfo: ImportBatch
): Promise<{ addedCount: number; duplicateCount: number }> {
  const current = await getTransactions(clientId);
  const existingFitids = new Set(current.map((t) => t.fitid));

  const uniqueToSave: BankTransaction[] = [];
  let duplicateCount = 0;

  for (const trn of transactions) {
    if (existingFitids.has(trn.fitid)) {
      duplicateCount++;
    } else {
      uniqueToSave.push(trn);
      existingFitids.add(trn.fitid);
    }
  }

  if (uniqueToSave.length > 0) {
    if (isFirebaseConfigured() && db) {
      try {
        const batch = writeBatch(db);
        for (const item of uniqueToSave) {
          batch.set(doc(db, 'transactions', item.id), item);
        }
        batch.set(doc(db, 'import_batches', batchInfo.id), {
          ...batchInfo,
          importedCount: uniqueToSave.length,
          duplicateCount,
        });
        await batch.commit();
      } catch (e) {
        console.error('Erro no writeBatch do Firestore:', e);
      }
    }

    const allUpdated = [...uniqueToSave, ...current];
    setLocalData(STORAGE_KEYS.TRANSACTIONS, allUpdated);

    const batches = getLocalData<ImportBatch[]>(STORAGE_KEYS.BATCHES, []);
    setLocalData(STORAGE_KEYS.BATCHES, [
      {
        ...batchInfo,
        importedCount: uniqueToSave.length,
        duplicateCount,
      },
      ...batches,
    ]);
  }

  return {
    addedCount: uniqueToSave.length,
    duplicateCount,
  };
}

export async function updateTransactionClassification(
  transactionId: string,
  accountId: string,
  accountCode: string,
  accountName: string,
  status: 'RECONCILED' | 'AUTO_CLASSIFIED' = 'RECONCILED'
): Promise<void> {
  const now = new Date().toISOString();
  if (isFirebaseConfigured() && db) {
    try {
      await updateDoc(doc(db, 'transactions', transactionId), {
        accountId,
        accountCode,
        accountName,
        status,
        reconciledAt: now,
      });
    } catch (e) {
      console.error('Erro ao atualizar transação no Firestore:', e);
    }
  }
  const current = await getTransactions();
  const updated = current.map((t) =>
    t.id === transactionId
      ? {
          ...t,
          accountId,
          accountCode,
          accountName,
          status,
          reconciledAt: now,
        }
      : t
  );
  setLocalData(STORAGE_KEYS.TRANSACTIONS, updated);
}
