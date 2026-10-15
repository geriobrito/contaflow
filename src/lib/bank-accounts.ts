import type { BankAccount, BankTransaction, ChartAccount, ImportBatch } from '@/types/firestore';
import { countsAfterOpening } from '@/lib/ledger';
import { round2 } from '@/lib/money';

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
 * banco menos a movimentação do arquivo, no início do primeiro dia do extrato.
 */
export function suggestOpening(
  batches: readonly (Pick<ImportBatch, 'accountKey' | 'startDate' | 'endDate' | 'ledgerDate' | 'ledgerBalance' | 'fileNet'> & { status?: string })[],
  accountKey: string
): { openingBalance: number; openingDate: string } | null {
  const first = batches
    .filter(
      (b) =>
        (!b.status || b.status === 'COMPLETED') &&
        b.accountKey === accountKey &&
        b.startDate &&
        b.ledgerBalance !== undefined &&
        b.fileNet !== undefined &&
        // Saldo de data posterior ao fim do extrato inclui lançamentos que não estão no arquivo.
        !(b.endDate && b.ledgerDate && b.ledgerDate > b.endDate)
    )
    .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''))[0];
  if (!first?.startDate || first.ledgerBalance === undefined || first.fileNet === undefined) return null;
  return { openingBalance: round2(first.ledgerBalance - first.fileNet), openingDate: first.startDate };
}


/**
 * Saldo da conta ao fim do dia `date`: saldo inicial (início do dia `openingDate`) + movimentação
 * desse dia em diante. Sem saldo inicial, considera toda a movimentação importada.
 *
 * `carried` é a movimentação já consolidada da conta (`LedgerWindow.carriedBanks`), quando
 * `transactions` traz só o que veio depois do consolidado; `date` não pode ser anterior a ele.
 */
export function bankBalanceAt(
  account: Pick<BankAccount, 'accountKey' | 'openingBalance' | 'openingDate'>,
  transactions: readonly BankTransaction[],
  date: string,
  carried = 0
): number {
  const movement = transactions
    .filter((t) => t.accountKey === account.accountKey && countsAfterOpening(t.date, account.openingDate) && t.date <= date)
    .reduce((s, t) => s + t.amount, 0);
  return round2((account.openingBalance ?? 0) + carried + movement);
}

/** Extrato mais recente da conta com saldo informado pelo banco. */
export const lastReportedStatement = <T extends Pick<ImportBatch, 'accountKey' | 'ledgerBalance' | 'ledgerDate'>>(batches: readonly T[], accountKey: string): T | undefined =>
  batches
    .filter((x) => x.accountKey === accountKey && x.ledgerBalance !== undefined && x.ledgerDate)
    .sort((x, y) => (y.ledgerDate ?? '').localeCompare(x.ledgerDate ?? ''))[0];

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
