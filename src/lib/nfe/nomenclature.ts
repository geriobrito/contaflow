import type { InvoiceSummary } from '@/types/firestore';
import { NBS_GROUPS, NCM_CHAPTERS } from '@/lib/nfe/nomenclature-table';

/**
 * Conta sugerida pelo que a nota de compra traz de cada produto (NCM) ou serviço (NBS), quando o
 * CFOP não diz a finalidade.
 *
 * Produtos: a nota do fornecedor (CFOP 5/6/7) diz o que ele vendeu, não para que a empresa
 * comprou; o padrão é a mercadoria para revenda. O NCM refina: se a empresa vende produto da
 * mesma posição (4 dígitos), é revenda mesmo; se não vende, veículo, informática, móveis e
 * máquinas vão para o imobilizado (ou para o consumo, abaixo de R$ 1.200), combustível para a
 * despesa de transporte e material de escritório e limpeza para o consumo.
 *
 * Serviços: o NBS da NFS-e separa TI, honorários, propaganda, fretes, viagens, aluguel,
 * manutenção, energia, água, telefone e seguros; sem ele, o código de tributação nacional (item
 * da lista da LC 116) cobre os mais comuns.
 *
 * Tudo é sugestão: o contador confirma na conciliação.
 */

export type NomenclatureBasis = 'ncm' | 'nbs';

export interface NomenclatureSuggestion {
  /** Conta do modelo do CFC. */
  code: string;
  basis: NomenclatureBasis;
  /** Por que esta conta (ex.: "NCM 8471: Equipamentos de informática"). */
  reason: string;
}

/** Valor usual até o qual o bem pode ir direto para a despesa, em vez do imobilizado. */
export const ASSET_MIN_AMOUNT = 1200;

/** Mercadoria para revenda (a mesma conta que o CFOP do fornecedor sugere). */
const RESALE_CODE = '3.2.1.01';
const CONSUMPTION_CODE = '3.3.2.10';

/** Posições (4 dígitos) ou capítulos (2) do NCM → conta e o nome do grupo. A primeira que casar vale. */
const NCM_RULES: readonly { prefixes: readonly string[]; code: string; label: string; asset: boolean }[] = [
  { prefixes: ['2710', '2711'], code: '3.3.2.13', label: 'combustíveis e gás', asset: false },
  { prefixes: ['8702', '8703', '8704', '8711'], code: '1.2.3.04', label: 'veículos', asset: true },
  { prefixes: ['8471', '8443', '8517', '8528'], code: '1.2.3.06', label: 'equipamentos de informática e telecomunicação', asset: true },
  { prefixes: ['9401', '9403'], code: '1.2.3.05', label: 'móveis', asset: true },
  { prefixes: ['84', '85', '90'], code: '1.2.3.03', label: 'máquinas, aparelhos e equipamentos', asset: true },
  { prefixes: ['4802', '4818', '4820', '3401', '3402', '96'], code: CONSUMPTION_CODE, label: 'material de escritório, higiene e limpeza', asset: false },
];

/** Posição (4 dígitos) de um NCM. */
export const ncmHeading = (ncm: string) => ncm.slice(0, 4);

/** Descrição do capítulo do NCM (ex.: "84 · Reatores nucleares, caldeiras, máquinas…"). */
export const ncmChapterLabel = (ncm: string): string => {
  const chapter = ncm.slice(0, 2);
  return NCM_CHAPTERS[chapter] ? `${chapter} · ${NCM_CHAPTERS[chapter]}` : chapter;
};

/** Descrição do NBS pelo subgrupo (5 dígitos) ou grupo (3). */
export const nbsLabel = (nbs: string): string | null => NBS_GROUPS[nbs.slice(0, 5)] ?? NBS_GROUPS[nbs.slice(0, 3)] ?? null;

/** Posições de NCM que a empresa vende (das notas de venda autorizadas). */
export function soldHeadings(invoices: readonly Pick<InvoiceSummary, 'direction' | 'status' | 'ncms'>[]): Set<string> {
  const out = new Set<string>();
  for (const inv of invoices) {
    if (inv.direction !== 'SALE' || inv.status === 'CANCELLED') continue;
    for (const n of inv.ncms ?? []) out.add(ncmHeading(n.ncm));
  }
  return out;
}

