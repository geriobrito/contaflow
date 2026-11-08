import type { BankAccount, ChartAccount, FinancingRegister, FixedAssetRegister, InvestmentRegister, LockState, PayrollRegister, PeriodLock, PrepaidRegister, StockControl } from '@/types/firestore';
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
 * Repositório com cache de leitura do plano de contas, das contas bancárias, dos fechamentos e do
 * cadastro do imobilizado — o que quase toda tela relê ao abrir e só muda por gravações deste
 * mesmo repositório. Cada
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
  const lockStates = listCache<LockState>(now, ttlMs);
  const fixedAssets = listCache<FixedAssetRegister>(now, ttlMs);
  const prepaid = listCache<PrepaidRegister>(now, ttlMs);
  const financing = listCache<FinancingRegister>(now, ttlMs);
  const investments = listCache<InvestmentRegister>(now, ttlMs);
  const stock = listCache<StockControl>(now, ttlMs);
  const payroll = listCache<PayrollRegister>(now, ttlMs);
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
    async getLockState(clientId) {
      const [found] = await lockStates.get(key(clientId), async () => {
        const s = await repo.getLockState(clientId);
        return s ? [s] : [];
      });
      return found ? { ...found, ...(found.lastEvent ? { lastEvent: { ...found.lastEvent } } : {}) } : null;
    },

    async getFixedAssets(clientId) {
      const [found] = await fixedAssets.get(key(clientId), async () => {
        const r = await repo.getFixedAssets(clientId);
        return r ? [r] : [];
      });
      // Cópia profunda: quem edita a lista de bens recebida não mexe na guardada.
      return found ? (structuredClone(found) as FixedAssetRegister) : null;
    },
    saveFixedAssets: writing(repo.saveFixedAssets, fixedAssets),
    async getPrepaidExpenses(clientId) {
      const [found] = await prepaid.get(key(clientId), async () => {
        const r = await repo.getPrepaidExpenses(clientId);
        return r ? [r] : [];
      });
      return found ? (structuredClone(found) as PrepaidRegister) : null;
    },
    savePrepaidExpenses: writing(repo.savePrepaidExpenses, prepaid),
    async getFinancingContracts(clientId) {
      const [found] = await financing.get(key(clientId), async () => {
        const r = await repo.getFinancingContracts(clientId);
        return r ? [r] : [];
      });
      return found ? (structuredClone(found) as FinancingRegister) : null;
    },
    saveFinancingContracts: writing(repo.saveFinancingContracts, financing),
    async getInvestments(clientId) {
      const [found] = await investments.get(key(clientId), async () => {
        const r = await repo.getInvestments(clientId);
        return r ? [r] : [];
      });
      return found ? (structuredClone(found) as InvestmentRegister) : null;
    },
    saveInvestments: writing(repo.saveInvestments, investments),
    async getStockControl(clientId) {
      const [found] = await stock.get(key(clientId), async () => {
        const r = await repo.getStockControl(clientId);
        return r ? [r] : [];
      });
      return found ? (structuredClone(found) as StockControl) : null;
    },
    saveStockControl: writing(repo.saveStockControl, stock),
    async getPayrollRegister(clientId) {
      const [found] = await payroll.get(key(clientId), async () => {
        const r = await repo.getPayrollRegister(clientId);
        return r ? [r] : [];
      });
      return found ? (structuredClone(found) as PayrollRegister) : null;
    },
    savePayrollRegister: writing(repo.savePayrollRegister, payroll),

    // Contas globais valem para todos os clientes, e a exclusão não informa o cliente: limpa tudo.
    saveClient: writing(repo.saveClient, lockStates),
    saveAccount: writing(repo.saveAccount, accounts),
    deleteAccount: writing(repo.deleteAccount, accounts),
    insertAccounts: writing(repo.insertAccounts, accounts),
    saveChartSetup: writing(repo.saveChartSetup, accounts, banks),
    saveBankAccount: writing(repo.saveBankAccount, banks),
    saveOpeningBalances: writing(repo.saveOpeningBalances, accounts, banks),
    closePeriod: writing(repo.closePeriod, locks, lockStates),
    reopenPeriod: writing(repo.reopenPeriod, locks, lockStates),
    closeYear: writing(repo.closeYear, lockStates),
    deleteClient: writing(repo.deleteClient, accounts, banks, locks, lockStates, fixedAssets, prepaid, financing, investments, stock, payroll),
  };
}
