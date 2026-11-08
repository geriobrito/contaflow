import type {
  BankTransaction,
  ChartAccount,
  JournalEntry,
  JournalEntryLine,
  PayrollAccountMapping,
  PayrollRegister,
  PayrollSummary,
} from '@/types/firestore';
import type { JournalEntryDraft } from '@/lib/data/repository';
import { lastDayOf } from '@/lib/fixed-assets';
import { fromCents, toCents } from '@/lib/money';
import { parseMoneyInput } from '@/lib/opening';
import { normalizeText } from '@/lib/rules/engine';

/** Mapeamento padrão do modelo de plano de contas do CFC (NBC TG 1002 / ITG 1000). */
export const DEFAULT_PAYROLL_MAPPING: PayrollAccountMapping = {
  salaryExpenseCode: '3.3.2.01',
  proLaboreExpenseCode: '3.3.2.02',
  socialChargesExpenseCode: '3.3.2.03',
  provisionsExpenseCode: '3.3.2.04',
  salariesPayableCode: '2.1.1.01',
  proLaborePayableCode: '2.1.1.02',
  inssPayableCode: '2.1.1.03',
  fgtsPayableCode: '2.1.1.04',
  vacationPayableCode: '2.1.1.05',
  thirteenthPayableCode: '2.1.1.06',
  irrfPayableCode: '2.1.5.04',
};

export interface PayrollInput {
  month: string;
  grossSalaries?: number;
  grossProLabore?: number;
  inssEmployees?: number;
  inssProLabore?: number;
  irrfEmployees?: number;
  irrfProLabore?: number;
  otherDeductions?: number;
  fgts?: number;
  inssEmployer?: number;
  vacationProvision?: number;
  thirteenthProvision?: number;
  mappedAccounts?: Partial<PayrollAccountMapping>;
  notes?: string;
}

export interface CalculatedPayroll {
  grossSalaries: number;
  grossProLabore: number;
  inssEmployees: number;
  inssProLabore: number;
  irrfEmployees: number;
  irrfProLabore: number;
  otherDeductions: number;
  netSalaries: number;
  netProLabore: number;
  fgts: number;
  inssEmployer: number;
  vacationProvision: number;
  thirteenthProvision: number;
  totalGross: number;
  totalRetentions: number;
  totalNetPayable: number;
  totalEmployerCharges: number;
  totalProvisions: number;
  totalInssPayable: number;
  totalIrrfPayable: number;
  totalTaxesPayable: number;
  totalExpense: number;
}

const cleanAmount = (v: number | undefined): number => {
  if (v === undefined || !Number.isFinite(v) || v <= 0) return 0;
  return fromCents(toCents(v));
};

export function resolvePayrollMapping(
  registerMapping?: Partial<PayrollAccountMapping>,
  summaryMapping?: Partial<PayrollAccountMapping>
): PayrollAccountMapping {
  return {
    ...DEFAULT_PAYROLL_MAPPING,
    ...(registerMapping ?? {}),
    ...(summaryMapping ?? {}),
  };
}

/**
 * Calcula os valores líquidos e totalizadores da folha em centavos exatos,
 * garantindo que `Bruto − Retenções = Líquido`.
 */
