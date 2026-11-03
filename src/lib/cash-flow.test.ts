import { describe, expect, it } from 'vitest';
import type { BankAccount, BankTransaction, ChartAccount, JournalEntry, OpeningBalances } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { buildBalanceSheet, buildPostings } from '@/lib/ledger';
import { buildCashFlow, cashAccountIds, cashFlowRows, suggestedCashFlowActivity } from '@/lib/cash-flow';

const chart = buildITG1000Chart('c', '2025-01-01T00:00:00.000Z');
const id = (code: string) => `c_itg22_${code}`;
const byCode = (code: string) => chart.find((a) => a.code === code)!;

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

const journal = (date: string, lines: [string, 'DEBIT' | 'CREDIT', number][]): JournalEntry => ({
  id: `j${++n}`,
  clientId: 'c',
  entryNumber: n,
  date,
  memo: 'manual',
  category: 'ADJUSTMENT' as JournalEntry['category'],
  totalAmount: lines.filter((l) => l[1] === 'DEBIT').reduce((s, l) => s + l[2], 0),
  createdAt: date,
  updatedAt: date,
  createdByUid: 'u',
  lines: lines.map(([code, type, amount], i) => ({ id: `l${i}`, accountId: id(code), type, amount, memo: '' })),
});

const YEAR = { start: '2025-01-01', end: '2025-12-31' };
const banks = [bank('itau', '1.1.1.02', [1000, '2024-12-31']), bank('nubank', '1.1.1.02')];

const lineOf = (s: ReturnType<typeof buildCashFlow>, label: string) =>
  s.sections.flatMap((sec) => sec.lines).find((l) => l.label === label)?.value;

describe('atividade sugerida pelo modelo do CFC', () => {
  it('classifica pelas contas do modelo', () => {
    expect(suggestedCashFlowActivity(byCode('1.1.1.02'))).toBe('CASH');
    expect(suggestedCashFlowActivity(byCode('3.1.1.01'))).toBe('OPERATING');
    expect(suggestedCashFlowActivity(byCode('1.2.3.04'))).toBe('INVESTING');
    expect(suggestedCashFlowActivity(byCode('3.3.9.02'))).toBe('INVESTING');
    expect(suggestedCashFlowActivity(byCode('1.2.1.01'))).toBe('INVESTING');
    expect(suggestedCashFlowActivity(byCode('2.1.4.01'))).toBe('FINANCING');
    expect(suggestedCashFlowActivity(byCode('2.2.2.02'))).toBe('FINANCING');
    expect(suggestedCashFlowActivity(byCode('2.2.2.01'))).toBe('OPERATING');
    expect(suggestedCashFlowActivity(byCode('2.3.3.03'))).toBe('FINANCING');
  });

  it('fora do modelo, usa a natureza e o nome', () => {
    const custom = (code: string, name: string, type: ChartAccount['type']) => ({ code, name, type });
    expect(suggestedCashFlowActivity(custom('9.1', 'Mútuo com coligada', 'LIABILITY'))).toBe('FINANCING');
    expect(suggestedCashFlowActivity(custom('9.2', 'Adiantamento de clientes', 'LIABILITY'))).toBe('OPERATING');
    expect(suggestedCashFlowActivity(custom('9.3', 'Capital', 'EQUITY'))).toBe('FINANCING');
    // Código do modelo com natureza diferente da esperada não segue o modelo.
    expect(suggestedCashFlowActivity(custom('1.2.3.09', 'Receita estranha', 'REVENUE'))).toBe('OPERATING');
  });
});

