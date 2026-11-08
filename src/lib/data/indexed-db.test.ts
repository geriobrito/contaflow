import { describe, expect, it } from 'vitest';
import { createIndexedDbStore, IDB_STORE_NAME, isIndexedDbSupported, type SyncMirrorStore } from '@/lib/data/indexed-db';
import { createLocalRepository, LOCAL_ORG_ID } from '@/lib/data/local-repository';
import { setSession } from '@/lib/data/scope';

/** Simulador leve da API nativa IndexedDB para testes em ambiente Node.js. */
function createFakeIdbFactory(): { factory: IDBFactory; rawStore: Map<string, string> } {
  const rawStore = new Map<string, string>();
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

describe('armazenamento local com IndexedDB (createIndexedDbStore)', () => {
  it('detecta corretamente disponibilidade da API IndexedDB', () => {
    const { factory } = createFakeIdbFactory();
    expect(isIndexedDbSupported(factory)).toBe(true);
    expect(isIndexedDbSupported(null)).toBe(false);
  });

  it('grava, lê e remove chaves no IndexedDB espelhando no mirror quando há espaço', async () => {
    const { factory, rawStore } = createFakeIdbFactory();
    const mirror = createFakeMirror();
    const store = createIndexedDbStore({ idb: factory, mirror });

    expect(await store.getItem('chave_inexistente')).toBeNull();

    await store.setItem('contaflow_clients', '[{"id":"c1"}]');
    expect(rawStore.get('contaflow_clients')).toBe('[{"id":"c1"}]');
    expect(mirror.data.get('contaflow_clients')).toBe('[{"id":"c1"}]');
    expect(await store.getItem('contaflow_clients')).toBe('[{"id":"c1"}]');

    await store.removeItem?.('contaflow_clients');
    expect(await store.getItem('contaflow_clients')).toBeNull();
    expect(mirror.data.has('contaflow_clients')).toBe(false);
  });

  it('migra automaticamente dados existentes do localStorage na primeira leitura', async () => {
    const { factory, rawStore } = createFakeIdbFactory();
    const mirror = createFakeMirror();
    mirror.data.set('contaflow_transactions', '[{"id":"tx_legada"}]');

    const store = createIndexedDbStore({ idb: factory, mirror });

    // Antes da leitura, o IndexedDB está vazio
    expect(rawStore.has('contaflow_transactions')).toBe(false);

    // Ao ler, puxa do localStorage e persiste no IndexedDB
    const val = await store.getItem('contaflow_transactions');
    expect(val).toBe('[{"id":"tx_legada"}]');
    expect(rawStore.get('contaflow_transactions')).toBe('[{"id":"tx_legada"}]');
  });

  it('não falha quando o localStorage lança QuotaExceededError em cargas volumosas', async () => {
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

    // A gravação deve ter sucesso no IndexedDB mesmo estourando a cota do localStorage
    await expect(store.setItem('contaflow_transactions', largePayload)).resolves.toBeUndefined();
    expect(mirror.quotaErrors).toBe(1);
    expect(rawStore.get('contaflow_transactions')).toBe(largePayload);
    expect(await store.getItem('contaflow_transactions')).toBe(largePayload);
  });

  it('funciona em modo fallback quando IndexedDB não está disponível', async () => {
    const mirror = createFakeMirror();
    mirror.data.set('chave_legada', 'valor_antigo');

    const store = createIndexedDbStore({ idb: null, mirror });
    expect(await store.getItem('chave_legada')).toBe('valor_antigo');

    await store.setItem('nova_chave', 'novo_valor');
    expect(await store.getItem('nova_chave')).toBe('novo_valor');
    expect(mirror.data.get('nova_chave')).toBe('novo_valor');
  });

  it('integra de ponta a ponta com createLocalRepository assíncrono', async () => {
    setSession(LOCAL_ORG_ID, { uid: 'u1', email: 'u1@contaflow.test' }, 'admin');
    const { factory } = createFakeIdbFactory();
    const mirror = createFakeMirror(200); // cota baixa no localStorage
    const store = createIndexedDbStore({ idb: factory, mirror });
    const repo = createLocalRepository(store);

    await repo.saveClient({
      id: 'c1',
      name: 'Indústria Metalúrgica S.A.',
      cnpj: '11222333000181',
      regime: 'LUCRO_PRESUMIDO',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    });

    const txs = Array.from({ length: 25 }, (_, i) => ({
      id: `tx_${i}`,
      clientId: 'c1',
      fitid: `fit_${i}`,
      date: '2026-03-15',
      amount: -100 - i,
      type: 'DEBIT' as const,
      memo: `Compra de insumo industrial lote #${i}`,
      status: 'PENDING' as const,
      createdAt: '2026-03-15',
    }));

    await repo.insertTransactions(txs);

    const loadedClients = await repo.listClients();
    expect(loadedClients).toHaveLength(1);
    expect(loadedClients[0].name).toBe('Indústria Metalúrgica S.A.');

    const loadedTxs = await repo.listTransactions('c1');
    expect(loadedTxs).toHaveLength(25);
    expect(mirror.quotaErrors).toBeGreaterThan(0); // Estourou o localStorage mas salvou 100% no IndexedDB!
  });
});
