import { doc, setDoc, where } from 'firebase/firestore';
import type {
  ClosingChecklist,
  ExplanatoryNotes,
  FinancingRegister,
  FixedAssetRegister,
  InvestmentRegister,
  PayrollRegister,
  PrepaidRegister,
  StockControl,
} from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { getDocs } from '@/lib/data/counted-reads';
import { saveRegister } from './journal-writes';
import { COL, type FirestoreContext } from './shared';

/**
 * Cadastros de um documento por empresa (imobilizado, despesas antecipadas, contratos,
 * aplicações, estoque, folha), checklist do fechamento e notas explicativas.
 */
export function registerMethods(ctx: FirestoreContext) {
  const { db, scoped, stamp, getById } = ctx;
  return {
    async getFixedAssets(clientId) {
      return getById<FixedAssetRegister>(COL.fixedAssets, clientId);
    },
    async saveFixedAssets(register, audit, journal = {}, options) {
      return saveRegister(ctx, COL.fixedAssets, register, audit, journal, options);
    },
    async getPrepaidExpenses(clientId) {
      return getById<PrepaidRegister>(COL.prepaid, clientId);
    },
    async savePrepaidExpenses(register, audit, journal = {}, options) {
      return saveRegister(ctx, COL.prepaid, register, audit, journal, options);
    },
    async getFinancingContracts(clientId) {
      return getById<FinancingRegister>(COL.financing, clientId);
    },
    async saveFinancingContracts(register, audit, journal = {}, options) {
      return saveRegister(ctx, COL.financing, register, audit, journal, options);
    },
    async getInvestments(clientId) {
      return getById<InvestmentRegister>(COL.investments, clientId);
    },
    async saveInvestments(register, audit, options) {
      return saveRegister(ctx, COL.investments, register, audit, {}, options);
    },
    async getStockControl(clientId) {
      return getById<StockControl>(COL.stock, clientId);
    },
    async saveStockControl(control, audit, options) {
      return saveRegister(ctx, COL.stock, control, audit, {}, options);
    },
    async getPayrollRegister(clientId) {
      return getById<PayrollRegister>(COL.payroll, clientId);
    },
    async savePayrollRegister(register, audit, journal = {}, options) {
      return saveRegister(ctx, COL.payroll, register, audit, journal, options);
    },

    /* ── Checklist do fechamento ──────────────────────────────────────── */
    async listClosingChecklists(clientId) {
      const snap = await getDocs(scoped(COL.checklists, where('clientId', '==', clientId)));
      return snap.docs.map((d) => ({ ...(d.data() as ClosingChecklist), id: d.id })).sort((a, b) => a.year.localeCompare(b.year));
    },
    async getClosingChecklist(clientId, year) {
      return getById<ClosingChecklist>(COL.checklists, `${clientId}_${year}`);
    },
    async saveClosingChecklist(checklist) {
      const id = `${checklist.clientId}_${checklist.year}`;
      // Itens aninhados: campos `undefined` saem pelo JSON (o Firestore os recusa).
      await setDoc(doc(db, COL.checklists, id), stamp(JSON.parse(JSON.stringify({ ...checklist, id })) as ClosingChecklist));
    },

    /* ── Notas explicativas ───────────────────────────────────────────── */
    async listExplanatoryNotes(clientId) {
      const snap = await getDocs(scoped(COL.notes, where('clientId', '==', clientId)));
      return snap.docs.map((d) => ({ ...(d.data() as ExplanatoryNotes), id: d.id })).sort((a, b) => a.year.localeCompare(b.year));
    },
    async getExplanatoryNotes(clientId, year) {
      return getById<ExplanatoryNotes>(COL.notes, `${clientId}_${year}`);
    },
    async saveExplanatoryNotes(notes) {
      const id = `${notes.clientId}_${notes.year}`;
      await setDoc(doc(db, COL.notes, id), stamp({ ...notes, id }));
    },
  } satisfies Partial<DataRepository>;
}
