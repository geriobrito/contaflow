import { describe, expect, it } from 'vitest';
import type { FinancingContract, FixedAsset, InvestmentAccount, PrepaidExpense, StockControl } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { checkOpeningAgainstRegisters, registerExpectations, type OpeningRegisters } from '@/lib/opening-registers';

const chart = buildITG1000Chart('c');
const acc = (code: string) => chart.find((a) => a.code === code)!;
const veic = acc('1.2.3.04');
const deprec = acc('1.2.3.07');

// Veículo de R$ 60.000 a 20% a.a. (R$ 1.000/mês) em uso desde 01/01/2025; abertura em 01/03/2026.
const car: FixedAsset = {
  id: 'a1',
  description: 'Fiorino',
  accountId: veic.id,
  accountCode: veic.code,
  use: 'EXPENSE',
  acquisitionDate: '2025-01-01',
  inUseDate: '2025-01-01',
  invoiceValue: 60000,
  annualRate: 20,
  createdAt: '',
  updatedAt: '',
};

// Seguro de R$ 1.200 em 12 meses desde 10/10/2025: 5 cotas (out a fev) apropriadas antes da abertura.
const insurance: PrepaidExpense = {
  id: 'p1',
  kind: 'INSURANCE',
  description: 'Seguro',
  use: 'EXPENSE',
  amount: 1200,
  startDate: '2025-10-10',
  months: 12,
  assetAccountId: 'x-seg',
  assetAccountCode: '1.1.4.01',
  payableAccountId: 'y',
  payableAccountCode: '2.1.3.05',
  expenseAccountId: 'z',
  expenseAccountCode: '3.3.2.10',
  createdAt: '',
  updatedAt: '',
};

// Empréstimo de R$ 2.400 em 24 parcelas de R$ 120 (R$ 480 de juros), de 05/01/2026 a 05/12/2027.
const loan: FinancingContract = {
  id: 'f1',
  kind: 'LOAN',
  description: 'Capital de giro',
  date: '2025-12-05',
  principal: 2400,
  installments: 24,
  installmentAmount: 120,
  firstDueDate: '2026-01-05',
  interestMode: 'PREFIXED',
  counterpartAccountId: 'b',
  counterpartAccountCode: '1.1.1.02',
  shortTermAccountId: 's',
  shortTermAccountCode: '2.1.1.01',
  longTermAccountId: 'l',
  longTermAccountCode: '2.2.1.01',
  chargesShortAccountId: 'cs',
  chargesShortAccountCode: '2.1.1.02',
  chargesLongAccountId: 'cl',
  chargesLongAccountCode: '2.2.1.02',
  interestExpenseAccountId: 'j',
  interestExpenseAccountCode: '3.4.1.01',
  createdAt: '',
  updatedAt: '',
};

const cdb: InvestmentAccount = { id: 'i1', description: 'CDB', ledgerAccountId: 'cdb', ledgerAccountCode: '1.1.1.03', startMonth: '2025-06', balances: { '2026-02': 5000.5 }, createdAt: '', updatedAt: '' };
const stock: StockControl = { id: 'c', clientId: 'c', stockAccountId: 'est', stockAccountCode: '1.1.3.01', costAccountId: 'k', costAccountCode: '3.2.1.01', startMonth: '2025-01', frequency: 'MONTHLY', counts: { '2026-02': 8000 }, updatedAt: '' };

const reg: OpeningRegisters = { assets: [car], prepaid: [insurance], contracts: [loan], investments: [cdb], stock };
const extra = [
  { id: 'x-seg', code: '1.1.4.01' },
  { id: 's', code: '2.1.1.01' },
  { id: 'l', code: '2.2.1.01' },
  { id: 'cs', code: '2.1.1.02' },
  { id: 'cl', code: '2.2.1.02' },
  { id: 'cdb', code: '1.1.1.03' },
  { id: 'est', code: '1.1.3.01' },
].map((a) => ({ ...a, name: a.code, clientId: 'c', type: 'ASSET', nature: 'ANALYTIC', level: 4 }) as never);
const accounts = [...chart.filter((a) => !extra.some((e: { code: string }) => e.code === a.code)), ...extra];

const byCode = (date: string) => Object.fromEntries(registerExpectations(reg, date, accounts).map((e) => [e.accountCode, e]));

