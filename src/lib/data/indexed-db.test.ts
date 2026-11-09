import { describe, expect, it } from 'vitest';
import { createIndexedDbStore, IDB_STORE_NAME, isIndexedDbSupported, type SyncMirrorStore } from '@/lib/data/indexed-db';
import { createLocalRepository, LOCAL_KEYS, LOCAL_ORG_ID } from '@/lib/data/local-repository';
import { setSession } from '@/lib/data/scope';

/** Simulador leve da API nativa IndexedDB para testes em ambiente Node.js. */
function createFakeIdbFactory(initialData?: Map<string, string>): { factory: IDBFactory; rawStore: Map<string, string> } {
  const rawStore = new Map<string, string>(initialData);
  const objectStores = new Set<string>();

  const fakeDb = {
    objectStoreNames: {
      contains: (name: string) => objectStores.has(name),
    },
    createObjectStore: (name: string) => {
      objectStores.add(name);
      return {};
    },
    transaction: () => {
      const tx: {
        oncomplete: (() => void) | null;
        onerror: (() => void) | null;
        onabort: (() => void) | null;
        error: DOMException | null;
        objectStore: (name: string) => unknown;
      } = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        error: null,
        objectStore: () => ({
          get: (key: string) => {
            const req: { result: unknown; error: DOMException | null; onsuccess: (() => void) | null; onerror: (() => void) | null } = {
              result: rawStore.get(key),
              error: null,
              onsuccess: null,
              onerror: null,
            };
            queueMicrotask(() => req.onsuccess?.());
            return req;
          },
          put: (value: string, key: string) => {
            rawStore.set(key, value);
            queueMicrotask(() => tx.oncomplete?.());
          },
          delete: (key: string) => {
            rawStore.delete(key);
            queueMicrotask(() => tx.oncomplete?.());
          },
        }),
      };
      return tx as unknown as IDBTransaction;
    },
  } as unknown as IDBDatabase;

  const factory = {
    open: () => {
      const req: {
        result: IDBDatabase;
        error: DOMException | null;
        onupgradeneeded: (() => void) | null;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
      } = {
        result: fakeDb,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };
      queueMicrotask(() => {
        if (!objectStores.has(IDB_STORE_NAME)) {
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;

  return { factory, rawStore };
}

function createFakeMirror(quotaBytes = Infinity): SyncMirrorStore & { data: Map<string, string>; quotaErrors: number } {
  const data = new Map<string, string>();
  let quotaErrors = 0;
  return {
    data,
    get quotaErrors() {
      return quotaErrors;
    },
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      if (value.length > quotaBytes) {
        quotaErrors++;
        const err = new Error('QuotaExceededError: The quota has been exceeded.');
        err.name = 'QuotaExceededError';
        throw err;
      }
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe('armazenamento local híbrido com IndexedDB e cache write-through (createIndexedDbStore)', () => {
  it('detecta corretamente disponibilidade da API IndexedDB', () => {
    const { factory } = createFakeIdbFactory();
    expect(isIndexedDbSupported(factory)).toBe(true);
    expect(isIndexedDbSupported(null)).toBe(false);
  });

  it('grava de forma síncrona imediata no cache/mirror e persiste em segundo plano no IndexedDB', async () => {
    const { factory, rawStore } = createFakeIdbFactory();
    const mirror = createFakeMirror();
    const store = createIndexedDbStore({ idb: factory, mirror });

    expect(store.getItem('chave_inexistente')).toBeNull();

    // Escrita e leitura 100% síncronas (sem await)
    store.setItem('contaflow_clients', '[{"id":"c1"}]');
    expect(store.getItem('contaflow_clients')).toBe('[{"id":"c1"}]');
    expect(mirror.data.get('contaflow_clients')).toBe('[{"id":"c1"}]');

    // Após flush, o IndexedDB também recebeu o valor
    await store.flush();
    expect(rawStore.get('contaflow_clients')).toBe('[{"id":"c1"}]');

    store.removeItem('contaflow_clients');
    expect(store.getItem('contaflow_clients')).toBeNull();
    expect(mirror.data.has('contaflow_clients')).toBe(false);
    await store.flush();
    expect(rawStore.has('contaflow_clients')).toBe(false);
  });

  it('migra automaticamente dados existentes do localStorage na leitura e persiste no IndexedDB', async () => {
    const { factory, rawStore } = createFakeIdbFactory();
    const mirror = createFakeMirror();
    mirror.data.set('contaflow_transactions', '[{"id":"tx_legada"}]');

    const store = createIndexedDbStore({ idb: factory, mirror });

    // Leitura síncrona puxa imediatamente do localStorage
    const val = store.getItem('contaflow_transactions');
    expect(val).toBe('[{"id":"tx_legada"}]');

    // Em background, é migrado para o IndexedDB
    await store.flush();
    expect(rawStore.get('contaflow_transactions')).toBe('[{"id":"tx_legada"}]');
  });

  it('não falha quando o localStorage lança QuotaExceededError e recupera os dados do IndexedDB após reload', async () => {
    const { factory, rawStore } = createFakeIdbFactory();
    // Simula limite estreito de 100 bytes no localStorage
    const mirror = createFakeMirror(100);
    const store = createIndexedDbStore({ idb: factory, mirror });

    const largePayload = JSON.stringify(
      Array.from({ length: 50 }, (_, i) => ({
        id: `tx_${i}`,
        memo: `PAGAMENTO FORNECEDOR LOTE VOLUMOSO ${i}`,
        amount: -1500.25,
      }))
    );

    expect(largePayload.length).toBeGreaterThan(100);

    // Não lança erro mesmo com QuotaExceededError no localStorage
    expect(() => store.setItem(LOCAL_KEYS.transactions, largePayload)).not.toThrow();
    expect(mirror.quotaErrors).toBe(1);
    expect(store.getItem(LOCAL_KEYS.transactions)).toBe(largePayload);

    await store.flush();
    expect(rawStore.get(LOCAL_KEYS.transactions)).toBe(largePayload);

    // Simula um novo boot da página (novo store com localStorage vazio mas IndexedDB populado)
    const freshMirror = createFakeMirror(100);
    const reloadedStore = createIndexedDbStore({ idb: factory, mirror: freshMirror });
    await reloadedStore.ready;
    expect(reloadedStore.getItem(LOCAL_KEYS.transactions)).toBe(largePayload);
  });

  it('sobrevive a page.reload() imediato após saveClosingChecklist mesmo quando o IndexedDB ainda tem versão anterior defasada', async () => {
    setSession(LOCAL_ORG_ID, { uid: 'u1', email: 'u1@contaflow.test' }, 'admin');
    // Simula um IndexedDB que já possuía uma versão anterior (done: false) gravada em passo prévio
    const staleChecklist = JSON.stringify([
      {
        id: 'c1_2025',
        orgId: LOCAL_ORG_ID,
        clientId: 'c1',
        year: '2025',
        items: { cash: { done: false, at: '2026-01-10T11:00:00Z', byUid: 'u1' } },
        updatedAt: '2026-01-10T11:00:00Z',
      },
    ]);
    const { factory, rawStore } = createFakeIdbFactory(new Map([[LOCAL_KEYS.checklists, staleChecklist]]));
    const mirror = createFakeMirror();
    mirror.data.set(LOCAL_KEYS.checklists, staleChecklist);

    const store1 = createIndexedDbStore({ idb: factory, mirror });
    const repo1 = createLocalRepository(store1);

    // Usuário marca o item e recarrega a página imediatamente (antes de store1.flush() atualizar o IndexedDB)
    void repo1.saveClosingChecklist({
      id: 'c1_2025',
      clientId: 'c1',
      year: '2025',
      items: { cash: { done: true, at: '2026-01-10T12:00:00Z', byUid: 'u1' } },
      updatedAt: '2026-01-10T12:00:00Z',
    });

    // O mirror (localStorage) já recebeu o dado de forma síncrona!
    expect(mirror.data.get(LOCAL_KEYS.checklists)).toContain('"done":true');

    // Simula reload imediato da página compartilhando o MESMO IndexedDB (ainda defasado) e o MESMO localStorage (atualizado)
    const store2 = createIndexedDbStore({ idb: factory, mirror });
    expect(store2.isHydrated).toBe(true);
    const repo2 = createLocalRepository(store2);

    const saved = await repo2.getClosingChecklist('c1', '2025');
    expect(saved?.items.cash?.done).toBe(true);

    // E após o flush em background da nova página, o IndexedDB passa a refletir a versão mais recente
    await store2.flush();
    expect(rawStore.get(LOCAL_KEYS.checklists)).toContain('"done":true');
  });
});
