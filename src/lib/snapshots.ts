import type { BankAccount, BankTransaction, ChartAccount, MonthCounts, PeriodLock, PeriodSnapshot } from '@/types/firestore';
import { buildPostings, type Posting } from '@/lib/ledger';
import { monthOf } from '@/lib/periods';
import { toCents } from '@/lib/money';

/**
 * Saldos consolidados de competências fechadas.
 *
 * Balanço, razão e painel precisam do acumulado desde o primeiro lançamento. Em vez de
 * reler o histórico inteiro, lê-se um snapshot (saldo por conta até o fim de um mês
 * fechado) e só os lançamentos posteriores a ele.
 *
 * O snapshot resume apenas as partidas dos lançamentos bancários — saldos iniciais,
 * saldos de abertura e lançamentos manuais são poucos e continuam calculados na hora. Guarda
 * também a movimentação por conta bancária, para o saldo de cada banco (Contas e extratos). Ele
 * só é usado enquanto nada do que resume pode ter mudado:
 *   - toda competência com lançamentos até a data dele segue fechada, no mesmo fechamento
 *     (as regras do Firestore congelam os lançamentos de mês fechado);
 *   - a quantidade de lançamentos até a data é a mesma (importar em mês fechado é permitido
 *     e muda os saldos; a contagem é conferida no servidor por quem carrega);
 *   - os vínculos/datas dos bancos e as contas do plano são os mesmos (`ledgerConfigKey`).
 * Se qualquer condição falha, ele é ignorado e refeito a partir dos lançamentos.
 */

/**
 * Muda quando a forma de calcular as partidas ou o conteúdo do snapshot muda: os antigos
 * deixam de valer. v2: movimentação por conta bancária e contagem de lançamentos sem conta.
 */
const SNAPSHOT_VERSION = 2;

export const snapshotId = (clientId: string, month: string): string => `${clientId}_${month}`;

/** Último dia (YYYY-MM-DD) da competência YYYY-MM. */
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Hash de 53 bits (cyrb53) em hexadecimal: compara configurações sem guardá-las inteiras. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/**
 * Tudo o que, fora os próprios lançamentos, decide em que conta cada partida cai: o vínculo
 * contábil e a data do saldo inicial de cada banco, e quais contas existem no plano.
 */
export function ledgerConfigKey(
  banks: readonly Pick<BankAccount, 'accountKey' | 'ledgerAccountId' | 'openingDate'>[],
  accounts: readonly Pick<ChartAccount, 'id'>[]
): string {
  const payload = JSON.stringify({
    banks: banks.map((b) => `${b.accountKey}|${b.ledgerAccountId ?? ''}|${b.openingDate ?? ''}`).sort(),
    accounts: accounts.map((a) => a.id).sort(),
  });
  return `v${SNAPSHOT_VERSION}-${hash(payload)}`;
}

/**
 * Saldos por conta contábil e movimentação por conta bancária (em centavos), e contagens por
 * competência, de um conjunto de lançamentos. Devolve quantos não têm conta bancária.
 */
function tally(
  transactions: readonly BankTransaction[],
  banks: readonly BankAccount[],
  accounts: readonly ChartAccount[],
  balances: Map<string, number>,
  bankMovements: Map<string, number>,
  months: Map<string, MonthCounts>
): number {
  // Só as partidas dos lançamentos: o saldo inicial dos bancos é lançado à parte, na hora.
  const banksWithoutOpening = banks.map((b) => ({ ...b, openingBalance: undefined }));
  for (const p of buildPostings(transactions, banksWithoutOpening, accounts)) {
    balances.set(p.accountId, (balances.get(p.accountId) ?? 0) + toCents(p.value));
  }
  // O mesmo corte de `bankBalanceAt`: o que veio até a data do saldo inicial já está nele.
  const openingDate = new Map(banks.map((b) => [b.accountKey, b.openingDate ?? ''] as const));
  let unlinked = 0;
  for (const t of transactions) {
    if (!t.accountKey) unlinked++;
    else if (t.date > (openingDate.get(t.accountKey) ?? '')) {
      bankMovements.set(t.accountKey, (bankMovements.get(t.accountKey) ?? 0) + toCents(t.amount));
    }
    const month = monthOf(t.date);
    const c = months.get(month) ?? { month, total: 0, pending: 0, auto: 0, reconciled: 0 };
    c.total++;
    if (t.status === 'PENDING') c.pending++;
    else if (t.status === 'AUTO_CLASSIFIED') c.auto++;
    else c.reconciled++;
    months.set(month, c);
  }
  return unlinked;
}

/**
 * Snapshot do fim de `month`, a partir de `base` (snapshot anterior já conferido, ou null) e
 * dos lançamentos posteriores a ele até o fim de `month`. Devolve null se alguma competência
 * com lançamentos não está fechada — nesse caso os saldos ainda podem mudar.
 */
