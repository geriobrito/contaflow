import { describe, expect, it } from 'vitest';
import {
  buildPayrollJournalDraft,
  buildPayrollSummary,
  calculateNetPayroll,
  DEFAULT_PAYROLL_MAPPING,
  fifthWorkingDay,
  matchBankTransactionsWithPayroll,
  missingPayrollCodes,
  parsePayrollText,
  payrollCloseProblem,
  payrollDueDate,
  payrollProblem,
  payrollRoutineStatus,
  payrollYearOverview,
} from '@/lib/payroll';
import { journalTotals } from '@/lib/journal';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import type { BankTransaction, ChartAccount, PayrollRegister } from '@/types/firestore';

function makeAccounts(clientId = 'c1'): ChartAccount[] {
  return buildITG1000Chart(clientId, '2025-01-01T00:00:00Z');
}

function makeTx(partial: Partial<BankTransaction> & { id: string; date: string; amount: number; memo: string }): BankTransaction {
  return {
    clientId: 'c1',
    fitid: partial.id,
    type: partial.amount < 0 ? 'DEBIT' : 'CREDIT',
    status: 'PENDING',
    isSplit: false,
    importBatchId: 'b1',
    createdAt: '2025-11-10T00:00:00Z',
    ...partial,
  };
}

describe('payroll — cálculo líquido e validações', () => {
  it('calcula líquidos de salários, pró-labore, encargos e provisões em centavos exatos', () => {
    const calc = calculateNetPayroll({
      month: '2025-10',
      grossSalaries: 10000,
      inssEmployees: 900.55,
      irrfEmployees: 350.2,
      otherDeductions: 149.25,
      grossProLabore: 5000,
      inssProLabore: 550,
      irrfProLabore: 250,
      fgts: 800,
      inssEmployer: 2000,
      vacationProvision: 1111.11,
      thirteenthProvision: 833.33,
    });

    expect(calc.netSalaries).toBe(8600);
    expect(calc.netProLabore).toBe(4200);
    expect(calc.totalGross).toBe(15000);
    expect(calc.totalRetentions).toBe(2200);
    expect(calc.totalNetPayable).toBe(12800);
    expect(calc.totalEmployerCharges).toBe(2800);
    expect(calc.totalProvisions).toBe(1944.44);
    expect(calc.totalInssPayable).toBe(3450.55); // 900.55 + 550 + 2000
    expect(calc.totalIrrfPayable).toBe(600.2); // 350.20 + 250
    expect(calc.totalTaxesPayable).toBe(4850.75); // 3450.55 + 800 + 600.20
  });

  it('recusa retenções maiores que o bruto ou folha totalmente zerada', () => {
    expect(payrollProblem({ month: '2025-10' })).toContain('Informe ao menos um valor');
    expect(
      payrollProblem({
        month: '2025-10',
        grossSalaries: 1000,
        inssEmployees: 800,
        irrfEmployees: 300,
      })
    ).toContain('não podem superar o valor dos salários brutos');
    expect(
      payrollProblem({
        month: '2025-10',
        grossProLabore: 2000,
        inssProLabore: 1500,
        irrfProLabore: 600,
      })
    ).toContain('não podem superar o valor do pró-labore bruto');
  });
});

