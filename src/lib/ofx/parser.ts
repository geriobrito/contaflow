import { OFXParseResult, OFXRawTransaction, OFXAccountInfo } from './types';
import { decodeOFXBytes, repairMojibake } from './encoding';

import { isISODate } from '@/lib/periods';

/**
 * Normaliza qualquer data vinda do OFX para YYYY-MM-DD, ou `null` se não for uma data real.
 *
 * Aceita o padrão OFX (`20250329`, `20250329120000`, `20250329120000.000[-3:BRT]`),
 * ISO (`2025-03-29`, `2025-03-29T10:00:00`) e o formato brasileiro que alguns bancos
 * (ex.: PagBank/PagSeguro) enviam fora do padrão (`29/03/2025`, `29/03/2025 10:00`).
 *
 * Nunca devolve "hoje" como fallback: uma data inventada lançaria o movimento na
 * competência errada sem ninguém perceber. Quem chama decide o que fazer com `null`.
 */
export function normalizeOFXDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\[[^\]]*\]/g, '').trim();
  let parts: RegExpMatchArray | null;
  let y: string, m: string, d: string;
  if ((parts = cleaned.match(/^(\d{4})(\d{2})(\d{2})/))) [, y, m, d] = parts;
  else if ((parts = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/))) [, y, m, d] = parts;
  else if ((parts = cleaned.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?!\d)/))) [, d, m, y] = parts;
  else return null;
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return isISODate(iso) ? iso : null;
}

/**
 * Normaliza um valor monetário do OFX, ou `null` se não houver número.
 *
 * - Remove moeda e texto (`R$ 3.327,70`, `BRL -10.00`) e espaços.
 * - Sinal: `-10`, `10-` ou `(10,00)`.
 * - Separador decimal: o último entre vírgula e ponto quando há os dois (`1.250,50`,
 *   `1,250.50`); vírgula sozinha é decimal (`-802,66`); ponto sozinho é decimal, como
 *   manda o padrão OFX (`-802.66`), exceto em valores com `R$` no formato brasileiro de
 *   milhar sem centavos (`R$ 3.327`). Vários separadores iguais são de milhar.
 */
export function normalizeOFXAmount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = raw.trim();
  const negative = /^\(.*\)$/.test(text) || /-/.test(text);
  let digits = text.replace(/[^\d.,]/g, '');
  if (!/\d/.test(digits)) return null;

  const commas = (digits.match(/,/g) ?? []).length;
  const dots = (digits.match(/\./g) ?? []).length;
  if (commas && dots) {
    const decimal = digits.lastIndexOf(',') > digits.lastIndexOf('.') ? ',' : '.';
    const thousands = decimal === ',' ? /\./g : /,/g;
    digits = digits.replace(thousands, '').replace(decimal, '.');
  } else if (commas) {
    digits = commas > 1 ? digits.replace(/,/g, '') : digits.replace(',', '.');
  } else if (dots > 1 || (dots === 1 && /R\$/i.test(text) && /\.\d{3}$/.test(digits))) {
    digits = digits.replace(/\./g, '');
  }

  const value = Number.parseFloat(digits);
  if (!Number.isFinite(value)) return null;
  const cents = Math.round(value * 100) / 100;
  return negative ? -cents : cents;
}

/** @deprecated use `normalizeOFXDate` (devolve '' quando a data é inválida). */
export const parseOFXDate = (dateStr: string): string => normalizeOFXDate(dateStr) ?? '';

/** @deprecated use `normalizeOFXAmount` (devolve 0 quando não há número). */
export const parseOFXAmount = (amountStr: string): number => normalizeOFXAmount(amountStr) ?? 0;

