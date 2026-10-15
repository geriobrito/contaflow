import type { BankAccount, ChartAccount, OpeningBalances, OpeningEntry, OpeningMode } from '@/types/firestore';
import { OPENING_ACCOUNT_CODE, VIRTUAL, accountKind, isContraAccount, openingContraId, openingSign } from '@/lib/ledger';
import { missingTemplateAccounts, withMissingParents } from '@/lib/chart/itg1000';
import { round2 } from '@/lib/money';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

/**
 * Balanço de abertura e implantação de saldos: quais contas aceitam saldo, se a abertura fecha
 * (ativo = passivo + patrimônio líquido) e, no balanço de abertura sem contabilidade anterior,
 * a contrapartida automática na conta 2.3.3.04.
 */

/** Tipo de implantação de um documento salvo (sem o campo: implantação com balanço anterior). */
export const openingModeOf = (openings: Pick<OpeningBalances, 'mode'> | null | undefined): OpeningMode => openings?.mode ?? 'CONTINUITY';

export const OPENING_MODE_LABEL: Record<OpeningMode, string> = {
  OPENING_BALANCE: 'Balanço de abertura (sem contabilidade anterior — MEI / Simples)',
  CONTINUITY: 'Implantação de saldos (transferência com balanço anterior)',
};


/**
 * Contas que recebem saldo de abertura: analíticas e patrimoniais, retificadoras inclusive
 * ((-) Depreciação Acumulada a crédito, (-) Capital a Integralizar a débito). As de resultado
 * não têm saldo na abertura; as que representam um banco têm o saldo inicial do banco; e a
 * 2.3.3.04 Balanço de Abertura recebe só a contrapartida automática.
 */
export function openingAccounts(accounts: readonly ChartAccount[], banks: readonly BankAccount[]): ChartAccount[] {
  const bankLedger = new Set(banks.map((b) => b.ledgerAccountId).filter(Boolean));
  return accounts.filter((a) => a.nature === 'ANALYTIC' && accountKind(a) !== 'RESULT' && !bankLedger.has(a.id) && a.code !== OPENING_ACCOUNT_CODE);
}

/**
 * Contas do modelo que o balanço de abertura precisa e faltam no plano: a 2.3.3.04 e os grupos
 * dela. Criadas junto com a gravação da abertura, como a ARE no encerramento.
 */
export function missingOpeningAccounts(clientId: string, accounts: readonly ChartAccount[], now?: string): ChartAccount[] {
  const missing = missingTemplateAccounts(clientId, accounts, now);
  const codes = withMissingParents([OPENING_ACCOUNT_CODE], missing);
  return missing.filter((a) => codes.has(a.code));
}

export interface OpeningSummary {
  /** Ativo informado nas contas (sem bancos). */
  assets: number;
  /** Saldos iniciais dos bancos (Contas e Extratos). */
  banks: number;
  liabilities: number;
  equity: number;
  /** Ativo total − (passivo + PL): o que falta detalhar. Zero quando a abertura fecha. */
  difference: number;
  balanced: boolean;
}

/** Totais por lado, com retificadoras reduzindo o grupo, e a diferença a detalhar. */
export function summarizeOpening(entries: readonly Pick<OpeningEntry, 'accountId' | 'amount'>[], accounts: readonly ChartAccount[], banks: readonly BankAccount[]): OpeningSummary {
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  let assets = 0;
  let liabilities = 0;
  let equity = 0;
  for (const e of entries) {
    const acc = byId.get(e.accountId);
    if (!acc || !e.amount) continue;
    const kind = accountKind(acc);
    // Valor no lado natural do grupo: retificadora subtrai.
    const signed = (isContraAccount(acc) ? -1 : 1) * e.amount;
    if (kind === 'ASSET') assets += signed;
    else if (kind === 'LIABILITY') liabilities += signed;
    else if (kind === 'EQUITY') equity += signed;
  }
  const bankTotal = banks.reduce((s, b) => s + (b.openingBalance ?? 0), 0);
  const difference = round2(assets + bankTotal - liabilities - equity);
  return {
    assets: round2(assets),
    banks: round2(bankTotal),
    liabilities: round2(liabilities),
    equity: round2(equity),
    difference,
    balanced: Math.abs(difference) < 0.005,
  };
}

/** Sinal de uma entrada (para testes e telas): +1 débito, -1 crédito. */
export { openingSign };

/* =========================================================================
   Data de implantação e conferência da abertura
   ========================================================================= */

/**
 * Data de implantação (início do dia): o marco zero da contabilidade no sistema. É a data dos
 * saldos de abertura ou, sem eles, a do saldo inicial bancário mais antigo. Tudo antes dela está
 * contido nos saldos de abertura; os lançamentos começam nela.
 */
export function implantationDate(openings: Pick<OpeningBalances, 'date'> | null | undefined, banks: readonly BankAccount[]): string | null {
  if (openings?.date) return openings.date;
  return (
    banks
      .map((b) => b.openingDate)
      .filter((d): d is string => Boolean(d))
      .sort()[0] ?? null
  );
}

/**
 * Banco cujo saldo inicial não está na data de implantação: a abertura deixa de ser uma posição
 * única (a contrapartida do banco cai em outra data). Um banco aberto depois, com saldo inicial
 * zero, não é divergência.
 */
function bankOutOfDate(b: BankAccount, date: string): boolean {
  if (!b.openingDate || b.openingDate === date) return false;
  return Boolean(b.openingBalance) || b.openingDate < date;
}

