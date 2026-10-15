import { describe, expect, it } from 'vitest';
import type { BankAccount, BankTransaction, ChartAccount, JournalEntry, OpeningBalances } from '@/types/firestore';
import { buildDaybook, daybookTerms } from '@/lib/daybook';
import { VIRTUAL, buildPostings, buildTrialBalance } from '@/lib/ledger';

const account = (id: string, code: string, type: ChartAccount['type']): ChartAccount => ({
  id,
  clientId: 'c1',
  code,
  name: id,
  type,
  nature: 'ANALYTIC',
  level: 2,
  createdAt: '',
  updatedAt: '',
});
const accounts = [
  account('banco', '1.1', 'ASSET'),
  account('clientes', '1.2', 'ASSET'),
  account('fornecedores', '2.1', 'LIABILITY'),
  account('capital', '2.3', 'EQUITY'),
  account('receita', '3.1', 'REVENUE'),
  account('despesa', '4.1', 'EXPENSE'),
  account('tarifas', '4.2', 'EXPENSE'),
];
const banks: BankAccount[] = [
  { id: 'b1', clientId: 'c1', accountKey: 'k1', nickname: 'Itaú', ledgerAccountId: 'banco', openingBalance: 1000, openingDate: '2025-01-01', createdAt: '', updatedAt: '' },
  { id: 'b2', clientId: 'c1', accountKey: 'k2', nickname: 'Caixa', createdAt: '', updatedAt: '' },
];
const openings: OpeningBalances = { id: 'c1', clientId: 'c1', date: '2025-01-01', entries: [{ accountId: 'capital', amount: 1000 }, { accountId: 'clientes', amount: 300 }], updatedAt: '' };

const tx = (id: string, date: string, amount: number, extra: Partial<BankTransaction> = {}): BankTransaction => ({
  id,
  clientId: 'c1',
  fitid: `F${id}`,
  date,
  amount,
  type: amount < 0 ? 'DEBIT' : 'CREDIT',
  memo: `memo ${id}`,
  status: 'RECONCILED',
  accountKey: 'k1',
  createdAt: '',
  ...extra,
});
const transactions = [
  tx('tx0', '2024-12-31', 999, { accountId: 'receita' }), // antes da data do saldo inicial: já está nele
  tx('t0', '2025-01-01', 50, { accountId: 'receita' }), // no próprio dia do saldo inicial (início do dia): conta
  tx('t1', '2025-01-10', 800.1, { accountId: 'receita' }),
  tx('t2', '2025-01-10', -300, { isSplit: true, splits: [{ id: 's1', accountId: 'despesa', amount: -200.5, memo: 'aluguel' }, { id: 's2', accountId: 'tarifas', amount: -99.5, memo: '' }] }),
  tx('t3', '2025-02-05', -75, { status: 'PENDING' }),
  tx('t4', '2025-02-20', 60, { accountKey: 'k2', accountId: 'conta-removida' }),
  tx('t5', '2025-03-03', -18, { accountId: 'tarifas' }),
];
const journal = (n: number, date: string, lines: [string, 'DEBIT' | 'CREDIT', number][]): JournalEntry => ({
  id: `j${n}`,
  clientId: 'c1',
  entryNumber: n,
  date,
  memo: `manual ${n}`,
  category: 'OTHER',
  lines: lines.map(([accountId, type, amount], i) => ({ id: `l${i}`, accountId, type, amount })),
  totalAmount: lines.filter((l) => l[1] === 'DEBIT').reduce((s, l) => s + l[2], 0),
  documentRef: n === 1 ? 'FOLHA-2025-01' : undefined,
  createdAt: '',
  updatedAt: '',
  createdByUid: 'u',
});
const journals = [
  journal(2, '2025-01-31', [['fornecedores', 'CREDIT', 250], ['despesa', 'DEBIT', 250]]),
  journal(1, '2025-01-31', [['despesa', 'DEBIT', 100], ['tarifas', 'DEBIT', 20], ['fornecedores', 'CREDIT', 120]]),
  journal(3, '2025-02-28', [['clientes', 'DEBIT', 80], ['receita', 'CREDIT', 80]]),
];