export function calculateNetPayroll(input: PayrollInput): CalculatedPayroll {
  const grossSalaries = cleanAmount(input.grossSalaries);
  const grossProLabore = cleanAmount(input.grossProLabore);
  const inssEmployees = cleanAmount(input.inssEmployees);
  const inssProLabore = cleanAmount(input.inssProLabore);
  const irrfEmployees = cleanAmount(input.irrfEmployees);
  const irrfProLabore = cleanAmount(input.irrfProLabore);
  const otherDeductions = cleanAmount(input.otherDeductions);
  const fgts = cleanAmount(input.fgts);
  const inssEmployer = cleanAmount(input.inssEmployer);
  const vacationProvision = cleanAmount(input.vacationProvision);
  const thirteenthProvision = cleanAmount(input.thirteenthProvision);

  const salaryRetentionsCents = toCents(inssEmployees) + toCents(irrfEmployees) + toCents(otherDeductions);
  const proLaboreRetentionsCents = toCents(inssProLabore) + toCents(irrfProLabore);

  const netSalaries = fromCents(Math.max(0, toCents(grossSalaries) - salaryRetentionsCents));
  const netProLabore = fromCents(Math.max(0, toCents(grossProLabore) - proLaboreRetentionsCents));

  const totalGross = fromCents(toCents(grossSalaries) + toCents(grossProLabore));
  const totalRetentions = fromCents(salaryRetentionsCents + proLaboreRetentionsCents);
  const totalNetPayable = fromCents(toCents(netSalaries) + toCents(netProLabore));
  const totalEmployerCharges = fromCents(toCents(fgts) + toCents(inssEmployer));
  const totalProvisions = fromCents(toCents(vacationProvision) + toCents(thirteenthProvision));
  const totalInssPayable = fromCents(toCents(inssEmployees) + toCents(inssProLabore) + toCents(inssEmployer));
  const totalIrrfPayable = fromCents(toCents(irrfEmployees) + toCents(irrfProLabore));
  const totalTaxesPayable = fromCents(toCents(totalInssPayable) + toCents(fgts) + toCents(totalIrrfPayable));
  const totalExpense = fromCents(
    toCents(grossSalaries) -
      toCents(otherDeductions) +
      toCents(grossProLabore) +
      toCents(totalEmployerCharges) +
      toCents(totalProvisions)
  );

  return {
    grossSalaries,
    grossProLabore,
    inssEmployees,
    inssProLabore,
    irrfEmployees,
    irrfProLabore,
    otherDeductions,
    netSalaries,
    netProLabore,
    fgts,
    inssEmployer,
    vacationProvision,
    thirteenthProvision,
    totalGross,
    totalRetentions,
    totalNetPayable,
    totalEmployerCharges,
    totalProvisions,
    totalInssPayable,
    totalIrrfPayable,
    totalTaxesPayable,
    totalExpense,
  };
}

/** Verifica se os valores da folha são consistentes antes de contabilizar. */
export function payrollProblem(input: PayrollInput): string | null {
  if (!/^\d{4}-\d{2}$/.test(input.month)) {
    return 'Informe uma competência válida (AAAA-MM).';
  }
  const fields: [number | undefined, string][] = [
    [input.grossSalaries, 'Salários brutos'],
    [input.grossProLabore, 'Pró-labore bruto'],
    [input.inssEmployees, 'INSS dos empregados'],
    [input.inssProLabore, 'INSS sobre pró-labore'],
    [input.irrfEmployees, 'IRRF sobre salários'],
    [input.irrfProLabore, 'IRRF sobre pró-labore'],
    [input.otherDeductions, 'Outros descontos'],
    [input.fgts, 'FGTS'],
    [input.inssEmployer, 'INSS patronal'],
    [input.vacationProvision, 'Provisão de férias'],
    [input.thirteenthProvision, 'Provisão de 13º salário'],
  ];
  for (const [val, label] of fields) {
    if (val !== undefined && (!Number.isFinite(val) || val < 0)) {
      return `${label}: informe um valor válido (zero ou positivo).`;
    }
  }

  const calc = calculateNetPayroll(input);
  const salaryDeductionsCents = toCents(calc.inssEmployees) + toCents(calc.irrfEmployees) + toCents(calc.otherDeductions);
  if (salaryDeductionsCents > toCents(calc.grossSalaries)) {
    return 'As retenções e descontos dos empregados (INSS + IRRF + outros) não podem superar o valor dos salários brutos.';
  }

  const proLaboreDeductionsCents = toCents(calc.inssProLabore) + toCents(calc.irrfProLabore);
  if (proLaboreDeductionsCents > toCents(calc.grossProLabore)) {
    return 'As retenções dos sócios (INSS + IRRF) não podem superar o valor do pró-labore bruto.';
  }

  const anyValue =
    toCents(calc.totalGross) + toCents(calc.totalEmployerCharges) + toCents(calc.totalProvisions) > 0;
  if (!anyValue) {
    return 'Informe ao menos um valor de salário, pró-labore, encargo ou provisão para contabilizar a folha.';
  }

  return null;
}

const formatCompetence = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;

