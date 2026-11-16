import { describe, expect, it } from 'vitest';
import { mergeSharedPeriod, parseSharedPeriod, periodOfDate } from '@/lib/shared-period';

describe('período compartilhado das demonstrações', () => {
  it('lê o período guardado e descarta o que não serve', () => {
    expect(parseSharedPeriod(JSON.stringify({ mode: 'year', year: 2025, month: 3, quarter: 1 }))).toEqual({ mode: 'year', year: 2025, month: 3, quarter: 1 });
    expect(parseSharedPeriod(JSON.stringify({ mode: 'semana', year: 2025, month: 13, quarter: 0 }))).toEqual({ year: 2025 });
    expect(parseSharedPeriod(JSON.stringify({ year: '2025' }))).toBeNull();
    expect(parseSharedPeriod('{não é json')).toBeNull();
    expect(parseSharedPeriod('null')).toBeNull();
    expect(parseSharedPeriod(null)).toBeNull();
  });

  it('a alteração entra por cima e o resto fica como estava', () => {
    expect(mergeSharedPeriod({ mode: 'month', year: 2026, month: 5, quarter: 2 }, { year: 2025 })).toEqual({ mode: 'month', year: 2025, month: 5, quarter: 2 });
    // Só o exercício escolhido (Notas, Fechamento): cada tela mantém o tipo de período dela.
    expect(mergeSharedPeriod(null, { year: 2025 })).toEqual({ year: 2025 });
  });

  it('data vira ano, mês e trimestre', () => {
    expect(periodOfDate('2025-12-31')).toEqual({ year: 2025, month: 12, quarter: 4 });
    expect(periodOfDate('2025-04-01')).toEqual({ year: 2025, month: 4, quarter: 2 });
    expect(periodOfDate('2025')).toBeNull();
    expect(periodOfDate('')).toBeNull();
  });
});
