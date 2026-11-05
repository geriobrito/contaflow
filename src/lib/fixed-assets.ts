import type {
  ChartAccount,
  FixedAsset,
  FixedAssetDisposalReason,
  FixedAssetUse,
  JournalEntry,
  JournalEntryLine,
} from '@/types/firestore';
import { fromCents, toCents } from '@/lib/money';
import { MONTH_NAMES, monthOf } from '@/lib/periods';
import { journalEntryProblem, journalTotals, MAX_JOURNAL_LINES } from '@/lib/journal';

/**
 * Imobilizado e intangível: cadastro dos bens, cotas mensais de depreciação (linha reta,
 * NBC TG 1002/1001 seção 17) e os lançamentos gerados a partir delas.
 *
 * - A depreciação começa na data em que o bem ficou disponível para uso, proporcional aos dias
 *   do primeiro mês (em uso desde o dia 15 de março: 17/31 da cota de março; desde o dia 1º:
 *   o mês cheio), e é lançada todo mês, no último dia da competência.
 * - Cota mensal = (custo − residual) × taxa anual ÷ 12, em centavos; a última cota é o que falta
 *   para a base, de modo que o total nunca passa dela.
 * - Na baixa, a depreciação vai até a data da baixa, também proporcional aos dias.
 * - Tudo é recalculado a partir dos dados do bem: não há saldo acumulado gravado que possa
 *   ficar desatualizado.
 */

export const DEPRECIATION_EXPENSE_CODE = '3.3.2.15';
export const DEPRECIATION_COST_CODE = '3.2.1.04';
export const ACCUMULATED_DEPRECIATION_CODE = '1.2.3.07';
export const ACCUMULATED_AMORTIZATION_CODE = '1.2.4.03';
export const DISPOSAL_LOSS_CODE = '3.3.9.04';

const TANGIBLE_PREFIX = '1.2.3.';
const INTANGIBLE_PREFIX = '1.2.4.';
const CONTRA_CODES = new Set([ACCUMULATED_DEPRECIATION_CODE, ACCUMULATED_AMORTIZATION_CODE]);

/**
 * Taxas anuais sugeridas por conta do modelo de plano de contas, da IN RFB 1700/2017 (Anexo III),
 * que a NBC TG 1002 aceita e a NBC TG 1001 admite como expediente prático. Terrenos não se depreciam.
 */
export const SUGGESTED_RATES: Readonly<Record<string, number>> = {
  '1.2.3.01': 0,
  '1.2.3.02': 4,
  '1.2.3.03': 10,
  '1.2.3.04': 20,
  '1.2.3.05': 10,
  '1.2.3.06': 20,
  '1.2.4.01': 20,
};

export const USE_LABEL: Record<FixedAssetUse, string> = {
  COST: 'Atividade-fim (custo)',
  EXPENSE: 'Administrativo ou comercial (despesa)',
};

export const DISPOSAL_REASON_LABEL: Record<FixedAssetDisposalReason, string> = {
  SALE: 'venda',
  LOSS: 'perda ou sinistro',
  SCRAP: 'sucata ou desuso',
};

export const isIntangibleCode = (code: string): boolean => code.startsWith(INTANGIBLE_PREFIX);

/** Retificadora do bem: depreciação acumulada (imobilizado) ou amortização acumulada (intangível). */
export const contraCodeFor = (assetCode: string): string =>
  isIntangibleCode(assetCode) ? ACCUMULATED_AMORTIZATION_CODE : ACCUMULATED_DEPRECIATION_CODE;

const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code, undefined, { numeric: true });

/** Contas que recebem bens: analíticas do imobilizado e do intangível, sem as retificadoras. */
export function assetAccounts(accounts: readonly ChartAccount[]): ChartAccount[] {
  return accounts
    .filter(
      (a) =>
        a.nature === 'ANALYTIC' &&
        (a.code.startsWith(TANGIBLE_PREFIX) || a.code.startsWith(INTANGIBLE_PREFIX)) &&
        !a.isContra &&
        !CONTRA_CODES.has(a.code)
    )
    .sort(byCode);
}

/* =========================================================================
   Datas
   ========================================================================= */

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Último dia da competência (YYYY-MM-DD): data dos lançamentos de depreciação. */
export const lastDayOf = (month: string): string => `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;

export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** "março/2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1] ?? month}/${y}`;
}

