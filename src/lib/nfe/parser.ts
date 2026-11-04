import type { InvoiceCfop, InvoiceInstallment } from '@/types/firestore';
import { fromCents, toCents } from '@/lib/money';

/**
 * Leitura do XML de NF-e/NFC-e e de NFS-e do padrão nacional no navegador, sem guardar o
 * arquivo: tira só o que a conciliação usa (partes, valor, data, CFOP, parcelas e IBS/CBS).
 *
 * NF-e: aceita a nota processada (`nfeProc`, com o protocolo de autorização), a nota sem
 * protocolo, o resumo da distribuição DF-e (`resNFe`, o que a SEFAZ entrega antes da
 * manifestação) e o evento de cancelamento (`procEventoNFe`, tpEvento 110111).
 *
 * NFS-e (Emissor Nacional / ADN): a nota gerada (`NFSe`/`infNFSe`, chave de 50 dígitos) e o
 * evento de cancelamento (e101101) ou de cancelamento por substituição (e105102). O leiaute
 * municipal (ABRASF) e a DPS sozinha são recusados com o motivo.
 *
 * A extração é por tag, não por DOM: os leiautes são fixos, e assim o mesmo código roda no
 * navegador e nos testes.
 */

export interface InvoiceParty {
  /** CNPJ (14) ou CPF (11), sem pontuação; vazio se ausente. */
  doc: string;
  name: string;
}

export type InvoiceSituation = 'AUTHORIZED' | 'CANCELLED' | 'DENIED' | 'UNKNOWN';

export interface ParsedInvoice {
  key: string;
  number: string;
  series: string;
  model: string;
  issueDate: string;
  /** tpNF: 0 = entrada, 1 = saída (do ponto de vista do emitente). */
  operation: 'IN' | 'OUT';
  issuer: InvoiceParty;
  /** Ausente no resumo (resNFe) e na NFC-e sem consumidor identificado. */
  recipient: InvoiceParty | null;
  /** Valor a pagar: vNF da NF-e; vLiq da NFS-e (sem as retenções). */
  total: number;
  /** Outro valor possível do pagamento (vServ da NFS-e, vNFTot da NF-e), quando difere do total. */
  altTotal?: number;
  /** IBS e CBS destacados (0 quando a nota não traz o grupo). */
  ibs: number;
  cbs: number;
  /** NFS-e: código de tributação nacional (cTribNac). */
  serviceCode?: string;
  cfops: InvoiceCfop[];
  installments: InvoiceInstallment[];
  /** Situação pelo protocolo (ou pelo resumo); UNKNOWN = XML sem protocolo de autorização. */
  situation: InvoiceSituation;
  /** Veio do resumo (resNFe): sem itens nem parcelas. */
  summaryOnly: boolean;
}

/** Modelo gravado para a NFS-e do padrão nacional. */
export const NFSE_MODEL = 'NFSE';

export type ParsedXml =
  | { kind: 'invoice'; invoice: ParsedInvoice }
  | { kind: 'cancellation'; key: string }
  | { kind: 'unknown'; reason: string };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Conteúdo do primeiro `<tag>` (com ou sem atributos), ou null. */
function section(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? m[1] : null;
}

/** Conteúdo de todos os `<tag>`. */
function sections(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);
}

/** Texto do primeiro `<tag>`, decodificado; '' se ausente. */
function text(xml: string | null, tag: string): string {
  if (!xml) return '';
  const inner = section(xml, tag);
  return inner === null ? '' : decode(inner);
}

/** Valor decimal do XML ("1234.56"), em reais com duas casas. */
function amount(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? fromCents(toCents(n)) : 0;
}

const docOf = (xml: string | null) => (text(xml, 'CNPJ') || text(xml, 'CPF')).toUpperCase().replace(/[^0-9A-Z]/g, '');

/** "2025-03-05T10:20:00-03:00" ou "2025-03-05" → "2025-03-05". */
const dateOf = (raw: string) => (/^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : '');

const KEY = /^[0-9A-Z]{44}$/;

/** cStat do protocolo: 100/150 autorizada; 101/151 cancelada; sem protocolo, desconhecida; o resto, denegada ou rejeitada. */
function situationOf(cStat: string): InvoiceSituation {
  if (!cStat) return 'UNKNOWN';
  if (cStat === '100' || cStat === '150') return 'AUTHORIZED';
  if (cStat === '101' || cStat === '151') return 'CANCELLED';
  return 'DENIED';
}

/**
 * IBS e CBS de um grupo de totais: `vIBS` (ou `vIBSTot`; sem eles, UF + município) e `vCBS`.
 * Os nomes valem para o `IBSCBSTot` da NF-e e para os totais da NFS-e.
 */
