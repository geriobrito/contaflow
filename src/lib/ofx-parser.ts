export interface OFXTransaction {
  fitid: string;
  type: 'DEBIT' | 'CREDIT';
  date: string; // YYYY-MM-DD
  amount: number;
  memo: string;
}

export function parseOFX(rawText: string): OFXTransaction[] {
  const transactions: OFXTransaction[] = [];
  // Regex compatível com tags fechadas </STMTTRN> ou separadas por próxima tag <STMTTRN> (SGML legado)
  const stmtTrnRegex = /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>|<\/BANKTRANLIST>|$))/gi;
  let match: RegExpExecArray | null;

  while ((match = stmtTrnRegex.exec(rawText)) !== null) {
    const block = match[1];
    if (!block.trim()) continue;

    const getTagValue = (tag: string) => {
      const regex = new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i');
      const found = block.match(regex);
      return found ? found[1].trim() : '';
    };

    const fitid = getTagValue('FITID');
    const trntype = getTagValue('TRNTYPE').toUpperCase();
    const rawDate = getTagValue('DTPOSTED');
    const rawAmt = getTagValue('TRNAMT');
    const memo = getTagValue('MEMO') || getTagValue('NAME') || 'LANÇAMENTO';

    // Formata data YYYYMMDD... -> YYYY-MM-DD
    let formattedDate = '';
    if (rawDate && rawDate.length >= 8) {
      formattedDate = `${rawDate.substring(0, 4)}-${rawDate.substring(4, 6)}-${rawDate.substring(6, 8)}`;
    }

    const amount = parseFloat(rawAmt.replace(',', '.'));

    if (fitid && !isNaN(amount)) {
      transactions.push({
        fitid,
        type: amount < 0 || trntype === 'DEBIT' ? 'DEBIT' : 'CREDIT',
        date: formattedDate,
        amount: Math.abs(amount),
        memo,
      });
    }
  }

  return transactions;
}

/**
 * Lê diretamente um arquivo File (drag & drop ou input) no navegador
 */
export async function parseOFXFile(file: File): Promise<OFXTransaction[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const txs = parseOFX(text);
        resolve(txs);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Erro ao ler arquivo OFX do disco.'));
    // ISO-8859-1 preserva acentuações bancárias legadas
    reader.readAsText(file, 'ISO-8859-1');
  });
}
