import { describe, expect, it } from 'vitest';
import type { ChartAccount, JournalEntry, PeriodLock } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { buildBalanceSheet, buildPostings, VIRTUAL, type Posting } from '@/lib/ledger';
import { buildDRE } from '@/lib/dre/build';
import { journalEntryProblem, MAX_JOURNAL_LINES } from '@/lib/journal';
import {
  buildClosingDrafts,
  buildDLPA,
  closingEquity,
  closingTransfer,
  missingClosingAccounts,
  resultBalances,
  withoutClosingOf,
  yearClosingState,
  type ClosingDraft,
} from '@/lib/year-closing';

const chart = buildITG1000Chart('c', '2025-01-01T00:00:00.000Z');
const id = (code: string) => `c_itg22_${code}`;
const BANK = id('1.1.1.02');
const p = (code: string, date: string, value: number): Posting[] => [
  { accountId: id(code), date, value },
  { accountId: BANK, date, value: -value },
];

// 2024: receita de 500 (não encerrada). 2025: receita de 1.000 e despesa de 300 → lucro de 700.
const base: Posting[] = [...p('3.1.1.01', '2024-06-01', -500), ...p('3.1.1.01', '2025-03-10', -1000), ...p('3.3.2.06', '2025-04-10', 300)];

const lock = (month: string): PeriodLock => ({ id: `c_${month}`, clientId: 'c', month, lockedAt: 'x', lockedByUid: 'u' });
const asEntries = (drafts: ClosingDraft[]): JournalEntry[] =>
  drafts.map((d, i) => ({ ...d, id: `je_${i}`, clientId: 'c', entryNumber: 10 + i, createdAt: '', updatedAt: '', createdByUid: 'u' }));
const close = (postings: Posting[], accounts: ChartAccount[] = chart) =>
  asEntries(buildClosingDrafts('2025', resultBalances(postings, accounts, '2025'), accounts, closingEquity(postings, accounts, '2025')));
const linesOf = (d: ClosingDraft) => d.lines.map((l) => [l.accountCode, l.type, l.amount]);
const sheetAt = (date: string, postings: Posting[], entries: JournalEntry[]) => buildBalanceSheet(buildPostings([], [], chart, date, null, entries, postings), chart, date);
const equity = (sheet: ReturnType<typeof buildBalanceSheet>, accountId: string) => sheet.equity.find((l) => l.accountId === accountId)?.value ?? 0;

describe('lançamentos de encerramento', () => {
  it('zera as contas de resultado contra a ARE e leva o lucro a Lucros Acumulados', () => {
    const drafts = buildClosingDrafts('2025', resultBalances(base, chart, '2025'), chart);
    expect(drafts).toHaveLength(2);
    expect(drafts.every((d) => d.date === '2025-12-31' && d.category === 'CLOSING' && d.yearClosing === '2025')).toBe(true);
    expect(drafts[0].lines.map((l) => [l.accountCode, l.type, l.amount])).toEqual([
      ['3.1.1.01', 'DEBIT', 1000],
      ['3.3.2.06', 'CREDIT', 300],
      ['5.1.1.01', 'CREDIT', 700],
    ]);
    expect(drafts[1].lines.map((l) => [l.accountCode, l.type, l.amount])).toEqual([
      ['5.1.1.01', 'DEBIT', 700],
      ['2.3.3.01', 'CREDIT', 700],
    ]);
    for (const d of drafts) expect(journalEntryProblem(d)).toBeNull();
  });

  it('prejuízo vai para Prejuízos Acumulados', () => {
    const loss = [...p('3.1.1.01', '2025-03-10', -100), ...p('3.3.2.06', '2025-04-10', 400)];
    const last = buildClosingDrafts('2025', resultBalances(loss, chart, '2025'), chart).at(-1)!;
    expect(last.lines.map((l) => [l.accountCode, l.type, l.amount])).toEqual([
      ['2.3.3.02', 'DEBIT', 300],
      ['5.1.1.01', 'CREDIT', 300],
    ]);
  });

  it(`divide em partes de até ${MAX_JOURNAL_LINES} partidas`, () => {
    // Todas as contas de resultado analíticas (mais de 19), menos a receita principal e a ARE.
    const expenses = chart.filter((a) => a.code.startsWith('3.') && a.nature === 'ANALYTIC' && !['3.1.1.01', '5.1.1.01'].includes(a.code));
    expect(expenses.length).toBeGreaterThan(MAX_JOURNAL_LINES);
    const many = [...p('3.1.1.01', '2025-01-05', -10000), ...expenses.flatMap((a) => p(a.code, '2025-02-01', 10))];
    const drafts = buildClosingDrafts('2025', resultBalances(many, chart, '2025'), chart);
    expect(drafts.length).toBeGreaterThan(2);
    for (const d of drafts) {
      expect(d.lines.length).toBeLessThanOrEqual(MAX_JOURNAL_LINES);
      expect(journalEntryProblem(d)).toBeNull();
    }
    const zeroed = new Set(drafts.flatMap((d) => d.lines.map((l) => l.accountCode)));
    expect(zeroed.has('3.1.1.01') && expenses.every((a) => zeroed.has(a.code))).toBe(true);
  });

  it('sem resultado, nada a lançar; faltando a ARE, ela entra pelo modelo', () => {
    expect(buildClosingDrafts('2025', [], chart)).toEqual([]);
    const withoutAre = chart.filter((a) => !a.code.startsWith('5') && !a.code.startsWith('2.3.3'));
    expect(missingClosingAccounts('c', withoutAre).map((a) => a.code).sort()).toEqual(['2.3.3', '2.3.3.01', '2.3.3.02', '5', '5.1', '5.1.1', '5.1.1.01']);
    expect(() => buildClosingDrafts('2025', resultBalances(base, withoutAre, '2025'), withoutAre)).toThrow(/5\.1\.1\.01/);
  });
});

