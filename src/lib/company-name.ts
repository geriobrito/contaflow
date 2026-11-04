import { textKey } from '@/lib/payee';

/**
 * Comparação de nomes de empresa (notas fiscais × extrato, cadastro × Receita): sem acento,
 * sem natureza jurídica (LTDA, ME…) nem termos genéricos ("Comércio", "Serviços").
 */

/** Palavras que não identificam a empresa: natureza jurídica, ligações e termos genéricos. */
const STOP = new Set([
  'ltda', 'me', 'epp', 'eireli', 'sa', 's', 'a', 'cia', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'com', 'comercio', 'comercial',
  'servicos', 'industria', 'distribuidora', 'brasil', 'grupo', 'empresa', 'produtos', 'importacao', 'exportacao',
  'pix', 'ted', 'doc', 'pagamento', 'boleto', 'efetuado', 'enviado', 'recebido', 'transferencia', 'compra', 'debito', 'credito',
]);

/** Palavras que identificam a empresa no nome. */
export const companyTokens = (s: string): string[] => textKey(s).split(' ').filter((w) => w.length >= 3 && !STOP.has(w));

/** Duas palavras conferem se uma começa a outra (o extrato costuma cortar o nome). */
const sameWord = (a: string, b: string) => (a.length >= 4 && b.length >= 4 ? a.startsWith(b) || b.startsWith(a) : a === b);

/** Fração das palavras do nome do parceiro que aparecem na descrição (0 a 1). */
export function nameOverlap(partner: string, memo: string): number {
  const names = companyTokens(partner);
  if (!names.length) return 0;
  const words = companyTokens(memo);
  const hits = names.filter((n) => words.some((w) => sameWord(n, w))).length;
  return hits / names.length;
}

/**
 * Os dois nomes são da mesma empresa: as palavras do nome mais curto aparecem quase todas no
 * outro ("Pão Quente" × "PADARIA PAO QUENTE LTDA - ME"). "Padaria Aurora" × "Padaria Pão Quente" não.
 */
export function sameCompany(a: string | undefined, b: string | undefined): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  const ta = companyTokens(a);
  const tb = companyTokens(b);
  if (!ta.length || !tb.length) return textKey(a) === textKey(b);
  const [shorter, longer] = ta.length <= tb.length ? [a, b] : [b, a];
  return nameOverlap(shorter, longer) > 0.7;
}
