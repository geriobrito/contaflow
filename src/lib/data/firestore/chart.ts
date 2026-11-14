import { deleteDoc, doc, setDoc, where, writeBatch } from 'firebase/firestore';
import type { BankAccount, ChartAccount, ClassificationRule, LockState, OpeningBalances } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { getDoc, getDocs } from '@/lib/data/counted-reads';
import { frozenMessage, prepareProtectedSave } from '@/lib/lock-guard';
import { rethrowPermissionDenied } from '@/lib/utils/errors';
import { BATCH_LIMIT, byCode, COL, single, toISO, type FirestoreContext } from './shared';

/** Plano de contas, regras de classificação, contas bancárias e saldos de abertura. */
export function chartMethods(ctx: FirestoreContext) {
  const { db, scoped, stamp, run, auditWrite, readLockState } = ctx;
  return {
    /* ── Plano de contas ──────────────────────────────────────────────── */
    async listAccounts(clientId) {
      const snap = await getDocs(scoped(COL.accounts, where('clientId', 'in', [clientId, 'global'])));
      return snap.docs.map((d) => ({ ...(d.data() as ChartAccount), id: d.id })).sort(byCode);
    },
    async saveAccount(account) {
      const ref = doc(db, COL.accounts, account.id);
      const [existingSnap, ls] = await Promise.all([
        getDoc(ref),
        account.clientId === 'global' ? Promise.resolve(null) : readLockState(account.clientId),
      ]);
      const existing = existingSnap.exists() ? { ...(existingSnap.data() as ChartAccount), id: existingSnap.id } : null;
      const prepared = prepareProtectedSave('chart_of_accounts', existing, account, ls);
      try {
        await setDoc(ref, stamp(prepared));
      } catch (e) {
        rethrowPermissionDenied(e, frozenMessage('chart_of_accounts', { isGlobal: account.clientId === 'global' }));
      }
    },
    async deleteAccount(accountId, audit) {
      const b = writeBatch(db);
      b.delete(doc(db, COL.accounts, accountId));
      if (audit) auditWrite(audit)(b);
      try {
        await b.commit();
      } catch (e) {
        rethrowPermissionDenied(e, 'Somente o administrador do escritório pode excluir contas do plano.');
      }
    },
    async insertAccounts(accounts) {
      if (!accounts.length) return;
      const clientIds = [...new Set(accounts.map((a) => a.clientId).filter((id) => id !== 'global'))];
      const lockStates = new Map<string, LockState | null>(await Promise.all(clientIds.map(async (id) => [id, await readLockState(id)] as const)));
      const prepared = accounts.map((acc) =>
        prepareProtectedSave('chart_of_accounts', null, acc, acc.clientId === 'global' ? null : lockStates.get(acc.clientId))
      );
      await run(prepared.map((acc) => single((b) => b.set(doc(db, COL.accounts, acc.id), stamp(acc)))));
    },
    async saveChartSetup({ accounts, bankAccounts }) {
      if (accounts.length + bankAccounts.length > BATCH_LIMIT) throw new Error('Alteração do plano maior que o limite de uma gravação.');
      if (!accounts.length && !bankAccounts.length) return;
      const clientIds = [...new Set([...accounts.map((a) => a.clientId), ...bankAccounts.map((bk) => bk.clientId)].filter((id) => id !== 'global'))];
      const [lockStateEntries, accountSnaps, bankSnaps] = await Promise.all([
        Promise.all(clientIds.map(async (id) => [id, await readLockState(id)] as const)),
        Promise.all(accounts.map((a) => getDoc(doc(db, COL.accounts, a.id)))),
        Promise.all(bankAccounts.map((bk) => getDoc(doc(db, COL.bankAccounts, bk.id)))),
      ]);
      const lockStates = new Map<string, LockState | null>(lockStateEntries);
      const preparedAccounts = accounts.map((acc, i) => {
        const snap = accountSnaps[i];
        const existing = snap.exists() ? { ...(snap.data() as ChartAccount), id: snap.id } : null;
        return prepareProtectedSave('chart_of_accounts', existing, acc, acc.clientId === 'global' ? null : lockStates.get(acc.clientId));
      });
      const preparedBanks = bankAccounts.map((bank, i) => {
        const snap = bankSnaps[i];
        const existing = snap.exists() ? { ...(snap.data() as BankAccount), id: snap.id } : null;
        return prepareProtectedSave('bank_accounts', existing, bank, lockStates.get(bank.clientId));
      });
      const b = writeBatch(db);
      // Substitui os documentos: campos opcionais removidos somem de fato e `lockSeq` fica exato.
      for (const acc of preparedAccounts) b.set(doc(db, COL.accounts, acc.id), stamp(acc));
      for (const bank of preparedBanks) b.set(doc(db, COL.bankAccounts, bank.id), stamp(bank));
      try {
        await b.commit();
      } catch (e) {
        rethrowPermissionDenied(e, frozenMessage('bank_accounts'));
      }
    },

    /* ── Regras ───────────────────────────────────────────────────────── */
    async listRules(clientId) {
      const snap = await getDocs(scoped(COL.rules, where('clientId', 'in', [clientId, 'global'])));
      return snap.docs.map((d) => {
        const data = d.data();
        return { ...(data as ClassificationRule), id: d.id, createdAt: toISO(data.createdAt), updatedAt: toISO(data.updatedAt) };
      });
    },
    async saveRule(rule) {
      await setDoc(doc(db, COL.rules, rule.id), stamp(rule), { merge: true });
    },
    async deleteRule(ruleId) {
      try {
        await deleteDoc(doc(db, COL.rules, ruleId));
      } catch (e) {
        rethrowPermissionDenied(e, 'Operadores só podem excluir regras criadas por si mesmos.');
      }
    },

    /* ── Saldos de abertura ───────────────────────────────────────────── */
    async getOpeningBalances(clientId) {
      return ctx.getById<OpeningBalances>(COL.openings, clientId);
    },
    async saveOpeningBalances(balances, audit, related = {}) {
      const banks = related.bankAccounts ?? [];
      const accounts = related.accounts ?? [];
      if (banks.length + accounts.length + 2 > BATCH_LIMIT) throw new Error('Abertura maior que o limite de uma gravação.');
      const clientId = balances.clientId;
      const openingRef = doc(db, COL.openings, clientId);
      const [openingSnap, ls, accountSnaps, bankSnaps] = await Promise.all([
        getDoc(openingRef),
        readLockState(clientId),
        Promise.all(accounts.map((a) => getDoc(doc(db, COL.accounts, a.id)))),
        Promise.all(banks.map((bk) => getDoc(doc(db, COL.bankAccounts, bk.id)))),
      ]);
      const existingOpening = openingSnap.exists() ? { ...(openingSnap.data() as OpeningBalances), id: openingSnap.id } : null;
      const preparedOpening = prepareProtectedSave('opening_balances', existingOpening, { ...balances, id: clientId }, ls);
      const preparedAccounts = accounts.map((acc, i) => {
        const snap = accountSnaps[i];
        const existing = snap.exists() ? { ...(snap.data() as ChartAccount), id: snap.id } : null;
        return prepareProtectedSave('chart_of_accounts', existing, acc, acc.clientId === 'global' ? null : ls);
      });
      const preparedBanks = banks.map((bank, i) => {
        const snap = bankSnaps[i];
        const existing = snap.exists() ? { ...(snap.data() as BankAccount), id: snap.id } : null;
        return prepareProtectedSave('bank_accounts', existing, bank, ls);
      });
      const b = writeBatch(db);
      for (const acc of preparedAccounts) b.set(doc(db, COL.accounts, acc.id), stamp(acc));
      // Substitui o documento, como `saveBankAccount`.
      for (const bank of preparedBanks) b.set(doc(db, COL.bankAccounts, bank.id), stamp(bank));
      b.set(openingRef, stamp(preparedOpening));
      auditWrite(audit)(b);
      try {
        await b.commit();
      } catch (e) {
        rethrowPermissionDenied(e, frozenMessage('opening_balances', { firstTime: !existingOpening }));
      }
    },

    /* ── Contas bancárias ─────────────────────────────────────────────── */
    async listBankAccounts(clientId) {
      const snap = await getDocs(scoped(COL.bankAccounts, where('clientId', '==', clientId)));
      return snap.docs.map((d) => ({ ...(d.data() as BankAccount), id: d.id }));
    },
    async saveBankAccount(account) {
      const ref = doc(db, COL.bankAccounts, account.id);
      const [existingSnap, ls] = await Promise.all([getDoc(ref), readLockState(account.clientId)]);
      const existing = existingSnap.exists() ? { ...(existingSnap.data() as BankAccount), id: existingSnap.id } : null;
      const prepared = prepareProtectedSave('bank_accounts', existing, account, ls);
      try {
        // Substitui o documento: vínculo ou saldo inicial removidos somem de fato.
        await setDoc(ref, stamp(prepared));
      } catch (e) {
        rethrowPermissionDenied(e, frozenMessage('bank_accounts'));
      }
    },
  } satisfies Partial<DataRepository>;
}