const build = (start: string, end: string, numberFrom?: string) =>
  buildDaybook({ transactions, bankAccounts: banks, accounts, range: { start, end }, openings, journalEntries: journals, numberFrom });

describe('Livro Diário', () => {
  it('lista tudo em ordem cronológica: abertura, extrato e manuais, com débitos antes de créditos', () => {
    const book = build('2025-01-01', '2025-12-31');
    expect(book.entries.map((e) => [e.number, e.date, e.origin, e.document])).toEqual([
      [1, '2025-01-01', 'OPENING', 'SALDO INICIAL'],
      [2, '2025-01-01', 'OPENING', 'ABERTURA'],
      [3, '2025-01-01', 'OPENING', 'ABERTURA'],
      [4, '2025-01-01', 'BANK', 'Ft0'],
      [5, '2025-01-10', 'BANK', 'Ft1'],
      [6, '2025-01-10', 'BANK', 'Ft2'],
      [7, '2025-01-31', 'MANUAL', 'L1 · FOLHA-2025-01'],
      [8, '2025-01-31', 'MANUAL', 'L2'],
      [9, '2025-02-05', 'BANK', 'Ft3'],
      [10, '2025-02-20', 'BANK', 'Ft4'],
      [11, '2025-02-28', 'MANUAL', 'L3'],
      [12, '2025-03-03', 'BANK', 'Ft5'],
    ]);
    // Entrada no banco: debita o banco, credita a receita.
    expect(book.entries[4].lines).toEqual([
      { accountId: 'banco', code: '1.1', name: 'banco', debit: 800.1, credit: 0 },
      { accountId: 'receita', code: '3.1', name: 'receita', debit: 0, credit: 800.1 },
    ]);
    // Saída rateada: uma partida por conta do rateio, a crédito do banco.
    expect(book.entries[5].lines.map((l) => [l.accountId, l.debit, l.credit, l.memo])).toEqual([
      ['despesa', 200.5, 0, 'aluguel'],
      ['tarifas', 99.5, 0, undefined],
      ['banco', 0, 300, undefined],
    ]);
    // Lançamento manual gravado com o crédito primeiro sai com o débito primeiro.
    expect(book.entries[7].lines.map((l) => l.accountId)).toEqual(['despesa', 'fornecedores']);
    expect(book.entries.map((e) => e.total)).toEqual([1000, 300, 1000, 50, 800.1, 300, 120, 250, 75, 60, 80, 18]);
    // O extrato anterior à data do saldo inicial fica de fora, mesmo dentro do período emitido.
    expect(build('2024-12-01', '2025-01-01').entries.map((e) => e.document)).not.toContain('Ftx0');
  });

  it('balanço de abertura: um lançamento composto, com a 2.3.3.04 pela diferença e o histórico informado', () => {
    const plug = account('plug', '2.3.3.04', 'EQUITY');
    const book = buildDaybook({
      transactions: [],
      bankAccounts: banks,
      accounts: [...accounts, plug],
      range: { start: '2025-01-01', end: '2025-01-31' },
      openings: { ...openings, mode: 'OPENING_BALANCE', memo: 'Balanço de abertura conforme contrato social' },
    });
    expect(book.entries).toHaveLength(1);
    const [entry] = book.entries;
    expect(entry).toMatchObject({ origin: 'OPENING', document: 'ABERTURA', memo: 'Balanço de abertura conforme contrato social', total: 1300 });
    // Banco 1.000 + clientes 300 = 1.300 a débito; capital 1.000 e a 2.3.3.04 com os 300 de diferença a crédito.
    expect(entry.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      ['banco', 1000, 0],
      ['clientes', 300, 0],
      ['capital', 0, 1000],
      ['plug', 0, 300],
    ]);
    const trial = buildTrialBalance(buildPostings([], banks, [...accounts, plug], '2025-01-31', { ...openings, mode: 'OPENING_BALANCE' }), [...accounts, plug], { start: '2025-01-01', end: '2025-01-31' });
    expect(book.totals).toEqual({ debits: trial.totals.debits, credits: trial.totals.credits });
    expect(trial.rows.find((r) => r.accountId === 'plug')?.final).toBe(-300);
    expect(trial.rows.some((r) => r.accountId === VIRTUAL.OPENING)).toBe(false);
  });

  it('pendentes e contas removidas vão para "a classificar" e marcam o livro como provisório', () => {
    const book = build('2025-02-01', '2025-02-28');
    const [pending, removed] = book.entries;
    expect(pending.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([[VIRTUAL.SUSPENSE, 75, 0], ['banco', 0, 75]]);
    expect(removed.lines.map((l) => [l.accountId, l.name])).toEqual([
      [VIRTUAL.BANK_UNLINKED, 'Bancos sem vínculo contábil'],
      [VIRTUAL.SUSPENSE, 'Lançamentos a classificar'],
    ]);
    expect(book.unclassified).toBe(2);
    expect(build('2025-03-01', '2025-03-31').unclassified).toBe(0);
  });

  it('débitos = créditos, e os totais são os do balancete do mesmo período', () => {
    for (const [start, end] of [['2025-01-01', '2025-12-31'], ['2025-01-01', '2025-01-31'], ['2025-02-01', '2025-03-31']]) {
      const book = build(start, end);
      const trial = buildTrialBalance(buildPostings(transactions, banks, accounts, end, openings, journals), accounts, { start, end });
      expect(book.balanced).toBe(true);
      expect(book.totals).toEqual({ debits: trial.totals.debits, credits: trial.totals.credits });
    }
  });

  it('o número de ordem é contado desde o início do exercício, qualquer que seja o mês emitido', () => {
    expect(build('2025-02-01', '2025-02-28').entries.map((e) => e.number)).toEqual([1, 2, 3]);
    expect(build('2025-02-01', '2025-02-28', '2025-01-01').entries.map((e) => e.number)).toEqual([9, 10, 11]);
    expect(build('2025-03-01', '2025-03-31', '2025-01-01').entries.map((e) => e.number)).toEqual([12]);
  });

  it('termos de abertura e de encerramento trazem empresa, período, páginas e totais', () => {
    const terms = daybookTerms({
      clientName: 'ALPHA LTDA',
      cnpj: '11.222.333/0001-81',
      book: { number: '3', city: 'Recife/PE', registry: '26200000000' },
      range: { start: '2025-01-01', end: '2025-12-31' },
      pages: 42,
      entryCount: 11,
      total: 2903.6,
    });
    expect(terms.opening).toBe(
      'Contém este livro 42 página(s), numeradas de 1 a 42, emitidas por processamento eletrônico de dados, e servirá de Livro Diário nº 3 de ALPHA LTDA, inscrita no CNPJ sob o nº 11.222.333/0001-81, registrada sob o nº 26200000000, com sede em Recife/PE, para a escrituração dos lançamentos do período de 01/01/2025 a 31/12/2025.'
    );
    expect(terms.closing).toContain('serviu de Livro Diário nº 3 de ALPHA LTDA');
    expect(terms.closing).toContain('foram escriturados 11 lançamento(s) do período de 01/01/2025 a 31/12/2025');
    expect(terms.closing).toMatch(/totalizam R\$\s2\.903,60 a débito e a crédito\.$/);
    // Sem registro nem sede informados, o texto não deixa lacunas.
    expect(daybookTerms({ clientName: 'BETA', cnpj: '', book: { number: '' }, range: { start: '2025-01-01', end: '2025-01-31' }, pages: 3, entryCount: 0, total: 0 }).opening).toContain(
      'Livro Diário nº 1 de BETA, CNPJ não informado, para a escrituração'
    );
  });
});
