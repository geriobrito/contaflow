import type { InvoiceSummary, InvoiceTaxItem } from '@/types/firestore';
import { CCLASSTRIB_ROWS, CCLASSTRIB_SOURCE, IBS_CBS_CST } from '@/lib/nfe/cclasstrib-table';
import { toCents } from '@/lib/money';

/**
 * Classificação tributária do IBS/CBS (cClassTrib) pela tabela oficial, gerada do repositório da
 * Receita Federal (`scripts/update-cclasstrib.py`). Diz, por classificação, se quem compra pode
 * apropriar o crédito da CBS e do IBS destacados e se há crédito presumido para ele.
 */

export interface CClassTrib {
  code: string;
  /** CST do IBS/CBS (os três primeiros dígitos do cClassTrib). */
  cst: string;
  description: string;
  /** O adquirente apropria o crédito da CBS / do IBS destacado; null: a tabela não informa. */
  creditCbs: boolean | null;
  creditIbs: boolean | null;
  /** Dá crédito presumido ao adquirente (apurado à parte, fora do destaque). */
  presumedCredit: boolean | null;
  rateType: string;
  from: string;
  until: string | null;
}

export { CCLASSTRIB_SOURCE, IBS_CBS_CST };

const BY_CODE = new Map<string, CClassTrib[]>();
for (const [code, cst, description, creditCbs, creditIbs, presumedCredit, rateType, from, until] of CCLASSTRIB_ROWS) {
  const list = BY_CODE.get(code) ?? [];
  list.push({ code, cst, description, creditCbs, creditIbs, presumedCredit, rateType, from, until });
  BY_CODE.set(code, list);
}

/** A classificação existe na tabela (em qualquer vigência). */
export const isKnownCClassTrib = (code: string): boolean => BY_CODE.has(code);

/**
 * Classificação vigente na data (YYYY-MM-DD). Fora de qualquer vigência, null; sem data, a mais
 * recente.
 */
export function findCClassTrib(code: string, date?: string): CClassTrib | null {
  const list = BY_CODE.get(code);
  if (!list) return null;
  if (!date) return list[list.length - 1];
  return list.find((c) => c.from <= date && (!c.until || c.until >= date)) ?? null;
}

/** Texto curto da classificação: "000001 · Situações tributadas integralmente pelo IBS e CBS." */
export const describeCClassTrib = (code: string, date?: string): string => {
  const c = findCClassTrib(code, date) ?? findCClassTrib(code);
  return c ? `${code} · ${c.description}` : code;
};

export type TaxItemIssueKind = 'unknown' | 'out-of-term' | 'cst-mismatch' | 'no-credit' | 'presumed-credit';

export interface TaxItemIssue {
  kind: TaxItemIssueKind;
  cClassTrib: string;
  message: string;
}

/**
 * Conferência das classificações da nota contra a tabela oficial: código inexistente, fora da
 * vigência na data de emissão, CST que não confere com o cClassTrib e, na compra, as que não dão
 * crédito ao adquirente ou dão crédito presumido.
 */
export function taxItemIssues(invoice: Pick<InvoiceSummary, 'issueDate' | 'direction' | 'ibsCbsItems'>): TaxItemIssue[] {
  const out: TaxItemIssue[] = [];
  const seen = new Set<string>();
  for (const item of invoice.ibsCbsItems ?? []) {
    const code = item.cClassTrib;
    if (seen.has(code)) continue;
    seen.add(code);
    if (!isKnownCClassTrib(code)) {
      out.push({ kind: 'unknown', cClassTrib: code, message: `cClassTrib ${code} não está na tabela oficial (base ${CCLASSTRIB_SOURCE.dbVersion}).` });
      continue;
    }
    const current = findCClassTrib(code, invoice.issueDate);
    if (!current) {
      out.push({ kind: 'out-of-term', cClassTrib: code, message: `cClassTrib ${code} fora da vigência em ${invoice.issueDate.split('-').reverse().join('/')}.` });
      continue;
    }
    if (item.cst && item.cst !== current.cst) {
      out.push({ kind: 'cst-mismatch', cClassTrib: code, message: `CST ${item.cst} não confere com o cClassTrib ${code} (CST ${current.cst}).` });
    }
    if (invoice.direction !== 'PURCHASE') continue;
    if (current.creditCbs === false && current.creditIbs === false && (item.ibs > 0 || item.cbs > 0)) {
      out.push({ kind: 'no-credit', cClassTrib: code, message: `${describeCClassTrib(code, invoice.issueDate)}: não dá crédito ao adquirente.` });
    }
    if (current.presumedCredit) {
      out.push({ kind: 'presumed-credit', cClassTrib: code, message: `${describeCClassTrib(code, invoice.issueDate)}: dá crédito presumido ao adquirente, apurado à parte.` });
    }
  }
  return out;
}

/**
 * Destaque sem direito a crédito, pela classificação de cada item (em centavos). Classificação
 * desconhecida, fora de vigência ou sem o indicador fica como creditável: a conferência avisa.
 */
export function blockedCreditCents(items: readonly InvoiceTaxItem[], issueDate: string): { ibs: number; cbs: number } {
  let ibs = 0;
  let cbs = 0;
  for (const item of items) {
    const c = findCClassTrib(item.cClassTrib, issueDate);
    if (!c) continue;
    if (c.creditIbs === false) ibs += toCents(item.ibs);
    if (c.creditCbs === false) cbs += toCents(item.cbs);
  }
  return { ibs, cbs };
}
