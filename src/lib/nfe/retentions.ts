import type { InvoiceRetentions, InvoiceSummary, TaxRegime } from '@/types/firestore';
import { toCents } from '@/lib/money';

/**
 * Retenções da NFS-e casada com o extrato: o que mostrar e quando avisar. O extrato traz o
 * líquido; a receita (ou a despesa) vai pelo bruto, e cada retenção para a conta dela.
 */

export interface RetentionPart {
  label: string;
  cents: number;
}

const PARTS: readonly [keyof InvoiceRetentions, string][] = [
  ['irrf', 'IRRF'],
  ['pis', 'PIS'],
  ['cofins', 'COFINS'],
  ['csll', 'CSLL'],
  ['inss', 'INSS'],
  ['iss', 'ISS'],
  ['other', 'não discriminado'],
];

/** Retenções da nota, na ordem de exibição (só as diferentes de zero). */
export function retentionParts(r: InvoiceRetentions | undefined): RetentionPart[] {
  if (!r) return [];
  return PARTS.map(([k, label]) => ({ label, cents: toCents(r[k] ?? 0) })).filter((p) => p.cents > 0);
}

/**
 * O pagamento casado é o líquido da nota (com as retenções descontadas). Pago ou recebido pelo
 * valor do serviço, não houve retenção no caixa e o bruto × líquido não se aplica.
 */
export function paidNet(invoice: Pick<InvoiceSummary, 'total' | 'retentions'>, matchedAmount: number): boolean {
  return retentionParts(invoice.retentions).length > 0 && toCents(Math.abs(matchedAmount)) === toCents(invoice.total);
}

/**
 * Prestadora do Simples Nacional com IRRF ou CSRF retidos na nota: a retenção é dispensada para
 * optante (IN SRF 765/2007, art. 1º; Lei 10.833/2003, art. 32), em geral porque a nota não
 * informou a opção pelo Simples. O INSS fica de fora: pode ser devido na cessão de mão de obra.
 */
export function simplesRetentionWarning(invoice: Pick<InvoiceSummary, 'direction' | 'retentions'>, regime: TaxRegime | undefined): string | null {
  if (invoice.direction !== 'SALE' || (regime !== 'SIMPLES_NACIONAL' && regime !== 'MEI')) return null;
  const r = invoice.retentions;
  if (!r || !(r.irrf || r.pis || r.cofins || r.csll)) return null;
  return 'A empresa é do Simples Nacional: IRRF e PIS/COFINS/CSLL não são retidos de optante (IN SRF 765/2007, art. 1º; Lei 10.833/2003, art. 32). Confira se a nota informa a opção pelo Simples. O valor retido não abate o DAS: fica a recuperar até a restituição.';
}