describe('payroll — geração do lançamento contábil de provisão', () => {
  const accounts = makeAccounts();

  it('gera partida dobrada equilibrada (débitos === créditos) no último dia do mês', () => {
    const draft = buildPayrollJournalDraft(
      {
        month: '2025-10',
        grossSalaries: 12000,
        inssEmployees: 1100,
        irrfEmployees: 450,
        otherDeductions: 250,
        grossProLabore: 6000,
        inssProLabore: 660,
        irrfProLabore: 340,
        fgts: 960,
        inssEmployer: 2400,
        vacationProvision: 1333.33,
        thirteenthProvision: 1000,
      },
      accounts
    );

    expect(draft.date).toBe('2025-10-31');
    expect(draft.category).toBe('PAYROLL');
    expect(draft.payrollMonth).toBe('2025-10');

    const totals = journalTotals(draft.lines);
    expect(totals.difference).toBe(0);
    expect(totals.debit).toBe(totals.credit);

    // Verifica contas utilizadas
    const codes = new Set(draft.lines.map((l) => l.accountCode));
    expect(codes.has(DEFAULT_PAYROLL_MAPPING.salaryExpenseCode)).toBe(true);
    expect(codes.has(DEFAULT_PAYROLL_MAPPING.proLaboreExpenseCode)).toBe(true);
    expect(codes.has(DEFAULT_PAYROLL_MAPPING.socialChargesExpenseCode)).toBe(true);
    expect(codes.has(DEFAULT_PAYROLL_MAPPING.provisionsExpenseCode)).toBe(true);
    expect(codes.has(DEFAULT_PAYROLL_MAPPING.salariesPayableCode)).toBe(true);
    expect(codes.has(DEFAULT_PAYROLL_MAPPING.proLaborePayableCode)).toBe(true);
    expect(codes.has(DEFAULT_PAYROLL_MAPPING.inssPayableCode)).toBe(true);
    expect(codes.has(DEFAULT_PAYROLL_MAPPING.fgtsPayableCode)).toBe(true);
    expect(codes.has(DEFAULT_PAYROLL_MAPPING.irrfPayableCode)).toBe(true);
    expect(codes.has(DEFAULT_PAYROLL_MAPPING.vacationPayableCode)).toBe(true);
    expect(codes.has(DEFAULT_PAYROLL_MAPPING.thirteenthPayableCode)).toBe(true);
  });

  it('detecta contas ausentes no plano de contas quando removidas', () => {
    const partialAccounts = accounts.filter((a) => a.code !== '2.1.1.04');
    const missing = missingPayrollCodes({ month: '2025-10', grossSalaries: 3000, fgts: 240 }, partialAccounts);
    expect(missing).toEqual(['2.1.1.04']);
  });
});

describe('payroll — cruzamento automático com extrato bancário', () => {
  const accounts = makeAccounts();
  const summary = buildPayrollSummary(
    'c1',
    {
      month: '2025-10',
      grossSalaries: 5000,
      inssEmployees: 500,
      grossProLabore: 3000,
      inssProLabore: 330,
      fgts: 400,
      inssEmployer: 600,
    },
    ['je_1'],
    '2025-10-31T10:00:00Z'
  );
  // Líquido salários = 4500 (2.1.1.01)
  // Líquido pró-labore = 2670 (2.1.1.02)
  // INSS total = 1430 (2.1.1.03)
  // FGTS = 400 (2.1.1.04)

  it('identifica obrigações já conciliadas e sugere candidatos no mês e no mês seguinte', () => {
    const transactions: BankTransaction[] = [
      // FGTS já conciliado na conta 2.1.1.04 em 07/11/2025
      makeTx({
        id: 'tx_fgts',
        date: '2025-11-07',
        amount: -400,
        memo: 'CAIXA FGTS GRF 10/2025',
        status: 'RECONCILED',
        accountId: 'c1_2.1.1.04',
        accountCode: '2.1.1.04',
        accountName: 'FGTS a Recolher',
      }),
      // Salários pendente com valor exato + palavra-chave em 05/11/2025
      makeTx({
        id: 'tx_sal',
        date: '2025-11-05',
        amount: -4500,
        memo: 'PAGTO SALARIOS FOLHA OUTUBRO',
      }),
      // INSS pendente com valor exato (sem palavra-chave óbvia) em 20/11/2025
      makeTx({
        id: 'tx_inss_exact',
        date: '2025-11-20',
        amount: -1430,
        memo: 'DEB AUTORIZADO ARRECADACAO RFB',
      }),
      // INSS pendente apenas por palavra-chave (valor diferente)
      makeTx({
        id: 'tx_inss_kw',
        date: '2025-11-20',
        amount: -1450,
        memo: 'DARF PREVIDENCIARIO DCTFWEB',
      }),
      // Lançamento fora da janela (dezembro/2025) — deve ser ignorado
      makeTx({
        id: 'tx_dec',
        date: '2025-12-05',
        amount: -2670,
        memo: 'PRO LABORE SOCIO',
      }),
    ];

    const matches = matchBankTransactionsWithPayroll(summary, transactions, accounts);
    const byKey = new Map(matches.map((m) => [m.key, m]));

    // FGTS: quitado
    const fgts = byKey.get('fgts')!;
    expect(fgts.status).toBe('SETTLED');
    expect(fgts.paid).toBe(400);
    expect(fgts.remaining).toBe(0);
    expect(fgts.candidates).toHaveLength(0);

    // Salários: pendente com sugestão EXACT_AND_MEMO
    const sal = byKey.get('salaries')!;
    expect(sal.status).toBe('PENDING');
    expect(sal.candidates).toHaveLength(1);
    expect(sal.candidates[0].transaction.id).toBe('tx_sal');
    expect(sal.candidates[0].matchReason).toBe('EXACT_AND_MEMO');

    // INSS: pendente com 2 candidatos ordenados por relevância (EXACT_AMOUNT antes de MEMO_KEYWORD)
    const inss = byKey.get('inss')!;
    expect(inss.status).toBe('PENDING');
    expect(inss.candidates.map((c) => [c.transaction.id, c.matchReason])).toEqual([
      ['tx_inss_exact', 'EXACT_AMOUNT'],
      ['tx_inss_kw', 'MEMO_KEYWORD'],
    ]);

    // Pró-labore: sem candidatos na janela out-nov
    const pro = byKey.get('proLabore')!;
    expect(pro.status).toBe('PENDING');
    expect(pro.candidates).toHaveLength(0);
  });
});