/** Códigos de contas contábeis exigidos pelos itens preenchidos na folha. */
export function requiredPayrollAccountCodes(
  input: PayrollInput,
  mapping: PayrollAccountMapping = DEFAULT_PAYROLL_MAPPING
): string[] {
  const calc = calculateNetPayroll(input);
  const codes = new Set<string>();
  if (calc.grossSalaries > 0) {
    codes.add(mapping.salaryExpenseCode);
    if (calc.netSalaries > 0) codes.add(mapping.salariesPayableCode);
  }
  if (calc.grossProLabore > 0) {
    codes.add(mapping.proLaboreExpenseCode);
    if (calc.netProLabore > 0) codes.add(mapping.proLaborePayableCode);
  }
  if (calc.fgts > 0 || calc.inssEmployer > 0) {
    codes.add(mapping.socialChargesExpenseCode);
  }
  if (calc.fgts > 0) {
    codes.add(mapping.fgtsPayableCode);
  }
  if (calc.totalInssPayable > 0) {
    codes.add(mapping.inssPayableCode);
  }
  if (calc.totalIrrfPayable > 0) {
    codes.add(mapping.irrfPayableCode);
  }
  if (calc.vacationProvision > 0) {
    codes.add(mapping.provisionsExpenseCode);
    codes.add(mapping.vacationPayableCode);
  }
  if (calc.thirteenthProvision > 0) {
    codes.add(mapping.provisionsExpenseCode);
    codes.add(mapping.thirteenthPayableCode);
  }
  return [...codes];
}

/** Códigos do modelo CFC que estão faltando no plano do cliente para contabilizar esta folha. */
export function missingPayrollCodes(
  input: PayrollInput,
  accounts: readonly ChartAccount[],
  mapping: PayrollAccountMapping = DEFAULT_PAYROLL_MAPPING
): string[] {
  const existing = new Set(accounts.filter((a) => a.nature === 'ANALYTIC').map((a) => a.code));
  return requiredPayrollAccountCodes(input, mapping).filter((code) => !existing.has(code));
}

export type PayrollJournalDraft = Omit<JournalEntryDraft, 'id' | 'clientId' | 'createdAt' | 'updatedAt' | 'createdByUid'>;

/**
 * Monta o lançamento contábil de provisão da folha de pagamento e encargos no último dia da competência.
 * Garante equilíbrio estrito de partidas dobradas (soma dos débitos === soma dos créditos).
 */
