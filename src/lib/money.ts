/**
 * Dinheiro.
 *
 * Os valores trafegam em reais com duas casas (como vêm do extrato e são gravados), mas
 * toda soma e comparação passa por centavos inteiros: em ponto flutuante 0,1 + 0,2 não é
 * 0,3, e uma diferença de 0,0000001 não pode decidir se um lançamento fecha.
 */

/** Reais → centavos inteiros. */
export const toCents = (value: number): number => Math.round(value * 100);

/** Centavos inteiros → reais. */
export const fromCents = (cents: number): number => cents / 100;

/** Arredonda um valor em reais para centavos. */
export const round2 = (value: number): number => toCents(value) / 100;

/** Soma exata de valores em reais (acumula em centavos). */
export function sumMoney(values: Iterable<number>): number {
  let cents = 0;
  for (const v of values) cents += toCents(v);
  return fromCents(cents);
}

/** Dois valores em reais são o mesmo valor, centavo a centavo? */
export const sameAmount = (a: number, b: number): boolean => toCents(a) === toCents(b);
