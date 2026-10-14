import { describe, expect, it } from 'vitest';
import { fromCents, round2, sameAmount, sumMoney, toCents } from '@/lib/money';

describe('dinheiro em centavos inteiros', () => {
  it('converte reais em centavos sem resíduo de ponto flutuante', () => {
    expect(toCents(19.99)).toBe(1999);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(-1234.56)).toBe(-123456);
    expect(fromCents(1999)).toBe(19.99);
  });

  it('arredonda para centavos', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(10.004)).toBe(10);
    expect(round2(-0.004)).toBe(-0);
  });

  it('soma exata, onde a soma direta em ponto flutuante erra', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7])).toBe(2.8);
    expect(sumMoney([100, -60.5, -39.5])).toBe(0);
    expect(sumMoney([])).toBe(0);
  });

  it('compara valores centavo a centavo', () => {
    expect(sameAmount(0.1 + 0.2, 0.3)).toBe(true);
    expect(sameAmount(100, 100.004)).toBe(true);
    expect(sameAmount(100, 100.01)).toBe(false);
  });
});
