import { describe, expect, it } from 'vitest';
import type { BankAccount, JournalEntry, OpeningBalances } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { buildPostings } from '@/lib/ledger';
import { equityMovements, openingPostings } from '@/lib/balance-sheet-checks';
import { dmplCheck } from '@/lib/statement-checks';
import { defaultNotes, noteIssue } from '@/lib/notes';

const chart = buildITG1000Chart('c');
const id = (code: string) => `c_itg22_${code}`;
const bank: BankAccount = { id: 'b', clientId: 'c', accountKey: 'k', nickname: 'Itaú', ledgerAccountId: id('1.1.1.02'), openingBalance: 10000, openingDate: '2025-01-01', createdAt: '', updatedAt: '' };
/** Abertura em 01/01/2025 com capital de 10.000: saldo inicial, não mutação. */
const openings: OpeningBalances = { id: 'c', clientId: 'c', date: '2025-01-01', mode: 'CONTINUITY', entries: [{ accountId: id('2.3.1.01'), amount: 10000 }], updatedAt: '' };
let n = 0;
const journal = (date: string, debit: string, credit: string, amount: number): JournalEntry =>
  ({
    id: `j${++n}`, clientId: 'c', entryNumber: n, date, memo: 'x', category: 'ADJUSTMENT', totalAmount: amount,
    lines: [
      { id: 'd', accountId: id(debit), type: 'DEBIT', amount },
      { id: 'c', accountId: id(credit), type: 'CREDIT', amount },
    ],
    createdAt: '', updatedAt: '',
  }) as JournalEntry;
const year = { start: '2025-01-01', end: '2025-12-31' };
const moves = (entries: JournalEntry[]) =>
  equityMovements(buildPostings([], [bank], chart, year.end, openings, entries), openingPostings(openings, [bank], chart), chart, year);

describe('equityMovements', () => {
  it('a abertura é saldo inicial: sem movimento', () => {
    expect(moves([])).toEqual([]);
  });

  it('aumento de capital e constituição de reserva no exercício contam', () => {
    const list = moves([journal('2025-06-10', '1.1.1.02', '2.3.1.01', 5000), journal('2025-12-31', '2.3.3.01', '2.3.2.02', 800)]);
    expect(list.map((m) => [m.code, m.value, m.count])).toEqual([
      ['2.3.1.01', 5000, 1],
      ['2.3.2.02', 800, 1],
    ]);
  });

  it('aumento e redução que se anulam ainda são movimento', () => {
    const list = moves([journal('2025-03-01', '1.1.1.02', '2.3.1.01', 1000), journal('2025-04-01', '2.3.1.01', '1.1.1.02', 1000)]);
    expect(list).toEqual([expect.objectContaining({ code: '2.3.1.01', value: 0, count: 2 })]);
  });

  it('fora do exercício e fora de Capital ou Reservas, não', () => {
    expect(moves([journal('2026-02-01', '1.1.1.02', '2.3.1.01', 1000)])).toEqual([]);
    expect(moves([journal('2025-05-01', '2.3.3.03', '1.1.1.02', 300)])).toEqual([]);
  });

  it('um aumento no mesmo dia e valor da abertura não é confundido com ela', () => {
    const list = moves([journal('2025-01-01', '1.1.1.02', '2.3.1.01', 10000)]);
    expect(list).toEqual([expect.objectContaining({ code: '2.3.1.01', value: 10000, count: 1 })]);
  });
});

describe('dmplCheck', () => {
  const list = [{ accountId: 'x', code: '2.3.1.01', name: 'Capital Subscrito', value: 5000, count: 1 }];

  it('pequena empresa com movimento: pede a DMPL', () => {
    const c = dmplCheck('PEQUENA_EMPRESA', list, '2025');
    expect(c).toMatchObject({ id: 'dmpl', level: 'warn' });
    expect(c?.title).toBe('Movimento em Capital ou Reservas em 2025: a NBC TG 1001 exige a DMPL');
    expect(c?.items?.[0]).toMatch(/2\.3\.1\.01 Capital Subscrito: aumento de R\$\s5\.000,00/);
  });

  it('microentidade ou sem movimento: nada', () => {
    expect(dmplCheck('MICROENTIDADE', list, '2025')).toBeNull();
    expect(dmplCheck('PEQUENA_EMPRESA', [], '2025')).toBeNull();
  });
});

describe('notas da pequena empresa e a DMPL', () => {
  const client = { name: 'ALPHA LTDA', cnpj: '11222333000181', regime: 'LUCRO_PRESUMIDO' as const, porte: 'PEQUENA_EMPRESA' as const };
  const figures = { capital: 15000, capitalToPay: 0, netResult: 0, distributions: 0, retained: 0, closed: false };
  const basis = (equityMovement: boolean) => defaultNotes(client, '2025', { ...figures, equityMovement }).find((x) => x.id === 'basis')!;

  it('com movimento, a base de preparação cita a DMPL; sem, a DLPA', () => {
    expect(basis(true).text).toMatch(/Demonstração das Mutações do Patrimônio Líquido/);
    expect(basis(true).text).not.toMatch(/Lucros ou Prejuízos Acumulados/);
    expect(basis(false).text).toMatch(/Demonstração de Lucros ou Prejuízos Acumulados/);
  });

  it('nota gravada sem a DMPL, com movimento no ano: avisa', () => {
    const saved = { ...basis(false), text: basis(false).text };
    expect(noteIssue(saved, 'PEQUENA_EMPRESA', { equityMovement: true })).toMatch(/DMPL/);
    expect(noteIssue(basis(true), 'PEQUENA_EMPRESA', { equityMovement: true })).toBeNull();
    expect(noteIssue(saved, 'PEQUENA_EMPRESA', { equityMovement: false })).toBeNull();
    expect(noteIssue(saved, 'PEQUENA_EMPRESA', null)).toBeNull();
  });
});
