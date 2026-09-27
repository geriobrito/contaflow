import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  writeBatch,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import {
  ClientCompany,
  ChartAccount,
  BankTransaction,
  ClassificationRule,
  ImportBatch,
  DREResult,
  DRELineItem,
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
      await setDoc(doc(db, 'clients', client.id), client, { merge: true });
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

export async function getAccounts(clientId?: string): Promise<ChartAccount[]> {
  if (isFirebaseConfigured() && db) {
    try {
      const snap = await getDocs(collection(db, 'chart_of_accounts'));
      if (!snap.empty) {
        const list = snap.docs.map((d) => d.data() as ChartAccount);
        return list.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
      }
    } catch (e) {
      console.warn('Erro ao carregar contas do Firestore, usando fallback:', e);
    }
  }
  const local = getLocalData<ChartAccount[]>(STORAGE_KEYS.ACCOUNTS, INITIAL_CHART_OF_ACCOUNTS);
  return local.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

export async function saveAccount(account: ChartAccount): Promise<void> {
  if (isFirebaseConfigured() && db) {
    try {
      await setDoc(doc(db, 'chart_of_accounts', account.id), account, { merge: true });
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
      const snap = await getDocs(collection(db, 'classification_rules'));
      if (!snap.empty) {
        return snap.docs.map((d) => d.data() as ClassificationRule);
      }
    } catch (e) {
      console.warn('Erro ao buscar regras no Firestore:', e);
    }
  }
  return getLocalData<ClassificationRule[]>(
    STORAGE_KEYS.RULES,
    INITIAL_CLASSIFICATION_RULES
  );
}

export async function saveRule(rule: ClassificationRule): Promise<void> {
  if (isFirebaseConfigured() && db) {
    try {
      await setDoc(doc(db, 'classification_rules', rule.id), rule, { merge: true });
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

/* =========================================================================
   GERAÇÃO DE DRE (Demonstração do Resultado do Exercício)
   ========================================================================= */

export async function generateDRE(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<DREResult> {
  const transactions = await getTransactions(clientId);
  const accounts = await getAccounts(clientId);
  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  // Filtrar transações conciliadas ou auto-classificadas no período com conta atribuída
  const periodTransactions = transactions.filter((t) => {
    if (!t.accountId) return false;
    if (t.status === 'PENDING') return false;
    if (startDate && t.date < startDate) return false;
    if (endDate && t.date > endDate) return false;
    return true;
  });

  // Agrupamento por DRE Group
  let grossRevenue = 0;
  let deductions = 0;
  let costs = 0;
  let operatingExpenses = 0;
  let financialResult = 0;
  let taxes = 0;

  // Detalhamento analítico por conta contábil
  const accountSums: Record<string, { account: ChartAccount; total: number }> = {};

  for (const trn of periodTransactions) {
    if (!trn.accountId) continue;
    const acc = accountMap.get(trn.accountId);
    if (!acc) continue;

    const val = Math.abs(trn.amount);

    if (!accountSums[acc.id]) {
      accountSums[acc.id] = { account: acc, total: 0 };
    }
    accountSums[acc.id].total += val;

    // Regras de agrupamento padrão da contabilidade brasileira
    if (acc.type === 'REVENUE') {
      if (acc.dreGroup === 'RECEITAS_FINANCEIRAS') {
        financialResult += val;
      } else {
        grossRevenue += val;
      }
    } else if (acc.type === 'COST' || acc.dreGroup === 'CUSTOS') {
      costs += val;
    } else if (acc.type === 'EXPENSE') {
      if (acc.dreGroup === 'DEDUCOES_RECEITA') {
        deductions += val;
      } else if (acc.dreGroup === 'DESPESAS_FINANCEIRAS') {
        financialResult -= val;
      } else if (acc.dreGroup === 'IMPOSTOS_LUCRO') {
        taxes += val;
      } else {
        operatingExpenses += val;
      }
    }
  }

  const netRevenue = grossRevenue - deductions;
  const grossProfit = netRevenue - costs;
  const netIncomeBeforeTaxes = grossProfit - operatingExpenses + financialResult;
  const netProfit = netIncomeBeforeTaxes - taxes;

  // Montagem da árvore de itens da DRE
  const items: DRELineItem[] = [
    {
      id: 'dre-1',
      title: '1. RECEITA OPERACIONAL BRUTA',
      level: 1,
      isTotal: false,
      value: grossRevenue,
      children: Object.values(accountSums)
        .filter((a) => a.account.type === 'REVENUE' && a.account.dreGroup !== 'RECEITAS_FINANCEIRAS')
        .map((a) => ({
          id: `dre-acc-${a.account.id}`,
          title: `(+) ${a.account.code} - ${a.account.name}`,
          level: 2,
          value: a.total,
        })),
    },
    {
      id: 'dre-2',
      title: '(-) Deduções da Receita Bruta e Impostos sobre Vendas',
      level: 1,
      isTotal: false,
      value: -deductions,
      children: Object.values(accountSums)
        .filter((a) => a.account.dreGroup === 'DEDUCOES_RECEITA')
        .map((a) => ({
          id: `dre-acc-${a.account.id}`,
          title: `(-) ${a.account.code} - ${a.account.name}`,
          level: 2,
          value: -a.total,
        })),
    },
    {
      id: 'dre-3',
      title: '(=) RECEITA OPERACIONAL LÍQUIDA',
      level: 1,
      isTotal: true,
      value: netRevenue,
    },
    {
      id: 'dre-4',
      title: '(-) Custos dos Serviços Prestados / Mercadorias Vendidas (CSP/CMV)',
      level: 1,
      isTotal: false,
      value: -costs,
      children: Object.values(accountSums)
        .filter((a) => a.account.type === 'COST' || a.account.dreGroup === 'CUSTOS')
        .map((a) => ({
          id: `dre-acc-${a.account.id}`,
          title: `(-) ${a.account.code} - ${a.account.name}`,
          level: 2,
          value: -a.total,
        })),
    },
    {
      id: 'dre-5',
      title: '(=) RESULTADO BRUTO / LUCRO BRUTO',
      level: 1,
      isTotal: true,
      value: grossProfit,
    },
    {
      id: 'dre-6',
      title: '(-) Despesas Operacionais e Administrativas',
      level: 1,
      isTotal: false,
      value: -operatingExpenses,
      children: Object.values(accountSums)
        .filter(
          (a) =>
            a.account.type === 'EXPENSE' &&
            a.account.dreGroup !== 'DEDUCOES_RECEITA' &&
            a.account.dreGroup !== 'DESPESAS_FINANCEIRAS' &&
            a.account.dreGroup !== 'IMPOSTOS_LUCRO'
        )
        .map((a) => ({
          id: `dre-acc-${a.account.id}`,
          title: `(-) ${a.account.code} - ${a.account.name}`,
          level: 2,
          value: -a.total,
        })),
    },
    {
      id: 'dre-7',
      title: '(+/-) Resultado Financeiro Líquido',
      level: 1,
      isTotal: false,
      value: financialResult,
      children: Object.values(accountSums)
        .filter(
          (a) =>
            a.account.dreGroup === 'RECEITAS_FINANCEIRAS' ||
            a.account.dreGroup === 'DESPESAS_FINANCEIRAS'
        )
        .map((a) => ({
          id: `dre-acc-${a.account.id}`,
          title: `${a.account.type === 'REVENUE' ? '(+)' : '(-)'} ${a.account.code} - ${a.account.name}`,
          level: 2,
          value: a.account.type === 'REVENUE' ? a.total : -a.total,
        })),
    },
    {
      id: 'dre-8',
      title: '(=) RESULTADO ANTES DOS TRIBUTOS (LAIR)',
      level: 1,
      isTotal: true,
      value: netIncomeBeforeTaxes,
    },
    {
      id: 'dre-9',
      title: '(-) Provisão para IRPJ e CSLL',
      level: 1,
      isTotal: false,
      value: -taxes,
    },
    {
      id: 'dre-10',
      title: '(=) RESULTADO LÍQUIDO DO EXERCÍCIO (LUCRO/PREJUÍZO)',
      level: 1,
      isTotal: true,
      value: netProfit,
    },
  ];

  return {
    period: { startDate, endDate },
    clientId,
    regime: 'SIMPLES_NACIONAL',
    grossRevenue,
    deductions,
    netRevenue,
    costs,
    grossProfit,
    operatingExpenses,
    financialResult,
    netIncomeBeforeTaxes,
    taxes,
    netProfit,
    items,
  };
}
