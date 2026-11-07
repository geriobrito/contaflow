import { describe, expect, it } from 'vitest';
import type { BankAccount, ChartAccount, JournalEntry, OpeningBalances } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { buildBalanceSheet, buildPostings, VIRTUAL, type Posting } from '@/lib/ledger';
import { openingPostings } from '@/lib/balance-sheet-checks';
import { buildClosingDrafts, buildDLPA, closingEquity, resultBalances, type ClosingDraft } from '@/lib/year-closing';
import { buildDMPL } from '@/lib/dmpl';

const chart = buildITG1000Chart('c', '2025-01-01T00:00:00.000Z');
const id = (code: string) => `c_itg22_${code}`;
const BANK = id('1.1.1.02');

const p = (code: string, date: string, value: number): Posting[] => [
  { accountId: id(code), date, value },
  { accountId: BANK, date, value: -value },
];

let seq = 0;
const manualEntry = (
  date: string,
  memo: string,
  lines: { code: string; type: 'DEBIT' | 'CREDIT'; amount: number }[]
): JournalEntry => ({
  id: `je_m_${++seq}`,
  clientId: 'c',
  entryNumber: seq,
  date,
  memo,
  category: 'ADJUSTMENT',
  totalAmount: lines.filter((l) => l.type === 'DEBIT').reduce((s, l) => s + l.amount, 0),
  lines: lines.map((l, i) => ({
    id: `l_${i}`,
    accountId: id(l.code),
    accountCode: l.code,
    type: l.type,
    amount: l.amount,
  })),
  createdAt: '',
  updatedAt: '',
  createdByUid: 'u',
});

const asClosingEntries = (drafts: ClosingDraft[]): JournalEntry[] =>
  drafts.map((d, i) => ({
    ...d,
    id: `je_c_${i}`,
    clientId: 'c',
    entryNumber: 100 + i,
    createdAt: '',
    updatedAt: '',
    createdByUid: 'u',
  }));

const closeYear = (postings: Posting[], accounts: ChartAccount[] = chart): JournalEntry[] =>
  asClosingEntries(buildClosingDrafts('2025', resultBalances(postings, accounts, '2025'), accounts, closingEquity(postings, accounts, '2025')));

const equityOnSheet = (sheet: ReturnType<typeof buildBalanceSheet>, accountId: string) =>
  sheet.equity.find((l) => l.accountId === accountId)?.value ?? 0;