export function buildPayrollJournalDraft(
  input: PayrollInput,
  accounts: readonly ChartAccount[],
  mapping: PayrollAccountMapping = DEFAULT_PAYROLL_MAPPING
): PayrollJournalDraft {
  const problem = payrollProblem(input);
  if (problem) throw new Error(problem);

  const calc = calculateNetPayroll(input);
  const byCode = new Map(accounts.filter((a) => a.nature === 'ANALYTIC').map((a) => [a.code, a] as const));
  const comp = formatCompetence(input.month);

  const requireAcc = (code: string, label: string): ChartAccount => {
    const acc = byCode.get(code);
    if (!acc) throw new Error(`A conta analítica ${code} (${label}) não foi encontrada no plano de contas.`);
    return acc;
  };

  const lines: JournalEntryLine[] = [];
  let lineSeq = 1;
  const pushLine = (code: string, label: string, type: 'DEBIT' | 'CREDIT', amount: number, memo: string) => {
    const val = cleanAmount(amount);
    if (val <= 0) return;
    const acc = requireAcc(code, label);
    lines.push({
      id: `pl_${input.month}_${lineSeq++}`,
      accountId: acc.id,
      accountCode: acc.code,
      accountName: acc.name,
      type,
      amount: val,
      memo,
    });
  };

  // 1. Salários CLT
  if (calc.grossSalaries > 0) {
    pushLine(mapping.salaryExpenseCode, 'Salários e Ordenados', 'DEBIT', calc.grossSalaries, `Salários brutos — ${comp}`);
    if (calc.otherDeductions > 0) {
      pushLine(
        mapping.salaryExpenseCode,
        'Salários e Ordenados',
        'CREDIT',
        calc.otherDeductions,
        `Descontos em folha (VT/faltas/outros) — ${comp}`
      );
    }
    if (calc.netSalaries > 0) {
      pushLine(mapping.salariesPayableCode, 'Salários a Pagar', 'CREDIT', calc.netSalaries, `Salários líquidos a pagar — ${comp}`);
    }
  }

  // 2. Pró-Labore
  if (calc.grossProLabore > 0) {
    pushLine(mapping.proLaboreExpenseCode, 'Pró-Labore', 'DEBIT', calc.grossProLabore, `Pró-labore bruto — ${comp}`);
    if (calc.netProLabore > 0) {
      pushLine(mapping.proLaborePayableCode, 'Pró-Labore a Pagar', 'CREDIT', calc.netProLabore, `Pró-labore líquido a pagar — ${comp}`);
    }
  }

  // 3. Encargos Sociais Patronais (FGTS + INSS Patronal)
  if (calc.inssEmployer > 0) {
    pushLine(
      mapping.socialChargesExpenseCode,
      'Encargos Sociais',
      'DEBIT',
      calc.inssEmployer,
      `INSS patronal (CPP/RAT/Terceiros) — ${comp}`
    );
  }
  if (calc.fgts > 0) {
    pushLine(mapping.socialChargesExpenseCode, 'Encargos Sociais', 'DEBIT', calc.fgts, `FGTS da competência — ${comp}`);
    pushLine(mapping.fgtsPayableCode, 'FGTS a Recolher', 'CREDIT', calc.fgts, `FGTS a recolher — ${comp}`);
  }

  // 4. INSS a Recolher (Segurados + Sócios + Patronal)
  if (calc.inssEmployees > 0) {
    pushLine(mapping.inssPayableCode, 'INSS a Recolher', 'CREDIT', calc.inssEmployees, `INSS retido dos empregados — ${comp}`);
  }
  if (calc.inssProLabore > 0) {
    pushLine(mapping.inssPayableCode, 'INSS a Recolher', 'CREDIT', calc.inssProLabore, `INSS retido sobre pró-labore — ${comp}`);
  }
  if (calc.inssEmployer > 0) {
    pushLine(mapping.inssPayableCode, 'INSS a Recolher', 'CREDIT', calc.inssEmployer, `INSS patronal a recolher — ${comp}`);
  }

  // 5. IRRF a Recolher (Salários + Pró-Labore)
  if (calc.irrfEmployees > 0) {
    pushLine(mapping.irrfPayableCode, 'IRRF a Recolher', 'CREDIT', calc.irrfEmployees, `IRRF retido sobre salários — ${comp}`);
  }
  if (calc.irrfProLabore > 0) {
    pushLine(mapping.irrfPayableCode, 'IRRF a Recolher', 'CREDIT', calc.irrfProLabore, `IRRF retido sobre pró-labore — ${comp}`);
  }

  // 6. Provisões Mensais de Férias e 13º Salário
  if (calc.vacationProvision > 0) {
    pushLine(
      mapping.provisionsExpenseCode,
      'Férias e 13º Salário',
      'DEBIT',
      calc.vacationProvision,
      `Provisão mensal de férias e encargos — ${comp}`
    );
    pushLine(
      mapping.vacationPayableCode,
      'Férias e Encargos a Pagar',
      'CREDIT',
      calc.vacationProvision,
      `Provisão de férias a pagar — ${comp}`
    );
  }
  if (calc.thirteenthProvision > 0) {
    pushLine(
      mapping.provisionsExpenseCode,
      'Férias e 13º Salário',
      'DEBIT',
      calc.thirteenthProvision,
      `Provisão mensal de 13º salário e encargos — ${comp}`
    );
    pushLine(
      mapping.thirteenthPayableCode,
      '13º Salário e Encargos a Pagar',
      'CREDIT',
      calc.thirteenthProvision,
      `Provisão de 13º salário a pagar — ${comp}`
    );
  }

  const totalAmount = fromCents(lines.filter((l) => l.type === 'DEBIT').reduce((s, l) => s + toCents(l.amount), 0));

  return {
    date: lastDayOf(input.month),
    memo: `Folha de pagamento e encargos — ${comp}`,
    category: 'PAYROLL',
    documentRef: `Folha ${comp}`,
    payrollMonth: input.month,
    lines,
    totalAmount,
  };
}

