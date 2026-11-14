/**
 * Dias úteis para prazos federais: sábados, domingos e feriados nacionais (fixos, Carnaval,
 * Sexta-feira Santa e Corpus Christi, em que não há expediente bancário). Feriados estaduais e
 * municipais não entram: para eles o prazo federal não muda.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function addCalendarDays(date: string, days: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

const cache = new Map<number, Set<string>>();

/** Feriados nacionais do ano (YYYY-MM-DD). */
export function nationalHolidays(year: number): Set<string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const easter = easterSunday(year);
  const fixed = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '12-25'];
  // Dia Nacional de Zumbi e da Consciência Negra: feriado nacional desde 2024 (Lei 14.759/2023).
  if (year >= 2024) fixed.push('11-20');
  const set = new Set<string>([
    ...fixed.map((md) => `${year}-${md}`),
    addCalendarDays(easter, -48), // Carnaval (segunda)
    addCalendarDays(easter, -47), // Carnaval (terça)
    addCalendarDays(easter, -2), // Sexta-feira Santa
    addCalendarDays(easter, 60), // Corpus Christi
  ]);
  cache.set(year, set);
  return set;
}

export function isBusinessDay(date: string): boolean {
  const dow = utc(date).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !nationalHolidays(Number(date.slice(0, 4))).has(date);
}

/** O próprio dia, se útil; senão o próximo (`next`) ou o anterior (`previous`) dia útil. */
export function shiftToBusinessDay(date: string, direction: 'next' | 'previous'): string {
  let d = date;
  const step = direction === 'next' ? 1 : -1;
  while (!isBusinessDay(d)) d = addCalendarDays(d, step);
  return d;
}

/** Último dia (YYYY-MM-DD) da competência YYYY-MM. */
export function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return iso(new Date(Date.UTC(y, m, 0)));
}

/** Competência deslocada (YYYY-MM). */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** Dia `day` do mês (limitado ao último dia: dia 31 em abril vira 30). */
export function dayOfMonth(month: string, day: number): string {
  const last = Number(lastDayOf(month).slice(8));
  return `${month}-${pad(Math.min(Math.max(1, day), last))}`;
}

export const lastBusinessDayOf = (month: string): string => shiftToBusinessDay(lastDayOf(month), 'previous');

/** N-ésimo dia útil do mês (1 = primeiro). */
export function nthBusinessDayOf(month: string, n: number): string {
  let d = shiftToBusinessDay(`${month}-01`, 'next');
  for (let i = 1; i < n; i++) d = shiftToBusinessDay(addCalendarDays(d, 1), 'next');
  return d;
}

export const todayISO = (now = new Date()): string => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