/** Conta pelo NCM de maior valor da nota de compra, ou null quando o NCM não muda a sugestão. */
export function productAccountSuggestion(
  invoice: Pick<InvoiceSummary, 'direction' | 'ncms'>,
  sold: ReadonlySet<string>
): NomenclatureSuggestion | null {
  if (invoice.direction !== 'PURCHASE') return null;
  const main = invoice.ncms?.[0];
  if (!main) return null;
  const heading = ncmHeading(main.ncm);
  if (sold.has(heading)) {
    return { code: RESALE_CODE, basis: 'ncm', reason: `NCM ${heading}: a empresa vende produto da mesma posição` };
  }
  const rule = NCM_RULES.find((r) => r.prefixes.some((p) => main.ncm.startsWith(p)));
  if (!rule) return null;
  if (rule.asset && main.amount < ASSET_MIN_AMOUNT) {
    return { code: CONSUMPTION_CODE, basis: 'ncm', reason: `NCM ${heading}: ${rule.label} abaixo de R$ 1.200, limite usual para lançar direto na despesa` };
  }
  return { code: rule.code, basis: 'ncm', reason: `NCM ${heading}: ${rule.label}${rule.asset ? ' que a empresa não vende' : ''}` };
}

/** Subgrupos (5 dígitos) ou grupos (3) da NBS → conta. O mais específico vale. */
const NBS_RULES: readonly [readonly string[], string][] = [
  [['115', '11103', '11703'], '3.3.2.12'], // TI, licenças de software e conteúdo online
  [['113', '11401', '11402', '11403'], '3.3.2.11'], // jurídicos, contábeis, consultoria, arquitetura e engenharia
  [['11406', '11408', '11409'], '3.3.1.02'], // propaganda, foto e vídeo, design
  [['105', '106', '107'], '3.3.1.03'], // transporte de cargas, apoio aos transportes, correios
  [['104', '10303', '11805'], '3.3.2.13'], // transporte de passageiros, hospedagem, viagens
  [['11001', '11002', '11101', '11102'], '3.3.2.07'], // imóveis e locação de bens
  [['12001', '12002', '12003', '10105', '10106', '10107', '11803'], '3.3.2.14'], // manutenção, instalação, limpeza
  [['10801'], '3.3.2.06'], // eletricidade
  [['10802'], '3.3.2.09'], // água
  [['11701', '11702'], '3.3.2.08'], // telefone e internet
  [['10903', '10906'], '3.3.2.18'], // seguros
];

/** Item.subitem da lista da LC 116 (4 primeiros dígitos do cTribNac) → conta, para NFS-e sem NBS. */
const SERVICE_CODE_RULES: readonly [readonly string[], string, string][] = [
  [['0101', '0102', '0103', '0104', '0105', '0106', '0107', '0108', '0109'], '3.3.2.12', 'informática'],
  [['1701', '1714', '1716', '1719', '1720'], '3.3.2.11', 'consultoria, advocacia, auditoria e contabilidade'],
  [['1706', '2301'], '3.3.1.02', 'propaganda e programação visual'],
  [['1602', '2601'], '3.3.1.03', 'transporte e coleta de cargas'],
  [['0710', '0711', '1401', '1402', '1406'], '3.3.2.14', 'limpeza, manutenção e conservação'],
];

/** Conta pelo serviço da NFS-e de compra (NBS; sem ele, o item da LC 116), ou null. */
export function serviceAccountSuggestion(invoice: Pick<InvoiceSummary, 'direction' | 'nbs' | 'serviceCode'>): NomenclatureSuggestion | null {
  if (invoice.direction !== 'PURCHASE') return null;
  const nbs = invoice.nbs;
  if (nbs) {
    const sub = NBS_RULES.find(([codes]) => codes.includes(nbs.slice(0, 5)));
    const group = sub ?? NBS_RULES.find(([codes]) => codes.includes(nbs.slice(0, 3)));
    if (group) return { code: group[1], basis: 'nbs', reason: `NBS ${nbs.slice(0, 5)}: ${nbsLabel(nbs) ?? 'serviço'}` };
  }
  const item = (invoice.serviceCode ?? '').replace(/\D/g, '').slice(0, 4);
  const rule = item.length === 4 ? SERVICE_CODE_RULES.find(([codes]) => codes.includes(item)) : undefined;
  return rule ? { code: rule[1], basis: 'nbs', reason: `item ${item.slice(0, 2)}.${item.slice(2)} da LC 116: ${rule[2]}` } : null;
}
