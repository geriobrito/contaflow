import type { BankAccount, ChartAccount, OpeningEntry } from '@/types/firestore';
import { accountKind, openingSign } from '@/lib/ledger';

/**
 * Saldos de abertura: quais contas aceitam saldo e se a abertura fecha
 * (ativo = passivo + patrimônio líquido).
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

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
