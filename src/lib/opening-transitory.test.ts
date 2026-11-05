import { describe, expect, it } from 'vitest';
import type { BankAccount, JournalEntry, OpeningBalances } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { buildPostings } from '@/lib/ledger';
import { closedYearsOf, transitoryBalance, transitoryBalanceAt, transitoryReminder } from '@/lib/opening-transitory';
import { transitoryCheck } from '@/lib/statement-checks';
import { buildDashboard, type DashboardInput } from '@/lib/dashboard';

const chart = buildITG1000Chart('c');
const id = (code: string) => `c_itg22_${code}`;
const bank: BankAccount = {
  id: 'b', clientId: 'c', accountKey: 'k', nickname: 'Itaú', ledgerAccountId: id('1.1.1.02'), openingBalance: 1500, openingDate: '2025-01-01', createdAt: '', updatedAt: '',
};
/** Banco 1.500 e capital 1.000: 500 credores na 2.3.3.04. */
const openings: OpeningBalances = {
  id: 'c', clientId: 'c', date: '2025-01-01', mode: 'OPENING_BALANCE', entries: [{ accountId: id('2.3.1.01'), amount: 1000 }], updatedAt: '',
};
/** Encerramento de 2025 que zera a 2.3.3.04 contra Lucros Acumulados. */
const closing: JournalEntry = {
  id: 'j1', clientId: 'c', entryNumber: 1, date: '2025-12-31', memo: 'Encerramento', category: 'CLOSING', yearClosing: '2025', totalAmount: 500,
  lines: [
    { id: 'l1', accountId: id('2.3.3.04'), type: 'DEBIT', amount: 500 },
    { id: 'l2', accountId: id('2.3.3.01'), type: 'CREDIT', amount: 500 },
  ],
  createdAt: '', updatedAt: '',
} as JournalEntry;

describe('saldo da conta transitória', () => {
  it('a contrapartida da abertura deixa a 2.3.3.04 credora; o encerramento a zera', () => {
    expect(transitoryBalance(openings, [bank], chart, [])).toBe(500);
    expect(transitoryBalance(openings, [bank], chart, [closing])).toBe(0);
  });

  it('pelas partidas do razão, até a data', () => {
    const postings = buildPostings([], [bank], chart, '2025-12-31', openings, [closing]);
    expect(transitoryBalanceAt(postings, chart, '2025-06-30')).toBe(500);
    expect(transitoryBalanceAt(postings, chart, '2025-12-31')).toBe(0);
  });

  it('implantação com balanço anterior não usa a 2.3.3.04', () => {
    expect(transitoryBalance({ ...openings, mode: 'CONTINUITY' }, [bank], chart, [])).toBe(0);
  });

  it('sem a conta no plano, sem saldo', () => {
    expect(transitoryBalance(openings, [bank], chart.filter((a) => a.code !== '2.3.3.04'), [])).toBe(0);
  });
});

describe('transitoryReminder', () => {
  it('sem saldo, nada a lembrar', () => {
    expect(transitoryReminder({ balance: 0, implantation: '2025-01-01', closedYears: [], today: '2026-02-01' })).toBeNull();
  });

  it('no ano da implantação, lembrete; depois de 31/12, atrasado', () => {
    expect(transitoryReminder({ balance: 500, implantation: '2025-01-01', closedYears: [], today: '2025-06-01' })).toEqual({ balance: 500, year: '2025', overdue: false });
    expect(transitoryReminder({ balance: 500, implantation: '2025-01-01', closedYears: [], today: '2025-12-31' })?.overdue).toBe(false);
    expect(transitoryReminder({ balance: 500, implantation: '2025-01-01', closedYears: [], today: '2026-01-01' })).toEqual({ balance: 500, year: '2025', overdue: true });
  });

  it('exercício já encerrado com saldo lançado depois: o próximo exercício é que zera', () => {
    expect(transitoryReminder({ balance: -80, implantation: '2025-01-01', closedYears: closedYearsOf([closing]), today: '2026-03-01' })).toEqual({ balance: -80, year: '2026', overdue: false });
  });
});

describe('transitoryCheck (balanço)', () => {
  it('em 31/12 do exercício que deve zerá-la, impede, com o destino do saldo', () => {
    const c = transitoryCheck(500, '2025-12-31', '2025');
    expect(c).toMatchObject({ id: 'transitory', level: 'block' });
    expect(c?.title).toContain('credor de R$');
    expect(c?.items?.[0]).toContain('Lucros Acumulados (2.3.3.01)');
    expect(transitoryCheck(-500, '2025-12-31', '2025')?.items?.[0]).toContain('Prejuízos Acumulados (2.3.3.02)');
  });

  it('antes de 31/12 só observa; zerada, some', () => {
    expect(transitoryCheck(500, '2025-06-30', '2025')?.level).toBe('info');
    expect(transitoryCheck(0, '2025-12-31', '2025')).toBeNull();
  });

  it('exercício anterior não encerrado: pede atenção no ano seguinte e impede no 31/12 seguinte', () => {
    const c = transitoryCheck(500, '2026-11-30', '2025');
    expect(c).toMatchObject({ level: 'warn' });
    expect(c?.title).toContain('o exercício de 2025 não foi encerrado');
    expect(transitoryCheck(500, '2026-12-31', '2025')?.level).toBe('block');
  });
});

describe('painel: lembrete de zerar', () => {
  const base = (over: Partial<DashboardInput>): DashboardInput => ({
    client: { id: 'c', name: 'Cliente', cnpj: '', regime: 'MEI', legalRepresentativeName: 'R', legalRepresentativeCpf: '1', createdAt: '', updatedAt: '' },
    accounts: chart,
    transactions: [],
    batches: [],
    banks: [bank],
    locks: [],
    requests: [],
    org: null,
    openings,
    journalEntries: [],
    today: '2025-06-15',
    nowMs: 0,
    ...over,
  });
  const alert = (over: Partial<DashboardInput>) => buildDashboard(base(over)).alerts.find((a) => a.id === 'transitory');

  it('no ano, lembrete baixo; depois do exercício, urgente', () => {
    expect(alert({})).toMatchObject({ severity: 'low', href: '/balanco' });
    expect(alert({ today: '2026-01-10' })).toMatchObject({ severity: 'high' });
    expect(alert({ today: '2026-01-10' })?.title).toContain('encerre o exercício de 2025');
  });

  it('zerada pelo encerramento, ou sem os lançamentos carregados, sem lembrete', () => {
    expect(alert({ today: '2026-01-10', journalEntries: [closing] })).toBeUndefined();
    expect(alert({ journalEntries: undefined })).toBeUndefined();
  });
});
