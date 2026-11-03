/**
 * Contagem aproximada das leituras do Firestore feitas por este navegador no dia.
 *
 * No plano gratuito a cota é de 50 mil leituras por dia, somadas em todo o projeto; estourada,
 * o app para de carregar até a cota reiniciar (meia-noite no horário do Pacífico). O Firestore
 * não informa o consumo ao app, então a conta é feita aqui, a cada consulta ao servidor. Não
 * entram as leituras de outros aparelhos, dos links de pendências abertos pelos clientes, dos
 * scripts nem do console do Firebase.
 */

export const FREE_DAILY_READS = 50_000;

const STORAGE_KEY = 'contaflow_firestore_reads';

export interface ReadTally {
  /** Dia da cota (AAAA-MM-DD no horário do Pacífico). */
  day: string;
  reads: number;
}

const QUOTA_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Dia da cota do Firestore, que vira à meia-noite no horário do Pacífico. */
export function quotaDay(now: Date = new Date()): string {
  return QUOTA_DAY.format(now);
}

/** Leituras cobradas por uma consulta: uma por documento devolvido, e uma se não vier nenhum. */
export function queryReads(size: number): number {
  return Math.max(1, size);
}

/** Leituras cobradas por uma contagem (`count()`): uma a cada mil entradas do índice. */
export function countReads(count: number): number {
  return Math.max(1, Math.ceil(count / 1000));
}

export type QuotaLevel = 'ok' | 'warn' | 'danger';

/** Faixa de alerta: atenção a partir de 60% da cota, perigo a partir de 85%. */
export function quotaLevel(reads: number, limit: number = FREE_DAILY_READS): QuotaLevel {
  const share = reads / limit;
  return share >= 0.85 ? 'danger' : share >= 0.6 ? 'warn' : 'ok';
}

function parseTally(raw: string | null): ReadTally | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ReadTally>;
    return typeof value.day === 'string' && typeof value.reads === 'number' && value.reads >= 0
      ? { day: value.day, reads: value.reads }
      : null;
  } catch {
    return null;
  }
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

const EMPTY: ReadTally = { day: '', reads: 0 };
let cache: ReadTally | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

/** Total do dia da cota. Devolve o mesmo objeto enquanto nada muda (seguro para `useSyncExternalStore`). */
export function getReadTally(now: Date = new Date()): ReadTally {
  const day = quotaDay(now);
  if (cache?.day === day) return cache;
  const stored = parseTally(storage()?.getItem(STORAGE_KEY) ?? null);
  cache = stored?.day === day ? stored : { day, reads: 0 };
  return cache;
}

/** Soma leituras ao total do dia. Relê o armazenamento antes, para não perder o que outras abas somaram. */
export function addReads(count: number, now: Date = new Date()): void {
  if (!(count > 0)) return;
  const day = quotaDay(now);
  const store = storage();
  const stored = parseTally(store?.getItem(STORAGE_KEY) ?? null);
  const base = stored?.day === day ? stored.reads : cache?.day === day ? cache.reads : 0;
  cache = { day, reads: base + count };
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* armazenamento cheio ou bloqueado: a contagem segue só na memória */
  }
  notify();
}

/** Avisa quando o total muda, inclusive por leituras feitas em outra aba. */
export function subscribeReads(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    cache = null;
    listener();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

/** Valor usado na renderização do servidor, onde não há contagem. */
export function getServerReadTally(): ReadTally {
  return EMPTY;
}

/** Só para testes: esquece o total guardado na memória. */
export function resetReadMeterCache(): void {
  cache = null;
}
