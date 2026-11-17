import { describe, expect, it } from 'vitest';
import { controlsSummary, horizonEnd, upcomingEvents, type ControlsRegisters } from '@/lib/controls-overview';
import type { FinancingContract, FixedAsset, InvestmentAccount, PrepaidExpense, StockControl } from '@/types/firestore';

// Veículo de R$ 60.000 a 20% ao ano (R$ 1.000 por mês), em uso desde 01/01/2026.
const car: FixedAsset = {
  id: 'a1',
  description: 'Fiorino',
  accountId: 'acc-veic',
  accountCode: '1.2.3.04',
  use: 'EXPENSE',
  acquisitionDate: '2026-01-01',
  inUseDate: '2026-01-01',
  invoiceValue: 60000,
  annualRate: 20,
  createdAt: '',
  updatedAt: '',
};
// Computador de R$ 1.200 a 100% ao ano: termina de depreciar em 12/2026.
const laptop: FixedAsset = { ...car, id: 'a2', description: 'Notebook', invoiceValue: 1200, annualRate: 100 };

// Seguro de R$ 2.400 em 12 meses, a partir de 10/03/2026: vigência até 10/03/2027.
const insurance: PrepaidExpense = {
  id: 'p1',
  kind: 'INSURANCE',
  description: 'Seguro da Fiorino',
  documentRef: '998',
  use: 'EXPENSE',
  amount: 2400,
  startDate: '2026-03-10',
  months: 12,
  assetAccountId: 'x',
  assetAccountCode: '1.1.4.01',
  payableAccountId: 'y',
  payableAccountCode: '2.1.3.05',
  expenseAccountId: 'z',
  expenseAccountCode: '3.3.2.10',
  createdAt: '',
  updatedAt: '',
};

// Empréstimo de R$ 3.000 em 3 parcelas de R$ 1.100 (juros prefixados de R$ 300), de 05/04 a 05/06/2026.
const loan: FinancingContract = {
  id: 'f1',
  kind: 'LOAN',
  description: 'Capital de giro',
  lender: 'Banco X',
  date: '2026-03-05',
  principal: 3000,
  installments: 3,
  installmentAmount: 1100,
  firstDueDate: '2026-04-05',
  interestMode: 'PREFIXED',
  counterpartAccountId: 'b',
  counterpartAccountCode: '1.1.1.02',
  shortTermAccountId: 's',
  shortTermAccountCode: '2.1.1.01',
  longTermAccountId: 'l',
  longTermAccountCode: '2.2.1.01',
  interestExpenseAccountId: 'j',
  interestExpenseAccountCode: '3.4.1.01',
  createdAt: '',
  updatedAt: '',
};

const cdb: InvestmentAccount = { id: 'i1', description: 'CDB', ledgerAccountId: 'c', ledgerAccountCode: '1.1.1.03', startMonth: '2026-01', balances: { '2026-04': 5050.5 }, createdAt: '', updatedAt: '' };
const stock: StockControl = { id: 'c1', clientId: 'c1', stockAccountId: 'e', stockAccountCode: '1.1.3.01', costAccountId: 'k', costAccountCode: '3.2.1.01', startMonth: '2026-01', frequency: 'QUARTERLY', counts: { '2026-03': 8000 }, updatedAt: '' };

const reg: ControlsRegisters = { assets: [car, laptop], prepaid: [insurance], contracts: [loan], investments: [cdb], stock, implantationMonth: null };
const empty: ControlsRegisters = { assets: [], prepaid: [], contracts: [], investments: [], stock: null, implantationMonth: null };

const byKey = (r: ControlsRegisters, month: string) => Object.fromEntries(controlsSummary(r, month).map((s) => [s.key, s]));

