import { describe, expect, it } from 'vitest';
import type { BankAccount, BankTransaction, JournalEntry } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { buildAccountLedger, buildBalanceSheet, buildPostings, buildTrialBalance, VIRTUAL } from '@/lib/ledger';

const chart = buildITG1000Chart('c', '2025-01-01T00:00:00.000Z');
const id = (code: string) => `c_itg22_${code}`;

let n = 0;
const tx = (date: string, amount: number, account: string | null, accountKey = 'itau', extra: Partial<BankTransaction> = {}): BankTransaction => ({
  id: `t${++n}`,
  clientId: 'c',
  fitid: `f${n}`,
  date,
  amount,
  type: amount < 0 ? 'DEBIT' : 'CREDIT',
  memo: 'x',
  status: account ? 'RECONCILED' : 'PENDING',
  ...(account ? { accountId: id(account) } : {}),
  accountKey,
  createdAt: '2025-01-01',
  ...extra,
});

const bank = (accountKey: string, ledger: string | null, opening?: [number, string]): BankAccount => ({
  id: `c_${accountKey}`,
  clientId: 'c',
  accountKey,
  nickname: accountKey,
  ...(ledger ? { ledgerAccountId: id(ledger) } : {}),
  ...(opening ? { openingBalance: opening[0], openingDate: opening[1] } : {}),
  createdAt: '',
  updatedAt: '',
});

describe('partidas dobradas a partir do extrato', () => {
  const txs = [
    tx('2025-01-10', 1000, '3.1.1.01'), // receita de serviços
    tx('2025-01-15', -200, '3.3.2.07'), // aluguel
    tx('2025-01-20', -50, null), // pendente → a classificar
    tx('2025-02-05', -300, '2.1.4.01'), // amortização de empréstimo (passivo)
  ];
  const banks = [bank('itau', '1.1.1.02', [500, '2024-12-31'])];
  const postings = buildPostings(txs, banks, chart);

  it('cada lançamento gera débito e crédito de mesmo valor', () => {
    expect(postings.reduce((s, p) => s + p.value, 0)).toBeCloseTo(0);
    expect(postings.filter((p) => p.accountId === id('1.1.1.02')).reduce((s, p) => s + p.value, 0)).toBe(950);
    expect(postings.find((p) => p.accountId === VIRTUAL.SUSPENSE)?.value).toBe(50);
  });

  it('balancete: débitos = créditos, sintéticas somam as filhas, saldo anterior do período', () => {
    const tb = buildTrialBalance(postings, chart, { start: '2025-02-01', end: '2025-02-28' });
    expect(tb.balanced).toBe(true);
    const row = (code: string) => tb.rows.find((r) => r.code === code)!;
    expect(row('1.1.1.02')).toMatchObject({ previous: 1250, debits: 0, credits: 300, final: 950 });
    expect(row('1.1.1').final).toBe(950);
    expect(row('1').final).toBe(950); // a conta virtual "a classificar" fica fora da hierarquia
    expect(tb.rows.find((r) => r.accountId === VIRTUAL.SUSPENSE)?.final).toBe(50);
    expect(row('3.1.1.01')).toMatchObject({ previous: -1000, final: -1000 });
    expect(row('2.1.4.01')).toMatchObject({ debits: 300, final: 300 });
  });

  it('balancete no ano seguinte: resultado anterior vai para o PL', () => {
    const tb = buildTrialBalance(postings, chart, { start: '2026-01-01', end: '2026-01-31' });
    expect(tb.rows.find((r) => r.code === '3.1.1.01')).toBeUndefined();
    expect(tb.rows.find((r) => r.accountId === VIRTUAL.PRIOR_RESULTS)?.previous).toBe(-800);
    expect(tb.balanced).toBe(true);
  });

  it('balanço fecha: ativo = passivo + PL, com resultado do exercício e saldos de abertura', () => {
    const bs = buildBalanceSheet(postings, chart, '2025-02-28');
    expect(bs.difference).toBe(0);
    expect(bs.totalAssets).toBe(1000); // 950 banco + 50 a classificar
    expect(bs.suspense).toBe(50);
    expect(bs.liabilities.find((l) => l.code === '2.1.4.01')?.value).toBe(-300);
    expect(bs.equity.find((l) => l.accountId === VIRTUAL.CURRENT_RESULT)?.value).toBe(800);
    expect(bs.equity.find((l) => l.accountId === VIRTUAL.OPENING)?.value).toBe(500);
    expect(bs.assets.find((l) => l.code === '1')?.value).toBe(950);
  });

  it('rateio: cada parte vai para a sua conta', () => {
    const split = tx('2025-03-01', -100, null, 'itau', {
      status: 'RECONCILED',
      isSplit: true,
      splits: [
        { id: 's1', accountId: id('3.3.2.12'), amount: -60, memo: '' },
        { id: 's2', accountId: id('3.3.2.13'), amount: -40, memo: '' },
      ],
    });
    const p = buildPostings([split], [], chart);
    expect(p).toEqual(
      expect.arrayContaining([
        { accountId: VIRTUAL.BANK_UNLINKED, date: '2025-03-01', value: -100 },
        { accountId: id('3.3.2.12'), date: '2025-03-01', value: 60 },
        { accountId: id('3.3.2.13'), date: '2025-03-01', value: 40 },
      ])
    );
  });

  it('transferência conciliada nas duas pernas zera a conta transitória', () => {
    const banks2 = [bank('itau', '1.1.1.02'), bank('bb', '1.1.1.03')];
    const legs = [
      tx('2025-04-01', -700, '1.1.1.04', 'itau', { transferPairId: 'x' }),
      tx('2025-04-02', 700, '1.1.1.04', 'bb', { transferPairId: 'y' }),
    ];
    const bs = buildBalanceSheet(buildPostings(legs, banks2, chart), chart, '2025-04-30');
    expect(bs.assets.find((l) => l.code === '1.1.1.04')).toBeUndefined();
    expect(bs.assets.find((l) => l.code === '1.1.1.02')?.value).toBe(-700);
    expect(bs.assets.find((l) => l.code === '1.1.1.03')?.value).toBe(700);
    expect(bs.equity).toHaveLength(0);
    expect(bs.difference).toBe(0);
  });

  it('lançamentos até a data do saldo inicial não são somados de novo', () => {
    const p = buildPostings([tx('2024-12-20', 999, '3.1.1.01')], [bank('itau', '1.1.1.02', [100, '2024-12-31'])], chart);
    expect(p.filter((x) => x.accountId === id('1.1.1.02')).map((x) => x.value)).toEqual([100]);
  });
});

