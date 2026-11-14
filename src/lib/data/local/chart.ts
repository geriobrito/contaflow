import type { BankAccount, ChartAccount, ClassificationRule, OpeningBalances } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { isAdminSession, peekActor } from '@/lib/data/scope';
import { canDeleteRule, prepareProtectedSave } from '@/lib/lock-guard';
import { byCode, LOCAL_KEYS, type LocalContext } from './store';

/** Plano de contas, regras de classificação, contas bancárias e saldos de abertura. */
export function chartMethods(ctx: LocalContext) {
  const { ready, read, write, upsert, remove, replace, stamp, appendAudit, readLockState, lockedMonthsOf, inScope } = ctx;
  /** Fechamento atual da empresa (contas globais não travam). */
  const guardOf = (clientId: string) =>
    clientId === 'global' ? ([null, undefined] as const) : ([readLockState(clientId), lockedMonthsOf(clientId)] as const);
  return {
    async listAccounts(clientId) {
      await ready();
      return read<ChartAccount>(LOCAL_KEYS.accounts).filter((a) => inScope(a.clientId, clientId)).sort(byCode);
    },
    async saveAccount(account) {
      const existing = read<ChartAccount>(LOCAL_KEYS.accounts).find((a) => a.id === account.id);
      const [ls, months] = guardOf(account.clientId);
      replace(LOCAL_KEYS.accounts, stamp(prepareProtectedSave('chart_of_accounts', existing, account, ls, months)));
    },
    async deleteAccount(accountId, audit) {
      if (!isAdminSession()) throw new Error('Somente o administrador do escritório pode excluir contas do plano.');
      remove<ChartAccount>(LOCAL_KEYS.accounts, accountId);
      if (audit) appendAudit(audit);
    },
    async insertAccounts(accounts) {
      if (!accounts.length) return;
      const prepared = accounts.map((acc) => {
        const [ls, months] = guardOf(acc.clientId);
        return stamp(prepareProtectedSave('chart_of_accounts', null, acc, ls, months));
      });
      write(LOCAL_KEYS.accounts, [...read<ChartAccount>(LOCAL_KEYS.accounts), ...prepared]);
    },
    async saveChartSetup({ accounts, bankAccounts }) {
      // Valida e monta as duas listas antes de gravar qualquer uma.
      const storedAccounts = read<ChartAccount>(LOCAL_KEYS.accounts);
      for (const acc of accounts) {
        const i = storedAccounts.findIndex((a) => a.id === acc.id);
        const existing = i >= 0 ? storedAccounts[i] : null;
        const [ls, months] = guardOf(acc.clientId);
        const prepared = stamp(prepareProtectedSave('chart_of_accounts', existing, acc, ls, months));
        if (i >= 0) storedAccounts[i] = prepared;
        else storedAccounts.push(prepared);
      }
      const existingBanks = read<BankAccount>(LOCAL_KEYS.bankAccounts);
      const preparedBanks = bankAccounts.map((bank) => {
        const existing = existingBanks.find((b) => b.id === bank.id);
        return stamp(prepareProtectedSave('bank_accounts', existing, bank, readLockState(bank.clientId), lockedMonthsOf(bank.clientId)));
      });
      const replaced = new Set(bankAccounts.map((b) => b.id));
      write(LOCAL_KEYS.accounts, storedAccounts);
      write(LOCAL_KEYS.bankAccounts, [...existingBanks.filter((b) => !replaced.has(b.id)), ...preparedBanks]);
    },

    async listRules(clientId) {
      await ready();
      return read<ClassificationRule>(LOCAL_KEYS.rules).filter((r) => inScope(r.clientId, clientId));
    },
    async saveRule(rule) {
      const existing = read<ClassificationRule>(LOCAL_KEYS.rules).find((r) => r.id === rule.id);
      if (existing) {
        const prevAuthor = existing.createdByUid ?? '';
        const nextAuthor = rule.createdByUid ?? prevAuthor;
        if (nextAuthor !== prevAuthor) throw new Error('A autoria de uma regra não pode ser alterada.');
      }
      upsert(LOCAL_KEYS.rules, stamp(rule));
    },
    async deleteRule(ruleId) {
      const existing = read<ClassificationRule>(LOCAL_KEYS.rules).find((r) => r.id === ruleId);
      if (existing && !canDeleteRule(existing, peekActor()?.uid, isAdminSession())) {
        throw new Error('Operadores só podem excluir regras criadas por si mesmos.');
      }
      remove<ClassificationRule>(LOCAL_KEYS.rules, ruleId);
    },

    async getOpeningBalances(clientId) {
      await ready();
      return read<OpeningBalances>(LOCAL_KEYS.openings).find((o) => o.clientId === clientId) ?? null;
    },
    async saveOpeningBalances(balances, audit, related = {}) {
      // Valida e monta todas as listas antes de gravar qualquer uma.
      const clientId = balances.clientId;
      const ls = readLockState(clientId);
      const months = lockedMonthsOf(clientId);
      const allOpenings = read<OpeningBalances>(LOCAL_KEYS.openings);
      const existingOpening = allOpenings.find((o) => o.clientId === clientId);
      const preparedOpening = stamp(prepareProtectedSave('opening_balances', existingOpening, { ...balances, id: clientId }, ls, months));
      const others = allOpenings.filter((o) => o.clientId !== clientId);

      const allAccounts = read<ChartAccount>(LOCAL_KEYS.accounts);
      const newAccounts = related.accounts ?? [];
      const preparedAccounts = newAccounts.map((acc) => {
        const existingAcc = allAccounts.find((a) => a.id === acc.id);
        return stamp(prepareProtectedSave('chart_of_accounts', existingAcc, acc, acc.clientId === 'global' ? null : ls, months));
      });
      const knownAccounts = new Set(newAccounts.map((a) => a.id));
      const accounts = [...allAccounts.filter((a) => !knownAccounts.has(a.id)), ...preparedAccounts];

      const allBanks = read<BankAccount>(LOCAL_KEYS.bankAccounts);
      const nextBanks = related.bankAccounts ?? [];
      const preparedBanks = nextBanks.map((bank) => {
        const existingBank = allBanks.find((b) => b.id === bank.id);
        return stamp(prepareProtectedSave('bank_accounts', existingBank, bank, ls, months));
      });
      const replaced = new Set(nextBanks.map((b) => b.id));
      const banks = [...allBanks.filter((b) => !replaced.has(b.id)), ...preparedBanks];

      if (newAccounts.length) write(LOCAL_KEYS.accounts, accounts);
      if (replaced.size) write(LOCAL_KEYS.bankAccounts, banks);
      write(LOCAL_KEYS.openings, [...others, preparedOpening]);
      appendAudit(audit);
    },

    async listBankAccounts(clientId) {
      await ready();
      return read<BankAccount>(LOCAL_KEYS.bankAccounts).filter((b) => b.clientId === clientId);
    },
    async saveBankAccount(account) {
      const all = read<BankAccount>(LOCAL_KEYS.bankAccounts);
      const existing = all.find((b) => b.id === account.id);
      const prepared = prepareProtectedSave('bank_accounts', existing, account, readLockState(account.clientId), lockedMonthsOf(account.clientId));
      write(LOCAL_KEYS.bankAccounts, [...all.filter((b) => b.id !== account.id), stamp(prepared)]);
    },
  } satisfies Partial<DataRepository>;
}