describe('buildDMPL', () => {
  it('sem movimento em reservas, exibe apenas Capital Social e Lucros/Prejuízos Acumulados, batendo com a DLPA', () => {
    const base: Posting[] = [
      ...p('2.3.1.01', '2024-01-10', -10000),
      ...p('3.1.1.01', '2024-06-01', -5000),
      ...p('3.1.1.01', '2025-03-10', -20000),
      ...p('2.3.3.03', '2025-11-01', 5000),
    ];

    for (const closing of [[], closeYear(base)]) {
      const postings = buildPostings([], [], chart, '2025-12-31', null, closing, base);
      const dmpl = buildDMPL(postings, chart, closing, '2025-12-31');
      const dlpa = buildDLPA(postings, chart, closing, '2025-12-31');

      expect(dmpl.columns.map((c) => c.key)).toEqual(['capital', 'retained']);
      expect(dmpl.initialEquity).toBe(15000);
      expect(dmpl.finalEquity).toBe(30000);
      expect(dmpl.rows.at(-1)!.values.retained).toBe(dlpa.closing);
      expect(dmpl.rows.at(-1)!.values.capital).toBe(10000);
    }
  });

  it('reproduz o caso completo (aumento de capital, lucro, constituição de reservas, dividendos e quotas em tesouraria)', () => {
    // Adiciona subgrupo 2.3.4 Ações/Quotas em Tesouraria (conta redutora do PL)
    const treasuryGroup: ChartAccount = {
      id: id('2.3.4'),
      clientId: 'c',
      code: '2.3.4',
      name: 'Quotas em Tesouraria',
      type: 'EQUITY',
      nature: 'SYNTHETIC',
      level: 3,
      createdAt: '',
      updatedAt: '',
    };
    const treasuryAnalytic: ChartAccount = {
      id: id('2.3.4.01'),
      clientId: 'c',
      code: '2.3.4.01',
      name: '(-) Quotas em Tesouraria',
      type: 'EQUITY',
      nature: 'ANALYTIC',
      parentId: treasuryGroup.id,
      level: 4,
      isContra: true,
      createdAt: '',
      updatedAt: '',
    };
    const accounts = [...chart, treasuryGroup, treasuryAnalytic];

    // Saldos em 31/12/2024: Capital 100.000, Tesouraria (15.000), Reserva Capital 26.000, Reserva Lucros 8.720 → Total 119.720
    const prior: Posting[] = [
      ...p('2.3.1.01', '2024-01-01', -100000),
      ...p('2.3.4.01', '2024-02-01', 15000),
      ...p('2.3.2.01', '2024-03-01', -26000),
      ...p('2.3.2.02', '2024-04-01', -8720),
    ];

    // Movimentações em 2025:
    // 1. Aumento de capital em dinheiro: +5.000
    // 2. Lucro líquido do exercício: Receita 30.000 - Despesa 10.000 = +20.000
    // 3. Dividendos / lucros distribuídos: -5.000
    const yearBankAndResult: Posting[] = [
      ...prior,
      ...p('2.3.1.01', '2025-05-10', -5000),
      ...p('3.1.1.01', '2025-06-15', -30000),
      ...p('3.3.2.06', '2025-07-20', 10000),
      ...p('2.3.3.03', '2025-11-15', 5000),
    ];

    // 4. Destinação do lucro para Reserva de Lucros (1.000) e Reserva de Capital (14.000)
    const manual: JournalEntry[] = [
      manualEntry('2025-12-31', 'Constituição de reserva de lucros', [
        { code: '2.3.3.01', type: 'DEBIT', amount: 1000 },
        { code: '2.3.2.02', type: 'CREDIT', amount: 1000 },
      ]),
      manualEntry('2025-12-31', 'Constituição de reserva de capital', [
        { code: '2.3.3.01', type: 'DEBIT', amount: 14000 },
        { code: '2.3.2.01', type: 'CREDIT', amount: 14000 },
      ]),
    ];

    const postingsBeforeClose = buildPostings([], [], accounts, '2025-12-31', null, manual, yearBankAndResult);
    const closing = closeYear(postingsBeforeClose, accounts);

    for (const entries of [manual, [...manual, ...closing]]) {
      const allPostings = buildPostings([], [], accounts, '2025-12-31', null, entries, yearBankAndResult);
      const dmpl = buildDMPL(allPostings, accounts, entries, '2025-12-31');
      const sheet = buildBalanceSheet(allPostings, accounts, '2025-12-31');

      expect(dmpl.columns.map((c) => c.key)).toEqual(['capital', 'capitalReserves', 'profitReserves', 'group_2.3.4', 'retained']);
      expect(dmpl.initialEquity).toBe(119720);
      expect(dmpl.finalEquity).toBe(139720);
      expect(dmpl.finalEquity).toBe(sheet.totalEquity);

      const first = dmpl.rows[0];
      expect(first.values).toEqual({
        capital: 100000,
        capitalReserves: 26000,
        profitReserves: 8720,
        'group_2.3.4': -15000,
        retained: 0,
      });

      const capRow = dmpl.rows.find((r) => r.label === '(+) Aumento de capital')!;
      expect(capRow.values.capital).toBe(5000);
      expect(capRow.total).toBe(5000);

      const resRow = dmpl.rows.find((r) => r.label === 'Constituição de reservas')!;
      expect(resRow.values).toMatchObject({
        capitalReserves: 14000,
        profitReserves: 1000,
        retained: -15000,
      });
      expect(resRow.total).toBe(0);

      const last = dmpl.rows.at(-1)!;
      expect(last.values).toEqual({
        capital: 105000,
        capitalReserves: 40000,
        profitReserves: 9720,
        'group_2.3.4': -15000,
        retained: 0,
      });
      expect(last.values.capital).toBe(equityOnSheet(sheet, id('2.3.1')));
      expect(last.values.capitalReserves).toBe(equityOnSheet(sheet, id('2.3.2.01')));
      expect(last.values.profitReserves).toBe(equityOnSheet(sheet, id('2.3.2.02')));
      expect(last.values['group_2.3.4']).toBe(equityOnSheet(sheet, id('2.3.4')));
      expect(last.values.retained).toBe(
        equityOnSheet(sheet, id('2.3.3')) + equityOnSheet(sheet, VIRTUAL.PRIOR_RESULTS) + equityOnSheet(sheet, VIRTUAL.CURRENT_RESULT)
      );
    }
  });

  it('reconhece aumento de capital com reservas e reversão de reservas (mutações permutativas com total zero)', () => {
    const prior: Posting[] = [
      ...p('2.3.1.01', '2024-01-01', -50000),
      ...p('2.3.2.02', '2024-06-01', -12000),
      ...p('2.3.3.02', '2024-12-01', 3000),
    ];
    const manual: JournalEntry[] = [
      manualEntry('2025-04-10', 'Aumento de capital com reserva de lucros', [
        { code: '2.3.2.02', type: 'DEBIT', amount: 8000 },
        { code: '2.3.1.01', type: 'CREDIT', amount: 8000 },
      ]),
      manualEntry('2025-05-15', 'Absorção de prejuízo com reserva', [
        { code: '2.3.2.02', type: 'DEBIT', amount: 3000 },
        { code: '2.3.3.02', type: 'CREDIT', amount: 3000 },
      ]),
    ];

    const allPostings = buildPostings([], [], chart, '2025-12-31', null, manual, prior);
    const dmpl = buildDMPL(allPostings, chart, manual, '2025-12-31');

    const capInternal = dmpl.rows.find((r) => r.label === '(+/-) Aumento de capital com reservas ou lucros')!;
    expect(capInternal.values).toMatchObject({ capital: 8000, profitReserves: -8000 });
    expect(capInternal.total).toBe(0);

    const revRow = dmpl.rows.find((r) => r.label === 'Reversão de reservas / absorção de prejuízos')!;
    expect(revRow.values).toMatchObject({ profitReserves: -3000, retained: 3000 });
    expect(revRow.total).toBe(0);

    expect(dmpl.initialEquity).toBe(59000);
    expect(dmpl.finalEquity).toBe(59000);
    expect(dmpl.rows.at(-1)!.values).toEqual({
      capital: 58000,
      profitReserves: 1000,
      retained: 0,
    });
  });

  it('trata os saldos de abertura em 01/01 como Saldo Inicial e mantém a 2.3.3.04 em linha própria', () => {
    const bank: BankAccount = {
      id: 'b',
      clientId: 'c',
      accountKey: 'k',
      nickname: 'Itaú',
      ledgerAccountId: BANK,
      openingBalance: 15000,
      openingDate: '2025-01-01',
      createdAt: '',
      updatedAt: '',
    };
    const openings: OpeningBalances = {
      id: 'c',
      clientId: 'c',
      date: '2025-01-01',
      mode: 'OPENING_BALANCE',
      entries: [{ accountId: id('2.3.1.01'), amount: 10000 }],
      updatedAt: '',
    };
    const manual = [
      manualEntry('2025-06-01', 'Integralização de capital', [
        { code: '1.1.1.02', type: 'DEBIT', amount: 2000 },
        { code: '2.3.1.01', type: 'CREDIT', amount: 2000 },
      ]),
    ];

    const postings = buildPostings([], [bank], chart, '2025-12-31', openings, manual);
    const openLines = openingPostings(openings, [bank], chart);
    const dmpl = buildDMPL(postings, chart, manual, '2025-12-31', openLines);

    expect(dmpl.rows[0].values).toEqual({ capital: 10000, retained: 0 });
    expect(dmpl.rows.find((r) => r.label === '(+/-) Balanço de abertura (2.3.3.04)')?.values.retained).toBe(5000);
    expect(dmpl.rows.find((r) => r.label === '(+) Aumento de capital')?.values.capital).toBe(2000);
    expect(dmpl.rows.at(-1)!.values).toEqual({ capital: 12000, retained: 5000 });
    expect(dmpl.finalEquity).toBe(17000);
  });
});