/** "03/2026" */
const competence = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;

/* =========================================================================
   Valores do bem
   ========================================================================= */

/** Custo do bem em centavos: nota + gastos para pôr em uso + tributos não recuperáveis − descontos. */
export function assetCostCents(a: Pick<FixedAsset, 'invoiceValue' | 'additionalCosts' | 'nonRecoverableTaxes' | 'discounts'>): number {
  return toCents(a.invoiceValue || 0) + toCents(a.additionalCosts ?? 0) + toCents(a.nonRecoverableTaxes ?? 0) - toCents(a.discounts ?? 0);
}

export const assetCost = (a: Parameters<typeof assetCostCents>[0]): number => fromCents(assetCostCents(a));

/** Base depreciável (custo − valor residual), em centavos. */
const baseCents = (a: FixedAsset): number => Math.max(0, assetCostCents(a) - toCents(a.residualValue ?? 0));

/** Cota de um mês cheio, em centavos. */
export const monthlyQuotaCents = (a: FixedAsset): number => Math.round((baseCents(a) * (a.annualRate || 0)) / 1200);

/** Vida útil em meses pela taxa (20% ao ano → 60 meses), ou null sem depreciação. */
export const usefulLifeMonths = (annualRate: number): number | null => (annualRate > 0 ? Math.round(1200 / annualRate) : null);

/* =========================================================================
   Cotas
   ========================================================================= */

export interface QuotaRow {
  month: string;
  cents: number;
  /**
   * Lançada por esta rotina. As cotas anteriores à implantação estão nos saldos de abertura e as
   * informadas como já lançadas (`priorDepreciation`) foram contabilizadas à mão.
   */
  posted: boolean;
}

/** Teto de meses percorridos (taxa de 1% ao ano = 100 anos). */
const MAX_MONTHS = 1300;

/**
 * Cotas do bem, do mês de início de uso até esgotar a base ou até a baixa. Com
 * `priorDepreciation`, o valor informado vira uma única linha não lançada na competência dele, e
 * as cotas seguem a partir do mês seguinte.
 */
export function depreciationSchedule(asset: FixedAsset, implantationMonth: string | null): QuotaRow[] {
  const base = baseCents(asset);
  const monthly = monthlyQuotaCents(asset);
  if (base <= 0 || monthly <= 0 || !asset.inUseDate) return [];
  const startMonth = monthOf(asset.inUseDate);
  const endDate = asset.disposal?.date;
  const endMonth = endDate ? monthOf(endDate) : null;
  const rows: QuotaRow[] = [];
  let accumulated = 0;
  let month = startMonth;

  const prior = asset.priorDepreciation;
  if (prior && prior.through >= startMonth) {
    accumulated = Math.min(base, Math.max(0, toCents(prior.amount)));
    if (accumulated > 0) rows.push({ month: prior.through, cents: accumulated, posted: false });
    month = nextMonth(prior.through);
  }

  for (let i = 0; i < MAX_MONTHS && accumulated < base; i++) {
    if (endMonth && month > endMonth) break;
    const dim = daysInMonth(month);
    const first = month === startMonth ? Number(asset.inUseDate.slice(8, 10)) || 1 : 1;
    const last = endMonth === month && endDate ? Number(endDate.slice(8, 10)) || dim : dim;
    const days = last - first + 1;
    if (days > 0) {
      const quota = Math.min(days >= dim ? monthly : Math.round((monthly * days) / dim), base - accumulated);
      if (quota > 0) {
        rows.push({ month, cents: quota, posted: implantationMonth === null || month >= implantationMonth });
        accumulated += quota;
      }
    }
    month = nextMonth(month);
  }
  return rows;
}

/** Cota lançada por esta rotina no mês, em centavos (zero antes da implantação ou fora da vida útil). */
export function postedQuotaCents(asset: FixedAsset, month: string, implantationMonth: string | null): number {
  const row = depreciationSchedule(asset, implantationMonth).find((r) => r.month === month);
  return row?.posted ? row.cents : 0;
}

export interface AssetPosition {
  /** Custo no balanço (zero depois da baixa ou antes da aquisição), em centavos. */
  costCents: number;
  /** Depreciação acumulada no balanço, em centavos. */
  accumulatedCents: number;
  netCents: number;
}

