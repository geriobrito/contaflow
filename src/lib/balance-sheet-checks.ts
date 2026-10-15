import type { BalanceSheet, BalanceSheetLine } from '@/lib/ledger';

/**
 * Conferências do balanço patrimonial para a tela: contas com saldo contrário à natureza do
 * grupo e capital social sem saldo.
 */

/** Retificadoras (saldo contrário ao grupo por natureza): "(-) ...", depreciação e amortização acumuladas. */
const CONTRA = /\(-\)|deprecia|amortiza/i;

/** Grupos de natureza conferida: ativo devedor; passivo exigível (circulante e não circulante) credor. */
const CHECKED: { prefix: string; side: 'ASSET' | 'LIABILITY' }[] = [
  { prefix: '1.', side: 'ASSET' },
  { prefix: '2.1.', side: 'LIABILITY' },
  { prefix: '2.2.', side: 'LIABILITY' },
];

export interface InvertedBalance {
  line: BalanceSheetLine;
  /** ASSET com saldo credor ou LIABILITY com saldo devedor. */
  side: 'ASSET' | 'LIABILITY';
}

/**
 * Contas analíticas de ativo com saldo credor e de passivo exigível com saldo devedor. No
 * balanço, cada lado já vem na natureza do grupo: saldo invertido é valor negativo.
 */
export function invertedBalances(bs: Pick<BalanceSheet, 'assets' | 'liabilities'>): InvertedBalance[] {
  const out: InvertedBalance[] = [];
  for (const line of [...bs.assets, ...bs.liabilities]) {
    if (line.synthetic || !line.code || line.value > -0.005 || CONTRA.test(line.name)) continue;
    const group = CHECKED.find((g) => line.code.startsWith(g.prefix));
    if (group) out.push({ line, side: group.side });
  }
  return out;
}

/** Grupo do capital social no plano do CFC. */
export const CAPITAL_GROUP_CODE = '2.3.1';

/** Balanço com algum saldo, mas o capital social (2.3.1) zerado: falta registrá-lo na abertura ou por lançamento. */
export function missingShareCapital(bs: Pick<BalanceSheet, 'assets' | 'liabilities' | 'equity'>): boolean {
  const hasBalances = bs.assets.length + bs.liabilities.length + bs.equity.length > 0;
  const capital = bs.equity.find((l) => l.code === CAPITAL_GROUP_CODE)?.value ?? 0;
  return hasBalances && Math.abs(capital) < 0.005;
}