describe('razão com o exercício encerrado', () => {
  const entries = close(base);

  it('balanço em 31/12: sem resultado do exercício, lucro em Lucros Acumulados; continua fechando', () => {
    const sheet = sheetAt('2025-12-31', base, entries);
    expect(equity(sheet, VIRTUAL.CURRENT_RESULT)).toBe(0);
    expect(equity(sheet, id('2.3.3.01'))).toBe(700);
    expect(equity(sheet, VIRTUAL.PRIOR_RESULTS)).toBe(500); // 2024 não foi encerrado: continua virtual
    expect(sheet.difference).toBe(0);
  });

  it('no ano seguinte, só o que não foi encerrado aparece como resultados anteriores', () => {
    const sheet = sheetAt('2026-06-30', base, entries);
    expect(equity(sheet, VIRTUAL.PRIOR_RESULTS)).toBe(500);
    expect(equity(sheet, id('2.3.3.01'))).toBe(700);
    // Sem o encerramento, os 700 também seriam "resultados anteriores" (cálculo virtual de sempre).
    expect(equity(sheetAt('2026-06-30', base, []), VIRTUAL.PRIOR_RESULTS)).toBe(1200);
  });

  it('a DRE ignora o encerramento, e a conferência soma o que ele transferiu', () => {
    expect(buildDRE([], chart, { start: '2025-01-01', end: '2025-12-31' }, entries).netResult).toBe(0);
    expect(closingTransfer(entries, chart, '2025', '2025-12-31')).toBe(700);
    expect(closingTransfer(entries, chart, '2025', '2025-12-30')).toBe(0);
  });
});

describe('situação do exercício', () => {
  const state = (entries: JournalEntry[], locks: PeriodLock[], postings = base, extra: Partial<Parameters<typeof yearClosingState>[0]> = {}) =>
    yearClosingState({ year: '2025', postings, accounts: chart, journalEntries: entries, locks, ...extra });

  it('só encerra com dezembro fechado', () => {
    expect(state([], []).canClose).toBe(false);
    expect(state([], []).blockers.join(' ')).toMatch(/dezembro/);
    const ok = state([], [lock('2025-12')]);
    expect(ok).toMatchObject({ canClose: true, closed: false, netResult: 700 });
  });

  it('avisa das competências abertas e recusa exercício anterior à implantação', () => {
    const s = state([], [lock('2025-12')], base, { monthsWithData: ['2025-03', '2025-04', '2025-12'] });
    expect(s.warnings.join(' ')).toMatch(/março.*abril/);
    expect(s.canClose).toBe(true);
    // Implantação no início do dia: um exercício que termina antes dela não se encerra no sistema.
    expect(state([], [lock('2025-12')], base, { implantation: '2026-01-01' }).canClose).toBe(false);
    expect(state([], [lock('2025-12')], base, { implantation: '2025-01-01' }).canClose).toBe(true);
  });

  it('encerrado e em dia; lançamento posterior o deixa desatualizado', () => {
    const entries = close(base);
    expect(state(entries, [lock('2025-12')])).toMatchObject({ closed: true, stale: false, residual: 0, canClose: false });
    const later = [...base, ...p('3.3.2.07', '2025-12-20', 50)];
    expect(state(entries, [lock('2025-12')], later)).toMatchObject({ closed: true, stale: true, residual: -50 });
  });

  it('a base da apuração exclui só o encerramento do próprio exercício', () => {
    const entries = close(base);
    const other = { ...entries[0], id: 'x', yearClosing: '2024' };
    expect(withoutClosingOf([...entries, other], '2025')).toEqual([other]);
  });
});

