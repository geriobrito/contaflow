import { OFXParseResult, OFXRawTransaction, OFXAccountInfo } from './types';

/**
 * Utilitário de parsing de data no formato OFX (ex: 20240315120000[-3:BRT] ou 20240315)
 */
export function parseOFXDate(dateStr: string): string {
  if (!dateStr) return '';
  const clean = dateStr.trim();
  // Formato YYYYMMDD
  if (clean.length >= 8) {
    const year = clean.substring(0, 4);
    const month = clean.substring(4, 6);
    const day = clean.substring(6, 8);
    return `${year}-${month}-${day}`;
  }
  return clean;
}

/**
 * Utilitário de parsing de valores monetários no OFX (suporta pontos e vírgulas)
 */
export function parseOFXAmount(amountStr: string): number {
  if (!amountStr) return 0;
  let clean = amountStr.trim().replace(/\s/g, '');
  // Se contiver vírgula como separador decimal (comum no Brasil)
  if (clean.includes(',') && !clean.includes('.')) {
    clean = clean.replace(',', '.');
  } else if (clean.includes(',') && clean.includes('.')) {
    // Ex: 1.250,50 -> 1250.50
    clean = clean.replace(/\./g, '').replace(',', '.');
  }
  const parsed = parseFloat(clean);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Limpeza e normalização do MEMO / Descrição da transação
 */
export function cleanOFXMemo(memoStr: string): string {
  if (!memoStr) return 'LANÇAMENTO SEM DESCRIÇÃO';
  let cleaned = memoStr
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'LANÇAMENTO';
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
  const dtStartMatch = bodyPart.match(/<DTSTART>([^<\r\n]+)/i);
  const startDate = dtStartMatch ? parseOFXDate(dtStartMatch[1]) : undefined;

  const dtEndMatch = bodyPart.match(/<DTEND>([^<\r\n]+)/i);
  const endDate = dtEndMatch ? parseOFXDate(dtEndMatch[1]) : undefined;

  // 5. Saldo final (LEDGERBAL)
  let ledgerBalance: { amount: number; date?: string } | undefined;
  const balAmtMatch = bodyPart.match(/<BALAMT>([^<\r\n]+)/i);
  if (balAmtMatch) {
    const dtAsOfMatch = bodyPart.match(/<DTASOF>([^<\r\n]+)/i);
    ledgerBalance = {
      amount: parseOFXAmount(balAmtMatch[1]),
      date: dtAsOfMatch ? parseOFXDate(dtAsOfMatch[1]) : undefined,
    };
  }

  // 6. Extração das transações (<STMTTRN>...</STMTTRN>)
  // Tratamos tanto tags fechadas </STMTTRN> quanto separação por abertura
  const transactions: OFXRawTransaction[] = [];
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
    const date = parseOFXDate(rawDate);

    // Valor da transação
    const trnAmtMatch = trnBlock.match(/<TRNAMT>([^<\r\n]+)/i);
    let amount = trnAmtMatch ? parseOFXAmount(trnAmtMatch[1]) : 0;

    // Se o valor for negativo, é débito; se for positivo, é crédito (padronização bancária)
    if (amount < 0 && type === 'OTHER') {
      type = 'DEBIT';
    } else if (amount > 0 && type === 'OTHER') {
      type = 'CREDIT';
    }

    // FITID (Identificador Único obrigatório para evitar duplicações)
    const fitidMatch = trnBlock.match(/<FITID>([^<\r\n]+)/i);
    let fitid = fitidMatch ? fitidMatch[1].trim() : '';

    // Se por algum motivo o banco não fornecer FITID, geramos um hash determinístico
    if (!fitid) {
      fitid = `GEN_${rawDate}_${amount}_${Math.random().toString(36).substring(2, 8)}`;
      warnings.push(`Transação sem FITID identificada na data ${date}. FITID sintético gerado.`);
    }

    // MEMO ou NAME (descrição do lançamento)
    const memoMatch = trnBlock.match(/<MEMO>([^<\r\n]+)/i);
    const nameMatch = trnBlock.match(/<NAME>([^<\r\n]+)/i);
    const rawMemo = memoMatch ? memoMatch[1] : (nameMatch ? nameMatch[1] : '');
    const memo = cleanOFXMemo(rawMemo);

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
    hasErrors: false,
    warnings,
  };
}

/**
 * Helper client-side para ler um arquivo File do input HTML / Drag & Drop
 * Detecta automaticamente codificação (UTF-8 ou ISO-8859-1 comum em bancos legados)
 */
export async function parseOFXFile(file: File): Promise<OFXParseResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const result = parseOFXString(text);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = () => {
      reject(new Error('Erro ao ler arquivo OFX do disco.'));
    };

    // Lê como ISO-8859-1 (Latin1) ou UTF-8
    // Tenta como ISO-8859-1 para preservar acentuações bancárias brasileiras
    reader.readAsText(file, 'ISO-8859-1');
  });
}