describe('DFC pelo método direto', () => {
  const txs = [
    tx('2025-01-10', 5000, '3.1.1.01'), // recebimento de serviços
    tx('2025-01-12', 800, '1.1.2.01'), // recebimento de cliente (duplicata)
    tx('2025-01-15', -1200, '3.3.2.07'), // aluguel
    tx('2025-01-20', -300, '3.3.2.01'), // salários
    tx('2025-02-01', -2500, '1.2.3.06'), // compra de computador
    tx('2025-02-05', 4000, '2.1.4.01'), // empréstimo obtido
    tx('2025-02-10', -900, '2.1.4.01'), // parcela do empréstimo
    tx('2025-03-01', -700, '2.3.3.03'), // lucros distribuídos
    tx('2025-03-05', -150, null), // pendente
    tx('2025-03-10', -1000, '1.1.1.04'), // transferência: sai do Itaú…
    tx('2025-03-10', 1000, '1.1.1.04', 'nubank'), // …e entra no Nubank
    tx('2025-03-15', 100, '3.4.1.02.001'), // rendimento
    tx('2025-03-20', 970, null, 'itau', {
      // rateio: venda líquida da tarifa
      status: 'RECONCILED',
      isSplit: true,
      splits: [
        { id: 's1', accountId: id('3.1.1.02'), amount: 1000, memo: '' },
        { id: 's2', accountId: id('3.4.1.01.002'), amount: -30, memo: '' },
      ],
    }),
  ];
  const depreciation = journal('2025-12-31', [
    ['3.3.2.15', 'DEBIT', 400],
    ['1.2.3.07', 'CREDIT', 400],
  ]);
  const cashPurchase = journal('2025-04-01', [
    ['1.1.3.01', 'DEBIT', 250],
    ['1.1.1.01', 'CREDIT', 250],
  ]);
  const dfc = buildCashFlow({ transactions: txs, banks, accounts: chart, range: YEAR, journalEntries: [depreciation, cashPurchase] });

  it('separa as atividades com recebimentos e pagamentos brutos', () => {
    expect(lineOf(dfc, 'Recebimentos de clientes')).toBe(6800);
    expect(lineOf(dfc, 'Juros e rendimentos recebidos')).toBe(100);
    expect(lineOf(dfc, 'Pagamentos de despesas operacionais')).toBe(-1200);
    expect(lineOf(dfc, 'Pagamentos a empregados, pró-labore e encargos')).toBe(-300);
    expect(lineOf(dfc, 'Pagamentos a fornecedores')).toBe(-250);
    expect(lineOf(dfc, 'Juros e despesas financeiras pagos')).toBe(-30);
    expect(lineOf(dfc, 'Aquisição de imobilizado e intangível')).toBe(-2500);
    expect(lineOf(dfc, 'Empréstimos e financiamentos obtidos')).toBe(4000);
    expect(lineOf(dfc, 'Pagamento de empréstimos e financiamentos')).toBe(-900);
    expect(lineOf(dfc, 'Lucros distribuídos aos sócios')).toBe(-700);
    expect(dfc.sections.map((s) => s.total)).toEqual([5120, -2500, 2400]);
  });

  it('deixa de fora depreciação e transferências entre contas próprias', () => {
    const labels = dfc.sections.flatMap((s) => s.lines.flatMap((l) => l.accounts.map((a) => a.code)));
    expect(labels).not.toContain('1.2.3.07');
    expect(labels).not.toContain('3.3.2.15');
    expect(labels).not.toContain('1.1.1.04');
  });

  it('pendentes ficam à parte e a DFC fecha com o caixa do razão', () => {
    expect(dfc.unclassified).toBe(-150);
    expect(dfc.openingCash).toBe(1000);
    expect(dfc.netChange).toBe(5120 - 2500 + 2400 - 150);
    expect(dfc.closingCash).toBe(1000 + 4870);
    expect(dfc.difference).toBe(0);
    // O caixa final é a soma das Disponibilidades no balanço.
    const bs = buildBalanceSheet(buildPostings(txs, banks, chart, YEAR.end, null, [depreciation, cashPurchase]), chart, YEAR.end);
    expect(bs.assets.find((l) => l.code === '1.1.1')?.value).toBe(dfc.closingCash);
  });

  it('um período parcial parte do caixa no fim do período anterior', () => {
    const q2 = buildCashFlow({ transactions: txs, banks, accounts: chart, range: { start: '2025-04-01', end: '2025-12-31' }, journalEntries: [depreciation, cashPurchase] });
    expect(q2.openingCash).toBe(dfc.closingCash + 250);
    expect(q2.netChange).toBe(-250);
    expect(q2.difference).toBe(0);
  });

  it('a escolha do contador no grupo vale para as subcontas', () => {
    const custom = chart.map((a) => (a.code === '3.4.1.01' ? { ...a, cashFlowActivity: 'FINANCING' as const } : a));
    const s = buildCashFlow({ transactions: txs, banks, accounts: custom, range: YEAR });
    const financing = s.sections.find((x) => x.activity === 'FINANCING')!;
    expect(financing.lines.find((l) => l.label === 'Despesas Bancárias')?.value).toBe(-30);
    expect(lineOf(s, 'Juros e despesas financeiras pagos')).toBeUndefined();
  });

  it('conta marcada como caixa deixa de gerar fluxo', () => {
    const custom = chart.map((a) => (a.code === '1.2.2.02' ? { ...a, cashFlowActivity: 'CASH' as const } : a));
    expect(cashAccountIds(custom, banks).has(id('1.2.2.02'))).toBe(true);
    const s = buildCashFlow({ transactions: [tx('2025-05-01', -500, '1.2.2.02')], banks, accounts: custom, range: YEAR });
    expect(s.netChange).toBe(0);
    expect(s.difference).toBe(0);
  });
});

