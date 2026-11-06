import { describe, expect, it } from 'vitest';
import type { JournalEntry, PrepaidExpense } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import {
  appropriationCloseProblem,
  appropriationDraft,
  appropriationStatus,
  prepaidBalanceAt,
  prepaidEndDate,
  prepaidLockProblem,
  prepaidProblem,
  prepaidSchedule,
  recognitionDraft,
} from '@/lib/prepaid-expenses';

const chart = buildITG1000Chart('c');
const acc = (code: string) => chart.find((a) => a.code === code)!;

function insurance(over: Partial<PrepaidExpense> = {}): PrepaidExpense {
  return {
    id: 'pp1',
    kind: 'INSURANCE',
    description: 'Seguro do veículo Fiat Strada',
    documentRef: '0531.12345',
    use: 'EXPENSE',
    amount: 1410.88,
    startDate: '2026-03-01',
    months: 12,
    assetAccountId: acc('1.1.4.01').id,
    assetAccountCode: '1.1.4.01',
    payableAccountId: acc('2.1.3.05').id,
    payableAccountCode: '2.1.3.05',
    expenseAccountId: acc('3.3.2.18').id,
    expenseAccountCode: '3.3.2.18',
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('despesas antecipadas: cotas', () => {
  it('seguro da aula: R$ 1.410,88 em 12 meses dá R$ 117,57 por mês; a última fecha o total', () => {
    const q = prepaidSchedule(insurance(), null);
    expect(q).toHaveLength(12);
    expect(q[0]).toEqual({ month: '2026-03', cents: 11757, index: 1, posted: true });
    expect(q.slice(0, 11).every((x) => x.cents === 11757)).toBe(true);
    expect(q[11]).toEqual({ month: '2027-02', cents: 11761, index: 12, posted: true });
    expect(q.reduce((s, x) => s + x.cents, 0)).toBe(141088);
    expect(prepaidEndDate(insurance())).toBe('2027-03-01');
    // Saldo a apropriar no ativo depois de março.
    expect(prepaidBalanceAt(insurance(), '2026-03', null)).toBe(129331);
  });

  it('apropriação já lançada: divide o informado pelos meses dela e o resto pelos seguintes', () => {
    const q = prepaidSchedule(insurance({ priorAppropriation: { through: '2026-05', amount: 352.71 } }), null);
    expect(q.slice(0, 3).map((x) => [x.cents, x.posted])).toEqual([
      [11757, false],
      [11757, false],
      [11757, false],
    ]);
    expect(q.filter((x) => x.posted)).toHaveLength(9);
    expect(q.reduce((s, x) => s + x.cents, 0)).toBe(141088);
  });

  it('antes da implantação as cotas ficam na abertura', () => {
    const q = prepaidSchedule(insurance({ startDate: '2025-11-01' }), '2026-01');
    expect(q.filter((x) => !x.posted).map((x) => x.month)).toEqual(['2025-11', '2025-12']);
  });
});

describe('despesas antecipadas: validação e trava', () => {
  it('pede descrição, vigência, valor e contas analíticas', () => {
    expect(prepaidProblem(insurance(), chart)).toBeNull();
    expect(prepaidProblem(insurance({ months: 0 }), chart)).toMatch(/vigência/);
    expect(prepaidProblem(insurance({ amount: 0 }), chart)).toMatch(/valor/);
    expect(prepaidProblem(insurance({ expenseAccountId: acc('3.3.2').id }), chart)).toMatch(/resultado/);
  });

  it('com lançamento em mês fechado, valores não mudam; item novo em mês fechado pede reabertura', () => {
    const saved = insurance({ recognitionEntryId: 'j1' });
    const locked = new Set(['2026-03']);
    expect(prepaidLockProblem(saved, { ...saved, amount: 1500 }, locked, null)).toMatch(/competência fechada/);
    expect(prepaidLockProblem(saved, { ...saved, description: 'Seguro auto' }, locked, null)).toBeNull();
    expect(prepaidLockProblem(null, insurance(), locked, null)).toMatch(/03\/2026.*fechada/);
  });
});

describe('despesas antecipadas: lançamentos', () => {
  it('lançamento inicial na data da apólice: D Seguros a Apropriar / C Seguros a Pagar', () => {
    const { draft } = recognitionDraft(insurance(), chart);
    expect(draft!.date).toBe('2026-03-01');
    expect(draft!.prepaidId).toBe('pp1');
    expect(draft!.lines.map((l) => [l.accountCode, l.type, l.amount])).toEqual([
      ['1.1.4.01', 'DEBIT', 1410.88],
      ['2.1.3.05', 'CREDIT', 1410.88],
    ]);
    expect(draft!.memo).toBe('Apólice de seguro nº 0531.12345 - Seguro do veículo Fiat Strada (vigência de 01/03/2026 a 01/03/2027)');
  });

  it('apropriação do mês no último dia: D Seguros / C Seguros a Apropriar, com a cota no histórico', () => {
    const cost = insurance({ id: 'pp2', use: 'COST', expenseAccountId: acc('3.2.1.05').id, expenseAccountCode: '3.2.1.05', amount: 600, months: 6 });
    const { draft } = appropriationDraft([insurance(), cost], '2026-03', null, chart);
    expect(draft!.date).toBe('2026-03-31');
    expect(draft!.prepaidMonth).toBe('2026-03');
    expect(draft!.lines.map((l) => [l.accountCode, l.type, l.amount])).toEqual([
      ['3.3.2.18', 'DEBIT', 117.57],
      ['1.1.4.01', 'CREDIT', 117.57],
      ['3.2.1.05', 'DEBIT', 100],
      ['1.1.4.01', 'CREDIT', 100],
    ]);
    expect(draft!.lines[0].memo).toBe('Apropriação 1 de 12 - Seguro do veículo Fiat Strada (nº 0531.12345) - março/2026');
  });

  it('situação: pendente, lançada e alterada; fora da vigência, nada', () => {
    const base = { month: '2026-03', implantationMonth: null, accounts: chart };
    const pending = appropriationStatus({ ...base, items: [insurance()], entries: [] });
    expect(pending.kind).toBe('PENDING');
    expect(appropriationCloseProblem(pending, '2026-03')).toMatch(/Lance a apropriação.*03\/2026.*117,57/);
    const draft = appropriationDraft([insurance()], '2026-03', null, chart).draft!;
    const entry = { ...draft, id: 'j', clientId: 'c', entryNumber: 1, createdAt: '', updatedAt: '', createdByUid: 'u' } as JournalEntry;
    expect(appropriationStatus({ ...base, items: [insurance()], entries: [entry] }).kind).toBe('POSTED');
    expect(appropriationStatus({ ...base, items: [insurance({ amount: 1200 })], entries: [entry] }).kind).toBe('PENDING');
    expect(appropriationStatus({ ...base, month: '2027-04', items: [insurance()], entries: [] }).kind).toBe('NONE');
  });
});
