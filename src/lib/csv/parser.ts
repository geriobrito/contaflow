import type { OFXAccountInfo, OFXParseResult, OFXRawTransaction } from '@/lib/ofx/types';
import { decodeOFXBytes } from '@/lib/ofx/encoding';

/* =========================================================================
   Tipos do Parser CSV
   ========================================================================= */

export type CSVDelimiter = ';' | ',' | '\t' | '|';

export interface CSVColumnMapping {
  /** Índice da coluna da data (0-based) */
  dateCol: number;
  /** Índice da coluna do histórico / descrição (0-based) */
  memoCol: number;
  /** Modo de leitura do valor: coluna única com sinal ou colunas separadas (débito/crédito) */
  valueMode: 'single' | 'split';
  /** Índice da coluna de valor único (quando valueMode === 'single') */
  amountCol?: number;
  /** Índice da coluna de saída/débito (quando valueMode === 'split') */
  debitCol?: number;
  /** Índice da coluna de entrada/crédito (quando valueMode === 'split') */
  creditCol?: number;
  /** Índice da coluna de documento / identificador (opcional) */
  docCol?: number;
  /** Inverter sinal (+/-): útil para faturas de cartão onde compras vêm positivas */
  invertSigns?: boolean;
  /** Se a primeira linha é cabeçalho */
  hasHeader: boolean;
}

export interface CSVPreview {
  delimiter: CSVDelimiter;
  headers: string[];
  previewRows: string[][];
  totalRows: number;
  guessedMapping: CSVColumnMapping;
}

export interface ParseCSVOptions {
  content: string;
  mapping: CSVColumnMapping;
  clientId: string;
  accountKey: string;
  bankAccountInfo?: OFXAccountInfo;
  delimiter?: CSVDelimiter;
}

/* =========================================================================
   Hash Determinístico para FITID
   ========================================================================= */

function simpleHash(str: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c64e6d;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(12, '0');
}

export function generateCSVFitid(
  clientId: string,
  accountKey: string,
  date: string,
  amount: number,
  memo: string,
  rowIdx: number
): string {
  const normMemo = memo.trim().toLowerCase().replace(/\s+/g, ' ');
  const rawKey = `${clientId}|${accountKey}|${date}|${amount.toFixed(2)}|${normMemo}|${rowIdx}`;
  return `CSV_${simpleHash(rawKey)}`;
}

/* =========================================================================
   Sniffer e Parser RFC 4180
   ========================================================================= */

/**
 * Detecta o delimitador mais provável analisando as primeiras linhas de texto.
 */
export function detectCSVDelimiter(text: string): CSVDelimiter {
  const candidates: CSVDelimiter[] = [';', ',', '\t', '|'];
  const firstLines = text.split(/\r?\n/).slice(0, 10).filter((l) => l.trim().length > 0);
  if (firstLines.length === 0) return ';';

  let bestDelimiter: CSVDelimiter = ';';
  let bestScore = -1;

  for (const delim of candidates) {
    let countInFirst = -1;
    let consistent = true;
    let totalCount = 0;

    for (const line of firstLines) {
      let count = 0;
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') inQuote = !inQuote;
        else if (c === delim && !inQuote) count++;
      }

      totalCount += count;
      if (countInFirst === -1) {
        countInFirst = count;
      } else if (count !== countInFirst) {
        consistent = false;
      }
    }

    if (totalCount > 0) {
      const score = (consistent ? 100 : 10) * countInFirst + totalCount;
      if (score > bestScore) {
        bestScore = score;
        bestDelimiter = delim;
      }
    }
  }

  return bestDelimiter;
}

/**
 * Divide o texto do CSV em matriz de strings, respeitando aspas e quebras de linha em células.
 */