/** Posição do bem no fim da competência `month`: o que o balanço mostra dele naquela data. */
export function assetPositionAt(asset: FixedAsset, month: string, implantationMonth: string | null): AssetPosition {
  const gone = asset.disposal && monthOf(asset.disposal.date) <= month;
  if (gone || !asset.acquisitionDate || monthOf(asset.acquisitionDate) > month) return { costCents: 0, accumulatedCents: 0, netCents: 0 };
  const costCents = assetCostCents(asset);
  const accumulatedCents = depreciationSchedule(asset, implantationMonth)
    .filter((r) => r.month <= month)
    .reduce((s, r) => s + r.cents, 0);
  return { costCents, accumulatedCents, netCents: costCents - accumulatedCents };
}

/** Acumulada até a data da baixa (inclui a cota proporcional do mês), em centavos. */
export function accumulatedAtDisposalCents(asset: FixedAsset, disposalDate: string, implantationMonth: string | null): number {
  const withDisposal: FixedAsset = { ...asset, disposal: { date: disposalDate, reason: 'SALE', journalEntryId: '' } };
  return depreciationSchedule(withDisposal, implantationMonth).reduce((s, r) => s + r.cents, 0);
}

/* =========================================================================
   Validação e trava por competência fechada
   ========================================================================= */

/** Primeiro problema que impede gravar o bem, ou null. */
export function assetProblem(asset: FixedAsset, accounts: readonly ChartAccount[]): string | null {
  if (!asset.description.trim()) return 'Informe a descrição do bem.';
  const account = accounts.find((a) => a.id === asset.accountId);
  if (!account || !assetAccounts(accounts).some((a) => a.id === account.id)) {
    return 'Escolha a conta do bem: uma conta analítica do Imobilizado (1.2.3) ou do Intangível (1.2.4).';
  }
  if (!asset.acquisitionDate) return 'Informe a data da aquisição (data da nota fiscal).';
  if (!asset.inUseDate) return 'Informe a data em que o bem ficou disponível para uso.';
  if (asset.inUseDate < asset.acquisitionDate) return 'O bem não pode entrar em uso antes da data da aquisição.';
  const cost = assetCostCents(asset);
  if (cost <= 0) return 'O custo do bem (nota + gastos − descontos) precisa ser maior que zero.';
  if (toCents(asset.residualValue ?? 0) < 0 || toCents(asset.residualValue ?? 0) >= cost) {
    return 'O valor residual precisa ser menor que o custo do bem.';
  }
  if (!Number.isFinite(asset.annualRate) || asset.annualRate < 0 || asset.annualRate > 100) {
    return 'A taxa anual de depreciação vai de 0% a 100%.';
  }
  if (account.code === '1.2.3.01' && asset.annualRate > 0) return 'Terrenos não se depreciam: use taxa 0%.';
  const prior = asset.priorDepreciation;
  if (prior) {
    if (!/^\d{4}-\d{2}$/.test(prior.through) || prior.through < monthOf(asset.inUseDate)) {
      return 'A depreciação já lançada precisa ir até uma competência a partir do início de uso.';
    }
    if (toCents(prior.amount) < 0 || toCents(prior.amount) > baseCents(asset)) {
      return 'A depreciação já lançada não pode passar da base depreciável (custo − residual).';
    }
  }
  if (asset.disposal && asset.disposal.date < asset.inUseDate) return 'A baixa não pode ser anterior ao início de uso.';
  return null;
}

/** Campos que mudam cotas já lançadas: travados quando alguma delas está em competência fechada. */
const FINANCIAL_FIELDS = [
  'accountId',
  'use',
  'acquisitionDate',
  'inUseDate',
  'invoiceValue',
  'additionalCosts',
  'nonRecoverableTaxes',
  'discounts',
  'residualValue',
  'annualRate',
  'priorDepreciation',
] as const satisfies readonly (keyof FixedAsset)[];

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Competências fechadas com cota deste bem lançada por esta rotina. */
export function lockedPostedMonths(asset: FixedAsset, lockedMonths: ReadonlySet<string>, implantationMonth: string | null): string[] {
  return depreciationSchedule(asset, implantationMonth)
    .filter((r) => r.posted && lockedMonths.has(r.month))
    .map((r) => r.month);
}

