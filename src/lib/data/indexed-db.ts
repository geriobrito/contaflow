import { LOCAL_KEYS, type KeyValueStore } from '@/lib/data/local-repository';

export const IDB_NAME = 'contaflow_db';
export const IDB_VERSION = 1;
export const IDB_STORE_NAME = 'keyval';
/** Sinalizador gravado no `localStorage` quando alguma chave excede a cota de ~5MB e passa a residir apenas no IndexedDB. */
export const IDB_OVERFLOW_KEY = 'contaflow_idb_overflow';

/** Armazenamento síncrono de espelhamento/migração (ex.: `window.localStorage`). */
export interface SyncMirrorStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** Extensão de `KeyValueStore` com controle de fila de persistência assíncrona no IndexedDB. */
export interface IndexedDbKeyValueStore extends KeyValueStore {
  removeItem(key: string): void;
  /** Indica se o cache síncrono em memória já está integralmente hidratado. */
  readonly isHydrated: boolean;
  /** Promessa resolvida assim que a hidratação/sincronização inicial do IndexedDB no boot termina. */
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
 * 1. **Hidratação Síncrona no Construtor**: Ao inicializar, carrega imediatamente todas as chaves
 *    presentes no `mirror` (`localStorage`) para o `cache` em memória. Enquanto nenhuma chave tiver
 *    estourado a cota do `localStorage` (`IDB_OVERFLOW_KEY`), `isHydrated` já nasce `true` sem
 *    qualquer latência assíncrona.
 * 2. **Escrita Write-Through (`setItem`)**: Atualiza o `cache` em memória e o `mirror` (`localStorage`)
 *    de forma 100% síncrona no mesmo tick de evento (garantindo sobrevivência imediata a `page.reload()`),
 *    e enfileira a gravação no IndexedDB em segundo plano. Se o `localStorage` lançar `QuotaExceededError`,
 *    remove a chave do `mirror` (para nunca manter cópia defasada), ativa `IDB_OVERFLOW_KEY` e preserva
 *    o dado íntegro no `cache` e no IndexedDB.
 * 3. **Sincronização em Segundo Plano com IndexedDB**: Chaves já presentes no `mirror` atualizam o
 *    IndexedDB em background (sem jamais serem sobrescritas por dados antigos do IndexedDB); chaves
 *    ausentes no `mirror` (por overflow de cota) são recuperadas do IndexedDB.
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

  function removeMirrorBestEffort(key: string): void {
    if (!mirror || typeof mirror.removeItem !== 'function') return;
    try {
      mirror.removeItem(key);
    } catch {
      // Ignorado.
    }
  }

  let mirrorOverflowed = readMirror(IDB_OVERFLOW_KEY) === '1';

  function writeMirrorBestEffort(key: string, value: string): void {
    if (!mirror) return;
    try {
      mirror.setItem(key, value);
    } catch {
      // QuotaExceededError ou SecurityError no localStorage:
      // remove a chave do mirror para nunca deixar cópia defasada e sinaliza overflow para o IndexedDB.
      mirrorOverflowed = true;
      removeMirrorBestEffort(key);
      try {
        mirror.setItem(IDB_OVERFLOW_KEY, '1');
      } catch {
        // Ignorado.
      }
    }
  }

  // Passo 1: Hidratação síncrona imediata a partir do localStorage (mirror)
  const keysToHydrate = Object.values(LOCAL_KEYS);
  for (const key of keysToHydrate) {
    const legacy = readMirror(key);
    if (legacy !== null) {
      cache.set(key, legacy);
    }
  }

  // Só precisa bloquear leituras iniciais aguardando IndexedDB quando houve overflow do localStorage
  let hydrated = !(factory && typeof factory.open === 'function' && mirrorOverflowed);

  // Passo 2: Sincronização e recuperação em background com o IndexedDB
  if (factory && typeof factory.open === 'function') {
    enqueue(async (db) => {
      for (const key of keysToHydrate) {
        if (modifiedKeys.has(key)) continue;
        if (cache.has(key)) {
          // O mirror (localStorage) já entregou o valor síncrono mais recente:
          // espelha no IndexedDB se necessário, sem jamais sobrescrever o cache com valor defasado.
          const currentVal = cache.get(key)!;
          const stored = await idbGet(db, key);
          if (!modifiedKeys.has(key) && stored !== currentVal) {
            await idbSet(db, key, currentVal);
          }
        } else {
          // Chave não está no mirror (ex.: excedeu cota do localStorage): recupera do IndexedDB.
          const stored = await idbGet(db, key);
          if (modifiedKeys.has(key)) continue;
          if (stored !== null) {
            cache.set(key, stored);
          }
        }
      }
      hydrated = true;
    });
  }

  const hydrationPromise = pendingQueue;

  return {
    get isHydrated() {
      return hydrated;
    },
    ready: hydrationPromise,

    getItem(key: string): string | null {
      if (cache.has(key)) {
        return cache.get(key) ?? null;
      }
      // Fallback e migração imediata a partir do localStorage para chaves avulsas
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
