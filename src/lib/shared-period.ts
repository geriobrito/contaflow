import type { PeriodMode } from '@/lib/dre/build';

/**
 * Período compartilhado pelas Demonstrações (Balanço, DRE, Diário, Razão, Notas Explicativas e
 * Fechamento do Exercício): o que o contador escolhe numa tela vale nas outras, até trocar de
 * empresa ou fechar a aba. Fica no `sessionStorage`: um dia novo começa de novo no movimento
 * mais recente, e duas abas do navegador podem olhar períodos diferentes.
 */

export const SHARED_PERIOD_KEY = 'contaflow_periodo_demonstracoes';
/** Avisado ao trocar de empresa: as telas abertas voltam a aceitar o período sugerido pelos dados. */
export const SHARED_PERIOD_RESET_EVENT = 'contaflow:period-reset';

export interface SharedPeriod {
  /** Ausente quando só o ano ou a data foram escolhidos: cada tela mantém o tipo de período dela. */
  mode?: PeriodMode;
  year?: number;
  month?: number;
  quarter?: number;
}

const MODES: readonly string[] = ['month', 'quarter', 'year'];
const int = (v: unknown, min: number, max: number): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined);

/** Período guardado, só com os campos válidos; null se não houver nada aproveitável. */
export function parseSharedPeriod(raw: string | null): SharedPeriod | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const { mode, year, month, quarter } = data as Record<string, unknown>;
  const out: SharedPeriod = {
    ...(typeof mode === 'string' && MODES.includes(mode) ? { mode: mode as PeriodMode } : {}),
    ...(int(year, 1900, 2200) !== undefined ? { year: int(year, 1900, 2200) } : {}),
    ...(int(month, 1, 12) !== undefined ? { month: int(month, 1, 12) } : {}),
    ...(int(quarter, 1, 4) !== undefined ? { quarter: int(quarter, 1, 4) } : {}),
  };
  return Object.keys(out).length ? out : null;
}

/** Período guardado com a alteração aplicada por cima (os demais campos ficam como estavam). */
export const mergeSharedPeriod = (current: SharedPeriod | null, patch: SharedPeriod): SharedPeriod => ({ ...(current ?? {}), ...patch });

/** Ano, mês e trimestre de uma data (YYYY-MM-DD); null se a data não servir. */
export function periodOfDate(date: string): Required<Omit<SharedPeriod, 'mode'>> | null {
  const [y, m] = date.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  return { year: y, month: m, quarter: Math.floor((m - 1) / 3) + 1 };
}

export function readSharedPeriod(): SharedPeriod | null {
  try {
    return parseSharedPeriod(window.sessionStorage.getItem(SHARED_PERIOD_KEY));
  } catch {
    return null;
  }
}

export function writeSharedPeriod(patch: SharedPeriod): void {
  try {
    window.sessionStorage.setItem(SHARED_PERIOD_KEY, JSON.stringify(mergeSharedPeriod(readSharedPeriod(), patch)));
  } catch {
    /* armazenamento indisponível: o período vale só na tela */
  }
}

/** Troca de empresa: esquece a escolha, para a nova empresa abrir no movimento mais recente dela. */
export function clearSharedPeriod(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(SHARED_PERIOD_KEY);
  } catch {
    /* armazenamento indisponível */
  }
  window.dispatchEvent(new Event(SHARED_PERIOD_RESET_EVENT));
}