/** O bem tem cota lançada em competência fechada: custo, taxa, conta e datas não mudam mais. */
export const isAssetFrozen = (asset: FixedAsset, lockedMonths: ReadonlySet<string>, implantationMonth: string | null): boolean =>
  lockedPostedMonths(asset, lockedMonths, implantationMonth).length > 0;

const formatRange = (months: readonly string[]) =>
  months.length === 1 ? competence(months[0]) : `${competence(months[0])} a ${competence(months[months.length - 1])}`;

/**
 * Motivo de recusar a gravação por causa das competências fechadas, ou null:
 * - bem com cota já lançada em mês fechado não muda custo, taxa, conta, uso nem datas;
 * - bem novo (ou alterado) cujas cotas cairiam em meses fechados: ou reabre, ou informa a
 *   depreciação já lançada até o último deles.
 */
export function lockedChangeProblem(
  before: FixedAsset | null,
  after: FixedAsset,
  lockedMonths: ReadonlySet<string>,
  implantationMonth: string | null
): string | null {
  if (before && isAssetFrozen(before, lockedMonths, implantationMonth)) {
    const changed = FINANCIAL_FIELDS.some((f) => !sameValue(before[f], after[f]));
    if (changed) {
      const months = lockedPostedMonths(before, lockedMonths, implantationMonth);
      return `A depreciação deste bem já foi lançada em competência fechada (${formatRange(months)}): custo, taxa, conta, uso e datas não mudam mais. Para corrigir, reabra essas competências, ou dê baixa no bem e cadastre-o de novo.`;
    }
    return null;
  }
  const conflicts = lockedPostedMonths(after, lockedMonths, implantationMonth);
  if (conflicts.length) {
    return `As cotas de ${formatRange(conflicts)} cairiam em competência fechada. Reabra essas competências ou informe a depreciação já lançada até ${competence(conflicts[conflicts.length - 1])}.`;
  }
  return null;
}

/**
 * Sugestão de depreciação já lançada para um bem novo: a acumulada pelo cálculo até o último mês
 * que não será lançado por esta rotina (antes da implantação, ou fechado). Null quando nenhuma
 * cota fica fora.
 */
export function suggestPriorDepreciation(
  asset: FixedAsset,
  lockedMonths: ReadonlySet<string>,
  implantationMonth: string | null
): { through: string; amount: number } | null {
  const rows = depreciationSchedule({ ...asset, priorDepreciation: undefined }, implantationMonth);
  const outside = rows.filter((r) => !r.posted || lockedMonths.has(r.month));
  if (!outside.length) return null;
  const through = outside[outside.length - 1].month;
  const amount = rows.filter((r) => r.month <= through).reduce((s, r) => s + r.cents, 0);
  return { through, amount: fromCents(amount) };
}

/* =========================================================================
   Lançamento mensal
   ========================================================================= */

export type FixedAssetDraft = Pick<
  JournalEntry,
  'date' | 'memo' | 'category' | 'lines' | 'totalAmount' | 'documentRef' | 'depreciationMonth' | 'fixedAssetId'
>;

/** Cota de cada bem no mês (só os com cota lançada por esta rotina). */
export function monthQuotas(assets: readonly FixedAsset[], month: string, implantationMonth: string | null): { asset: FixedAsset; cents: number }[] {
  return assets
    .map((asset) => ({ asset, cents: postedQuotaCents(asset, month, implantationMonth) }))
    .filter((q) => q.cents > 0);
}

/** Contas do modelo que a rotina usa e faltam no plano (como analíticas). */
export function missingDepreciationCodes(assets: readonly FixedAsset[], month: string, implantationMonth: string | null, accounts: readonly ChartAccount[]): string[] {
  const analytic = new Set(accounts.filter((a) => a.nature === 'ANALYTIC').map((a) => a.code));
  const needed = new Set<string>();
  for (const { asset } of monthQuotas(assets, month, implantationMonth)) {
    needed.add(asset.use === 'COST' ? DEPRECIATION_COST_CODE : DEPRECIATION_EXPENSE_CODE);
    needed.add(contraCodeFor(asset.accountCode));
  }
  return [...needed].filter((c) => !analytic.has(c)).sort();
}

/**
 * Lançamento de depreciação e amortização da competência: um débito por destino (custo ou
 * despesa) e um crédito na retificadora por conta de bem, com o histórico da classe. Null sem
 * cota no mês.
 */