/** Constrói um `PayrollSummary` completo a partir dos dados informados. */
export function buildPayrollSummary(
  clientId: string,
  input: PayrollInput,
  journalEntryIds: string[],
  now: string,
  authorUid?: string
): PayrollSummary {
  const calc = calculateNetPayroll(input);
  return {
    id: `${clientId}_${input.month}`,
    clientId,
    month: input.month,
    date: lastDayOf(input.month),
    grossSalaries: calc.grossSalaries,
    grossProLabore: calc.grossProLabore,
    inssEmployees: calc.inssEmployees,
    inssProLabore: calc.inssProLabore,
    irrfEmployees: calc.irrfEmployees,
    irrfProLabore: calc.irrfProLabore,
    ...(calc.otherDeductions > 0 ? { otherDeductions: calc.otherDeductions } : {}),
    netSalaries: calc.netSalaries,
    netProLabore: calc.netProLabore,
    fgts: calc.fgts,
    ...(calc.inssEmployer > 0 ? { inssEmployer: calc.inssEmployer } : {}),
    ...(calc.vacationProvision > 0 ? { vacationProvision: calc.vacationProvision } : {}),
    ...(calc.thirteenthProvision > 0 ? { thirteenthProvision: calc.thirteenthProvision } : {}),
    journalEntryIds,
    ...(input.mappedAccounts ? { mappedAccounts: input.mappedAccounts } : {}),
    ...(input.notes?.trim() ? { notes: input.notes.trim().slice(0, 200) } : {}),
    updatedAt: now,
    ...(authorUid ? { updatedByUid: authorUid } : {}),
  };
}

/* =========================================================================
   Cruzamento e Conciliação com o Extrato Bancário
   ========================================================================= */

export type PayrollObligationKey = 'salaries' | 'proLabore' | 'inss' | 'fgts' | 'irrf';

export interface PayrollCandidateTransaction {
  transaction: BankTransaction;
  /** Motivo da sugestão: valor exato + histórico, valor exato ou palavra-chave no histórico. */
  matchReason: 'EXACT_AND_MEMO' | 'EXACT_AMOUNT' | 'MEMO_KEYWORD';
}

export interface PayrollObligationMatch {
  key: PayrollObligationKey;
  label: string;
  accountCode: string;
  accountId: string | null;
  accountName: string;
  /** Valor provisionado na folha da competência. */
  provisioned: number;
  /** Soma dos pagamentos já classificados nesta conta na janela de pagamento. */
  paid: number;
  /** Saldo pendente de pagamento/conciliação. */
  remaining: number;
  status: 'SETTLED' | 'PARTIAL' | 'PENDING';
  reconciledTransactions: BankTransaction[];
  candidates: PayrollCandidateTransaction[];
}

/** Próxima competência (YYYY-MM). */
export function nextMonthOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Competência anterior (YYYY-MM). */
export function prevMonthOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

const OBLIGATION_KEYWORDS: Record<PayrollObligationKey, readonly string[]> = {
  salaries: ['SALARIO', 'SALARIOS', 'FOLHA', 'PAGTO SAL', 'PGTO SAL', 'ORDENADO', 'REMUNERACAO', 'LIQUIDO FOLHA'],
  proLabore: ['PRO LABORE', 'PROLABORE', 'RETIRADA SOCIO', 'ADIANTAMENTO SOCIO', 'SOCIO'],
  inss: ['INSS', 'GPS', 'DCTFWEB', 'DARF PREV', 'PREVIDENCIARIO', 'PREVIDENCIA', 'CONTRIB PREV'],
  fgts: ['FGTS', 'GFIP', 'GRF', 'SEFIP', 'CAIXA FGTS'],
  irrf: ['IRRF', '0561', '0588', 'DARF IR', 'IMPOSTO DE RENDA RETIDO'],
};

function matchesKeyword(memo: string, key: PayrollObligationKey): boolean {
  const norm = normalizeText(memo);
  if (!norm) return false;
  return OBLIGATION_KEYWORDS[key].some((kw) => norm.includes(kw));
}

/**
 * Cruza as obrigações geradas pela folha da competência (`summary.month`) com os débitos do
 * extrato bancário ocorridos na própria competência ou no mês seguinte (ex.: folha de 10/2025
 * paga em 10/2025 ou até 30/11/2025).
 */