/** Hash FNV-1a (32 bits) em base 36 — curto, estável e sem dependências. */
function hashString(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Limpeza e normalização do MEMO / Descrição da transação
 */
export function cleanOFXMemo(memoStr: string): string {
  if (!memoStr) return 'LANÇAMENTO SEM DESCRIÇÃO';
  const cleaned = memoStr
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  // Rede de segurança: texto que já chega com UTF-8 lido como Latin-1 ("transferÃªncia").
  return repairMojibake(cleaned) || 'LANÇAMENTO';
}

/**
 * Descrição do lançamento a partir de NAME (quem pagou/recebeu) e MEMO (o que foi).
 *
 * Alguns bancos (ex.: InfinitePay) mandam o favorecido em NAME e só um rótulo genérico em
 * MEMO ("Enviado", "Recebido", "Depósito InfinitePay"); usar só o MEMO deixa dezenas de
 * lançamentos iguais na tela. Se um texto contém o outro, vale o mais completo; senão,
 * "NAME - MEMO" (favorecido primeiro, que é o que identifica o lançamento).
 */
export function describeTransaction(rawName?: string, rawMemo?: string): string {
  const name = rawName?.trim() ? cleanOFXMemo(rawName) : '';
  const memo = rawMemo?.trim() ? cleanOFXMemo(rawMemo) : '';
  if (!name) return memo;
  if (!memo) return name;
  const a = name.toLowerCase();
  const b = memo.toLowerCase();
  if (a === b || a.includes(b)) return name;
  if (b.includes(a)) return memo;
  return `${name} - ${memo}`;
}

/**
 * Parser de OFX de alta performance e compatível tanto com Node.js quanto com Navegador (Client-side)
 * Suporta OFX 1.x (SGML) e OFX 2.x (XML) de bancos como Itaú, Bradesco, Santander, BB, Nubank, Inter, etc.
 */
export function parseOFXString(rawContent: string): OFXParseResult {
  const warnings: string[] = [];
  const rawHeader: Record<string, string> = {};

  if (!rawContent || rawContent.trim().length === 0) {
    return {
      account: {},
      transactions: [],
      rawHeader: {},
      encoding: 'UTF-8',
      hasErrors: true,
      warnings: ['Arquivo OFX vazio ou ilegível.'],
    };
  }

  // 1. Separar cabeçalho do corpo do OFX
  let headerPart = '';
  let bodyPart = '';

  const ofxTagIndex = rawContent.indexOf('<OFX>');
  if (ofxTagIndex !== -1) {
    headerPart = rawContent.substring(0, ofxTagIndex);
    bodyPart = rawContent.substring(ofxTagIndex);
  } else {
    // Alguns arquivos podem estar em lowercase <ofx>
    const ofxTagLower = rawContent.toLowerCase().indexOf('<ofx>');
    if (ofxTagLower !== -1) {
      headerPart = rawContent.substring(0, ofxTagLower);
      bodyPart = rawContent.substring(ofxTagLower);
    } else {
      bodyPart = rawContent;
    }
  }

  // 2. Extrair cabeçalhos (OFXHEADER:100, ENCODING:UTF-8, etc.)
  const headerLines = headerPart.split(/\r?\n/);
  for (const line of headerLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      const key = line.substring(0, colonIdx).trim().toUpperCase();
      const val = line.substring(colonIdx + 1).trim();
      if (key) rawHeader[key] = val;
    }
  }

  const encoding = rawHeader['ENCODING'] || rawHeader['CHARSET'] || 'UTF-8';

  // 3. Extrair dados bancários da conta
  const account: OFXAccountInfo = {};
  
  const bankIdMatch = bodyPart.match(/<BANKID>([^<\r\n]+)/i);
  if (bankIdMatch) account.bankId = bankIdMatch[1].trim();

  const branchIdMatch = bodyPart.match(/<BRANCHID>([^<\r\n]+)/i);
  if (branchIdMatch) account.branchId = branchIdMatch[1].trim();

  const acctIdMatch = bodyPart.match(/<ACCTID>([^<\r\n]+)/i);
  if (acctIdMatch) account.accountId = acctIdMatch[1].trim();

  const acctTypeMatch = bodyPart.match(/<ACCTTYPE>([^<\r\n]+)/i);
  if (acctTypeMatch) account.accountType = acctTypeMatch[1].trim();

  const orgMatch = bodyPart.match(/<ORG>([^<\r\n]+)/i);
  if (orgMatch) account.org = orgMatch[1].trim();

  const fidMatch = bodyPart.match(/<FID>([^<\r\n]+)/i);
  if (fidMatch) account.fid = fidMatch[1].trim();

  // 4. Período do extrato (DTSTART / DTEND)
  /** Data de cabeçalho: inválida vira `undefined` com aviso, sem derrubar a importação. */
  const headerDate = (source: string, tag: string): string | undefined => {
    const raw = source.match(new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i'))?.[1]?.trim();
    if (!raw) return undefined;
    const date = normalizeOFXDate(raw);
    if (!date) warnings.push(`Data ${tag} inválida no arquivo (“${raw}”); ignorada.`);
    return date ?? undefined;
  };
  const startDate = headerDate(bodyPart, 'DTSTART');
  const endDate = headerDate(bodyPart, 'DTEND');

  // 5. Saldo final (LEDGERBAL). Procura dentro do bloco LEDGERBAL para não confundir com AVAILBAL.
  let ledgerBalance: { amount: number; date?: string } | undefined;
  const ledgerBlock = bodyPart.match(/<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|$)/i)?.[1] ?? bodyPart;
  const rawBalance = ledgerBlock.match(/<BALAMT>([^<\r\n]+)/i)?.[1]?.trim();
  if (rawBalance) {
    const amount = normalizeOFXAmount(rawBalance);
    if (amount === null) warnings.push(`Saldo final inválido no arquivo (“${rawBalance}”); conferência de saldo ignorada.`);
    else ledgerBalance = { amount, date: headerDate(ledgerBlock, 'DTASOF') };
  }

  // 6. Extração das transações (<STMTTRN>...</STMTTRN>)
  // Tratamos tanto tags fechadas </STMTTRN> quanto separação por abertura
  const transactions: OFXRawTransaction[] = [];
  /** Ocorrências por base de FITID sintético (lançamentos idênticos no mesmo arquivo). */
  const generatedIds = new Map<string, number>();
  let skipped = 0;
  const stmtTrnRegex = /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>|<\/BANKTRANLIST>))/gi;
  let match: RegExpExecArray | null;

  while ((match = stmtTrnRegex.exec(bodyPart)) !== null) {
    const trnBlock = match[1];

    // Tipo (DEBIT / CREDIT / OTHER)
    const typeMatch = trnBlock.match(/<TRNTYPE>([^<\r\n]+)/i);
    const rawType = (typeMatch ? typeMatch[1].trim().toUpperCase() : 'OTHER');
    let type: 'DEBIT' | 'CREDIT' | 'OTHER' = 'OTHER';
    if (rawType.includes('DEBIT') || rawType === 'POS' || rawType === 'PAYMENT' || rawType === 'FEE') {
      type = 'DEBIT';
    } else if (rawType.includes('CREDIT') || rawType === 'DEP') {
      type = 'CREDIT';
    }

    // Data da postagem
    const dtPostedMatch = trnBlock.match(/<DTPOSTED>([^<\r\n]+)/i);
    const rawDate = dtPostedMatch ? dtPostedMatch[1].trim() : '';
    const date = normalizeOFXDate(rawDate);

    // Valor da transação
    const trnAmtMatch = trnBlock.match(/<TRNAMT>([^<\r\n]+)/i);
    const rawAmount = trnAmtMatch ? trnAmtMatch[1].trim() : '';
    const amount = normalizeOFXAmount(rawAmount);

    // Sem data ou valor legível o lançamento não pode ser contabilizado: descarta com aviso
    // (em vez de inventar uma data e jogá-lo na competência errada).
    if (!date || amount === null) {
      const memoHint = cleanOFXMemo((trnBlock.match(/<MEMO>([^<\r\n]+)/i) ?? trnBlock.match(/<NAME>([^<\r\n]+)/i))?.[1] ?? '');
      warnings.push(
        `Lançamento “${memoHint}” ignorado: ${!date ? `data inválida (“${rawDate || 'vazia'}”)` : `valor inválido (“${rawAmount || 'vazio'}”)`}.`
      );
      skipped += 1;
      continue;
    }

    // Se o valor for negativo, é débito; se for positivo, é crédito (padronização bancária)
    if (amount < 0 && type === 'OTHER') {
      type = 'DEBIT';
    } else if (amount > 0 && type === 'OTHER') {
      type = 'CREDIT';
    }

    // FITID (Identificador Único obrigatório para evitar duplicações)
    const fitidMatch = trnBlock.match(/<FITID>([^<\r\n]+)/i);
    let fitid = fitidMatch ? fitidMatch[1].trim() : '';

    // Sem FITID do banco: ID determinístico (data + valor + histórico + ocorrência), para que
    // reimportar o mesmo arquivo não duplique lançamentos.
    if (!fitid) {
      const rawMemoForId = (trnBlock.match(/<MEMO>([^<\r\n]+)/i) ?? trnBlock.match(/<NAME>([^<\r\n]+)/i))?.[1] ?? '';
      const base = `GEN_${rawDate || date}_${amount.toFixed(2)}_${hashString(cleanOFXMemo(rawMemoForId))}`;
      const occurrence = (generatedIds.get(base) ?? 0) + 1;
      generatedIds.set(base, occurrence);
      fitid = `${base}_${occurrence}`;
      warnings.push(`Transação sem FITID identificada na data ${date}. FITID sintético gerado.`);
    }

    // MEMO ou NAME (descrição do lançamento)
    const memoMatch = trnBlock.match(/<MEMO>([^<\r\n]+)/i);
    const nameMatch = trnBlock.match(/<NAME>([^<\r\n]+)/i);
    const memo = cleanOFXMemo(describeTransaction(nameMatch?.[1], memoMatch?.[1]));

    // Check number / Documento
    const checkNumMatch = trnBlock.match(/<CHECKNUM>([^<\r\n]+)/i);
    const checkNum = checkNumMatch ? checkNumMatch[1].trim() : undefined;

    // Ref number
    const refNumMatch = trnBlock.match(/<REFNUM>([^<\r\n]+)/i);
    const refNum = refNumMatch ? refNumMatch[1].trim() : undefined;

    transactions.push({
      fitid,
      type,
      date,
      rawDate,
      amount,
      memo,
      checkNum,
      refNum,
    });
  }

  // Ordenar transações por data crescente
  transactions.sort((a, b) => a.date.localeCompare(b.date));

  return {
    account,
    startDate,
    endDate,
    ledgerBalance,
    transactions,
    rawHeader,
    encoding,
    // Erro só quando havia lançamentos e nenhum pôde ser lido.
    hasErrors: transactions.length === 0 && skipped > 0,
    warnings,
  };
}

/**
 * Helper client-side para ler um arquivo File do input HTML / Drag & Drop
 * Detecta automaticamente codificação (UTF-8 ou ISO-8859-1 comum em bancos legados)
 */
export async function parseOFXFile(file: File): Promise<OFXParseResult> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new Error('Erro ao ler arquivo OFX do disco.');
  }
  // UTF-8 (Nubank, PagBank…) ou Windows-1252 (bancos antigos), detectado pelo conteúdo.
  const { text, encoding } = decodeOFXBytes(bytes);
  // `encoding` informa como o arquivo foi realmente lido (o cabeçalho OFX costuma mentir).
  return { ...parseOFXString(text), encoding };
}