describe('payroll — importação rápida via texto/CSV e rotina mensal', () => {
  it('interpreta resumo colado em linhas chave;valor ou texto livre', () => {
    const parsed = parsePayrollText(`
      Salários Brutos: R$ 8.500,00
      Pró-Labore Bruto; 4.000,00
      INSS Empregados\t750,25
      INSS Pró-Labore: 440,00
      IRRF Salários: 120,00
      FGTS: 680,00
      Provisão de Férias: 944,44
      Provisão 13º Salário: 708,33
    `);

    expect(parsed).toEqual({
      grossSalaries: 8500,
      grossProLabore: 4000,
      inssEmployees: 750.25,
      inssProLabore: 440,
      irrfEmployees: 120,
      fgts: 680,
      vacationProvision: 944.44,
      thirteenthProvision: 708.33,
    });
  });

  it('interpreta CSV horizontal de 2 linhas (cabeçalho + valores)', () => {
    const csv = [
      'Salários Brutos;Pró-Labore;INSS Empregados;FGTS',
      '5000,00;2500,00;450,00;400,00',
    ].join('\n');

    expect(parsePayrollText(csv)).toEqual({
      grossSalaries: 5000,
      grossProLabore: 2500,
      inssEmployees: 450,
      fgts: 400,
    });
  });

  it('sinaliza MISSING na rotina mensal quando empresa tinha folha em mês anterior e não lançou no mês atual', () => {
    const accounts = makeAccounts();
    const prevSummary = buildPayrollSummary('c1', { month: '2025-09', grossSalaries: 4000, fgts: 320 }, ['je_09'], '2025-09-30T00:00:00Z');
    const register: PayrollRegister = {
      id: 'c1',
      clientId: 'c1',
      summaries: [prevSummary],
      updatedAt: '2025-09-30T00:00:00Z',
    };

    const status = payrollRoutineStatus({ register, month: '2025-10', accounts });
    expect(status).toEqual({ kind: 'MISSING', previousMonth: '2025-09' });
    expect(payrollCloseProblem(status!, '2025-10')).toContain('10/2025');
  });
});

