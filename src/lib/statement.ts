import type { BalanceCheck, ImportBatch } from '@/types/firestore';
import type { OFXAccountInfo } from '@/lib/ofx/types';
import { isISODate } from '@/lib/periods';

/**
 * Conferência de extratos: saldo final informado pelo banco (LEDGERBAL) contra a
 * movimentação registrada, e lacunas de datas entre extratos da mesma conta.
 */

/** Chave estável da conta bancária (banco-agência-conta). Sem número de conta, não há chave. */
export function accountKeyOf(account: OFXAccountInfo): string | undefined {
  if (!account.accountId) return undefined;
  return [account.bankId, account.branchId, account.accountId]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join('-');
}

const CENT = 0.005;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Soma dia a dia (YYYY-MM-DD) sem fuso horário. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Compara o saldo informado com o esperado:
 *   esperado = saldo do extrato anterior (mesma conta) + movimentação em (data anterior, data atual].
 * Sem saldo no arquivo → NO_LEDGER; sem extrato anterior → BASELINE (vira referência).
 */
export function computeBalanceCheck(args: {
  reported?: number;
  previous?: Pick<ImportBatch, 'id' | 'ledgerBalance' | 'ledgerDate'>;
  movement: number;
  /**
   * O saldo é de uma data depois do fim do extrato (ex.: InfinitePay informa o saldo do dia da
   * geração do arquivo). Lançamentos entre as duas datas não estão no arquivo; não dá para conferir.
   */
  afterPeriod?: boolean;
}): BalanceCheck {
  const { reported, previous, movement } = args;
  if (reported === undefined || Number.isNaN(reported)) return { status: 'NO_LEDGER' };
  if (!previous || previous.ledgerBalance === undefined || !previous.ledgerDate) {
    return { status: 'BASELINE', reported: round2(reported), movement: round2(movement) };
  }
  if (args.afterPeriod) return { status: 'AFTER_PERIOD', reported: round2(reported), previousBatchId: previous.id, previousLedgerDate: previous.ledgerDate };
  const expected = round2(previous.ledgerBalance + movement);
  const difference = round2(reported - expected);
  return {
    status: Math.abs(difference) < CENT ? 'OK' : 'MISMATCH',
    reported: round2(reported),
    expected,
    difference,
    movement: round2(movement),
    previousBatchId: previous.id,
    previousLedgerDate: previous.ledgerDate,
  };
}

/** Extrato anterior da mesma conta: o de maior data de saldo, anterior à data informada. */
export function previousStatement<T extends Pick<ImportBatch, 'accountKey' | 'ledgerDate' | 'ledgerBalance'>>(
  batches: readonly T[],
  accountKey: string,
  ledgerDate: string
): T | undefined {
  return batches
    .filter((b) => b.accountKey === accountKey && isISODate(b.ledgerDate) && b.ledgerBalance !== undefined && b.ledgerDate < ledgerDate)
    .sort((a, b) => (b.ledgerDate ?? '').localeCompare(a.ledgerDate ?? ''))[0];
}

export interface CoverageGap {
  accountKey: string;
  from: string;
  to: string;
}

/** Dias sem extrato entre os períodos cobertos (DTSTART–DTEND) de cada conta. */
export function findCoverageGaps(
  batches: readonly Pick<ImportBatch, 'accountKey' | 'startDate' | 'endDate'>[]
): CoverageGap[] {
  const byAccount = new Map<string, { start: string; end: string }[]>();
  for (const b of batches) {
    if (!b.accountKey || !isISODate(b.startDate) || !isISODate(b.endDate)) continue;
    const list = byAccount.get(b.accountKey) ?? [];
    list.push({ start: b.startDate, end: b.endDate });
    byAccount.set(b.accountKey, list);
  }
  const gaps: CoverageGap[] = [];
  for (const [accountKey, ranges] of byAccount) {
    ranges.sort((a, b) => a.start.localeCompare(b.start));
    let coveredUntil = ranges[0].end;
    for (const r of ranges.slice(1)) {
      const nextNeeded = addDays(coveredUntil, 1);
      if (r.start > nextNeeded) gaps.push({ accountKey, from: nextNeeded, to: addDays(r.start, -1) });
      if (r.end > coveredUntil) coveredUntil = r.end;
    }
  }
  return gaps;
}

/** Lançamentos do arquivo fora do intervalo declarado (DTSTART–DTEND). */
export function outOfRangeDates(dates: readonly string[], start?: string, end?: string): string[] {
  if (!start || !end) return [];
  return dates.filter((d) => d < start || d > end);
}