export function matchBankTransactionsWithPayroll(
  summary: PayrollSummary | PayrollInput,
  transactions: readonly BankTransaction[],
  accounts: readonly ChartAccount[],
  mapping: PayrollAccountMapping = DEFAULT_PAYROLL_MAPPING
): PayrollObligationMatch[] {
  const calc = calculateNetPayroll(summary);
  const byCode = new Map(accounts.filter((a) => a.nature === 'ANALYTIC').map((a) => [a.code, a] as const));

  const windowStart = `${summary.month}-01`;
  const windowEnd = lastDayOf(nextMonthOf(summary.month));

  // Apenas saídas bancárias dentro da janela de pagamento da competência.
  const debitsInWindow = transactions.filter(
    (t) => t.date >= windowStart && t.date <= windowEnd && (t.amount < 0 || t.type === 'DEBIT')
  );

  const specs: { key: PayrollObligationKey; label: string; code: string; defaultName: string; amount: number }[] = [
    { key: 'salaries', label: 'Salários a Pagar', code: mapping.salariesPayableCode, defaultName: 'Salários a Pagar', amount: calc.netSalaries },
    { key: 'proLabore', label: 'Pró-Labore a Pagar', code: mapping.proLaborePayableCode, defaultName: 'Pró-Labore a Pagar', amount: calc.netProLabore },
    { key: 'inss', label: 'INSS a Recolher (GPS / DCTFWeb)', code: mapping.inssPayableCode, defaultName: 'INSS a Recolher', amount: calc.totalInssPayable },
    { key: 'fgts', label: 'FGTS a Recolher', code: mapping.fgtsPayableCode, defaultName: 'FGTS a Recolher', amount: calc.fgts },
    { key: 'irrf', label: 'IRRF a Recolher', code: mapping.irrfPayableCode, defaultName: 'IRRF a Recolher', amount: calc.totalIrrfPayable },
  ];

  const out: PayrollObligationMatch[] = [];

  for (const spec of specs) {
    if (spec.amount <= 0) continue;
    const acc = byCode.get(spec.code);
    const reconciledTransactions: BankTransaction[] = [];
    let paidCents = 0;

    for (const tx of debitsInWindow) {
      if (tx.status === 'PENDING') continue;
      if (tx.isSplit && tx.splits?.length) {
        const splitMatch = tx.splits.filter((s) => (acc && s.accountId === acc.id) || s.accountCode === spec.code);
        if (splitMatch.length > 0) {
          reconciledTransactions.push(tx);
          for (const s of splitMatch) paidCents += toCents(Math.abs(s.amount));
        }
        continue;
      }
      if ((acc && tx.accountId === acc.id) || tx.accountCode === spec.code) {
        reconciledTransactions.push(tx);
        paidCents += toCents(Math.abs(tx.amount));
      }
    }

    const provisionedCents = toCents(spec.amount);
    const remainingCents = Math.max(0, provisionedCents - paidCents);
    const remaining = fromCents(remainingCents);
    const paid = fromCents(paidCents);

    const status: PayrollObligationMatch['status'] =
      remainingCents === 0 ? 'SETTLED' : paidCents > 0 ? 'PARTIAL' : 'PENDING';

    const candidates: PayrollCandidateTransaction[] = [];
    if (remainingCents > 0) {
      const reconciledIds = new Set(reconciledTransactions.map((t) => t.id));
      for (const tx of debitsInWindow) {
        if (reconciledIds.has(tx.id)) continue;
        // Só sugere lançamentos ainda pendentes ou auto-classificados em outra conta.
        if (tx.status === 'RECONCILED') continue;
        const txCents = toCents(Math.abs(tx.amount));
        const exactAmount = txCents === remainingCents || txCents === provisionedCents;
        const hasKeyword = matchesKeyword(tx.memo, spec.key);

        if (exactAmount && hasKeyword) {
          candidates.push({ transaction: tx, matchReason: 'EXACT_AND_MEMO' });
        } else if (exactAmount) {
          candidates.push({ transaction: tx, matchReason: 'EXACT_AMOUNT' });
        } else if (hasKeyword) {
          candidates.push({ transaction: tx, matchReason: 'MEMO_KEYWORD' });
        }
      }

      const rank = { EXACT_AND_MEMO: 0, EXACT_AMOUNT: 1, MEMO_KEYWORD: 2 } as const;
      candidates.sort(
        (a, b) => rank[a.matchReason] - rank[b.matchReason] || a.transaction.date.localeCompare(b.transaction.date)
      );
    }

    out.push({
      key: spec.key,
      label: spec.label,
      accountCode: spec.code,
      accountId: acc?.id ?? null,
      accountName: acc?.name ?? spec.defaultName,
      provisioned: spec.amount,
      paid,
      remaining,
      status,
      reconciledTransactions,
      candidates,
    });
  }

  return out;
}

