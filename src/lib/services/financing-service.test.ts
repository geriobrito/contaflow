import { beforeAll, describe, expect, it } from 'vitest';
import type { FinancingContract } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { setSession } from '@/lib/data/scope';
import { getRepository } from '@/lib/services/data-service';
import { closeMonth } from '@/lib/services/reconciliation-service';
import { deleteFinancingContract, loadFinancingContext, saveFinancingContract } from '@/lib/services/financing-service';
import { loadMonthRoutines, postMonthRoutines } from '@/lib/services/month-routines';

const CLIENT = 'financ';

const contract = (over: Partial<FinancingContract> = {}): FinancingContract => ({
  id: 'fc1',
  kind: 'FINANCING',
  description: 'Financiamento do veículo',
  lender: 'Financiadora Beta S.A.',
  date: '2026-03-01',
  principal: 72280,
  upfrontCharges: 3899.94,
  installments: 36,
  installmentAmount: 2574.15,
  firstDueDate: '2026-04-07',
  interestMode: 'PREFIXED',
  monthlyRate: 1.1,
  counterpartAccountId: '',
  counterpartAccountCode: '2.1.2.01',
  shortTermAccountId: '',
  shortTermAccountCode: '2.1.4.02',
  longTermAccountId: '',
  longTermAccountCode: '2.2.1.01',
  chargesShortAccountId: '',
  chargesShortAccountCode: '2.1.4.03',
  chargesLongAccountId: '',
  chargesLongAccountCode: '2.2.1.02',
  upfrontExpenseAccountId: '',
  upfrontExpenseAccountCode: '3.4.1.01.006',
  interestExpenseAccountId: '',
  interestExpenseAccountCode: '3.4.1.01.005',
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('rotina dos contratos de financiamento (repositório local)', () => {
  beforeAll(async () => {
    setSession('local', { uid: 'u1' });
    const repo = getRepository();
    await repo.saveClient({ id: CLIENT, name: 'Financ Ltda', cnpj: '11222333000181', regime: 'SIMPLES_NACIONAL', createdAt: '', updatedAt: '' });
    // Plano sem as contas novas do modelo: entram ao salvar o contrato.
    const fresh = ['2.1.4.03', '2.2.1.02', '3.4.1.01.005', '3.4.1.01.006', '3.4.1.01.007'];
    await repo.insertAccounts(buildITG1000Chart(CLIENT).filter((a) => !fresh.includes(a.code)));
  });

  it('cadastrar cria as contas que faltam e o lançamento inicial com curto e longo prazo', async () => {
    await saveFinancingContract(CLIENT, contract(), await loadFinancingContext(CLIENT), { alreadyRecognized: false, authorUid: 'u1' });
    const [entry] = await getRepository().listJournalEntries(CLIENT);
    expect(entry.financingId).toBe('fc1');
    expect(entry.date).toBe('2026-03-01');
    const byCode = Object.fromEntries(entry.lines.map((l) => [`${l.accountCode}${l.type === 'DEBIT' ? 'D' : 'C'}`, l.amount]));
    expect(byCode['2.1.2.01D']).toBe(72280);
    expect(byCode['3.4.1.01.006D']).toBe(3899.94);
    expect(byCode['2.1.4.02C']).toBe(54057.15);
    expect(byCode['2.2.1.01C']).toBe(38612.25);
    expect(entry.totalAmount).toBe(92669.4);
  });

  it('março não tem juros; abril exige os juros da 1ª parcela para fechar', async () => {
    expect((await loadMonthRoutines(CLIENT, '2026-03'))?.problems).toEqual([]);
    await closeMonth(CLIENT, '2026-03');
    await expect(closeMonth(CLIENT, '2026-04')).rejects.toThrow(/Lance os juros de empréstimos e financiamentos de 04\/2026/);
    expect(await postMonthRoutines(CLIENT, '2026-04', 'u1')).toBe('Juros de empréstimos e financiamentos do mês lançados');
    const april = (await getRepository().listJournalEntries(CLIENT)).find((e) => e.financingMonth === '2026-04')!;
    expect(april.lines.map((l) => [l.accountCode, l.type, l.amount])).toEqual([
      ['3.4.1.01.005', 'DEBIT', 837.98],
      ['2.1.4.03', 'CREDIT', 837.98],
    ]);
    await closeMonth(CLIENT, '2026-04');
  });

  it('com lançamento em mês fechado, o contrato não muda nem é excluído', async () => {
    const ctx = await loadFinancingContext(CLIENT);
    const c = ctx.register!.contracts[0];
    await expect(saveFinancingContract(CLIENT, { ...c, installmentAmount: 2600 }, ctx, { alreadyRecognized: false, authorUid: 'u1' })).rejects.toThrow(/competência fechada/);
    await expect(deleteFinancingContract(CLIENT, c, ctx)).rejects.toThrow(/competência fechada/);
  });

  it('dezembro de 2027 traz a reclassificação das parcelas de 2028 para o curto prazo', async () => {
    const before = (await getRepository().listJournalEntries(CLIENT)).length;
    await postMonthRoutines(CLIENT, '2027-12', 'u1');
    const dec = (await getRepository().listJournalEntries(CLIENT)).find((e) => e.financingMonth === '2027-12')!;
    expect((await getRepository().listJournalEntries(CLIENT)).length).toBe(before + 1);
    expect(dec.memo).toMatch(/reclassificação para o curto prazo/);
    const reclass = dec.lines.filter((l) => l.memo?.startsWith('Transferência'));
    expect(reclass.slice(0, 2).map((l) => [l.accountCode, l.type, l.amount])).toEqual([
      ['2.2.1.01', 'DEBIT', 30889.8],
      ['2.1.4.02', 'CREDIT', 30889.8],
    ]);
  });
});
