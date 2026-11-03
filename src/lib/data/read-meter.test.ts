import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addReads,
  countReads,
  getReadTally,
  queryReads,
  quotaDay,
  quotaLevel,
  resetReadMeterCache,
  subscribeReads,
} from '@/lib/data/read-meter';

describe('quotaDay', () => {
  it('vira à meia-noite do Pacífico, não à de Brasília', () => {
    // 02h de 3/nov em Brasília (UTC-3) ainda é 2/nov na Califórnia.
    expect(quotaDay(new Date('2026-11-03T05:00:00Z'))).toBe('2026-11-02');
    expect(quotaDay(new Date('2026-11-03T09:00:00Z'))).toBe('2026-11-03');
  });
});

describe('custo das leituras', () => {
  it('consulta vazia custa uma leitura', () => {
    expect(queryReads(0)).toBe(1);
    expect(queryReads(37)).toBe(37);
  });

  it('contagem custa uma leitura a cada mil entradas', () => {
    expect(countReads(0)).toBe(1);
    expect(countReads(1000)).toBe(1);
    expect(countReads(1001)).toBe(2);
  });
});

describe('quotaLevel', () => {
  it('classifica pela fração da cota', () => {
    expect(quotaLevel(29_999)).toBe('ok');
    expect(quotaLevel(30_000)).toBe('warn');
    expect(quotaLevel(42_500)).toBe('danger');
  });
});

describe('total do dia (sem armazenamento)', () => {
  beforeEach(() => resetReadMeterCache());
  afterEach(() => resetReadMeterCache());

  it('soma no mesmo dia e zera no dia seguinte', () => {
    const day1 = new Date('2026-11-02T15:00:00Z');
    const day2 = new Date('2026-11-03T15:00:00Z');
    addReads(10, day1);
    addReads(5, day1);
    expect(getReadTally(day1)).toEqual({ day: '2026-11-02', reads: 15 });
    expect(getReadTally(day2)).toEqual({ day: '2026-11-03', reads: 0 });
    addReads(3, day2);
    expect(getReadTally(day2).reads).toBe(3);
  });

  it('devolve o mesmo objeto enquanto nada muda', () => {
    const now = new Date('2026-11-02T15:00:00Z');
    expect(getReadTally(now)).toBe(getReadTally(now));
  });

  it('ignora valores não positivos e avisa os assinantes', () => {
    const now = new Date('2026-11-02T15:00:00Z');
    const listener = vi.fn();
    const off = subscribeReads(listener);
    addReads(0, now);
    addReads(-4, now);
    expect(listener).not.toHaveBeenCalled();
    addReads(2, now);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    addReads(2, now);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
