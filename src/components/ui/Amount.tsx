import { formatCurrency } from '@/lib/utils/formatters';

/** O espaço de um ")" sem desenhá-lo: os centavos do positivo ficam na coluna dos do negativo. */
const ClosingSpace = () => (
  <span aria-hidden className="invisible">
    )
  </span>
);

/**
 * Valor contábil para colunas alinhadas pela vírgula: negativo entre parênteses e, no positivo,
 * o espaço do parêntese de fechamento reservado. Dígitos de largura fixa (Geist Mono), então
 * valores e totais de uma coluna alinhada à direita ficam com as vírgulas na mesma vertical.
 * `zero` troca o valor nulo por um marcador (ex.: "—").
 */
export function AccountingAmount({ value, zero, className = '' }: { value: number; zero?: string; className?: string }) {
  const base = `font-mono tabular-nums whitespace-nowrap ${className}`;
  if (zero !== undefined && Math.abs(value) < 0.005) {
    return (
      <span className={base}>
        {zero}
        <ClosingSpace />
      </span>
    );
  }
  const abs = formatCurrency(Math.abs(value));
  return (
    <span className={base}>
      {value <= -0.005 ? (
        `(${abs})`
      ) : (
        <>
          {abs}
          <ClosingSpace />
        </>
      )}
    </span>
  );
}
