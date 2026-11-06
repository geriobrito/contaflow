import { describe, expect, it } from 'vitest';
import type { FinancingContract, JournalEntry } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import {
  addMonths,
  contractPositionAt,
  expectedBalancesByAccount,
  financingCloseProblem,
  financingLockProblem,
  financingProblem,
  financingRoutineDraft,
  financingRoutineStatus,
  floatingPaymentSplit,
  initialEntryDraft,
  initialSplit,
  installmentSchedule,
  pendingFinancingMonths,
  priceRate,
  routineRows,
} from '@/lib/financing';

const chart = buildITG1000Chart('c');
const acc = (code: string) => chart.find((a) => a.code === code)!;
const ids = (codes: Record<string, string>) =>
  Object.fromEntries(Object.entries(codes).flatMap(([k, code]) => [[`${k}AccountId`, acc(code).id], [`${k}AccountCode`, code]]));

/** Financiamento do veículo da aula: R$ 72.280 + R$ 3.899,94 de encargos, 36 × R$ 2.574,15 a 1,10% a.m. */
function vehicle(over: Partial<FinancingContract> = {}): FinancingContract {
  return {
    id: 'f1',
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
    ...(ids({
      counterpart: '2.1.2.01',
      shortTerm: '2.1.4.02',
      longTerm: '2.2.1.01',
      chargesShort: '2.1.4.03',
      chargesLong: '2.2.1.02',
      upfrontExpense: '3.4.1.01.006',
      interestExpense: '3.4.1.01.005',
    }) as object),
    createdAt: '',
    updatedAt: '',
    ...over,
  } as FinancingContract;
}

/** Parcelamento do Simples da aula: R$ 8.066,35 consolidados em 26 parcelas-base de R$ 310,24 (Selic). */
function simples(over: Partial<FinancingContract> = {}): FinancingContract {
  return {
    id: 'f2',
    kind: 'INSTALLMENT_PLAN',
    description: 'Parcelamento do Simples Nacional',
    date: '2025-12-05',
    principal: 8066.35,
    installments: 26,
    installmentAmount: 310.24,
    firstDueDate: '2025-12-09',
    interestMode: 'FLOATING',
    ...(ids({ counterpart: '2.1.5.01', shortTerm: '2.1.5.05', longTerm: '2.2.2.01', interestExpense: '3.4.1.01.007' }) as object),
    createdAt: '',
    updatedAt: '',
    ...over,
  } as FinancingContract;
}

describe('tabela Price', () => {
  it('caso da aula: juros do 1º mês R$ 837,98, amortização R$ 1.736,17 e saldo R$ 74.443,77', () => {
    const rows = installmentSchedule(vehicle());
    expect(rows).toHaveLength(36);
    expect(rows[0]).toMatchObject({ n: 1, dueDate: '2026-04-07', payment: 257415, interest: 83798, amortization: 173617, balance: 7444377 });
    expect(rows[35].balance).toBe(0);
    // Total de juros = parcelas − valor financiado, exato.
    expect(rows.reduce((s, r) => s + r.interest, 0)).toBe(92669_40 - 76179_94);
    expect(rows.reduce((s, r) => s + r.amortization, 0)).toBe(7617994);
  });

  it('sem a taxa, calcula pela parcela', () => {
    expect(priceRate(76179.94, 2574.15, 36)).toBeCloseTo(1.1, 2);
    const rows = installmentSchedule(vehicle({ monthlyRate: undefined }));
    expect(Math.abs(rows[0].interest - 83798)).toBeLessThanOrEqual(5);
  });

  it('vencimentos mês a mês, no mesmo dia (31 vira o último dia)', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-04-07', 35)).toBe('2029-03-07');
  });
});

describe('lançamento inicial', () => {
  it('curto prazo até 31/12 do ano seguinte: 21 parcelas no curto (R$ 54.057,15) e 15 no longo (R$ 38.612,25)', () => {
    const s = initialSplit(vehicle());
    expect([s.shortCount, s.longCount]).toEqual([21, 15]);
    expect([s.shortPayments, s.longPayments]).toEqual([5405715, 3861225]);
    expect(Math.abs(s.shortInterest - 1329325)).toBeLessThanOrEqual(15);
    expect(s.shortInterest + s.longInterest).toBe(1648946);
  });

  it('D fornecedor, D encargos da contratação, D encargos a transcorrer, C financiamento', () => {
    const { draft, problem } = initialEntryDraft(vehicle(), chart);
    expect(problem).toBeNull();
    expect(draft!.date).toBe('2026-03-01');
    expect(draft!.financingId).toBe('f1');
    const lines = draft!.lines.map((l) => [l.accountCode, l.type]);
    expect(lines).toEqual([
      ['2.1.2.01', 'DEBIT'],
      ['3.4.1.01.006', 'DEBIT'],
      ['2.1.4.03', 'DEBIT'],
      ['2.2.1.02', 'DEBIT'],
      ['2.1.4.02', 'CREDIT'],
      ['2.2.1.01', 'CREDIT'],
    ]);
    expect(draft!.lines[0].amount).toBe(72280);
    expect(draft!.lines[1].amount).toBe(3899.94);
    expect(draft!.totalAmount).toBe(92669.4);
  });

  it('parcelamento: 13 parcelas no curto (R$ 4.033,12) e 13 no longo (R$ 4.033,23), sem encargos a transcorrer', () => {
    const { draft } = initialEntryDraft(simples(), chart);
    expect(draft!.lines.map((l) => [l.accountCode, l.type, l.amount])).toEqual([
      ['2.1.5.01', 'DEBIT', 8066.35],
      ['2.1.5.05', 'CREDIT', 4033.12],
      ['2.2.2.01', 'CREDIT', 4033.23],
    ]);
  });
});

