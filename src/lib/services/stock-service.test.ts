import { beforeAll, describe, expect, it } from 'vitest';
import type { JournalEntry, StockControl } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { setSession } from '@/lib/data/scope';
import { getRepository } from '@/lib/services/data-service';
import { closeMonth } from '@/lib/services/reconciliation-service';
import { loadStockContext, saveStockControl, saveStockCount } from '@/lib/services/stock-service';
import { loadMonthRoutines, postMonthRoutines } from '@/lib/services/month-routines';

const CLIENT = 'estoq';
const id = (code: string) => `${CLIENT}_itg22_${code}`;

function entry(n: number, date: string, debit: string, credit: string, amount: number): JournalEntry {
  const line = (code: string, type: 'DEBIT' | 'CREDIT', i: number) => ({ id: `l${i}`, accountId: id(code), accountCode: code, accountName: code, type, amount });
  return { id: `je${n}`, clientId: CLIENT, entryNumber: n, date, memo: `mov ${n}`, category: 'ADJUSTMENT', lines: [line(debit, 'DEBIT', 1), line(credit, 'CREDIT', 2)], totalAmount: amount, createdAt: '', updatedAt: '', createdByUid: 'u1' } as JournalEntry;
}

const control: StockControl = {
  id: CLIENT,
  clientId: CLIENT,
  stockAccountId: id('1.1.3.01'),
  stockAccountCode: '1.1.3.01',
  costAccountId: id('3.2.1.01'),
  costAccountCode: '3.2.1.01',
  startMonth: '2026-07',
  frequency: 'MONTHLY',
  counts: {},
  updatedAt: '',
};

describe('CMV pelo estoque final (repositório local)', () => {
  beforeAll(async () => {
    setSession('local', { uid: 'u1' });
    const repo = getRepository();
    await repo.saveClient({ id: CLIENT, name: 'Loja Ltda', cnpj: '11222333000181', regime: 'SIMPLES_NACIONAL', createdAt: '', updatedAt: '' });
    await repo.insertAccounts(buildITG1000Chart(CLIENT));
    // Estoque inicial de 400.000,00, compras de julho no estoque e uma distribuição de lucros.
    for (const m of [
      entry(1, '2026-06-30', '1.1.3.01', '2.3.3.04', 400000),
      entry(2, '2026-07-15', '1.1.3.01', '1.1.1.02', 897086.78),
      entry(3, '2026-07-20', '2.3.3.03', '1.1.1.02', 10000),
    ])
      await repo.createJournalEntry(m);
  });

  it('sem o estoque final, julho só avisa (inclusive a distribuição de lucros)', async () => {
    await saveStockControl(CLIENT, control, await loadStockContext(CLIENT));
    const routines = await loadMonthRoutines(CLIENT, '2026-07');
    expect(routines?.problems).toEqual([]);
    expect(routines?.warnings.join(' ')).toMatch(/Estoque final de 07\/2026 não informado.*distribuição de lucros em 07\/2026/);
    expect(routines?.inputs).toEqual([{ key: 'stock', label: 'Informar o estoque final', href: '/estoque?mes=2026-07' }]);
  });

  it('com o estoque final de 511.749,82, exige o CMV de 785.336,96, lança e fecha', async () => {
    await saveStockCount(CLIENT, '2026-07', 511749.82, 'Relatório Bling de 31/07', await loadStockContext(CLIENT));
    await expect(closeMonth(CLIENT, '2026-07')).rejects.toThrow(/Lance o CMV de 07\/2026/);
    expect(await postMonthRoutines(CLIENT, '2026-07', 'u1')).toBe('CMV do mês lançado');
    const cmv = (await getRepository().listJournalEntries(CLIENT)).find((e) => e.stockMonth === '2026-07')!;
    expect(cmv.memo).toMatch(/Relatório Bling de 31\/07/);
    expect(cmv.lines.map((l) => [l.accountCode, l.type, l.amount])).toEqual([
      ['3.2.1.01', 'DEBIT', 785336.96],
      ['1.1.3.01', 'CREDIT', 785336.96],
    ]);
    expect(await postMonthRoutines(CLIENT, '2026-07', 'u1')).toBeNull();
    await closeMonth(CLIENT, '2026-07');
    await expect(saveStockCount(CLIENT, '2026-07', 500000, '', await loadStockContext(CLIENT))).rejects.toThrow(/fechada/);
  });
});