describe('saldos de abertura das demais contas', () => {
  const opening = (entries: [string, number][], date = '2024-12-31') => ({
    id: 'c',
    clientId: 'c',
    date,
    entries: entries.map(([code, amount]) => ({ accountId: id(code), amount })),
    updatedAt: '',
  });
  const banks = [bank('itau', '1.1.1.02', [1000, '2024-12-31'])];

  it('cada lado no sentido natural; retificadora reduz; fecha quando ativo = passivo + PL', () => {
    const o = opening([
      ['1.1.2.01', 500], // clientes (D)
      ['1.2.3.03', 4000], // máquinas (D)
      ['1.2.3.07', 1000], // (-) depreciação acumulada (contra, ativo → crédito)
      ['2.1.2.01', 800], // fornecedores (C)
      ['2.3.1.01', 3700], // capital (C)
    ]);
    const postings = buildPostings([], banks, chart, undefined, o);
    expect(postings.reduce((s, p) => s + p.value, 0)).toBeCloseTo(0);
    const bs = buildBalanceSheet(postings, chart, '2025-01-31');
    // ativo: 1000 banco + 500 + 4000 − 1000 = 4500; passivo 800; PL 3700
    expect(bs.totalAssets).toBe(4500);
    expect(bs.totalLiabilities).toBe(800);
    expect(bs.totalEquity).toBe(3700);
    expect(bs.difference).toBe(0);
    expect(bs.equity.find((l) => l.accountId === VIRTUAL.OPENING)).toBeUndefined();
    expect(bs.assets.find((l) => l.code === '1.2.3.07')?.value).toBe(-1000);
  });

  it('o que falta detalhar fica em "Saldos de abertura (a detalhar)"', () => {
    const bs = buildBalanceSheet(buildPostings([], banks, chart, undefined, opening([['1.1.2.01', 500], ['2.3.1.01', 1000]])), chart, '2025-01-31');
    expect(bs.totalAssets).toBe(1500);
    expect(bs.equity.find((l) => l.accountId === VIRTUAL.OPENING)?.value).toBe(500);
    expect(bs.difference).toBe(0);
  });

  it('respeita a data e ignora contas de resultado e desconhecidas', () => {
    const o = opening([['1.1.2.01', 500], ['3.1.1.01', 999]], '2025-03-31');
    expect(buildPostings([], [], chart, '2025-02-28', o)).toEqual([]);
    const p = buildPostings([], [], chart, '2025-03-31', { ...o, entries: [...o.entries, { accountId: 'inexistente', amount: 5 }] });
    expect(p.map((x) => x.accountId).sort()).toEqual([VIRTUAL.OPENING, id('1.1.2.01')].sort());
  });
});

