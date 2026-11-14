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
import { LOCAL_KEYS, type LocalContext } from './store';

/**
 * Cadastros de um documento por empresa (imobilizado, despesas antecipadas, contratos,
 * aplicações, estoque, folha), checklist do fechamento e notas explicativas.
 */
export function registerMethods(ctx: LocalContext) {
  const { ready, read, write, stamp, saveRegister } = ctx;
  const findOf = async <T extends { clientId: string }>(key: string, clientId: string): Promise<T | null> => {
    await ready();
    return read<T>(key).find((r) => r.clientId === clientId) ?? null;
  };
  const ofYear = async <T extends { clientId: string; year: string }>(key: string, clientId: string, year?: string): Promise<T[]> => {
    await ready();
    return read<T>(key)
      .filter((x) => x.clientId === clientId && (year === undefined || x.year === year))
      .sort((a, b) => a.year.localeCompare(b.year));
  };
  return {
    getFixedAssets: (clientId) => findOf<FixedAssetRegister>(LOCAL_KEYS.fixedAssets, clientId),
    async saveFixedAssets(register, audit, journal = {}, options) {
      return saveRegister(LOCAL_KEYS.fixedAssets, register, audit, journal, options);
    },
    getPrepaidExpenses: (clientId) => findOf<PrepaidRegister>(LOCAL_KEYS.prepaid, clientId),
    async savePrepaidExpenses(register, audit, journal = {}, options) {
      return saveRegister(LOCAL_KEYS.prepaid, register, audit, journal, options);
    },
    getFinancingContracts: (clientId) => findOf<FinancingRegister>(LOCAL_KEYS.financing, clientId),
    async saveFinancingContracts(register, audit, journal = {}, options) {
      return saveRegister(LOCAL_KEYS.financing, register, audit, journal, options);
    },
    getInvestments: (clientId) => findOf<InvestmentRegister>(LOCAL_KEYS.investments, clientId),
    async saveInvestments(register, audit, options) {
      return saveRegister(LOCAL_KEYS.investments, register, audit, {}, options);
    },
    getStockControl: (clientId) => findOf<StockControl>(LOCAL_KEYS.stock, clientId),
    async saveStockControl(control, audit, options) {
      return saveRegister(LOCAL_KEYS.stock, control, audit, {}, options);
    },
    getPayrollRegister: (clientId) => findOf<PayrollRegister>(LOCAL_KEYS.payroll, clientId),
    async savePayrollRegister(register, audit, journal = {}, options) {
      return saveRegister(LOCAL_KEYS.payroll, register, audit, journal, options);
    },

    listClosingChecklists: (clientId) => ofYear<ClosingChecklist>(LOCAL_KEYS.checklists, clientId),
    async getClosingChecklist(clientId, year) {
      return (await ofYear<ClosingChecklist>(LOCAL_KEYS.checklists, clientId, year))[0] ?? null;
    },
    async saveClosingChecklist(checklist) {
      const id = `${checklist.clientId}_${checklist.year}`;
      write(LOCAL_KEYS.checklists, [
        ...read<ClosingChecklist>(LOCAL_KEYS.checklists).filter((c) => c.id !== id),
        stamp(JSON.parse(JSON.stringify({ ...checklist, id })) as ClosingChecklist),
      ]);
    },

    listExplanatoryNotes: (clientId) => ofYear<ExplanatoryNotes>(LOCAL_KEYS.notes, clientId),
    async getExplanatoryNotes(clientId, year) {
      return (await ofYear<ExplanatoryNotes>(LOCAL_KEYS.notes, clientId, year))[0] ?? null;
    },
    async saveExplanatoryNotes(notes) {
      const id = `${notes.clientId}_${notes.year}`;
      write(LOCAL_KEYS.notes, [...read<ExplanatoryNotes>(LOCAL_KEYS.notes).filter((n) => n.id !== id), stamp({ ...notes, id })]);
    },
  } satisfies Partial<DataRepository>;
}