export function depreciationDraft(
  assets: readonly FixedAsset[],
  month: string,
  implantationMonth: string | null,
  accounts: readonly ChartAccount[]
): { draft: FixedAssetDraft | null; problem: string | null } {
  const quotas = monthQuotas(assets, month, implantationMonth);
  if (!quotas.length) return { draft: null, problem: null };
  const missing = missingDepreciationCodes(assets, month, implantationMonth, accounts);
  if (missing.length) {
    return { draft: null, problem: `Faltam no plano, como analíticas, as contas ${missing.join(', ')}. Complete o plano com o modelo em Plano de Contas.` };
  }
  const analytic = new Map(accounts.filter((a) => a.nature === 'ANALYTIC').map((a) => [a.code, a] as const));
  const label = monthLabel(month);

  const debits = new Map<FixedAssetUse, number>();
  const credits = new Map<string, number>(); // por conta do bem
  for (const { asset, cents } of quotas) {
    debits.set(asset.use, (debits.get(asset.use) ?? 0) + cents);
    credits.set(asset.accountCode, (credits.get(asset.accountCode) ?? 0) + cents);
  }

  const line = (code: string, type: 'DEBIT' | 'CREDIT', cents: number, memo: string, i: number): JournalEntryLine => {
    const acc = analytic.get(code)!;
    return { id: `d${i}`, accountId: acc.id, accountCode: acc.code, accountName: acc.name, type, amount: fromCents(cents), memo };
  };

  const lines: JournalEntryLine[] = [];
  const useOrder: FixedAssetUse[] = ['COST', 'EXPENSE'];
  for (const use of useOrder) {
    const cents = debits.get(use);
    if (!cents) continue;
    const code = use === 'COST' ? DEPRECIATION_COST_CODE : DEPRECIATION_EXPENSE_CODE;
    const memo = use === 'COST' ? `Depreciação e amortização aplicadas aos custos - ${label}` : `Depreciação e amortização do mês - ${label}`;
    lines.push(line(code, 'DEBIT', cents, memo, lines.length + 1));
  }

  const assetName = (code: string) => accounts.find((a) => a.code === code)?.name ?? quotas.find((q) => q.asset.accountCode === code)?.asset.accountName ?? code;
  const creditCodes = [...credits.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (lines.length + creditCodes.length <= MAX_JOURNAL_LINES) {
    for (const code of creditCodes) {
      const kind = isIntangibleCode(code) ? 'amortização' : 'depreciação';
      lines.push(line(contraCodeFor(code), 'CREDIT', credits.get(code)!, `Vlr. ref. cota de ${kind} de ${assetName(code).toLowerCase()} referente ao mês de ${label}`, lines.length + 1));
    }
  } else {
    // Muitas contas de bem: um crédito por retificadora.
    const byContra = new Map<string, number>();
    for (const code of creditCodes) byContra.set(contraCodeFor(code), (byContra.get(contraCodeFor(code)) ?? 0) + credits.get(code)!);
    for (const [code, cents] of byContra) lines.push(line(code, 'CREDIT', cents, `Cotas do mês de ${label}`, lines.length + 1));
  }

  const draft: FixedAssetDraft = {
    date: lastDayOf(month),
    memo: `Depreciação e amortização do imobilizado - competência ${competence(month)}`,
    category: 'DEPRECIATION',
    lines,
    totalAmount: journalTotals(lines).debit,
    documentRef: `DEPREC-${month}`,
    depreciationMonth: month,
  };
  const problem = journalEntryProblem(draft);
  return problem ? { draft: null, problem } : { draft, problem: null };
}

const lineKey = (l: Pick<JournalEntryLine, 'accountId' | 'type' | 'amount' | 'memo'>) => `${l.accountId}|${l.type}|${toCents(l.amount)}|${l.memo ?? ''}`;

/** O lançamento gravado tem a mesma data, histórico e partidas do calculado? */
export function sameDepreciation(entry: Pick<JournalEntry, 'date' | 'memo' | 'lines'>, draft: Pick<JournalEntry, 'date' | 'memo' | 'lines'>): boolean {
  if (entry.date !== draft.date || entry.memo !== draft.memo || entry.lines.length !== draft.lines.length) return false;
  const a = entry.lines.map(lineKey).sort();
  const b = draft.lines.map(lineKey).sort();
  return a.every((k, i) => k === b[i]);
}

/**
 * Situação da depreciação da competência:
 * - NONE: nada a lançar e nada lançado;
 * - POSTED: lançada e conferida com o cadastro;
 * - PENDING: falta lançar (`existing` ausente) ou o cadastro mudou (`existing` a atualizar);
 * - REMOVE: há lançamento gerado, mas o cadastro não tem mais cota no mês;
 * - BLOCKED: há cota, mas falta conta no plano (`problem`).
 * `manual` lista lançamentos de depreciação feitos à mão no mês: possível duplicidade.
 */
export type DepreciationStatus =
  | { kind: 'NONE'; manual: JournalEntry[] }
  | { kind: 'POSTED'; entry: JournalEntry; manual: JournalEntry[] }
  | { kind: 'PENDING'; draft: FixedAssetDraft; existing: JournalEntry | null; manual: JournalEntry[] }
  | { kind: 'REMOVE'; existing: JournalEntry; manual: JournalEntry[] }
  | { kind: 'BLOCKED'; problem: string; totalCents: number; manual: JournalEntry[] };

export function depreciationStatus(args: {
  assets: readonly FixedAsset[];
  month: string;
  implantationMonth: string | null;
  accounts: readonly ChartAccount[];
  /** Lançamentos manuais da competência. */
  entries: readonly JournalEntry[];
}): DepreciationStatus {
  const { assets, month, implantationMonth, accounts, entries } = args;
  const inMonth = entries.filter((e) => monthOf(e.date) === month);
  const existing = inMonth.find((e) => e.depreciationMonth === month) ?? null;
  const manual = inMonth.filter((e) => e.category === 'DEPRECIATION' && !e.depreciationMonth);
  const { draft, problem } = depreciationDraft(assets, month, implantationMonth, accounts);
  if (problem) {
    const totalCents = monthQuotas(assets, month, implantationMonth).reduce((s, q) => s + q.cents, 0);
    return { kind: 'BLOCKED', problem, totalCents, manual };
  }
  if (!draft) return existing ? { kind: 'REMOVE', existing, manual } : { kind: 'NONE', manual };
  if (existing && sameDepreciation(existing, draft)) return { kind: 'POSTED', entry: existing, manual };
  return { kind: 'PENDING', draft, existing, manual };
}

/** O mês pode ser fechado quanto à depreciação? Mensagem do que falta, ou null. */
export function depreciationCloseProblem(status: DepreciationStatus, month: string): string | null {
  switch (status.kind) {
    case 'PENDING':
      return status.existing
        ? `O cadastro do imobilizado mudou depois da depreciação de ${competence(month)}: atualize o lançamento antes de fechar.`
        : `Lance a depreciação de ${competence(month)} (${formatMoney(status.draft.totalAmount)}) antes de fechar a competência.`;
    case 'REMOVE':
      return `A depreciação de ${competence(month)} não tem mais cota no cadastro do imobilizado: atualize o lançamento antes de fechar.`;
    case 'BLOCKED':
      // Faltam contas do modelo no plano: o lançamento as cria (ver postMonthDepreciation).
      return `Lance a depreciação de ${competence(month)} (${formatMoney(fromCents(status.totalCents))}) antes de fechar a competência.`;
    default:
      return null;
  }
}

/** Aviso de possível duplicidade: depreciação lançada à mão no mês de uma empresa com cadastro de bens. */
export function manualDepreciationWarning(status: DepreciationStatus, month: string): string | null {
  const n = status.manual.length;
  if (!n) return null;
  return `${n} lançamento(s) manual(is) de depreciação em ${competence(month)}, além do gerado pelo cadastro do imobilizado: confira se não há duplicidade.`;
}

const formatMoney = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Competências abertas com depreciação a lançar ou atualizar, do início de uso do bem mais antigo
 * até `untilMonth` (inclusive), a partir da implantação. Para recuperar meses que ficaram para trás.
 */
export function pendingDepreciationMonths(args: {
  assets: readonly FixedAsset[];
  untilMonth: string;
  implantationMonth: string | null;
  lockedMonths: ReadonlySet<string>;
  accounts: readonly ChartAccount[];
  entries: readonly JournalEntry[];
}): string[] {
  const { assets, untilMonth, implantationMonth, lockedMonths, accounts, entries } = args;
  const starts = assets.map((a) => a.inUseDate && monthOf(a.inUseDate)).filter(Boolean) as string[];
  if (!starts.length) return [];
  let month = starts.sort()[0];
  if (implantationMonth && month < implantationMonth) month = implantationMonth;
  const out: string[] = [];
  for (let i = 0; i < MAX_MONTHS && month <= untilMonth; i++, month = nextMonth(month)) {
    if (lockedMonths.has(month)) continue;
    const status = depreciationStatus({ assets, month, implantationMonth, accounts, entries });
    if (status.kind === 'PENDING' || status.kind === 'REMOVE' || status.kind === 'BLOCKED') out.push(month);
  }
  return out;
}

/* =========================================================================
   Baixa
   ========================================================================= */

/**
 * Lançamento da baixa na data: tira o custo (crédito na conta do bem) e a acumulada até a data
 * (débito na retificadora); o valor contábil que sobra vai para 3.3.9.04 Perda na Baixa de
 * Imobilizado. O valor recebido numa venda entra pelo extrato, em 3.3.9.02.
 */
export function disposalDraft(
  asset: FixedAsset,
  date: string,
  reason: FixedAssetDisposalReason,
  implantationMonth: string | null,
  accounts: readonly ChartAccount[]
): { draft: FixedAssetDraft | null; problem: string | null } {
  if (date < asset.inUseDate) return { draft: null, problem: 'A baixa não pode ser anterior ao início de uso.' };
  const analytic = new Map(accounts.filter((a) => a.nature === 'ANALYTIC').map((a) => [a.code, a] as const));
  const costCents = assetCostCents(asset);
  const accumulated = accumulatedAtDisposalCents(asset, date, implantationMonth);
  const net = costCents - accumulated;
  const contraCode = contraCodeFor(asset.accountCode);
  const needed = [...(accumulated > 0 ? [contraCode] : []), ...(net > 0 ? [DISPOSAL_LOSS_CODE] : [])];
  const missing = needed.filter((c) => !analytic.has(c));
  if (missing.length) return { draft: null, problem: `Faltam no plano, como analíticas, as contas ${missing.join(', ')}. Complete o plano com o modelo em Plano de Contas.` };
  const assetAccount = accounts.find((a) => a.id === asset.accountId);
  if (!assetAccount) return { draft: null, problem: 'A conta do bem não está mais no plano.' };

  const lines: JournalEntryLine[] = [];
  const push = (acc: ChartAccount, type: 'DEBIT' | 'CREDIT', cents: number, memo: string) =>
    lines.push({ id: `b${lines.length + 1}`, accountId: acc.id, accountCode: acc.code, accountName: acc.name, type, amount: fromCents(cents), memo });
  if (accumulated > 0) push(analytic.get(contraCode)!, 'DEBIT', accumulated, `Baixa da ${isIntangibleCode(asset.accountCode) ? 'amortização' : 'depreciação'} acumulada - ${asset.description}`);
  if (net > 0) push(analytic.get(DISPOSAL_LOSS_CODE)!, 'DEBIT', net, `Valor contábil baixado - ${asset.description}`);
  push(assetAccount, 'CREDIT', costCents, `Baixa do custo - ${asset.description}`);

  const draft: FixedAssetDraft = {
    date,
    memo: `Baixa do bem ${asset.description} por ${DISPOSAL_REASON_LABEL[reason]}`,
    category: 'ADJUSTMENT',
    lines,
    totalAmount: journalTotals(lines).debit,
    documentRef: `BAIXA-${asset.documentRef?.trim() || asset.id.slice(-6)}`,
    fixedAssetId: asset.id,
  };
  const problem = journalEntryProblem(draft);
  return problem ? { draft: null, problem } : { draft, problem: null };
}

/**
 * Motivo de recusar a baixa na data, ou null: o mês da baixa precisa estar aberto, e nenhuma
 * competência fechada depois dela pode ter cota lançada (ela deixaria de existir).
 */
export function disposalLockProblem(asset: FixedAsset, date: string, lockedMonths: ReadonlySet<string>, implantationMonth: string | null): string | null {
  const month = monthOf(date);
  if (lockedMonths.has(month)) return `A competência ${competence(month)} está fechada: reabra-a para dar baixa nessa data.`;
  const after = lockedPostedMonths(asset, lockedMonths, implantationMonth).filter((m) => m > month);
  if (after.length) return `Há depreciação deste bem lançada em competência fechada depois da baixa (${formatRange(after)}): reabra essas competências ou use uma data posterior.`;
  return null;
}

/* =========================================================================
   Conciliação com o balancete
   ========================================================================= */

export interface ReconciliationRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  /** Pelo cadastro, em reais. */
  register: number;
  /** Saldo contábil, em reais (no lado natural: retificadoras positivas). */
  ledger: number;
  difference: number;
}