function ibsCbsOf(group: string | null): { ibs: number; cbs: number } {
  if (!group) return { ibs: 0, cbs: 0 };
  const total = text(group, 'vIBS') || text(group, 'vIBSTot');
  const ibs = total ? amount(total) : fromCents(toCents(amount(text(group, 'vIBSUF'))) + toCents(amount(text(group, 'vIBSMun'))));
  return { ibs, cbs: amount(text(group, 'vCBS')) };
}

/* =========================================================================
   NFS-e do padrão nacional
   ========================================================================= */

const NFSE_KEY = /^\d{50}$/;
/** cStat da NFS-e gerada: 100 normal, 101 substituta, 102 decisão judicial, 103 avulsa. */
const NFSE_GENERATED = ['100', '101', '102', '103'];

function parseNFSe(xml: string): ParsedXml {
  const inf = section(xml, 'infNFSe');
  if (!inf) {
    if (/<chNFSe>/.test(xml)) {
      // e101101: cancelamento; e105102: cancelamento por substituição.
      if (!/<e(?:101101|105102)(?:\s|>)/.test(xml)) {
        return { kind: 'unknown', reason: 'Evento da NFS-e que não é cancelamento: nada a importar.' };
      }
      const key = text(xml, 'chNFSe');
      if (!NFSE_KEY.test(key)) return { kind: 'unknown', reason: 'Evento de cancelamento de NFS-e sem chave de acesso válida.' };
      return { kind: 'cancellation', key };
    }
    return { kind: 'unknown', reason: 'Este XML é a DPS (a declaração enviada para gerar a nota), não a NFS-e: baixe o XML da nota gerada.' };
  }

  const key = /<infNFSe[^>]*\bId="NFS(\d{50})"/.exec(xml)?.[1];
  if (!key) return { kind: 'unknown', reason: 'NFS-e sem chave de acesso válida.' };

  const dps = section(inf, 'infDPS') ?? '';
  // Dados da nota gerada, sem a DPS (que repete grupos com o mesmo nome).
  const own = inf.replace(/<DPS(?:\s[^>]*)?>[\s\S]*?<\/DPS>/, '');
  const emit = section(own, 'emit');
  const prest = section(dps, 'prest');
  const toma = section(dps, 'toma');

  const service = amount(text(section(dps, 'vServPrest'), 'vServ'));
  const net = amount(text(section(own, 'valores'), 'vLiq')) || service;
  const tax = ibsCbsOf(section(own, 'IBSCBS') ?? section(dps, 'IBSCBS'));
  const status = text(own, 'cStat');
  const recipientDoc = docOf(toma) || text(toma, 'NIF');
  const serviceCode = text(section(dps, 'cServ'), 'cTribNac');

  return {
    kind: 'invoice',
    invoice: {
      key,
      number: text(own, 'nNFSe') || String(Number(key.slice(23, 36))),
      series: '',
      model: NFSE_MODEL,
      issueDate: dateOf(text(dps, 'dhEmi') || text(own, 'dhProc')),
      // A NFS-e é sempre do prestador para o tomador.
      operation: 'OUT',
      issuer: { doc: docOf(emit) || docOf(prest), name: text(emit, 'xNome') || text(prest, 'xNome') },
      recipient: toma && (recipientDoc || text(toma, 'xNome')) ? { doc: recipientDoc, name: text(toma, 'xNome') } : null,
      total: net,
      ...(service > net ? { altTotal: service } : {}),
      ...tax,
      ...(serviceCode ? { serviceCode } : {}),
      cfops: [],
      installments: [],
      situation: !status ? 'UNKNOWN' : NFSE_GENERATED.includes(status) ? 'AUTHORIZED' : 'UNKNOWN',
      summaryOnly: false,
    },
  };
}