/* =========================================================================
   Importação Rápida (Planilha CSV ou Texto Colado do Resumo da Folha)
   ========================================================================= */

const FIELD_PATTERNS: { field: keyof Omit<PayrollInput, 'month' | 'mappedAccounts' | 'notes'>; patterns: readonly string[] }[] = [
  // Retenções, encargos e provisões vêm antes dos proventos genéricos ("SALARIOS", "PRO LABORE")
  // para que "INSS Pró-Labore" ou "IRRF Salários" não caiam em grossProLabore / grossSalaries.
  { field: 'inssProLabore', patterns: ['INSS PRO LABORE', 'INSS PROLABORE', 'INSS SOCIOS', 'INSS CONTRIBUINTE INDIVIDUAL'] },
  { field: 'inssEmployer', patterns: ['INSS PATRONAL', 'INSS EMPRESA', 'CPP', 'ENCARGOS INSS PATRONAL', 'PARTE EMPRESA'] },
  { field: 'inssEmployees', patterns: ['INSS EMPREGADOS', 'INSS SEGURADOS', 'INSS RETIDO EMPREGADOS', 'INSS DESCONTADO', 'INSS FOLHA', 'INSS SALARIOS'] },
  { field: 'irrfProLabore', patterns: ['IRRF PRO LABORE', 'IRRF PROLABORE', 'IRRF SOCIOS'] },
  { field: 'irrfEmployees', patterns: ['IRRF SALARIOS', 'IRRF EMPREGADOS', 'IRRF FOLHA', 'IRRF RETIDO SALARIOS', 'IRRF'] },
  { field: 'otherDeductions', patterns: ['OUTROS DESCONTOS', 'DESCONTOS DIVERSOS', 'VALE TRANSPORTE', 'FALTAS E ATRASOS'] },
  { field: 'fgts', patterns: ['FGTS', 'FGTS COMPETENCIA', 'FGTS A RECOLHER', 'FGTS MENSAL'] },
  { field: 'vacationProvision', patterns: ['PROVISAO FERIAS', 'PROVISAO DE FERIAS', 'FERIAS PROVISAO', 'COTA FERIAS'] },
  { field: 'thirteenthProvision', patterns: ['PROVISAO 13', 'PROVISAO DE 13', '13 SALARIO PROVISAO', 'DECIMO TERCEIRO PROVISAO'] },
  { field: 'grossProLabore', patterns: ['PRO LABORE BRUTO', 'PROLABORE BRUTO', 'PRO LABORE', 'PROLABORE', 'RETIRADA PRO LABORE'] },
  { field: 'grossSalaries', patterns: ['SALARIOS BRUTOS', 'SALARIO BRUTO', 'PROVENTOS SALARIOS', 'TOTAL SALARIOS', 'SALARIOS E ORDENADOS', 'SALARIOS'] },
];

/**
 * Lê um texto colado ou conteúdo CSV de resumo da folha (formato chave;valor em linhas
 * ou cabeçalho + linha de valores) e devolve os campos identificados.
 */