/**
 * Cadastro × balancete no fim da competência: custo por conta de bem e acumulada por
 * retificadora. `ledgerBalance` devolve o saldo da conta no lado natural dela (o da retificadora
 * em valor positivo).
 */
export function reconcileWithLedger(args: {
  assets: readonly FixedAsset[];
  month: string;
  implantationMonth: string | null;
  accounts: readonly ChartAccount[];
  ledgerBalance: (accountId: string) => number;
}): ReconciliationRow[] {
  const { assets, month, implantationMonth, accounts, ledgerBalance } = args;
  const register = new Map<string, number>();
  for (const asset of assets) {
    const pos = assetPositionAt(asset, month, implantationMonth);
    register.set(asset.accountId, (register.get(asset.accountId) ?? 0) + pos.costCents);
    const contra = accounts.find((a) => a.code === contraCodeFor(asset.accountCode) && a.nature === 'ANALYTIC');
    if (contra) register.set(contra.id, (register.get(contra.id) ?? 0) + pos.accumulatedCents);
  }
  // Também as contas de bem com saldo no balancete e nada no cadastro (bem comprado e não cadastrado).
  const relevant = accounts.filter(
    (a) => a.nature === 'ANALYTIC' && (assetAccounts(accounts).some((x) => x.id === a.id) || CONTRA_CODES.has(a.code))
  );
  return relevant
    .map((a) => {
      const reg = register.get(a.id) ?? 0;
      const led = toCents(ledgerBalance(a.id));
      return { accountId: a.id, accountCode: a.code, accountName: a.name, register: fromCents(reg), ledger: fromCents(led), difference: fromCents(led - reg) };
    })
    .filter((r) => r.register !== 0 || r.ledger !== 0)
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode, undefined, { numeric: true }));
}