describe('payroll — quitação por antiguidade, vencimentos e visão do ano', () => {
  const accounts = makeAccounts();
  // Pró-labore fixo: todo mês a mesma guia de INSS (330,00), paga no dia 20 do mês seguinte.
  const february = buildPayrollSummary('c1', { month: '2026-02', grossProLabore: 3000, inssProLabore: 330 }, ['je_2'], '2026-02-28T10:00:00Z');
  const inssId = accounts.find((a) => a.code === DEFAULT_PAYROLL_MAPPING.inssPayableCode)!.id;
  const paidInss = (id: string, date: string) =>
    makeTx({ id, date, amount: -330, memo: 'DARF PREVIDENCIARIO', status: 'RECONCILED', accountId: inssId, accountCode: '2.1.1.03', accountName: 'INSS a Recolher' });
  const inssOf = (txs: BankTransaction[], prior?: number) =>
    matchBankTransactionsWithPayroll(february, txs, accounts, DEFAULT_PAYROLL_MAPPING, {
      ...(prior !== undefined ? { priorBalances: new Map([[inssId, prior]]) } : {}),
      today: '2026-03-25',
    }).find((m) => m.key === 'inss')!;

  it('a guia de janeiro paga em fevereiro não quita a folha de fevereiro', () => {
    const januaryGuide = paidInss('tx_jan', '2026-02-20');

    // Sem o saldo anterior da conta, o pagamento contaria para fevereiro.
    expect(inssOf([januaryGuide]).status).toBe('SETTLED');

    // Com ele (a conta devia 330,00 de janeiro), o pagamento baixa janeiro e fevereiro segue em aberto.
    const open = inssOf([januaryGuide], 330);
    expect(open.status).toBe('PENDING');
    expect(open.paid).toBe(0);
    expect(open.remaining).toBe(330);
    expect(open.reconciledTransactions).toHaveLength(0);
    expect(open.priorTransactions.map((t) => t.id)).toEqual(['tx_jan']);
    expect(open.priorBalance).toBe(330);
    expect(open.priorRemaining).toBe(0);
    expect(open.overdue).toBe(true); // venceu em 20/03 e hoje é 25/03

    // A guia de fevereiro, paga em março, é a que quita a competência.
    const settled = inssOf([januaryGuide, paidInss('tx_fev', '2026-03-20')], 330);
    expect(settled.status).toBe('SETTLED');
    expect(settled.paid).toBe(330);
    expect(settled.reconciledTransactions.map((t) => t.id)).toEqual(['tx_fev']);
    expect(settled.overdue).toBe(false);
  });

  it('pagamento maior que o saldo anterior baixa o resto na competência; saldo anterior em aberto fica à vista', () => {
    // A conta devia 100,00 de antes: dos 330,00 pagos, 230,00 contam para fevereiro.
    const partial = inssOf([paidInss('tx_a', '2026-03-10')], 100);
    expect(partial.status).toBe('PARTIAL');
    expect(partial.paid).toBe(230);
    expect(partial.remaining).toBe(100);
    expect(partial.reconciledTransactions.map((t) => t.id)).toEqual(['tx_a']);

    // Devia 1.000,00 e só entrou um pagamento de 330,00: ainda restam 670,00 de competências anteriores.
    const arrears = inssOf([paidInss('tx_b', '2026-03-10')], 1000);
    expect(arrears.paid).toBe(0);
    expect(arrears.priorRemaining).toBe(670);

    // Saldo devedor (adiantamento) não vira dívida negativa.
    expect(inssOf([], -50).priorBalance).toBe(0);
  });

  it('sugere o débito pendente que tem o valor do saldo anterior em aberto', () => {
    const pending = makeTx({ id: 'tx_p', date: '2026-02-20', amount: -500, memo: 'DEB AUTORIZADO RFB' });
    expect(inssOf([pending], 500).candidates.map((c) => [c.transaction.id, c.matchReason])).toEqual([['tx_p', 'EXACT_AMOUNT']]);
    expect(inssOf([pending]).candidates).toHaveLength(0);
  });

  it('vencimentos: salários no 5º dia útil (sábado conta), guias no dia 20 antecipado, pró-labore sem prazo', () => {
    // Março/2026: dia 1º é domingo; úteis 2, 3, 4, 5 e 6 (sexta).
    expect(fifthWorkingDay('2026-03')).toBe('2026-03-06');
    // Maio/2026: 1º é feriado (sexta); sábado 2 conta, domingo 3 não: 2, 4, 5, 6 e 7.
    expect(fifthWorkingDay('2026-05')).toBe('2026-05-07');
    expect(payrollDueDate('salaries', '2026-02')).toBe('2026-03-06');
    expect(payrollDueDate('inss', '2026-02')).toBe('2026-03-20');
    expect(payrollDueDate('fgts', '2026-02')).toBe('2026-03-20');
    // Competência 05/2026: dia 20/06/2026 é sábado, antecipa para sexta, 19.
    expect(payrollDueDate('irrf', '2026-05')).toBe('2026-06-19');
    expect(payrollDueDate('proLabore', '2026-02')).toBeNull();
  });

  it('visão do ano: lançada, fechada, faltando e vazia', () => {
    const register: PayrollRegister = {
      id: 'c1',
      clientId: 'c1',
      updatedAt: '',
      summaries: [
        buildPayrollSummary('c1', { month: '2026-02', grossProLabore: 3000 }, ['a'], ''),
        buildPayrollSummary('c1', { month: '2026-04', grossProLabore: 3000, fgts: 100 }, ['b'], ''),
      ],
    };
    const overview = payrollYearOverview(register, 2026, new Set(['2026-02']), '2026-05-10');
    expect(overview).toHaveLength(12);
    expect(overview.map((m) => m.state)).toEqual(['EMPTY', 'LOCKED', 'MISSING', 'POSTED', 'MISSING', 'EMPTY', 'EMPTY', 'EMPTY', 'EMPTY', 'EMPTY', 'EMPTY', 'EMPTY']);
    expect(overview[3].totalExpense).toBe(3100);

    // Sem nenhuma folha, nada é cobrado.
    expect(payrollYearOverview(null, 2026, new Set(), '2026-05-10').every((m) => m.state === 'EMPTY')).toBe(true);
    // Ano anterior à primeira folha: nada faltando.
    expect(payrollYearOverview(register, 2025, new Set(), '2026-05-10').every((m) => m.state === 'EMPTY')).toBe(true);
  });
});