describe('controlsSummary', () => {
  it('posição e rotina de cada controle na competência', () => {
    const s = byKey(reg, '2026-04');
    // 4 cotas: 4 × (1.000 + 100) de acumulada sobre 61.200 de custo.
    expect(s.depreciation).toMatchObject({ registered: 2, active: 2, position: { cents: 6_120_000 - 440_000 }, monthly: { cents: 110_000 } });
    // Março e abril apropriados: 2 × 200.
    expect(s.prepaid).toMatchObject({ active: 1, position: { cents: 200_000 }, monthly: { cents: 20_000 } });
    // Uma parcela vencida em abril; restam duas.
    expect(s.financing.active).toBe(1);
    expect(s.financing.extra).toEqual({ label: '1 parcela(s) no mês', cents: 110_000 });
    expect(s.financing.monthly.cents).toBeGreaterThan(0);
    expect(s.financing.position.cents).toBeGreaterThan(0);
    expect(s.financing.position.cents).toBeLessThan(220_000);
    expect(s.investment).toMatchObject({ active: 1, position: { cents: 505_050 }, monthly: { label: '1 de 1 saldo(s) informado(s)' } });
    // Abril não é fim de trimestre: não há contagem a cobrar.
    expect(s.stock).toMatchObject({ active: 1, position: { cents: null }, monthly: { label: 'Mês sem contagem prevista' } });
  });

  it('dado do mês ainda não informado fica sem total', () => {
    const s = byKey(reg, '2026-06');
    expect(s.investment).toMatchObject({ position: { cents: null }, monthly: { label: '0 de 1 saldo(s) informado(s)' } });
    expect(s.stock.monthly.label).toBe('Falta o estoque final do mês');
    expect(byKey(reg, '2026-03').stock).toMatchObject({ position: { cents: 800_000 }, monthly: { label: 'Estoque do mês informado' } });
    // Depois da última parcela o contrato não conta mais como em aberto.
    expect(s.financing).toMatchObject({ registered: 1, active: 0, position: { cents: 0 } });
  });

  it('antes da implantação a rotina não lança cota (está nos saldos de abertura)', () => {
    const s = byKey({ ...reg, implantationMonth: '2026-06' }, '2026-04');
    expect(s.depreciation.monthly.cents).toBe(0);
    expect(s.prepaid.monthly.cents).toBe(0);
    // A posição do balanço não muda.
    expect(s.depreciation.position.cents).toBe(6_120_000 - 440_000);
  });

  it('empresa sem nada cadastrado: cinco controles zerados', () => {
    const list = controlsSummary(empty, '2026-04');
    expect(list.map((s) => s.key)).toEqual(['depreciation', 'prepaid', 'financing', 'investment', 'stock']);
    expect(list.every((s) => s.registered === 0 && s.active === 0)).toBe(true);
  });
});

describe('upcomingEvents', () => {
  it('parcelas na janela, em ordem de data; a última marca a quitação', () => {
    const events = upcomingEvents(reg, '2026-04', horizonEnd('2026-04', 3));
    expect(events.map((e) => [e.date, e.kind])).toEqual([
      ['2026-04-05', 'installment'],
      ['2026-05-05', 'installment'],
      ['2026-06-05', 'last-installment'],
    ]);
    expect(events[0]).toMatchObject({ title: 'Parcela 1/3: Capital de giro', cents: 110_000, attention: false, control: 'financing' });
    expect(events[2]).toMatchObject({ title: 'Última parcela: Capital de giro', attention: true });
    expect(events[2].detail).toContain('Banco X');
  });

  it('fim da vigência do seguro e última cota de depreciação', () => {
    const events = upcomingEvents(reg, '2026-12', '2027-03');
    expect(events.map((e) => [e.date, e.kind])).toEqual([
      ['2026-12-31', 'depreciation-end'],
      ['2027-03-10', 'prepaid-end'],
    ]);
    expect(events[0].title).toBe('Última cota de depreciação: Notebook');
    expect(events[1]).toMatchObject({ title: 'Fim da vigência: Seguro da Fiorino', attention: true });
    expect(events[1].detail).toContain('998');
  });

  it('bem baixado não entra; fora da janela, nada', () => {
    const disposed: FixedAsset = { ...laptop, disposal: { date: '2026-12-15', reason: 'SCRAP', journalEntryId: 'j' } };
    expect(upcomingEvents({ ...empty, assets: [disposed] }, '2026-12', '2026-12')).toEqual([]);
    expect(upcomingEvents(reg, '2026-07', '2026-09')).toEqual([]);
  });

  it('horizonEnd conta a competência inicial e vira o ano', () => {
    expect(horizonEnd('2026-04', 1)).toBe('2026-04');
    expect(horizonEnd('2026-11', 4)).toBe('2027-02');
  });
});
