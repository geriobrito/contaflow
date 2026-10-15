import type { BankAccount, ChartAccount, PeriodLock } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';

/** Validade de uma leitura em memória: limita a defasagem em relação a outra aba ou aparelho. */
export const READ_CACHE_TTL_MS = 5 * 60 * 1000;

interface Entry<T> {
  at: number;
  value: Promise<T[]>;
}

/**
 * Leituras por cliente guardadas em memória. Guarda a promessa, e não o resultado: duas telas
 * pedindo a mesma lista ao mesmo tempo fazem uma leitura só. Limpar descarta também a leitura
 * em andamento — quem já esperava recebe o resultado, mas ele não fica guardado.
 */
function listCache<T>(now: () => number, ttlMs: number) {
  const entries = new Map<string, Entry<T>>();
  return {
    async get(key: string, load: () => Promise<T[]>): Promise<T[]> {
      let entry = entries.get(key);
      if (!entry || now() - entry.at >= ttlMs) {
        const created: Entry<T> = { at: now(), value: load() };
        entry = created;
        entries.set(key, created);
        // Falha não fica guardada: a próxima chamada tenta de novo.
        created.value.catch(() => {
          if (entries.get(key) === created) entries.delete(key);
        });
      }
      // Cópia: quem ordena ou altera a lista recebida não mexe na guardada.
      return [...(await entry.value)];
    },
    clear: () => entries.clear(),
  };
}

/**
 * Repositório com cache de leitura do plano de contas, das contas bancárias e dos fechamentos
 * — o que quase toda tela relê ao abrir e só muda por gravações deste mesmo repositório. Cada
 * gravação que os altera limpa o cache correspondente antes (uma leitura iniciada durante a
 * gravação não fica guardada) e depois (a próxima leitura vê o resultado).
 *
 * `scope` identifica a sessão (escritório): as chaves nunca se misturam entre escritórios.
 */
export function withReadCache(
  repo: DataRepository,
  scope: () => string,
  options: { ttlMs?: number; now?: () => number } = {}
): DataRepository {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? READ_CACHE_TTL_MS;
  const accounts = listCache<ChartAccount>(now, ttlMs);
  const banks = listCache<BankAccount>(now, ttlMs);
  const locks = listCache<PeriodLock>(now, ttlMs);
  const key = (clientId: string) => `${scope()}|${clientId}`;

  /** Gravação que invalida os caches informados. */
  const writing =
    <A extends unknown[], R>(write: (...args: A) => Promise<R>, ...caches: { clear: () => void }[]) =>
    async (...args: A): Promise<R> => {
      caches.forEach((c) => c.clear());
      try {
        return await write(...args);
      } finally {
        caches.forEach((c) => c.clear());
      }
    };

  return {
    ...repo,

    listAccounts: (clientId) => accounts.get(key(clientId), () => repo.listAccounts(clientId)),
    listBankAccounts: (clientId) => banks.get(key(clientId), () => repo.listBankAccounts(clientId)),
    listPeriodLocks: (clientId) => locks.get(key(clientId), () => repo.listPeriodLocks(clientId)),

    // Contas globais valem para todos os clientes, e a exclusão não informa o cliente: limpa tudo.
    saveAccount: writing(repo.saveAccount, accounts),
    deleteAccount: writing(repo.deleteAccount, accounts),
    insertAccounts: writing(repo.insertAccounts, accounts),
    saveChartSetup: writing(repo.saveChartSetup, accounts, banks),
    saveBankAccount: writing(repo.saveBankAccount, banks),
    saveOpeningBalances: writing(repo.saveOpeningBalances, accounts, banks),
    closePeriod: writing(repo.closePeriod, locks),
    reopenPeriod: writing(repo.reopenPeriod, locks),
    deleteClient: writing(repo.deleteClient, accounts, banks, locks),
  };
}
