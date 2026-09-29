import type { BankAccount, BankTransaction, ChartAccount, ImportBatch } from '@/types/firestore';
import { addDays } from '@/lib/statement';

/**
 * Contas bancárias do cliente: vínculo com o plano de contas, saldo inicial e saldo
 * contábil por conta. Funções puras (sem acesso a banco de dados).
 */

/** ID do documento: `${clientId}_${accountKey}` só com caracteres seguros para IDs do Firestore. */
export const bankAccountId = (clientId: string, accountKey: string): string =>
  `${clientId}_${accountKey.replace(/[^A-Za-z0-9-]/g, '-')}`;

/** Nome sugerido a partir do extrato: "Banco 0341 · ag 1234 · cc 55555-5". */
export function defaultNickname(meta: Pick<BankAccount, 'bankName' | 'bankId' | 'branchId' | 'accountNumber'>): string {
  const bank = meta.bankName || (meta.bankId ? `Banco ${meta.bankId}` : 'Conta bancária');
  return [bank, meta.branchId && `ag ${meta.branchId}`, meta.accountNumber && `cc ${meta.accountNumber}`].filter(Boolean).join(' · ');
}

/**
 * Saldo inicial sugerido pelo extrato mais antigo com saldo informado: saldo final do
 * banco menos a movimentação do arquivo, no dia anterior ao início do extrato.
 */
export function suggestOpening(
  batches: readonly Pick<ImportBatch, 'accountKey' | 'startDate' | 'ledgerBalance' | 'fileNet'>[],
  accountKey: string
): { openingBalance: number; openingDate: string } | null {
  const first = batches
    .filter((b) => b.accountKey === accountKey && b.startDate && b.ledgerBalance !== undefined && b.fileNet !== undefined)
    .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''))[0];
  if (!first?.startDate || first.ledgerBalance === undefined || first.fileNet === undefined) return null;
  return { openingBalance: round2(first.ledgerBalance - first.fileNet), openingDate: addDays(first.startDate, -1) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Saldo da conta ao fim do dia `date`: saldo inicial + movimentação posterior à data do
 * saldo inicial. Sem saldo inicial, considera toda a movimentação importada.
 */
export function bankBalanceAt(account: Pick<BankAccount, 'accountKey' | 'openingBalance' | 'openingDate'>, transactions: readonly BankTransaction[], date: string): number {
  const from = account.openingDate ?? '';
  const movement = transactions
    .filter((t) => t.accountKey === account.accountKey && t.date > from && t.date <= date)
    .reduce((s, t) => s + t.amount, 0);
  return round2((account.openingBalance ?? 0) + movement);
}

const ASSET_TYPES = new Set(['ASSET', 'ATIVO']);

/** Contas do plano que podem representar um banco: analíticas do ativo. */
export const bankLedgerCandidates = (accounts: readonly ChartAccount[]): ChartAccount[] =>
  accounts.filter((a) => a.nature === 'ANALYTIC' && ASSET_TYPES.has(a.type));

/** Próximo código livre abaixo de `parentCode` com `digits` dígitos (ex.: 1.1.1.02 → 1.1.1.02.001). */
export function nextChildCode(parentCode: string, accounts: readonly Pick<ChartAccount, 'code'>[], digits = 3): string {
  const prefix = `${parentCode}.`;
  const used = new Set(
    accounts
      .map((a) => a.code)
      .filter((c) => c.startsWith(prefix) && !c.slice(prefix.length).includes('.'))
      .map((c) => Number.parseInt(c.slice(prefix.length), 10))
      .filter(Number.isFinite)
  );
  let n = 1;
  while (used.has(n)) n++;
  return `${prefix}${String(n).padStart(digits, '0')}`;
}
