import { beforeAll, describe, expect, it } from 'vitest';
import type { PrepaidExpense } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { setSession } from '@/lib/data/scope';
import { getRepository } from '@/lib/services/data-service';
import { closeMonth } from '@/lib/services/reconciliation-service';
import { deletePrepaidExpense, loadPrepaidContext, savePrepaidExpense } from '@/lib/services/prepaid-service';
import { loadMonthRoutines, postMonthRoutines } from '@/lib/services/month-routines';

const CLIENT = 'seguro';

const insurance = (over: Partial<PrepaidExpense> = {}): PrepaidExpense => ({
  id: 'pp1',
  kind: 'INSURANCE',
  description: 'Seguro do veículo',
  documentRef: '0531',
  use: 'EXPENSE',
  amount: 1410.88,
  startDate: '2025-03-01',
  months: 12,
  assetAccountId: '',
  assetAccountCode: '1.1.4.01',
  payableAccountId: '',
  payableAccountCode: '2.1.3.05',
  expenseAccountId: '',
  expenseAccountCode: '3.3.2.18',
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('rotina das despesas antecipadas (repositório local)', () => {
  beforeAll(async () => {
    setSession('local', { uid: 'u1' });
    const repo = getRepository();
    await repo.saveClient({ id: CLIENT, name: 'Seguro Ltda', cnpj: '11222333000181', regime: 'SIMPLES_NACIONAL', createdAt: '', updatedAt: '' });
    // Plano sem as contas novas do modelo (2.1.3.05 e 3.3.2.18): entram ao salvar.
    await repo.insertAccounts(buildITG1000Chart(CLIENT).filter((a) => !['2.1.3.05', '3.3.2.18'].includes(a.code)));
  });

  it('cadastrar cria as contas que faltam e o lançamento inicial na data da apólice', async () => {
    await savePrepaidExpense(CLIENT, insurance(), await loadPrepaidContext(CLIENT), { alreadyRecognized: false, authorUid: 'u1' });
    const accounts = await getRepository().listAccounts(CLIENT);
    expect(accounts.some((a) => a.code === '2.1.3.05') && accounts.some((a) => a.code === '3.3.2.18')).toBe(true);
    const [entry] = await getRepository().listJournalEntries(CLIENT);
    expect(entry.prepaidId).toBe('pp1');
    expect(entry.date).toBe('2025-03-01');
    expect(entry.lines.map((l) => [l.accountCode, l.type, l.amount])).toEqual([
      ['1.1.4.01', 'DEBIT', 1410.88],
      ['2.1.3.05', 'CREDIT', 1410.88],
    ]);
    const item = (await getRepository().getPrepaidExpenses(CLIENT))!.items[0];
    expect(item.recognitionEntryId).toBe(entry.id);
    expect(item.expenseAccountId).toBe(accounts.find((a) => a.code === '3.3.2.18')!.id);
  });

  it('o fechamento exige a apropriação do mês; as rotinas a lançam', async () => {
    const routines = await loadMonthRoutines(CLIENT, '2025-03');
    expect(routines?.pending).toEqual(['prepaid']);
    await expect(closeMonth(CLIENT, '2025-03')).rejects.toThrow(/apropriação de seguros e despesas antecipadas de 03\/2025.*117,57/);
    expect(await postMonthRoutines(CLIENT, '2025-03', 'u1')).toBe('Apropriação das despesas antecipadas do mês lançada');
    const entries = await getRepository().listJournalEntries(CLIENT);
    const appropriation = entries.find((e) => e.prepaidMonth === '2025-03')!;
    expect(appropriation.date).toBe('2025-03-31');
    expect(appropriation.lines.map((l) => [l.accountCode, l.type, l.amount])).toEqual([
      ['3.3.2.18', 'DEBIT', 117.57],
      ['1.1.4.01', 'CREDIT', 117.57],
    ]);
    await closeMonth(CLIENT, '2025-03');
  });

  it('com lançamento em mês fechado, valor não muda e o item não é excluído', async () => {
    const ctx = await loadPrepaidContext(CLIENT);
    const item = ctx.register!.items[0];
    await expect(savePrepaidExpense(CLIENT, { ...item, amount: 2000 }, ctx, { alreadyRecognized: false, authorUid: 'u1' })).rejects.toThrow(/competência fechada/);
    await expect(deletePrepaidExpense(CLIENT, item, ctx)).rejects.toThrow(/competência fechada/);
    const before = (await getRepository().listJournalEntries(CLIENT)).map((e) => e.id).sort();
    await savePrepaidExpense(CLIENT, { ...item, description: 'Seguro auto' }, ctx, { alreadyRecognized: false, authorUid: 'u1' });
    expect((await getRepository().getPrepaidExpenses(CLIENT))!.items[0].description).toBe('Seguro auto');
    // Mês da apólice fechado: o lançamento inicial não é refeito.
    expect((await getRepository().listJournalEntries(CLIENT)).map((e) => e.id).sort()).toEqual(before);
  });
});