export function parseCSVRows(text: string, delimiter: CSVDelimiter): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        i++; // pula aspas escapadas
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++; // pula \r\n
      }
      currentRow.push(currentCell.trim());
      currentCell = '';
      if (currentRow.some((c) => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentCell += char;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((c) => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/* =========================================================================
   Parsers Auxiliares de Dados (Data e Dinheiro)
   ========================================================================= */

/**
 * Converte strings de datas de formatos brasileiros (DD/MM/AAAA, DD-MM-AAAA)
 * ou ISO (AAAA-MM-DD, AAAAMMDD) para o padrão canônico ISO YYYY-MM-DD.
 */
export function parseBrazilianOrISODate(raw: string): string | null {
  if (!raw) return null;
  const clean = raw.trim().replace(/^['"]|['"]$/g, '');

  // 1) ISO: YYYY-MM-DD
  const isoMatch = clean.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // 2) Compacto: YYYYMMDD
  const compactMatch = clean.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactMatch) {
    const [, y, m, d] = compactMatch;
    return `${y}-${m}-${d}`;
  }

  // 3) BR: DD/MM/YYYY ou DD-MM-YYYY
  const brMatch = clean.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (brMatch) {
    const [, d, m, yRaw] = brMatch;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return null;
}

/**
 * Converte valor em formato string para número flutuante com sinal.
 * Trata:
 * - Padrão brasileiro: "1.234,56", "-1.234,56", "1.234,56 D", "1.234,56 C"
 * - Padrão internacional: "1,234.56", "-1234.56"
 * - Parênteses para valores negativos: "(1.234,56)"
 * - Moeda: "R$ 1.500,00"
 */
export function parseMoney(raw: string): number | null {
  if (!raw) return null;
  let str = raw.trim();
  if (!str) return null;

  // Checa indicador D/C no final ou início
  let isDebitSuffix = false;
  let isCreditSuffix = false;
  if (/\s*[Dd]$/.test(str) || /^[Dd]\s*/.test(str)) {
    isDebitSuffix = true;
    str = str.replace(/[Dd]/g, '').trim();
  } else if (/\s*[Cc]$/.test(str) || /^[Cc]\s*/.test(str)) {
    isCreditSuffix = true;
    str = str.replace(/[Cc]/g, '').trim();
  }

  // Checa parênteses como negativo: (100,00)
  let isParenthesesNegative = false;
  if (/^\(.*\)$/.test(str)) {
    isParenthesesNegative = true;
    str = str.slice(1, -1).trim();
  }

  // Remove símbolo de moeda e espaços extras
  str = str.replace(/[R$\s]/g, '').trim();
  if (!str) return null;

  let isNegative = str.startsWith('-') || isParenthesesNegative || isDebitSuffix;
  if (isCreditSuffix) isNegative = false;
  str = str.replace(/^[+-]/, '');

  // Decide se vírgula é decimal ou milhar
  const hasComma = str.includes(',');
  const hasDot = str.includes('.');

  if (hasComma && hasDot) {
    if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
      // 1.234.567,89 (padrão brasileiro)
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      // 1,234,567.89 (padrão americano)
      str = str.replace(/,/g, '');
    }
  } else if (hasComma) {
    // 1234,56
    str = str.replace(',', '.');
  }

  const normalizedNumber = parseFloat(str);
  if (isNaN(normalizedNumber)) return null;

  return isNegative ? -Math.abs(normalizedNumber) : Math.abs(normalizedNumber);
}

/* =========================================================================
   Adivinhação Inteligente de Colunas
   ========================================================================= */

const DATE_KEYWORDS = ['data', 'date', 'dt', 'dt_mov', 'dt_lancamento', 'dia', 'lançado em'];
const MEMO_KEYWORDS = [
  'historico',
  'histórico',
  'descricao',
  'descrição',
  'memo',
  'description',
  'detalhe',
  'detalhes',
  'lancamento',
  'lançamento',
  'transacao',
  'transação',
  'favorecido',
  'estabelecimento',
];
const AMOUNT_KEYWORDS = ['valor', 'amount', 'vl_movimento', 'vl_lancamento', 'saldo'];
const DEBIT_KEYWORDS = ['debito', 'débito', 'saida', 'saída', 'debit', 'pago', 'despesa'];
const CREDIT_KEYWORDS = ['credito', 'crédito', 'entrada', 'credit', 'recebido', 'receita'];
const DOC_KEYWORDS = ['documento', 'doc', 'num_doc', 'fitid', 'id', 'referencia', 'referência', 'autenticacao'];

export function guessCSVColumns(headers: string[], firstDataRow?: string[]): CSVColumnMapping {
  let dateCol = -1;
  let memoCol = -1;
  let amountCol = -1;
  let debitCol = -1;
  let creditCol = -1;
  let docCol = -1;

  const normHeaders = headers.map((h) => h.toLowerCase().trim());

  // 1. Procura coluna de Data
  for (let i = 0; i < normHeaders.length; i++) {
    const h = normHeaders[i];
    if (dateCol === -1 && DATE_KEYWORDS.some((k) => h === k || h.includes(k))) {
      dateCol = i;
      break;
    }
  }

  // 2. Procura coluna de Histórico/Descrição (diferente da data)
  for (let i = 0; i < normHeaders.length; i++) {
    if (i === dateCol) continue;
    const h = normHeaders[i];
    if (memoCol === -1 && MEMO_KEYWORDS.some((k) => h === k || h.includes(k))) {
      memoCol = i;
      break;
    }
  }

  // 3. Procura colunas de Valor / Débito / Crédito
  for (let i = 0; i < normHeaders.length; i++) {
    if (i === dateCol || i === memoCol) continue;
    const h = normHeaders[i];
    if (debitCol === -1 && DEBIT_KEYWORDS.some((k) => h === k || h.includes(k))) debitCol = i;
    else if (creditCol === -1 && CREDIT_KEYWORDS.some((k) => h === k || h.includes(k))) creditCol = i;
    else if (amountCol === -1 && AMOUNT_KEYWORDS.some((k) => h === k || h.includes(k))) amountCol = i;
  }

  // 4. Procura coluna de Documento
  for (let i = 0; i < normHeaders.length; i++) {
    if (i === dateCol || i === memoCol || i === amountCol || i === debitCol || i === creditCol) continue;
    const h = normHeaders[i];
    if (docCol === -1 && DOC_KEYWORDS.some((k) => h === k || h.includes(k))) docCol = i;
  }

  // Se não achou pelos cabeçalhos, analisa a primeira linha de dados
  if (firstDataRow && firstDataRow.length > 0) {
    for (let i = 0; i < firstDataRow.length; i++) {
      const val = firstDataRow[i];
      if (dateCol === -1 && parseBrazilianOrISODate(val) !== null) {
        dateCol = i;
      } else if (amountCol === -1 && parseMoney(val) !== null && i !== dateCol) {
        amountCol = i;
      }
    }
    if (memoCol === -1) {
      for (let i = 0; i < firstDataRow.length; i++) {
        if (i !== dateCol && i !== amountCol && i !== debitCol && i !== creditCol) {
          memoCol = i;
          break;
        }
      }
    }
  }

  // Fallback padrão se nada for encontrado
  if (dateCol === -1) dateCol = 0;
  if (memoCol === -1) memoCol = Math.min(1, headers.length - 1);
  if (amountCol === -1 && debitCol === -1) amountCol = Math.min(2, headers.length - 1);

  const valueMode = debitCol !== -1 && creditCol !== -1 ? 'split' : 'single';

  return {
    dateCol,
    memoCol,
    valueMode,
    amountCol: valueMode === 'single' ? (amountCol !== -1 ? amountCol : 2) : undefined,
    debitCol: valueMode === 'split' ? debitCol : undefined,
    creditCol: valueMode === 'split' ? creditCol : undefined,
    docCol: docCol !== -1 ? docCol : undefined,
    invertSigns: false,
    hasHeader: true,
  };
}

/* =========================================================================
   Geração de Preview
   ========================================================================= */

export function previewCSV(content: string, customDelimiter?: CSVDelimiter): CSVPreview {
  const delimiter = customDelimiter || detectCSVDelimiter(content);
  const rows = parseCSVRows(content, delimiter);

  if (rows.length === 0) {
    return {
      delimiter,
      headers: [],
      previewRows: [],
      totalRows: 0,
      guessedMapping: {
        dateCol: 0,
        memoCol: 1,
        valueMode: 'single',
        amountCol: 2,
        hasHeader: true,
      },
    };
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);
  const guessedMapping = guessCSVColumns(headers, dataRows[0]);

  return {
    delimiter,
    headers,
    previewRows: rows.slice(0, 6),
    totalRows: rows.length,
    guessedMapping,
  };
}

/* =========================================================================
   Execução do Parse para OFXParseResult
   ========================================================================= */

export function parseCSVToOFXResult({
  content,
  mapping,
  clientId,
  accountKey,
  bankAccountInfo,
  delimiter: customDelim,
}: ParseCSVOptions): OFXParseResult {
  const delimiter = customDelim || detectCSVDelimiter(content);
  const allRows = parseCSVRows(content, delimiter);
  const rows = mapping.hasHeader ? allRows.slice(1) : allRows;

  const transactions: OFXRawTransaction[] = [];
  const warnings: string[] = [];
  let startDate: string | undefined;
  let endDate: string | undefined;

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    if (row.length === 0 || row.every((c) => c.trim().length === 0)) continue;

    // 1. Data
    const rawDate = row[mapping.dateCol] ?? '';
    const date = parseBrazilianOrISODate(rawDate);
    if (!date) {
      warnings.push(`Linha #${idx + (mapping.hasHeader ? 2 : 1)} ignorada: data inválida (“${rawDate}”).`);
      continue;
    }

    // 2. Histórico
    const memo = row[mapping.memoCol]?.trim() || 'Lançamento sem descrição';

    // 3. Valor
    let amount: number | null = null;
    if (mapping.valueMode === 'single') {
      const col = mapping.amountCol ?? 2;
      amount = parseMoney(row[col] ?? '');
    } else {
      const debitRaw = mapping.debitCol !== undefined ? row[mapping.debitCol] : '';
      const creditRaw = mapping.creditCol !== undefined ? row[mapping.creditCol] : '';
      const debitVal = debitRaw ? parseMoney(debitRaw) : null;
      const creditVal = creditRaw ? parseMoney(creditRaw) : null;

      if (debitVal && Math.abs(debitVal) > 0) {
        amount = -Math.abs(debitVal);
      } else if (creditVal && Math.abs(creditVal) > 0) {
        amount = Math.abs(creditVal);
      }
    }

    if (amount === null || isNaN(amount)) {
      warnings.push(`Linha #${idx + (mapping.hasHeader ? 2 : 1)} ignorada: valor ausente ou inválido.`);
      continue;
    }

    // 4. Inversão de sinal (ex: fatura de cartão de crédito)
    if (mapping.invertSigns) {
      amount = -amount;
    }

    // 5. Documento / FITID
    const doc = mapping.docCol !== undefined ? row[mapping.docCol]?.trim() : undefined;
    const fitid = doc || generateCSVFitid(clientId, accountKey, date, amount, memo, idx);

    // 6. Atualização de intervalo
    if (!startDate || date < startDate) startDate = date;
    if (!endDate || date > endDate) endDate = date;

    transactions.push({
      fitid,
      date,
      rawDate,
      amount,
      type: amount >= 0 ? 'CREDIT' : 'DEBIT',
      memo,
      checkNum: doc,
    });
  }

  // Ordena cronologicamente
  transactions.sort((a, b) => a.date.localeCompare(b.date));

  return {
    account: bankAccountInfo || {
      accountId: accountKey,
    },
    startDate,
    endDate,
    transactions,
    rawHeader: {
      FORMAT: 'CSV',
      DELIMITER: delimiter,
    },
    encoding: 'utf-8',
    hasErrors: transactions.length === 0 && warnings.length > 0,
    warnings,
  };
}

/**
 * Lê um arquivo File (browser), decodifica seu conteúdo e executa o preview ou parse.
 */
export async function readCSVFileContent(file: File): Promise<{ text: string; encoding: string }> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  return decodeOFXBytes(bytes);
}
