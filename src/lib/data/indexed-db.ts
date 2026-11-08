import { LOCAL_KEYS, type KeyValueStore } from '@/lib/data/local-repository';

export const IDB_NAME = 'contaflow_db';
export const IDB_VERSION = 1;
export const IDB_STORE_NAME = 'keyval';

/** Armazenamento síncrono de espelhamento/migração (ex.: `window.localStorage`). */
export interface SyncMirrorStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** Extensão de `KeyValueStore` com controle de fila de persistência assíncrona no IndexedDB. */
export interface IndexedDbKeyValueStore extends KeyValueStore {
  removeItem(key: string): void;
  /** Promessa resolvida assim que a hidratação inicial do IndexedDB no boot termina. */
  readonly ready: Promise<void>;
  /** Aguarda a conclusão da hidratação inicial e de todas as gravações pendentes no IndexedDB. */
  flush(): Promise<void>;
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
 * Cria um `KeyValueStore` com cache em memória síncrono (write-through imediato) e persistência
 * assíncrona em segundo plano no IndexedDB, superando o teto de ~5MB do `localStorage`.
 *
 * Arquitetura híbrida:
 * 1. **Leitura Síncrona (`getItem`)**: Retorna imediatamente do cache em memória. Caso a chave ainda
 *    não esteja no cache mas exista no `mirror` (`localStorage`), carrega para o cache, agenda a
 *    migração para o IndexedDB em background e retorna o valor sem latência.
 * 2. **Escrita Write-Through (`setItem`)**: Atualiza o cache em memória e o `mirror` (`localStorage`)
 *    de forma 100% síncrona no mesmo tick de evento (garantindo sobrevivência imediata a `page.reload()`),
 *    e enfileira a gravação no IndexedDB em segundo plano. Se o `localStorage` lançar `QuotaExceededError`,
 *    a exceção do espelho é absorvida e o dado permanece íntegro no cache e no IndexedDB.
 * 3. **Hidratação no Boot**: Ao inicializar, hidrata o cache a partir do IndexedDB para todas as
 *    coleções conhecidas (`LOCAL_KEYS`), preservando chaves já modificadas na sessão atual.
 */
export function createIndexedDbStore(options: IndexedDbStoreOptions = {}): IndexedDbKeyValueStore {
  const factory = options.idb !== undefined ? options.idb : typeof indexedDB !== 'undefined' ? indexedDB : null;
  const mirror =
    options.mirror !== undefined
      ? options.mirror
      : typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
        ? window.localStorage
        : null;
  const dbName = options.dbName ?? IDB_NAME;

  const cache = new Map<string, string>();
  const modifiedKeys = new Set<string>();
  let dbPromise: Promise<IDBDatabase | null> | null = null;
  let pendingQueue: Promise<void> = Promise.resolve();

  function getDb(): Promise<IDBDatabase | null> {
    if (!factory || typeof factory.open !== 'function') {
      return Promise.resolve(null);
    }
    if (!dbPromise) {
      dbPromise = openDatabase(factory, dbName).catch(() => null);
    }
    return dbPromise;
  }

  function enqueue(task: (db: IDBDatabase) => Promise<void>): void {
    pendingQueue = pendingQueue
      .then(async () => {
        const db = await getDb();
        if (db) {
          await task(db);
        }
      })
      .catch(() => {
        // Falhas assíncronas de I/O em background não derrubam a thread principal.
      });
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
      // ignorado pois o dado está salvo com segurança no cache e no IndexedDB.
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

  // Hidratação inicial a partir do IndexedDB para chaves volumosas que excederam o localStorage
  if (factory && typeof factory.open === 'function') {
    enqueue(async (db) => {
      const keysToHydrate = Object.values(LOCAL_KEYS);
      for (const key of keysToHydrate) {
        if (modifiedKeys.has(key)) continue;
        const stored = await idbGet(db, key);
        if (modifiedKeys.has(key)) continue;
        if (stored !== null) {
          cache.set(key, stored);
        } else {
          const legacy = readMirror(key);
          if (legacy !== null) {
            cache.set(key, legacy);
            await idbSet(db, key, legacy);
          }
        }
      }
    });
  }

  const hydrationPromise = pendingQueue;

  return {
    ready: hydrationPromise,

    getItem(key: string): string | null {
      if (cache.has(key)) {
        return cache.get(key) ?? null;
      }
      // Fallback e migração imediata a partir do localStorage
      const legacy = readMirror(key);
      if (legacy !== null) {
        cache.set(key, legacy);
        enqueue((db) => idbSet(db, key, legacy));
        return legacy;
      }
      return null;
    },

    setItem(key: string, value: string): void {
      modifiedKeys.add(key);
      cache.set(key, value);
      writeMirrorBestEffort(key, value);
      enqueue((db) => idbSet(db, key, value));
    },

    removeItem(key: string): void {
      modifiedKeys.add(key);
      cache.delete(key);
      removeMirrorBestEffort(key);
      enqueue((db) => idbRemove(db, key));
    },

    flush(): Promise<void> {
      return pendingQueue;
    },
  };
}
