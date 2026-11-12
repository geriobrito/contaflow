import { beforeAll, describe, expect, it } from 'vitest';
import type { InvestmentAccount, JournalEntry } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { journalAudit } from '@/lib/audit';
import { setSession } from '@/lib/data/scope';
import { getRepository } from '@/lib/services/data-service';
import { closeMonth } from '@/lib/services/reconciliation-service';
import { deleteInvestment, loadInvestmentContext, saveInvestment, saveInvestmentBalance } from '@/lib/services/investment-service';
import { loadMonthRoutines, postMonthRoutines } from '@/lib/services/month-routines';

const CLIENT = 'aplic';
const id = (code: string) => `${CLIENT}_itg22_${code}`;

/** Lançamento manual simples (D/C), como os do extrato da conta corrente. */
function entry(n: number, date: string, debit: string, credit: string, amount: number, extra: [string, 'DEBIT' | 'CREDIT', number][] = []): JournalEntry {
  const line = (code: string, type: 'DEBIT' | 'CREDIT', value: number, i: number) => ({ id: `l${i}`, accountId: id(code), accountCode: code, accountName: code, type, amount: value });
  const lines = [line(debit, 'DEBIT', amount, 1), line(credit, 'CREDIT', amount + extra.reduce((s, [, t, v]) => s + (t === 'DEBIT' ? v : -v), 0), 2), ...extra.map(([c, t, v], i) => line(c, t, v, i + 3))];
  return { id: `je${n}`, clientId: CLIENT, entryNumber: n, date, memo: `mov ${n}`, category: 'ADJUSTMENT', lines, totalAmount: amount, createdAt: '', updatedAt: '', createdByUid: 'u1' } as JournalEntry;
}

const caixinha = (over: Partial<InvestmentAccount> = {}): InvestmentAccount => ({
  id: 'inv1',
  description: 'Caixinha Nubank',
  ledgerAccountId: id('1.1.1.03'),
  ledgerAccountCode: '1.1.1.03',
  startMonth: '2025-12',
  balances: {},
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('rendimento das aplicações (repositório local)', () => {
  beforeAll(async () => {
    setSession('local', { uid: 'u1' });
    const repo = getRepository();
    await repo.saveClient({ id: CLIENT, name: 'Aplic Ltda', cnpj: '11222333000181', regime: 'SIMPLES_NACIONAL', createdAt: '', updatedAt: '' });
    await repo.insertAccounts(buildITG1000Chart(CLIENT));
    // Caso da aula: 4.103,25 em 30/11 e o movimento de dezembro (resgates pelo bruto, com o IR na despesa do Simples).
    const moves = [
      entry(1, '2025-11-30', '1.1.1.03', '2.3.3.04', 4103.25),
      entry(2, '2025-12-09', '1.1.1.02', '1.1.1.03', 2200, [['3.3.2.19', 'DEBIT', 7.55]]),
      entry(3, '2025-12-11', '1.1.1.02', '1.1.1.03', 500, [['3.3.2.19', 'DEBIT', 2.27]]),
      entry(4, '2025-12-19', '1.1.1.03', '1.1.1.02', 1000),
      entry(5, '2025-12-25', '1.1.1.03', '1.1.1.02', 1174),
      entry(6, '2025-12-29', '1.1.1.02', '1.1.1.03', 300, [['3.3.2.19', 'DEBIT', 1.78]]),
      entry(7, '2025-12-29', '1.1.1.02', '1.1.1.03', 200, [['3.3.2.19', 'DEBIT', 1.18]]),
    ];
    for (const m of moves) await repo.createJournalEntry(m, journalAudit('JOURNAL_CREATE', { uid: 'u1' }, CLIENT, 'T', m));
  });

  it('sem o saldo do extrato, dezembro não fecha e a barra pede o saldo', async () => {
    await saveInvestment(CLIENT, caixinha(), await loadInvestmentContext(CLIENT));
    const routines = await loadMonthRoutines(CLIENT, '2025-12');
    expect(routines?.problems.join(' ')).toMatch(/Informe o saldo do extrato de Caixinha Nubank em 12\/2025/);
    expect(routines?.pending).toEqual([]);
    expect(routines?.inputs).toEqual([{ key: 'investment', label: 'Informar o saldo da aplicação', href: '/aplicacoes?mes=2025-12' }]);
    await expect(closeMonth(CLIENT, '2025-12')).rejects.toThrow(/Informe o saldo do extrato/);
  });

  it('com o saldo de 3.088,42, lança o rendimento de 23,95 no último dia e fecha', async () => {
    const ctx = await loadInvestmentContext(CLIENT);
    await saveInvestmentBalance(CLIENT, ctx.register!.accounts[0], '2025-12', 3088.42, ctx);
    expect((await loadMonthRoutines(CLIENT, '2025-12'))?.problems.join(' ')).toMatch(/Lance o rendimento das aplicações de 12\/2025 \(R\$\s23,95\)/);
    expect(await postMonthRoutines(CLIENT, '2025-12', 'u1')).toBe('Rendimento das aplicações do mês lançado');
    const yieldEntry = (await getRepository().listJournalEntries(CLIENT)).find((e) => e.investmentMonth === '2025-12')!;
    expect(yieldEntry.date).toBe('2025-12-31');
    expect(yieldEntry.lines.map((l) => [l.accountCode, l.type, l.amount])).toEqual([
      ['1.1.1.03', 'DEBIT', 23.95],
      ['3.4.1.02.001', 'CREDIT', 23.95],
    ]);
    // Lançado de novo, nada muda (o rendimento do próprio mês não entra no saldo contábil comparado).
    expect(await postMonthRoutines(CLIENT, '2025-12', 'u1')).toBeNull();
    await closeMonth(CLIENT, '2025-12');
  });

  it('competência fechada: o saldo nela não muda e a aplicação não é excluída', async () => {
    const ctx = await loadInvestmentContext(CLIENT);
    const inv = ctx.register!.accounts[0];
    await expect(saveInvestmentBalance(CLIENT, inv, '2025-12', 3100, ctx)).rejects.toThrow(/fechada/);
    await expect(deleteInvestment(CLIENT, inv, ctx)).rejects.toThrow(/competência fechada/);
  });
});
