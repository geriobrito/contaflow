import type { BankAccount, ChartAccount, OpeningBalances, OpeningEntry } from '@/types/firestore';
import { accountKind, openingSign } from '@/lib/ledger';
import { round2 } from '@/lib/money';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

/**
 * Saldos de abertura: quais contas aceitam saldo e se a abertura fecha
 * (ativo = passivo + patrimônio líquido).
 */


/**
 * Contas que recebem saldo de abertura: analíticas e patrimoniais. As de resultado não têm
 * saldo na abertura, e as contas que representam um banco (vinculadas em Contas e Extratos)
 * já têm saldo inicial próprio.
 */
export function openingAccounts(accounts: readonly ChartAccount[], banks: readonly BankAccount[]): ChartAccount[] {
  const bankLedger = new Set(banks.map((b) => b.ledgerAccountId).filter(Boolean));
  return accounts.filter((a) => a.nature === 'ANALYTIC' && accountKind(a) !== 'RESULT' && !bankLedger.has(a.id));
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
    const signed = (acc.isContra ? -1 : 1) * e.amount;
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
 * Data de implantação (fim do dia): o marco zero da contabilidade no sistema. É a data dos
 * saldos de abertura ou, sem eles, a do saldo inicial bancário mais antigo. Tudo até ela está
 * contido nos saldos de abertura; os lançamentos começam no dia seguinte.
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

export interface OpeningStatus {
  /** Data de implantação, ou null se nada foi informado. */
  date: string | null;
  summary: OpeningSummary;
  /** Bancos com saldo inicial em data diferente da implantação. */
  mismatchedBanks: BankAccount[];
  /** Saldos de abertura informados, os bancos na mesma data e ativo = passivo + PL. */
  verified: boolean;
  /** Motivos de a abertura não estar conferida, prontos para exibir. */
  problems: string[];
}

/** Conferência da abertura: data única, equação patrimonial e bancos alinhados. */
export function openingStatus(
  openings: OpeningBalances | null | undefined,
  accounts: readonly ChartAccount[],
  banks: readonly BankAccount[]
): OpeningStatus {
  const date = implantationDate(openings, banks);
  const summary = summarizeOpening(openings?.entries ?? [], accounts, banks);
  const mismatchedBanks = date ? banks.filter((b) => bankOutOfDate(b, date)) : [];
  const problems: string[] = [];
  if (!openings) problems.push('Saldos de abertura não informados: o balanço só tem os bancos.');
  if (!summary.balanced) {
    problems.push(`Faltam ${formatCurrency(Math.abs(summary.difference))} para ativo = passivo + patrimônio líquido na abertura.`);
  }
  for (const b of mismatchedBanks) {
    problems.push(`Saldo inicial de ${b.nickname} em ${formatDateBR(b.openingDate)}, e a implantação é em ${formatDateBR(date ?? '')}.`);
  }
  return { date, summary, mismatchedBanks, verified: problems.length === 0, problems };
}

/**
 * Motivo de recusar um lançamento manual na data `date`, ou null. Até a data de implantação,
 * o movimento já está nos saldos de abertura.
 */
export function implantationProblem(date: string, implantation: string | null): string | null {
  if (!implantation || date > implantation) return null;
  return `A contabilidade começa depois de ${formatDateBR(implantation)} (data de implantação, em Saldos de abertura): o que aconteceu até esse dia já está nos saldos de abertura. Use uma data posterior.`;
}

/** Lê um valor digitado ("1.234,56", "1234.5"); null se inválido; vazio = 0. */
export function parseMoneyInput(text: string): number | null {
  const t = text.trim();
  if (!t) return 0;
  if (!/^[\d.,\s]+$/.test(t)) return null;
  let s = t.replace(/\s/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) ?? []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? round2(n) : null;
}