/**
 * Saldo de cada conta analítica do ativo no balanço, no lado natural dela: as retificadoras
 * (que o balanço traz negativas) voltam positivas, como a acumulada do cadastro.
 */
export function naturalAssetBalances(
  lines: readonly { accountId: string; synthetic: boolean; value: number }[],
  accounts: readonly ChartAccount[]
): Map<string, number> {
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const out = new Map<string, number>();
  for (const l of lines) {
    if (l.synthetic) continue;
    const acc = byId.get(l.accountId);
    out.set(l.accountId, acc && (acc.isContra || CONTRA_CODES.has(acc.code)) ? -l.value : l.value);
  }
  return out;
}

/* =========================================================================
   Quadro por classe (notas explicativas e relatório)
   ========================================================================= */

export interface ClassSummary {
  accountCode: string;
  accountName: string;
  /** Taxas anuais usadas na classe (ordenadas, sem repetição). */
  rates: number[];
  cost: number;
  accumulated: number;
  net: number;
}

/** Custo, acumulada e líquido por conta de bem no fim da competência (bens ainda no balanço). */
export function classSummary(assets: readonly FixedAsset[], month: string, implantationMonth: string | null, accounts: readonly ChartAccount[]): ClassSummary[] {
  const map = new Map<string, { cost: number; acc: number; rates: Set<number>; name: string }>();
  for (const asset of assets) {
    const pos = assetPositionAt(asset, month, implantationMonth);
    if (pos.costCents === 0) continue;
    const cur = map.get(asset.accountCode) ?? {
      cost: 0,
      acc: 0,
      rates: new Set<number>(),
      name: accounts.find((a) => a.id === asset.accountId)?.name ?? asset.accountName ?? asset.accountCode,
    };
    cur.cost += pos.costCents;
    cur.acc += pos.accumulatedCents;
    cur.rates.add(asset.annualRate);
    map.set(asset.accountCode, cur);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([code, v]) => ({
      accountCode: code,
      accountName: v.name,
      rates: [...v.rates].sort((a, b) => a - b),
      cost: fromCents(v.cost),
      accumulated: fromCents(v.acc),
      net: fromCents(v.cost - v.acc),
    }));
}
