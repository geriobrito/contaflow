import type { KeyValueStore } from '@/lib/data/local-repository';

export const IDB_NAME = 'contaflow_db';
export const IDB_VERSION = 1;
export const IDB_STORE_NAME = 'keyval';

/** Armazenamento síncrono de espelhamento/migração (ex.: `window.localStorage`). */
export interface SyncMirrorStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** Verifica se a API IndexedDB está disponível no ambiente atual. */
export function isIndexedDbSupported(idb?: IDBFactory | null): boolean {
  const factory = idb !== undefined ? idb : typeof indexedDB !== 'undefined' ? indexedDB : null;
  return Boolean(factory && typeof factory.open === 'function');
}

function openDatabase(factory: IDBFactory, dbName = IDB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const request = factory.open(dbName, IDB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Falha ao abrir IndexedDB.'));
    } catch (err) {
      reject(err);
    }
  });
}

function idbGet(db: IDBDatabase, key: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readonly');
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        const result: unknown = req.result;
        resolve(typeof result === 'string' ? result : null);
      };
      req.onerror = () => reject(req.error ?? new Error(`Falha ao ler "${key}" no IndexedDB.`));
    } catch (err) {
      reject(err);
    }
  });
}

function idbSet(db: IDBDatabase, key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error(`Falha ao gravar "${key}" no IndexedDB.`));
      tx.onabort = () => reject(tx.error ?? new Error(`Transação abortada ao gravar "${key}" no IndexedDB.`));
    } catch (err) {
      reject(err);
    }
  });
}

function idbRemove(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error(`Falha ao remover "${key}" no IndexedDB.`));
      tx.onabort = () => reject(tx.error ?? new Error(`Transação abortada ao remover "${key}" no IndexedDB.`));
    } catch (err) {
      reject(err);
    }
  });
}

export interface IndexedDbStoreOptions {
  /** Instância customizada de `IDBFactory` (útil para testes). */
  idb?: IDBFactory | null;
  /** Armazenamento secundário para migração automática na leitura e espelhamento best-effort na escrita. */
  mirror?: SyncMirrorStore | null;
  /** Nome customizado do banco no IndexedDB. */
  dbName?: string;
}

/**
 * Cria um `KeyValueStore` assíncrono apoiado em IndexedDB, capaz de armazenar centenas de megabytes
 * sem sofrer com o teto de ~5MB do `localStorage`.
 *
 * Comportamento híbrido de migração e compatibilidade:
 * 1. **Leitura (`getItem`)**: Lê do IndexedDB. Caso a chave ainda não exista no IndexedDB mas exista
 *    no `mirror` (`localStorage`), importa o valor automaticamente para o IndexedDB e o retorna.
 * 2. **Escrita (`setItem`)**: Grava no IndexedDB (fonte primária de verdade) e tenta espelhar no
 *    `mirror` (`localStorage`) em modo best-effort — se o `localStorage` lançar `QuotaExceededError`,
 *    a exceção do espelho é ignorada silenciosamente e a gravação no IndexedDB prossegue normalmente.
 * 3. **Fallback**: Se o IndexedDB não estiver disponível no ambiente, opera em memória + `mirror`.
 */
export function createIndexedDbStore(options: IndexedDbStoreOptions = {}): KeyValueStore {
  const factory = options.idb !== undefined ? options.idb : typeof indexedDB !== 'undefined' ? indexedDB : null;
  const mirror =
    options.mirror !== undefined
      ? options.mirror
      : typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
        ? window.localStorage
        : null;
  const dbName = options.dbName ?? IDB_NAME;

  const fallbackMemory = new Map<string, string>();
  let dbPromise: Promise<IDBDatabase | null> | null = null;

  function getDb(): Promise<IDBDatabase | null> {
    if (!factory || typeof factory.open !== 'function') {
      return Promise.resolve(null);
    }
    if (!dbPromise) {
      dbPromise = openDatabase(factory, dbName).catch(() => null);
    }
    return dbPromise;
  }

  function readMirror(key: string): string | null {
    if (!mirror) return null;
    try {
      return mirror.getItem(key);
    } catch {
      return null;
    }
  }

  function writeMirrorBestEffort(key: string, value: string): void {
    if (!mirror) return;
    try {
      mirror.setItem(key, value);
    } catch {
      // QuotaExceededError ou SecurityError no localStorage:
      // ignorado pois o dado está salvo com segurança no IndexedDB.
    }
  }

  function removeMirrorBestEffort(key: string): void {
    if (!mirror || typeof mirror.removeItem !== 'function') return;
    try {
      mirror.removeItem(key);
    } catch {
      // Ignorado.
    }
  }

  return {
    async getItem(key: string): Promise<string | null> {
      const db = await getDb();
      if (db) {
        const stored = await idbGet(db, key);
        if (stored !== null) {
          return stored;
        }
        // Migração transparente: se o IndexedDB ainda não tem a chave, verifica o localStorage.
        const legacy = readMirror(key);
        if (legacy !== null) {
          await idbSet(db, key, legacy);
          return legacy;
        }
        return null;
      }

      if (fallbackMemory.has(key)) {
        return fallbackMemory.get(key) ?? null;
      }
      const legacy = readMirror(key);
      if (legacy !== null) {
        fallbackMemory.set(key, legacy);
        return legacy;
      }
      return null;
    },

    async setItem(key: string, value: string): Promise<void> {
      const db = await getDb();
      if (db) {
        await idbSet(db, key, value);
      } else {
        fallbackMemory.set(key, value);
      }
      writeMirrorBestEffort(key, value);
    },

    async removeItem(key: string): Promise<void> {
      const db = await getDb();
      if (db) {
        await idbRemove(db, key);
      } else {
        fallbackMemory.delete(key);
      }
      removeMirrorBestEffort(key);
    },
  };
}