/** Contrapartida automática do balanço de abertura na 2.3.3.04: credora quando o ativo supera passivo + PL. */
export interface OpeningPlug {
  amount: number;
  nature: 'C' | 'D';
}

export function openingPlug(summary: Pick<OpeningSummary, 'difference'>): OpeningPlug | null {
  if (Math.abs(summary.difference) < 0.005) return null;
  return { amount: Math.abs(summary.difference), nature: summary.difference > 0 ? 'C' : 'D' };
}

export const describePlug = (plug: OpeningPlug): string =>
  `Contrapartida automática na conta ${OPENING_ACCOUNT_CODE} Balanço de Abertura: ${formatCurrency(plug.amount)} (${plug.nature === 'C' ? 'Credor' : 'Devedor'})`;

export interface OpeningStatus {
  /** Data de implantação, ou null se nada foi informado. */
  date: string | null;
  mode: OpeningMode;
  summary: OpeningSummary;
  /** Balanço de abertura com a 2.3.3.04 no plano: a diferença vai para ela. */
  plug: OpeningPlug | null;
  /** O que ficou em "Saldos de abertura (a detalhar)": zero quando a abertura fecha ou a 2.3.3.04 absorve. */
  pending: number;
  /** Bancos com saldo inicial em data diferente da implantação. */
  mismatchedBanks: BankAccount[];
  /** Saldos de abertura informados, os bancos na mesma data e débitos = créditos. */
  verified: boolean;
  /** Motivos de a abertura não estar conferida, prontos para exibir. */
  problems: string[];
}

/**
 * Conferência da abertura: data única e débitos = créditos. No balanço de abertura (sem
 * contabilidade anterior), a 2.3.3.04 fecha o lançamento e a diferença não é problema; na
 * implantação com balanço anterior, ativo = passivo + PL precisa fechar pelos saldos informados.
 */
export function openingStatus(
  openings: OpeningBalances | null | undefined,
  accounts: readonly ChartAccount[],
  banks: readonly BankAccount[]
): OpeningStatus {
  const date = implantationDate(openings, banks);
  const mode = openingModeOf(openings);
  const summary = summarizeOpening(openings?.entries ?? [], accounts, banks);
  const absorbed = Boolean(openings) && openingContraId(openings, accounts) !== VIRTUAL.OPENING;
  const plug = absorbed ? openingPlug(summary) : null;
  const pending = absorbed ? 0 : summary.difference;
  const mismatchedBanks = date ? banks.filter((b) => bankOutOfDate(b, date)) : [];
  const problems: string[] = [];
  if (!openings) problems.push('Saldos de abertura não informados: o balanço só tem os bancos.');
  else if (Math.abs(pending) >= 0.005) {
    problems.push(
      mode === 'OPENING_BALANCE'
        ? `A conta ${OPENING_ACCOUNT_CODE} Balanço de Abertura não está no plano: salve a abertura de novo para criá-la e lançar nela os ${formatCurrency(Math.abs(pending))} de diferença.`
        : `Faltam ${formatCurrency(Math.abs(pending))} para ativo = passivo + patrimônio líquido na abertura.`
    );
  }
  for (const b of mismatchedBanks) {
    problems.push(`Saldo inicial de ${b.nickname} em ${formatDateBR(b.openingDate)}, e a implantação é em ${formatDateBR(date ?? '')}.`);
  }
  return { date, mode, summary, plug, pending, mismatchedBanks, verified: problems.length === 0, problems };
}

/**
 * Motivo de recusar um lançamento manual na data `date`, ou null. Antes da data de implantação,
 * o movimento já está nos saldos de abertura; no próprio dia, já pode ser lançado.
 */
export function implantationProblem(date: string, implantation: string | null): string | null {
  if (!implantation || date >= implantation) return null;
  return `A contabilidade começa em ${formatDateBR(implantation)} (data de implantação, em Saldos de abertura): o que aconteceu antes desse dia já está nos saldos de abertura. Use essa data ou uma posterior.`;
}

/**
 * Data sugerida para um balanço de abertura ainda não salvo: a do saldo inicial bancário mais
 * antigo ou, sem ele, 1º de janeiro do ano do primeiro extrato importado. Nunca parte do ano
 * corrente quando há movimento anterior.
 */
export function defaultOpeningDate(banks: readonly Pick<BankAccount, 'openingDate'>[], firstStatementDate: string | null | undefined, today = new Date()): string {
  const bankDate = banks
    .map((b) => b.openingDate)
    .filter((d): d is string => Boolean(d))
    .sort()[0];
  const fromStatements = firstStatementDate ? `${firstStatementDate.slice(0, 4)}-01-01` : null;
  if (bankDate && (!fromStatements || bankDate <= firstStatementDate!)) return bankDate;
  return fromStatements ?? `${today.getFullYear()}-01-01`;
}

const MONEY_TEXT = /^-?[\d.,\s]+$/;

function parseMoney(text: string, allowNegative: boolean): number | null {
  const t = text.trim();
  if (!t) return 0;
  if (!MONEY_TEXT.test(t) || (!allowNegative && t.startsWith('-'))) return null;
  const negative = t.startsWith('-');
  let s = t.replace(/^-/, '').replace(/\s/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) ?? []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? round2(negative ? -n : n) : null;
}

/** Lê um valor digitado ("1.234,56", "1234.5"); null se inválido; vazio = 0. */
export const parseMoneyInput = (text: string): number | null => parseMoney(text, false);

/** Como `parseMoneyInput`, aceitando negativo ("-1.234,56"): saldo bancário devedor (cheque especial). */
export const parseSignedMoneyInput = (text: string): number | null => parseMoney(text, true);