describe('Livro Razão Analítico (buildAccountLedger)', () => {
  const txs = [
    tx('2025-01-10', 1000, '3.1.1.01'), // receita de serviços
    tx('2025-01-15', -200, '3.3.2.07'), // aluguel
    tx('2025-01-20', -50, null), // pendente → a classificar
    tx('2025-02-05', -300, '2.1.4.01'), // amortização de empréstimo (passivo)
  ];
  const banks = [bank('itau', '1.1.1.02', [500, '2024-12-31'])];

  it('calcula saldo anterior, lançamentos e saldo progressivo da conta bancária em janeiro', () => {
    const r = buildAccountLedger({
      accountId: id('1.1.1.02'),
      accounts: chart,
      bankAccounts: banks,
      transactions: txs,
      range: { start: '2025-01-01', end: '2025-01-31' },
    });

    expect(r.code).toBe('1.1.1.02');
    expect(r.openingBalance).toBe(500);
    expect(r.openingNature).toBe('D');
    expect(r.entries).toHaveLength(3);

    // Entrada de 1000: débito 1000, contrapartida Receita (3.1.1.01), saldo 1500 D
    expect(r.entries[0]).toMatchObject({
      date: '2025-01-10',
      debit: 1000,
      credit: 0,
      balance: 1500,
      balanceNature: 'D',
      contraAccountCode: '3.1.1.01',
    });

    // Saída de 200: crédito 200, contrapartida Aluguel (3.3.2.07), saldo 1300 D
    expect(r.entries[1]).toMatchObject({
      date: '2025-01-15',
      debit: 0,
      credit: 200,
      balance: 1300,
      balanceNature: 'D',
      contraAccountCode: '3.3.2.07',
    });

    // Saída de 50 pendente: crédito 50, contrapartida Lançamentos a classificar, saldo 1250 D
    expect(r.entries[2]).toMatchObject({
      date: '2025-01-20',
      debit: 0,
      credit: 50,
      balance: 1250,
      balanceNature: 'D',
      contraAccountName: 'Lançamentos a classificar',
    });

    expect(r.totals).toEqual({
      debits: 1000,
      credits: 250,
      netMovement: 750,
      closingBalance: 1250,
      closingNature: 'D',
    });
  });

  it('no mês seguinte (fevereiro), o saldo anterior parte exatamente do saldo final de janeiro', () => {
    const r = buildAccountLedger({
      accountId: id('1.1.1.02'),
      accounts: chart,
      bankAccounts: banks,
      transactions: txs,
      range: { start: '2025-02-01', end: '2025-02-28' },
    });

    expect(r.openingBalance).toBe(1250);
    expect(r.openingNature).toBe('D');
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({
      date: '2025-02-05',
      debit: 0,
      credit: 300,
      balance: 950,
      balanceNature: 'D',
      contraAccountCode: '2.1.4.01',
    });
    expect(r.totals.closingBalance).toBe(950);
    expect(r.totals.closingNature).toBe('D');
  });

  it('conta de receita (credora) acumula créditos e reflete contrapartida bancária', () => {
    const r = buildAccountLedger({
      accountId: id('3.1.1.01'),
      accounts: chart,
      bankAccounts: banks,
      transactions: txs,
      range: { start: '2025-01-01', end: '2025-01-31' },
    });

    expect(r.openingBalance).toBe(0);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({
      date: '2025-01-10',
      debit: 0,
      credit: 1000,
      balance: 1000,
      balanceNature: 'C',
      contraAccountCode: '1.1.1.02',
    });
    expect(r.totals.closingBalance).toBe(1000);
    expect(r.totals.closingNature).toBe('C');
  });

  it('integração com lançamentos contábeis manuais (JournalEntry)', () => {
    const manual: JournalEntry = {
      id: 'j1',
      clientId: 'c',
      entryNumber: 1,
      date: '2025-01-31',
      memo: 'Provisão de depreciação mensal',
      category: 'DEPRECIATION',
      totalAmount: 150,
      createdAt: '2025-01-31',
      updatedAt: '2025-01-31',
      createdByUid: 'u1',
      lines: [
        { id: 'l1', accountId: id('3.3.2.14'), type: 'DEBIT', amount: 150, memo: 'Cota mensal' },
        { id: 'l2', accountId: id('1.2.3.07'), type: 'CREDIT', amount: 150, memo: 'Depreciação acumulada' },
      ],
    };

    const rExp = buildAccountLedger({
      accountId: id('3.3.2.14'),
      accounts: chart,
      bankAccounts: banks,
      transactions: txs,
      range: { start: '2025-01-01', end: '2025-01-31' },
      journalEntries: [manual],
    });

    expect(rExp.entries).toHaveLength(1);
    expect(rExp.entries[0]).toMatchObject({
      date: '2025-01-31',
      documentId: 'L1',
      debit: 150,
      credit: 0,
      balance: 150,
      balanceNature: 'D',
      contraAccountCode: '1.2.3.07',
    });

    const rContra = buildAccountLedger({
      accountId: id('1.2.3.07'),
      accounts: chart,
      bankAccounts: banks,
      transactions: txs,
      range: { start: '2025-01-01', end: '2025-01-31' },
      journalEntries: [manual],
    });

    expect(rContra.entries).toHaveLength(1);
    expect(rContra.entries[0]).toMatchObject({
      date: '2025-01-31',
      documentId: 'L1',
      debit: 0,
      credit: 150,
      balance: 150,
      balanceNature: 'C',
      contraAccountCode: '3.3.2.14',
    });
  });
});