/** XML de NF-e, NFC-e ou NFS-e do padrão nacional (nota, resumo ou evento de cancelamento). */
export function parseNFeXml(raw: string): ParsedXml {
  // Prefixos de namespace ("<nfe:NFe>") e a declaração não importam para a leitura por tag.
  const xml = raw.replace(/^﻿/, '').replace(/<(\/?)[A-Za-z_][\w.-]*:/g, '<$1');

  // NFS-e do padrão nacional (antes da NF-e: o evento dela também tem `infEvento`).
  if (/<(?:infNFSe|infDPS)(?:\s|>)|<chNFSe>/.test(xml)) return parseNFSe(xml);
  if (/<(?:InfNfse|CompNfse|ConsultarNfseResposta)(?:\s|>)/.test(xml)) {
    return { kind: 'unknown', reason: 'NFS-e no leiaute municipal (ABRASF): só o padrão nacional é lido. Baixe o XML no Portal da NFS-e Nacional.' };
  }

  // Evento de cancelamento (procEventoNFe ou só o evento).
  const event = section(xml, 'infEvento');
  if (event && text(event, 'tpEvento') === '110111') {
    const key = text(event, 'chNFe').toUpperCase();
    if (!KEY.test(key)) return { kind: 'unknown', reason: 'Evento de cancelamento sem chave de acesso válida.' };
    const ret = section(xml, 'retEvento');
    const status = text(ret, 'cStat');
    // Sem retorno da SEFAZ, aceita o evento; com retorno, só os registrados (135, 155).
    if (ret && status && !['135', '155'].includes(status)) {
      return { kind: 'unknown', reason: `Cancelamento não homologado pela SEFAZ (situação ${status}).` };
    }
    return { kind: 'cancellation', key };
  }
  if (event) return { kind: 'unknown', reason: 'Evento da NF-e que não é cancelamento (ex.: carta de correção ou manifestação): nada a importar.' };

  // Resumo da distribuição DF-e.
  const res = section(xml, 'resNFe');
  if (res) {
    const key = text(res, 'chNFe').toUpperCase();
    if (!KEY.test(key)) return { kind: 'unknown', reason: 'Resumo de NF-e sem chave de acesso válida.' };
    const situation = text(res, 'cSitNFe');
    return {
      kind: 'invoice',
      invoice: {
        key,
        number: String(Number(key.slice(25, 34))),
        series: String(Number(key.slice(22, 25))),
        model: key.slice(20, 22),
        issueDate: dateOf(text(res, 'dhEmi')),
        operation: text(res, 'tpNF') === '0' ? 'IN' : 'OUT',
        issuer: { doc: docOf(res), name: text(res, 'xNome') },
        recipient: null,
        total: amount(text(res, 'vNF')),
        ibs: 0,
        cbs: 0,
        cfops: [],
        installments: [],
        // cSitNFe: 1 autorizada, 2 denegada, 3 cancelada.
        situation: situation === '1' ? 'AUTHORIZED' : situation === '3' ? 'CANCELLED' : situation === '2' ? 'DENIED' : 'UNKNOWN',
        summaryOnly: true,
      },
    };
  }

  const inf = section(xml, 'infNFe');
  if (!inf) return { kind: 'unknown', reason: 'O arquivo não é XML de NF-e (falta o grupo infNFe).' };
  const idAttr = /<infNFe[^>]*\bId="NFe([0-9A-Za-z]{44})"/.exec(xml)?.[1]?.toUpperCase();
  const key = idAttr ?? text(section(xml, 'protNFe'), 'chNFe').toUpperCase();
  if (!key || !KEY.test(key)) return { kind: 'unknown', reason: 'NF-e sem chave de acesso válida.' };

  const ide = section(inf, 'ide');
  const emit = section(inf, 'emit');
  const dest = section(inf, 'dest');
  const icmsTot = section(inf, 'ICMSTot');

  const cfopCents = new Map<string, number>();
  for (const det of sections(inf, 'det')) {
    const prod = section(det, 'prod');
    const cfop = text(prod, 'CFOP');
    if (!cfop) continue;
    cfopCents.set(cfop, (cfopCents.get(cfop) ?? 0) + toCents(amount(text(prod, 'vProd'))));
  }

  const installments: InvoiceInstallment[] = [];
  for (const dup of sections(section(inf, 'cobr') ?? '', 'dup')) {
    const value = amount(text(dup, 'vDup'));
    const dueDate = dateOf(text(dup, 'dVenc'));
    if (value > 0 && dueDate) installments.push({ ...(text(dup, 'nDup') ? { number: text(dup, 'nDup') } : {}), dueDate, amount: value });
  }

  const prot = section(xml, 'protNFe');
  const protStatus = text(prot, 'cStat');
  const recipientDoc = docOf(dest) || text(dest, 'idEstrangeiro');
  const totals = section(inf, 'total');
  const total = amount(text(icmsTot, 'vNF'));
  // Reforma tributária: IBS/CBS destacados e o total com eles (vNFTot), quando a nota traz.
  const tax = ibsCbsOf(section(totals ?? '', 'IBSCBSTot'));
  const withTaxes = amount(text(totals, 'vNFTot'));

  return {
    kind: 'invoice',
    invoice: {
      key,
      number: text(ide, 'nNF'),
      series: text(ide, 'serie'),
      model: text(ide, 'mod') || key.slice(20, 22),
      issueDate: dateOf(text(ide, 'dhEmi') || text(ide, 'dEmi')),
      operation: text(ide, 'tpNF') === '0' ? 'IN' : 'OUT',
      issuer: { doc: docOf(emit), name: text(emit, 'xNome') },
      recipient: dest && (recipientDoc || text(dest, 'xNome')) ? { doc: recipientDoc, name: text(dest, 'xNome') } : null,
      total,
      ...(withTaxes > total ? { altTotal: withTaxes } : {}),
      ...tax,
      cfops: [...cfopCents].map(([cfop, cents]) => ({ cfop, amount: fromCents(cents) })).sort((a, b) => b.amount - a.amount),
      installments,
      situation: situationOf(protStatus),
      summaryOnly: false,
    },
  };
}