describe('saldos que os cadastros esperam na abertura', () => {
  it('imobilizado: custo e depreciação acumulada até o mês anterior', () => {
    const e = byCode('2026-03-01');
    expect(e['1.2.3.04']).toMatchObject({ accountId: veic.id, control: 'depreciation', cents: 6_000_000, parts: ['1 bem(ns)'] });
    // jan/2025 a fev/2026: 14 cotas de R$ 1.000.
    expect(e['1.2.3.07']).toMatchObject({ accountId: deprec.id, cents: 1_400_000, parts: ['1 bem(ns)', 'até 02/2026'] });
  });

  it('despesas antecipadas, contratos, aplicação e estoque', () => {
    const e = byCode('2026-03-01');
    // 12 cotas de R$ 100; 5 (out a fev) já apropriadas.
    expect(e['1.1.4.01'].cents).toBe(70_000);
    // Parcelas de mar/2026 a dez/2027: 10 no curto (até 31/12/2026) e 12 no longo.
    expect(e['2.1.1.01']).toMatchObject({ cents: 120_000, parts: ['1 contrato(s)', '10 parcela(s) no curto prazo'] });
    expect(e['2.2.1.01'].cents).toBe(144_000);
    expect(e['2.1.1.02'].cents + e['2.2.1.02'].cents).toBeLessThan(48_000);
    expect(e['2.1.1.02'].cents).toBeGreaterThan(e['2.2.1.02'].cents);
    expect(e['1.1.1.03']).toMatchObject({ cents: 500_050, parts: ['1 aplicação(ões)', 'saldo de 02/2026'] });
    expect(e['1.1.3.01']).toMatchObject({ cents: 800_000, parts: ['1 contagem', 'estoque de 02/2026'] });
  });

  it('o que começa na data da abertura ou depois não entra; bem baixado antes também não', () => {
    expect(registerExpectations(reg, '2025-01-01', accounts)).toEqual([]);
    const sold: FixedAsset = { ...car, disposal: { date: '2026-02-10', reason: 'SALE', journalEntryId: 'j' } };
    expect(registerExpectations({ ...reg, assets: [sold] }, '2026-03-01', accounts).some((e) => e.control === 'depreciation')).toBe(false);
    // Sem o saldo do mês anterior informado, aplicação e estoque ficam de fora.
    const e = byCode('2026-04-01');
    expect(e['1.1.1.03']).toBeUndefined();
    expect(e['1.1.3.01']).toBeUndefined();
  });

  it('contrato quitado antes da abertura não deixa saldo', () => {
    expect(registerExpectations({ ...reg, contracts: [loan], assets: [], prepaid: [], investments: [], stock: null }, '2028-01-01', accounts)).toEqual([]);
  });

  it('código esperado fora do plano fica sem conta', () => {
    const noContra = accounts.filter((a) => a.code !== '1.2.3.07');
    const e = registerExpectations({ ...reg, prepaid: [], contracts: [], investments: [], stock: null }, '2026-03-01', noContra);
    expect(e.find((x) => x.accountCode === '1.2.3.07')).toMatchObject({ accountId: null, cents: 1_400_000 });
  });
});

describe('cadastro × abertura', () => {
  const expectations = registerExpectations(reg, '2026-03-01', accounts);

  it('marca o que confere, o que diverge e a conta de imobilizado sem bem cadastrado', () => {
    const maquinas = acc('1.2.3.03');
    const amounts = new Map<string, number>([
      [veic.id, 60000],
      [deprec.id, 13000],
      [maquinas.id, 9000],
    ]);
    const checks = checkOpeningAgainstRegisters({ expectations, amounts, accounts });
    const of = (code: string) => checks.find((c) => c.accountCode === code)!;
    expect(of('1.2.3.04')).toMatchObject({ status: 'ok', expectedCents: 6_000_000, enteredCents: 6_000_000 });
    expect(of('1.2.3.07')).toMatchObject({ status: 'diverges', expectedCents: 1_400_000, enteredCents: 1_300_000 });
    expect(of('1.2.3.03')).toMatchObject({ status: 'unregistered', expectedCents: 0, enteredCents: 900_000, accountId: maquinas.id });
    expect(of('1.1.3.01')).toMatchObject({ status: 'diverges', enteredCents: 0 });
    // Em ordem de código.
    expect(checks.map((c) => c.accountCode)).toEqual([...checks.map((c) => c.accountCode)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
  });
});
