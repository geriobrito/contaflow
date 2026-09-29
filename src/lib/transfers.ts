import type { BankTransaction, ChartAccount } from '@/types/firestore';
import { isMonthLocked } from '@/lib/periods';

/**
 * Transferências entre contas próprias do mesmo cliente.
 *
 * Uma transferência aparece duas vezes: saída numa conta e entrada de mesmo valor em
 * outra, em datas próximas. Classificar as duas pernas numa conta de resultado inflaria
 * receita e despesa; o correto é levar ambas à conta transitória (numerário em trânsito),
 * que zera quando as duas pernas estão conciliadas.
 */

export interface TransferPair {
  /** Perna de saída (valor negativo). */
  out: BankTransaction;
  /** Perna de entrada (valor positivo). */
  in: BankTransaction;
  /** Distância em dias entre as datas. */
  days: number;
  /** Histórico sugere transferência (TED, PIX, TRANSF, aplicação, resgate). */
  hinted: boolean;
}

const HINT = /TRANSF|TED|DOC\b|PIX|APLICA|RESGATE|ENTRE CONTAS|MESMA TITULARIDADE/i;

const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;

const cents = (n: number) => Math.round(n * 100);

/** Lançamento pode ser perna de transferência (ainda não conciliado, conta conhecida, mês aberto). */
function eligible(t: BankTransaction, lockedMonths: ReadonlySet<string>): boolean {
  return (
    t.status !== 'RECONCILED' &&
    Boolean(t.accountKey) &&
    !t.transferPairId &&
    !t.isSplit &&
    t.amount !== 0 &&
    !isMonthLocked(t.date, lockedMonths)
  );
}

/**
 * Detecta pares saída/entrada de mesmo valor entre contas diferentes do cliente, com até
 * `maxDays` dias de diferença. Cada lançamento entra em no máximo um par; os mais
 * próximos (e com histórico sugestivo) são pareados primeiro.
 */
export function findTransferPairs(
  transactions: readonly BankTransaction[],
  options: { maxDays?: number; lockedMonths?: ReadonlySet<string> } = {}
): TransferPair[] {
  const maxDays = options.maxDays ?? 3;
  const locked = options.lockedMonths ?? new Set<string>();
  const candidates = transactions.filter((t) => eligible(t, locked));
  const inflowsByValue = new Map<number, BankTransaction[]>();
  for (const t of candidates) {
    if (t.amount > 0) inflowsByValue.set(cents(t.amount), [...(inflowsByValue.get(cents(t.amount)) ?? []), t]);
  }

  const options_: TransferPair[] = [];
  for (const out of candidates) {
    if (out.amount >= 0) continue;
    for (const inc of inflowsByValue.get(cents(-out.amount)) ?? []) {
      if (inc.accountKey === out.accountKey) continue;
      const days = Math.abs(dayNumber(inc.date) - dayNumber(out.date));
      if (days > maxDays) continue;
      options_.push({ out, in: inc, days, hinted: HINT.test(out.memo) || HINT.test(inc.memo) });
    }
  }

  options_.sort(
    (a, b) =>
      a.days - b.days ||
      Number(b.hinted) - Number(a.hinted) ||
      a.out.date.localeCompare(b.out.date) ||
      a.out.id.localeCompare(b.out.id) ||
      a.in.id.localeCompare(b.in.id)
  );
  const used = new Set<string>();
  const pairs: TransferPair[] = [];
  for (const p of options_) {
    if (used.has(p.out.id) || used.has(p.in.id)) continue;
    used.add(p.out.id);
    used.add(p.in.id);
    pairs.push(p);
  }
  return pairs.sort((a, b) => a.out.date.localeCompare(b.out.date));
}

/** Código e nome da conta transitória no modelo ITG 1000. */
export const TRANSIT_ACCOUNT = { code: '1.1.1.04', name: 'Transferências entre Contas (Numerário em Trânsito)' } as const;

const TRANSIT_NAME = /tr[aâ]nsito|transfer[êe]ncias entre contas/i;

/** Conta transitória já existente no plano do cliente (analítica do ativo), se houver. */
export function findTransitAccount(accounts: readonly ChartAccount[]): ChartAccount | undefined {
  return (
    accounts.find((a) => a.code === TRANSIT_ACCOUNT.code && a.nature === 'ANALYTIC') ??
    accounts.find((a) => a.nature === 'ANALYTIC' && (a.type === 'ASSET' || a.type === 'ATIVO') && TRANSIT_NAME.test(a.name))
  );
}