describe('rotina mensal', () => {
  it('juros da parcela que vence no mês: D juros / C encargos a transcorrer, no último dia', () => {
    const { draft } = financingRoutineDraft([vehicle()], '2026-04', null, chart);
    expect(draft!.date).toBe('2026-04-30');
    expect(draft!.financingMonth).toBe('2026-04');
    expect(draft!.lines.map((l) => [l.accountCode, l.type, l.amount])).toEqual([
      ['3.4.1.01.005', 'DEBIT', 837.98],
      ['2.1.4.03', 'CREDIT', 837.98],
    ]);
    expect(draft!.lines[0].memo).toBe('Juros da parcela 1 de 36 - Financiamento do veículo - abril/2026');
    // Março (mês do contrato) não tem parcela: nada a lançar.
    expect(financingRoutineDraft([vehicle()], '2026-03', null, chart).draft).toBeNull();
  });

  it('em dezembro de 2027, as parcelas de 2028 passam do longo para o curto prazo', () => {
    const rows = routineRows(vehicle(), null).filter((r) => r.kind === 'reclass');
    expect(rows.map((r) => [r.month, r.count])).toEqual([['2027-12', 12], ['2028-12', 3]]);
    const { draft } = financingRoutineDraft([vehicle()], '2027-12', null, chart);
    const reclass = draft!.lines.filter((l) => l.memo?.startsWith('Transferência'));
    expect(reclass.map((l) => [l.accountCode, l.type, l.amount])).toEqual([
      ['2.2.1.01', 'DEBIT', 30889.8],
      ['2.1.4.02', 'CREDIT', 30889.8],
      ['2.1.4.03', 'DEBIT', reclass[2].amount],
      ['2.2.1.02', 'CREDIT', reclass[2].amount],
    ]);
  });

  it('pós-fixado não tem juros na rotina; o pagamento acima da parcela-base vai para juros', () => {
    expect(routineRows(simples(), null).filter((r) => r.kind === 'interest')).toEqual([]);
    const split = floatingPaymentSplit([simples()], acc('2.1.5.05').id, -33450);
    expect(split).toMatchObject({ principalCents: 31024, interestCents: 2426 });
    expect(floatingPaymentSplit([simples()], acc('2.1.5.05').id, -31024)).toBeNull();
    expect(floatingPaymentSplit([vehicle()], acc('2.1.4.02').id, -300000)).toBeNull();
  });

  it('situação, aviso de fechamento e meses pendentes', () => {
    const base = { month: '2026-04', implantationMonth: null, accounts: chart };
    const pending = financingRoutineStatus({ ...base, contracts: [vehicle()], entries: [] });
    expect(pending.kind).toBe('PENDING');
    expect(financingCloseProblem(pending, '2026-04')).toMatch(/Lance os juros de empréstimos e financiamentos de 04\/2026/);
    const draft = financingRoutineDraft([vehicle()], '2026-04', null, chart).draft!;
    const entry = { ...draft, id: 'j', clientId: 'c', entryNumber: 1, createdAt: '', updatedAt: '', createdByUid: 'u' } as JournalEntry;
    expect(financingRoutineStatus({ ...base, contracts: [vehicle()], entries: [entry] }).kind).toBe('POSTED');
    const months = pendingFinancingMonths({ contracts: [vehicle()], untilMonth: '2026-06', implantationMonth: null, lockedMonths: new Set(['2026-05']), accounts: chart, entries: [entry] });
    expect(months).toEqual(['2026-06']);
  });
});

describe('validação, trava e posição', () => {
  it('parcelas que não cobrem o financiado e contas faltando', () => {
    expect(financingProblem(vehicle(), chart)).toBeNull();
    expect(financingProblem(vehicle({ installmentAmount: 1000 }), chart)).toMatch(/somam menos/);
    expect(financingProblem(vehicle({ firstDueDate: '2026-02-01' }), chart)).toMatch(/vencimento/);
    expect(financingProblem(vehicle({ chargesShortAccountId: undefined }), chart)).toMatch(/encargos a transcorrer/);
  });

  it('com juros lançados em mês fechado, o contrato não muda; contrato novo em mês fechado pede reabertura', () => {
    const saved = vehicle({ initialEntryId: 'j0' });
    const locked = new Set(['2026-04']);
    expect(financingLockProblem(saved, { ...saved, installmentAmount: 2600 }, locked, null)).toMatch(/competência fechada/);
    expect(financingLockProblem(saved, { ...saved, description: 'Carro' }, locked, null)).toBeNull();
    expect(financingLockProblem(null, vehicle(), new Set(['2026-03']), null)).toMatch(/03\/2026.*fechada/);
  });

  it('saldo devedor e saldos esperados por conta no fim da competência', () => {
    const p = contractPositionAt(vehicle(), '2026-04');
    expect(p.paidCount).toBe(1);
    expect(p.balance).toBe(7444377);
    expect(p.shortPayments).toBe(20 * 257415);
    const expected = expectedBalancesByAccount([vehicle()], '2026-04');
    expect(expected.get(acc('2.1.4.02').id)).toBe(20 * 257415);
    expect(expected.get(acc('2.2.1.01').id)).toBe(15 * 257415);
  });
});