describe('DLPA', () => {
  const withDistribution = [...base, ...p('2.3.3.03', '2025-11-01', 200)];

  it('saldo inicial + resultado − distribuições = saldo final, com ou sem encerramento', () => {
    for (const entries of [[], close(withDistribution)]) {
      const postings = buildPostings([], [], chart, '2025-12-31', null, entries, withDistribution);
      const d = buildDLPA(postings, chart, entries, '2025-12-31');
      expect(d).toMatchObject({ opening: 500, adjustments: 0, netResult: 700, distributions: -200, closing: 1000 });
      expect(d.rows.map((r) => r.value)).toEqual([500, 0, 700, -200, 1000]);
    }
  });

  it('o saldo final confere com lucros acumulados e resultados no balanço', () => {
    const entries = close(withDistribution);
    const sheet = sheetAt('2025-12-31', withDistribution, entries);
    const fromSheet = equity(sheet, id('2.3.3')) + equity(sheet, VIRTUAL.PRIOR_RESULTS) + equity(sheet, VIRTUAL.CURRENT_RESULT);
    const postings = buildPostings([], [], chart, '2025-12-31', null, entries, withDistribution);
    expect(buildDLPA(postings, chart, entries, '2025-12-31').closing).toBe(fromSheet);
  });
});

describe('lucros distribuídos (2.3.3.03) no encerramento', () => {
  // Lucro de 700 em 2025 e retiradas de 200.
  const year = [...p('3.1.1.01', '2025-03-10', -1000), ...p('3.3.2.06', '2025-04-10', 300), ...p('2.3.3.03', '2025-11-01', 200)];
  // Lucro de 100 e retiradas de 300: Lucros Acumulados terminaria devedora em 200.
  const over = [...p('3.1.1.01', '2025-03-10', -400), ...p('3.3.2.06', '2025-04-10', 300), ...p('2.3.3.03', '2025-11-01', 300)];

  it('baixa a 2.3.3.03 contra Lucros Acumulados em 31/12', () => {
    const entries = close(year);
    expect(linesOf(entries.at(-1)!)).toEqual([
      ['2.3.3.01', 'DEBIT', 200],
      ['2.3.3.03', 'CREDIT', 200],
    ]);
    for (const e of entries) expect(journalEntryProblem(e)).toBeNull();
    const sheet = sheetAt('2025-12-31', year, entries);
    expect(equity(sheet, id('2.3.3.03'))).toBe(0);
    expect(equity(sheet, id('2.3.3.01'))).toBe(500);
    expect(sheet.difference).toBe(0);
  });

  it('saldo devedor que sobra em Lucros Acumulados vai para Prejuízos Acumulados', () => {
    const entries = close(over);
    expect(entries.slice(-2).map(linesOf)).toEqual([
      [['2.3.3.01', 'DEBIT', 300], ['2.3.3.03', 'CREDIT', 300]],
      [['2.3.3.02', 'DEBIT', 200], ['2.3.3.01', 'CREDIT', 200]],
    ]);
    const sheet = sheetAt('2025-12-31', over, entries);
    expect(equity(sheet, id('2.3.3.01'))).toBe(0);
    expect(equity(sheet, id('2.3.3.03'))).toBe(0);
    const s = yearClosingState({ year: '2025', postings: over, accounts: chart, journalEntries: [], locks: [lock('2025-12')] });
    expect(s).toMatchObject({ netResult: 100, distributionTransfer: 300, deficitTransfer: 200 });
  });

  it('a DLPA mostra as mesmas retiradas antes e depois do encerramento, e confere com o balanço', () => {
    for (const postings of [year, over]) {
      const rows = [[], close(postings)].map((entries) => {
        const d = buildDLPA(buildPostings([], [], chart, '2025-12-31', null, entries, postings), chart, entries, '2025-12-31');
        const sheet = sheetAt('2025-12-31', postings, entries);
        expect(d.closing).toBe(equity(sheet, id('2.3.3')) + equity(sheet, VIRTUAL.CURRENT_RESULT));
        return d.rows;
      });
      expect(rows[1]).toEqual(rows[0]);
      expect(rows[0].find((r) => r.label === '(-) Lucros distribuídos')!.value).toBe(postings === year ? -200 : -300);
    }
  });

  it('encerramento sem a baixa da 2.3.3.03 fica desatualizado', () => {
    const old = asEntries(buildClosingDrafts('2025', resultBalances(year, chart, '2025'), chart));
    expect(yearClosingState({ year: '2025', postings: year, accounts: chart, journalEntries: old, locks: [lock('2025-12')] }).stale).toBe(true);
    expect(yearClosingState({ year: '2025', postings: year, accounts: chart, journalEntries: close(year), locks: [lock('2025-12')] }).stale).toBe(false);
  });
});