export function parsePayrollText(raw: string): Partial<Omit<PayrollInput, 'month' | 'mappedAccounts'>> {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return {};

  const out: Partial<Record<keyof Omit<PayrollInput, 'month' | 'mappedAccounts' | 'notes'>, number>> = {};

  const matchField = (label: string) => {
    const norm = normalizeText(label);
    if (!norm) return null;
    for (const item of FIELD_PATTERNS) {
      if (item.patterns.some((p) => norm === p || norm.includes(p))) {
        return item.field;
      }
    }
    return null;
  };

  // Caso 1: CSV horizontal (1ª linha cabeçalhos, 2ª linha valores)
  if (lines.length === 2 && (lines[0].includes(';') || lines[0].includes('\t') || lines[0].includes(','))) {
    const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
    const headers = lines[0].split(sep).map((s) => s.trim());
    const values = lines[1].split(sep).map((s) => s.trim());
    if (headers.length >= 2 && headers.length === values.length) {
      let matched = 0;
      for (let i = 0; i < headers.length; i++) {
        const field = matchField(headers[i]);
        const amount = parseMoneyInput(values[i].replace(/^R\$\s*/i, ''));
        if (field && amount !== null && amount >= 0) {
          out[field] = amount;
          matched++;
        }
      }
      if (matched > 0) return out;
    }
  }

  // Caso 2: Linhas chave;valor, chave\tvalor ou "Descrição: R$ 1.234,56"
  for (const line of lines) {
    let label = '';
    let valueStr = '';
    if (line.includes('\t')) {
      const parts = line.split('\t').map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        label = parts[0];
        valueStr = parts[parts.length - 1];
      }
    } else if (line.includes(';')) {
      const parts = line.split(';').map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        label = parts[0];
        valueStr = parts[parts.length - 1];
      }
    } else {
      const m = line.match(/^(.+?)\s*[:=-]?\s*(?:R\$\s*)?([\d.,]+)$/i);
      if (m) {
        label = m[1].trim();
        valueStr = m[2].trim();
      }
    }
    if (!label || !valueStr) continue;
    const field = matchField(label);
    const amount = parseMoneyInput(valueStr.replace(/^R\$\s*/i, ''));
    if (field && amount !== null && amount >= 0) {
      out[field] = amount;
    }
  }

  return out;
}

/** Situação da rotina mensal da folha para o fechamento da competência. */
export type PayrollRoutineStatus =
  | { kind: 'OK'; summary: PayrollSummary; existing: JournalEntry }
  | { kind: 'MISSING'; previousMonth: string }
  | { kind: 'PENDING'; summary: PayrollSummary; draft: PayrollJournalDraft; existing?: JournalEntry }
  | { kind: 'BLOCKED'; problem: string };

export function payrollRoutineStatus(params: {
  register: PayrollRegister | null;
  month: string;
  accounts: readonly ChartAccount[];
  existing?: JournalEntry;
}): PayrollRoutineStatus | null {
  const { register, month, accounts, existing } = params;
  if (!register || register.summaries.length === 0) return null;

  const summary = register.summaries.find((s) => s.month === month);
  if (!summary) {
    // Se a empresa já lançou folha em competência anterior, avisa que esta competência ainda não tem folha.
    const prior = register.summaries
      .filter((s) => s.month < month)
      .sort((a, b) => b.month.localeCompare(a.month))[0];
    if (!prior) return null;
    return { kind: 'MISSING', previousMonth: prior.month };
  }

  const mapping = resolvePayrollMapping(register.defaultMapping, summary.mappedAccounts);
  const missing = missingPayrollCodes(summary, accounts, mapping);
  if (missing.length > 0) {
    return {
      kind: 'BLOCKED',
      problem: `Faltam contas no plano para lançar a folha de ${formatCompetence(month)} (${missing.join(', ')}).`,
    };
  }

  const problem = payrollProblem(summary);
  if (problem) return { kind: 'BLOCKED', problem };

  const draft = buildPayrollJournalDraft(summary, accounts, mapping);
  if (existing && samePayrollEntry(existing, draft)) {
    return { kind: 'OK', summary, existing };
  }
  return { kind: 'PENDING', summary, draft, existing };
}

function samePayrollEntry(existing: JournalEntry, draft: PayrollJournalDraft): boolean {
  if (existing.date !== draft.date || existing.lines.length !== draft.lines.length) return false;
  return existing.lines.every((l, i) => {
    const d = draft.lines[i];
    return l.accountId === d.accountId && l.type === d.type && toCents(l.amount) === toCents(d.amount);
  });
}

export function payrollCloseProblem(status: PayrollRoutineStatus, month: string): string | null {
  const comp = formatCompetence(month);
  switch (status.kind) {
    case 'OK':
      return null;
    case 'MISSING':
      return `Informe ou repita a folha de pagamento de ${comp} (Rotina › Folha de Pagamento) antes de fechar a competência.`;
    case 'PENDING':
      return status.existing
        ? `Atualize o lançamento da folha de pagamento de ${comp} antes de fechar.`
        : `Lance a provisão da folha de pagamento de ${comp} antes de fechar.`;
    case 'BLOCKED':
      return status.problem;
  }
}
