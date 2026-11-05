import { describe, expect, it } from 'vitest';
import type { FixedAsset, JournalEntry } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import {
  assetCost,
  assetPositionAt,
  assetProblem,
  classSummary,
  depreciationCloseProblem,
  depreciationDraft,
  depreciationSchedule,
  depreciationStatus,
  disposalDraft,
  disposalLockProblem,
  isAssetFrozen,
  lockedChangeProblem,
  monthlyQuotaCents,
  pendingDepreciationMonths,
  reconcileWithLedger,
  suggestPriorDepreciation,
} from '@/lib/fixed-assets';

const chart = buildITG1000Chart('c');
const acc = (code: string) => chart.find((a) => a.code === code)!;

function asset(over: Partial<FixedAsset> = {}): FixedAsset {
  const account = acc(over.accountCode ?? '1.2.3.04');
  return {
    id: 'fa1',
    description: 'Veículo de passeio',
    accountId: account.id,
    accountCode: account.code,
    accountName: account.name,
    use: 'EXPENSE',
    acquisitionDate: '2026-03-01',
    inUseDate: '2026-03-01',
    invoiceValue: 72280,
    annualRate: 20,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

const sum = (rows: { cents: number }[]) => rows.reduce((s, r) => s + r.cents, 0);

describe('cotas de depreciação', () => {
  it('caso do veículo (NBC TG 1002): R$ 1.204,67 por mês, 60 cotas, a última ajusta o total', () => {
    const car = asset();
    expect(monthlyQuotaCents(car)).toBe(120467);
    const rows = depreciationSchedule(car, null);
    expect(rows).toHaveLength(60);
    expect(rows[0]).toEqual({ month: '2026-03', cents: 120467, posted: true });
    expect(rows.slice(0, 59).every((r) => r.cents === 120467)).toBe(true);
    expect(rows[59]).toEqual({ month: '2031-02', cents: 120447, posted: true });
    expect(sum(rows)).toBe(7228000);
    const march = assetPositionAt(car, '2026-03', null);
    expect(march).toEqual({ costCents: 7228000, accumulatedCents: 120467, netCents: 7107533 });
  });

  it('primeiro mês proporcional aos dias desde o início de uso (15/03: 17 de 31 dias)', () => {
    const rows = depreciationSchedule(asset({ acquisitionDate: '2026-03-10', inUseDate: '2026-03-15' }), null);
    expect(rows[0]).toEqual({ month: '2026-03', cents: Math.round((120467 * 17) / 31), posted: true });
    expect(rows[1].cents).toBe(120467);
    expect(sum(rows)).toBe(7228000);
    expect(rows).toHaveLength(61);
  });

  it('custo com frete, tributo não recuperável e desconto; residual reduz a base', () => {
    const a = asset({ invoiceValue: 10000, additionalCosts: 500, nonRecoverableTaxes: 300, discounts: 800, residualValue: 1000, annualRate: 10 });
    expect(assetCost(a)).toBe(10000);
    expect(monthlyQuotaCents(a)).toBe(7500); // 9.000 × 10% ÷ 12
    expect(sum(depreciationSchedule(a, null))).toBe(900000);
  });

  it('terreno (taxa zero) não deprecia', () => {
    expect(depreciationSchedule(asset({ accountCode: '1.2.3.01', annualRate: 0 }), null)).toEqual([]);
  });

  it('antes da implantação as cotas ficam na abertura (não lançadas)', () => {
    const rows = depreciationSchedule(asset({ acquisitionDate: '2025-01-01', inUseDate: '2025-01-01' }), '2026-01');
    expect(rows.filter((r) => !r.posted)).toHaveLength(12);
    expect(rows.find((r) => r.month === '2026-01')?.posted).toBe(true);
  });

  it('depreciação já lançada informada: as cotas seguem dela', () => {
    const a = asset({ acquisitionDate: '2025-01-01', inUseDate: '2025-01-01', priorDepreciation: { through: '2025-12', amount: 15000 } });
    const rows = depreciationSchedule(a, '2026-01');
    expect(rows[0]).toEqual({ month: '2025-12', cents: 1500000, posted: false });
    expect(rows[1]).toEqual({ month: '2026-01', cents: 120467, posted: true });
    expect(sum(rows)).toBe(7228000);
  });

  it('baixa: para na data, proporcional; depois dela o bem sai do balanço', () => {
    const a = asset({ disposal: { date: '2026-05-10', reason: 'SALE', journalEntryId: 'j' } });
    const rows = depreciationSchedule(a, null);
    expect(rows.map((r) => r.month)).toEqual(['2026-03', '2026-04', '2026-05']);
    expect(rows[2].cents).toBe(Math.round((120467 * 10) / 31));
    expect(assetPositionAt(a, '2026-04', null).costCents).toBe(7228000);
    expect(assetPositionAt(a, '2026-05', null).costCents).toBe(0);
  });
});

describe('validação e trava', () => {
  it('recusa terreno com taxa, uso antes da compra e conta errada', () => {
    expect(assetProblem(asset({ accountCode: '1.2.3.01', annualRate: 4 }), chart)).toMatch(/Terrenos/);
    expect(assetProblem(asset({ inUseDate: '2026-02-01' }), chart)).toMatch(/antes da data da aquisição/);
    expect(assetProblem(asset({ accountId: acc('1.2.3.07').id }), chart)).toMatch(/conta do bem/);
    expect(assetProblem(asset(), chart)).toBeNull();
  });

  it('bem com cota em mês fechado não muda taxa; descrição pode', () => {
    const before = asset();
    const locked = new Set(['2026-03']);
    expect(isAssetFrozen(before, locked, null)).toBe(true);
    expect(lockedChangeProblem(before, { ...before, annualRate: 10 }, locked, null)).toMatch(/competência fechada/);
    expect(lockedChangeProblem(before, { ...before, description: 'Carro' }, locked, null)).toBeNull();
  });

  it('bem novo com cotas em meses fechados pede a depreciação já lançada', () => {
    const a = asset();
    const locked = new Set(['2026-03', '2026-04']);
    expect(lockedChangeProblem(null, a, locked, null)).toMatch(/03\/2026 a 04\/2026/);
    const prior = suggestPriorDepreciation(a, locked, null);
    expect(prior).toEqual({ through: '2026-04', amount: 2409.34 });
    expect(lockedChangeProblem(null, { ...a, priorDepreciation: prior! }, locked, null)).toBeNull();
  });

  it('baixa só em mês aberto', () => {
    expect(disposalLockProblem(asset(), '2026-04-10', new Set(['2026-04']), null)).toMatch(/fechada/);
    expect(disposalLockProblem(asset(), '2026-04-10', new Set(['2026-05']), null)).toMatch(/depois da baixa/);
    expect(disposalLockProblem(asset(), '2026-04-10', new Set(['2026-03']), null)).toBeNull();
  });
});

describe('lançamento mensal', () => {
  const computer = asset({
    id: 'fa2',
    description: 'Notebook',
    accountCode: '1.2.3.06',
    accountId: acc('1.2.3.06').id,
    accountName: acc('1.2.3.06').name,
    use: 'COST',
    invoiceValue: 6000,
  });

  it('um débito por destino e um crédito por classe, no último dia do mês', () => {
    const { draft, problem } = depreciationDraft([asset(), computer], '2026-03', null, chart);
    expect(problem).toBeNull();
    expect(draft!.date).toBe('2026-03-31');
    expect(draft!.depreciationMonth).toBe('2026-03');
    expect(draft!.memo).toBe('Depreciação e amortização do imobilizado - competência 03/2026');
    const lines = draft!.lines.map((l) => [l.accountCode, l.type, l.amount]);
    expect(lines).toEqual([
      ['3.2.1.04', 'DEBIT', 100],
      ['3.3.2.15', 'DEBIT', 1204.67],
      ['1.2.3.07', 'CREDIT', 1204.67],
      ['1.2.3.07', 'CREDIT', 100],
    ]);
    expect(draft!.lines[2].memo).toBe('Vlr. ref. cota de depreciação de veículos referente ao mês de março/2026');
  });

  it('intangível credita a amortização acumulada', () => {
    const software = asset({ id: 's', accountCode: '1.2.4.01', accountId: acc('1.2.4.01').id, invoiceValue: 1200 });
    const { draft } = depreciationDraft([software], '2026-03', null, chart);
    expect(draft!.lines.find((l) => l.type === 'CREDIT')!.accountCode).toBe('1.2.4.03');
  });

  it('plano sem a conta de custo: bloqueia com o código', () => {
    const noCost = chart.filter((a) => a.code !== '3.2.1.04');
    const status = depreciationStatus({ assets: [computer], month: '2026-03', implantationMonth: null, accounts: noCost, entries: [] });
    expect(status.kind).toBe('BLOCKED');
    expect(status.kind === 'BLOCKED' && status.problem).toMatch(/3\.2\.1\.04/);
    expect(depreciationCloseProblem(status, '2026-03')).toMatch(/Lance a depreciação de 03\/2026 \(R\$\s100,00\)/);
  });

  it('situação: pendente, lançada, alterada e a remover', () => {
    const base = { month: '2026-03', implantationMonth: null, accounts: chart };
    const pending = depreciationStatus({ ...base, assets: [asset()], entries: [] });
    expect(pending.kind).toBe('PENDING');
    expect(depreciationCloseProblem(pending, '2026-03')).toMatch(/Lance a depreciação de 03\/2026/);

    const draft = depreciationDraft([asset()], '2026-03', null, chart).draft!;
    const entry = { ...draft, id: 'j1', clientId: 'c', entryNumber: 1, createdAt: '', updatedAt: '', createdByUid: 'u' } as JournalEntry;
    expect(depreciationStatus({ ...base, assets: [asset()], entries: [entry] }).kind).toBe('POSTED');
    const changed = depreciationStatus({ ...base, assets: [asset({ invoiceValue: 60000 })], entries: [entry] });
    expect(changed.kind).toBe('PENDING');
    expect(changed.kind === 'PENDING' && changed.existing?.id).toBe('j1');
    expect(depreciationStatus({ ...base, assets: [], entries: [entry] }).kind).toBe('REMOVE');
  });

  it('meses abertos que ficaram para trás', () => {
    const months = pendingDepreciationMonths({
      assets: [asset()],
      untilMonth: '2026-06',
      implantationMonth: null,
      lockedMonths: new Set(['2026-04']),
      accounts: chart,
      entries: [],
    });
    expect(months).toEqual(['2026-03', '2026-05', '2026-06']);
  });
});

describe('baixa, conciliação e quadro', () => {
  it('baixa: D acumulada, D perda (valor contábil), C custo', () => {
    const { draft } = disposalDraft(asset(), '2026-04-30', 'SALE', null, chart);
    const lines = draft!.lines.map((l) => [l.accountCode, l.type, l.amount]);
    expect(lines).toEqual([
      ['1.2.3.07', 'DEBIT', 2409.34],
      ['3.3.9.04', 'DEBIT', 69870.66],
      ['1.2.3.04', 'CREDIT', 72280],
    ]);
    expect(draft!.fixedAssetId).toBe('fa1');
    expect(draft!.memo).toBe('Baixa do bem Veículo de passeio por venda');
  });

  it('cadastro × balancete por conta', () => {
    const ledger = new Map([
      [acc('1.2.3.04').id, 72280],
      [acc('1.2.3.07').id, 1000],
      [acc('1.2.3.05').id, 500], // móvel comprado e não cadastrado
    ]);
    const rows = reconcileWithLedger({ assets: [asset()], month: '2026-03', implantationMonth: null, accounts: chart, ledgerBalance: (id) => ledger.get(id) ?? 0 });
    expect(rows.map((r) => [r.accountCode, r.register, r.ledger, r.difference])).toEqual([
      ['1.2.3.04', 72280, 72280, 0],
      ['1.2.3.05', 0, 500, 500],
      ['1.2.3.07', 1204.67, 1000, -204.67],
    ]);
  });

  it('quadro por classe com as taxas', () => {
    const rows = classSummary([asset()], '2026-12', null, chart);
    expect(rows).toEqual([{ accountCode: '1.2.3.04', accountName: 'Veículos', rates: [20], cost: 72280, accumulated: 12046.7, net: 60233.3 }]);
  });
});