describe('balanço de abertura (2.3.3.04) no encerramento e na DLPA', () => {
  // Abertura em 01/01/2025: banco 3.000 e capital 1.000 → 2.000 credora na 2.3.3.04. Lucro de 700 no ano.
  // `p` já debita o banco pelo capital (1.000); os outros 2.000 do banco têm contrapartida na 2.3.3.04.
  const opening = [...p('2.3.1.01', '2025-01-01', -1000), { accountId: BANK, date: '2025-01-01', value: 2000 }, { accountId: id('2.3.3.04'), date: '2025-01-01', value: -2000 }];
  const year = [...opening, ...p('3.1.1.01', '2025-03-10', -1000), ...p('3.3.2.06', '2025-04-10', 300)];
  const drafts = (postings: Posting[]) => buildClosingDrafts('2025', resultBalances(postings, chart, '2025'), chart, closingEquity(postings, chart, '2025'));

  it('zera a 2.3.3.04 em 31/12 contra Lucros Acumulados (credora) ou Prejuízos Acumulados (devedora)', () => {
    const last = drafts(year).at(-1)!;
    expect(last.lines.map((l) => [l.accountCode, l.type, l.amount])).toEqual([
      ['2.3.3.04', 'DEBIT', 2000],
      ['2.3.3.01', 'CREDIT', 2000],
    ]);
    expect(journalEntryProblem(last)).toBeNull();
    // Empréstimo de sócios 5.000 e banco 1.000: 4.000 devedora na 2.3.3.04.
    const debit = [...p('2.2.2.02', '2025-01-01', -5000), { accountId: BANK, date: '2025-01-01', value: -4000 }, { accountId: id('2.3.3.04'), date: '2025-01-01', value: 4000 }];
    expect(drafts(debit).at(-1)!.lines.map((l) => [l.accountCode, l.type, l.amount])).toEqual([
      ['2.3.3.02', 'DEBIT', 4000],
      ['2.3.3.04', 'CREDIT', 4000],
    ]);
  });

  it('encerra mesmo sem resultado no ano, quando só a 2.3.3.04 tem saldo', () => {
    const s = yearClosingState({ year: '2025', postings: opening, accounts: chart, journalEntries: [], locks: [lock('2025-12')] });
    expect(s).toMatchObject({ canClose: true, netResult: 0, openingTransfer: 2000 });
    expect(drafts(opening)).toHaveLength(1);
  });

  it('a DLPA mostra a linha do balanço de abertura e confere com o balanço, antes e depois do encerramento', () => {
    for (const entries of [[], asEntries(drafts(year))]) {
      const postings = buildPostings([], [], chart, '2025-12-31', null, entries, year);
      const d = buildDLPA(postings, chart, entries, '2025-12-31');
      expect(d).toMatchObject({ opening: 0, openingBalance: 2000, adjustments: 0, netResult: 700, closing: 2700 });
      expect(d.rows.map((r) => r.label)).toContain('(+/-) Balanço de abertura (2.3.3.04)');
      const sheet = sheetAt('2025-12-31', year, entries);
      expect(d.closing).toBe(equity(sheet, id('2.3.3')) + equity(sheet, VIRTUAL.CURRENT_RESULT));
    }
    // Depois do encerramento, a 2.3.3.04 fica zerada e os 2.000 estão em Lucros Acumulados.
    const closed = sheetAt('2025-12-31', year, asEntries(drafts(year)));
    expect(equity(closed, id('2.3.3.04'))).toBe(0);
    expect(equity(closed, id('2.3.3.01'))).toBe(2700);
  });

  it('abertura antes de 1º de janeiro também sai na linha própria, fora do saldo inicial', () => {
    const shift = (ps: Posting[]) => ps.map((x) => (x.date === '2025-01-01' ? { ...x, date: '2024-12-31' } : x));
    const early = shift(year);
    for (const entries of [[], asEntries(drafts(early))]) {
      const d = buildDLPA(buildPostings([], [], chart, '2025-12-31', null, entries, early), chart, entries, '2025-12-31');
      expect(d).toMatchObject({ opening: 0, openingBalance: 2000, netResult: 700, closing: 2700 });
      expect(d.rows[1]).toEqual({ kind: 'movement', label: '(+/-) Balanço de abertura (2.3.3.04)', value: 2000 });
    }
    // Encerrado em 2025, no ano seguinte os 2.000 já são saldo anterior em Lucros Acumulados.
    const entries = asEntries(drafts(early));
    const next = buildDLPA(buildPostings([], [], chart, '2026-12-31', null, entries, early), chart, entries, '2026-12-31');
    expect(next).toMatchObject({ opening: 2700, openingBalance: 0 });
  });
});