export function buildSnapshot(args: {
  clientId: string;
  month: string;
  base: PeriodSnapshot | null;
  /** Lançamentos com data depois de `base.asOf` (ou todos) e até o fim de `month`. */
  transactions: readonly BankTransaction[];
  banks: readonly BankAccount[];
  accounts: readonly ChartAccount[];
  locks: readonly PeriodLock[];
  createdAt: string;
}): PeriodSnapshot | null {
  const { clientId, month, base, transactions, banks, accounts, locks, createdAt } = args;
  const asOf = monthEnd(month);
  if (transactions.some((t) => t.date > asOf || (base && t.date <= base.asOf))) {
    throw new Error('Lançamentos fora do intervalo do snapshot.');
  }
  const balances = new Map((base?.balances ?? []).map((b) => [b.accountId, toCents(b.value)] as const));
  const bankMovements = new Map((base?.bankMovements ?? []).map((b) => [b.accountKey, toCents(b.value)] as const));
  const months = new Map((base?.months ?? []).map((m) => [m.month, { ...m }] as const));
  const unlinked = tally(transactions, banks, accounts, balances, bankMovements, months);

  const lockedAt = new Map(locks.map((l) => [l.month, l.lockedAt] as const));
  const dataMonths = [...months.keys()].sort();
  if (dataMonths.some((m) => !lockedAt.has(m))) return null;

  return {
    id: snapshotId(clientId, month),
    clientId,
    month,
    asOf,
    balances: [...balances]
      .filter(([, cents]) => cents !== 0)
      .map(([accountId, cents]) => ({ accountId, value: cents / 100 }))
      .sort((a, b) => a.accountId.localeCompare(b.accountId)),
    bankMovements: [...bankMovements]
      .filter(([, cents]) => cents !== 0)
      .map(([accountKey, cents]) => ({ accountKey, value: cents / 100 }))
      .sort((a, b) => a.accountKey.localeCompare(b.accountKey)),
    unlinkedCount: (base?.unlinkedCount ?? 0) + unlinked,
    txCount: (base?.txCount ?? 0) + transactions.length,
    months: dataMonths.map((m) => months.get(m)!),
    locks: dataMonths.map((m) => ({ month: m, lockedAt: lockedAt.get(m)! })),
    configKey: ledgerConfigKey(banks, accounts),
    createdAt,
  };
}

/**
 * Por que o snapshot não pode ser usado com os dados atuais, ou null se pode. Falta só
 * conferir a contagem de lançamentos no servidor (`txCount`), que é de quem carrega.
 */
export function snapshotProblem(
  snapshot: PeriodSnapshot,
  current: { banks: readonly BankAccount[]; accounts: readonly ChartAccount[]; locks: readonly PeriodLock[] }
): string | null {
  if (snapshot.asOf !== monthEnd(snapshot.month)) return 'data inconsistente';
  if (snapshot.configKey !== ledgerConfigKey(current.banks, current.accounts)) return 'bancos ou plano de contas alterados';
  const lockedAt = new Map(current.locks.map((l) => [l.month, l.lockedAt] as const));
  for (const l of snapshot.locks) {
    if (lockedAt.get(l.month) !== l.lockedAt) return `competência ${l.month} reaberta`;
  }
  // Toda competência com lançamentos precisa constar entre as fechadas.
  const covered = new Set(snapshot.locks.map((l) => l.month));
  if (snapshot.months.some((m) => !covered.has(m.month))) return 'competência sem fechamento';
  return null;
}

/** Saldos do snapshot como partidas na data dele, prontas para `buildPostings(..., carry)`. */
export const carryOf = (snapshot: PeriodSnapshot | null): Posting[] =>
  snapshot ? snapshot.balances.map((b) => ({ accountId: b.accountId, date: snapshot.asOf, value: b.value })) : [];

/**
 * A competência fechada mais recente, anterior a `beforeMonth`, para a qual dá para gravar
 * um snapshot: todo mês com lançamentos até o fim dela está fechado. `dataMonths` são os
 * meses com lançamentos conhecidos (do snapshot base e dos lançamentos carregados).
 */
export function snapshotTarget(locks: readonly PeriodLock[], dataMonths: Iterable<string>, beforeMonth?: string): string | null {
  const locked = new Set(locks.map((l) => l.month));
  const firstOpen = [...dataMonths].filter((m) => !locked.has(m)).sort()[0];
  const candidates = [...locked]
    .filter((m) => (!beforeMonth || m < beforeMonth) && (!firstOpen || m < firstOpen))
    .sort();
  return candidates[candidates.length - 1] ?? null;
}
