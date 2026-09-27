/**
 * Competências (meses) e fechamento de período.
 *
 * Um mês fechado não aceita classificação, reclassificação, rateio, desfazer nem
 * aprovação de lançamentos — assim a DRE entregue ao cliente não muda sem uma
 * reabertura explícita (auditada). A mesma regra é aplicada em `firestore.rules`.
 */

/** Data de calendário real no formato YYYY-MM-DD (rejeita 2025-02-30, 29/03/2025 etc.). */
export function isISODate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Competência (YYYY-MM) de uma data YYYY-MM-DD. */
export const monthOf = (date: string): string => date.slice(0, 7);

/** ID do documento de fechamento: `${clientId}_${YYYY-MM}` (o mesmo usado pelas regras). */
export const lockId = (clientId: string, month: string): string => `${clientId}_${month}`;

export const isMonthLocked = (date: string, lockedMonths: ReadonlySet<string>): boolean =>
  lockedMonths.has(monthOf(date));

/** Competências entre duas datas, inclusive. */
export function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let [y, m] = monthOf(start).split('-').map(Number);
  const [ey, em] = monthOf(end).split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "março de 2025" */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1] ?? month} de ${y}`;
}