describe('saldos de implantação e consolidado', () => {
  it('implantação dentro do período entra no caixa inicial, não nos fluxos', () => {
    const openings: OpeningBalances = {
      id: 'c',
      clientId: 'c',
      date: '2025-06-01',
      mode: 'OPENING_BALANCE',
      entries: [{ accountId: id('1.1.1.01'), amount: 300 }],
      updatedAt: '',
    } as OpeningBalances;
    const s = buildCashFlow({
      transactions: [tx('2025-06-10', 200, '3.1.1.01', 'nubank')],
      banks: [bank('nubank', '1.1.1.02', [700, '2025-06-01'])],
      accounts: chart,
      range: YEAR,
      openings,
    });
    expect(s.implantationCash).toBe(1000);
    expect(s.openingCash).toBe(1000);
    expect(s.netChange).toBe(200);
    expect(s.difference).toBe(0);
  });

  it('consolidado anterior ao período só compõe o caixa inicial', () => {
    const carry = [
      { accountId: id('1.1.1.02'), date: '2024-12-31', value: 2000 },
      { accountId: id('3.1.1.01'), date: '2024-12-31', value: -2000 },
    ];
    const s = buildCashFlow({ transactions: [tx('2025-01-05', -100, '3.3.2.06', 'nubank')], banks, accounts: chart, range: YEAR, carry });
    // 2.000 consolidados + 1.000 de saldo inicial do Itaú.
    expect(s.openingCash).toBe(3000);
    expect(s.closingCash).toBe(2900);
    expect(s.difference).toBe(0);
  });
});

describe('linhas para tela e exportação', () => {
  it('títulos, subtotais, variação e saldos; detalhe por conta opcional', () => {
    const s = buildCashFlow({ transactions: [tx('2025-01-10', 500, '3.1.1.01'), tx('2025-01-11', -50, null)], banks, accounts: chart, range: YEAR });
    const rows = cashFlowRows(s);
    expect(rows.map((r) => r.kind)).toEqual([
      'section', 'line', 'subtotal',
      'section', 'line', 'subtotal',
      'section', 'line', 'subtotal',
      'subtotal', 'total', 'balance', 'balance',
    ]);
    expect(rows[2].label).toBe('Caixa líquido gerado pelas atividades operacionais');
    expect(rows[4].label).toBe('Sem movimentação no período');
    expect(rows.at(-1)).toEqual({ kind: 'balance', label: 'Caixa e equivalentes de caixa no fim do período', value: 1450 });
    const detailed = cashFlowRows(s, { detail: true });
    expect(detailed.find((r) => r.kind === 'detail')).toEqual({ kind: 'detail', label: 'Receita de Prestação de Serviços', code: '3.1.1.01', value: 500 });
  });
});
