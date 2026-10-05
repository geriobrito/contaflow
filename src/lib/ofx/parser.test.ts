import { describe, expect, it } from 'vitest';
import { describeTransaction, normalizeOFXAmount, normalizeOFXDate, parseOFXAmount, parseOFXDate, parseOFXString } from '@/lib/ofx/parser';
import { SAMPLE_BRAZILIAN_OFX } from '@/lib/mock/sample-ofx';

const wrap = (transactions: string) => `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>0341<ACCTID>12345-6</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20250101<DTEND>20250131
${transactions}
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe('parseOFXDate / parseOFXAmount', () => {
  it('converte datas OFX com e sem fuso', () => {
    expect(parseOFXDate('20240315120000[-3:BRT]')).toBe('2024-03-15');
    expect(parseOFXDate('20240315')).toBe('2024-03-15');
  });

  it('entende ponto, vírgula e milhar brasileiro', () => {
    expect(parseOFXAmount('-802.66')).toBe(-802.66);
    expect(parseOFXAmount('-802,66')).toBe(-802.66);
    expect(parseOFXAmount('1.250,50')).toBe(1250.5);
    expect(parseOFXAmount('abc')).toBe(0);
  });
});

describe('parseOFXString', () => {
  it('lê o extrato de exemplo (SGML) com conta, transações e ordenação por data', () => {
    const r = parseOFXString(SAMPLE_BRAZILIAN_OFX);
    expect(r.hasErrors).toBe(false);
    expect(r.account.bankId).toBe('0077');
    expect(r.transactions.length).toBe(8);
    const dates = r.transactions.map((t) => t.date);
    expect([...dates].sort()).toEqual(dates);
    expect(new Set(r.transactions.map((t) => t.fitid)).size).toBe(8);
  });

  it('infere débito/crédito pelo sinal quando TRNTYPE é genérico', () => {
    const r = parseOFXString(
      wrap(`<STMTTRN><TRNTYPE>OTHER<DTPOSTED>20250110<TRNAMT>-19.90<FITID>A1<MEMO>TARIFA</STMTTRN>
<STMTTRN><TRNTYPE>OTHER<DTPOSTED>20250111<TRNAMT>100.00<FITID>A2<MEMO>PIX</STMTTRN>`)
    );
    expect(r.transactions.map((t) => t.type)).toEqual(['DEBIT', 'CREDIT']);
  });

  it('decodifica entidades e usa NAME quando não há MEMO', () => {
    const r = parseOFXString(
      wrap(`<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20250110<TRNAMT>-5<FITID>B1<NAME>PADARIA &amp; CAFE</STMTTRN>`)
    );
    expect(r.transactions[0].memo).toBe('PADARIA & CAFE');
  });

  it('gera FITID determinístico quando o banco não envia (reimportação não duplica)', () => {
    const body = `<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20250110<TRNAMT>-10.00<MEMO>CAFE</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20250110<TRNAMT>-10.00<MEMO>CAFE</STMTTRN>`;
    const first = parseOFXString(wrap(body)).transactions.map((t) => t.fitid);
    const second = parseOFXString(wrap(body)).transactions.map((t) => t.fitid);
    expect(first).toEqual(second);
    // Dois lançamentos idênticos no mesmo dia continuam distintos.
    expect(new Set(first).size).toBe(2);
  });
});

describe('normalizeOFXDate', () => {
  it('aceita OFX, ISO e o formato brasileiro, com ou sem fuso', () => {
    expect(normalizeOFXDate('20250329')).toBe('2025-03-29');
    expect(normalizeOFXDate('20250329120000.000[-3:BRT]')).toBe('2025-03-29');
    expect(normalizeOFXDate('20250329000000[-3:BRT]')).toBe('2025-03-29');
    expect(normalizeOFXDate('29/03/2025')).toBe('2025-03-29');
    expect(normalizeOFXDate(' 29/03/2025 10:15:00 ')).toBe('2025-03-29');
    expect(normalizeOFXDate('1/3/2025')).toBe('2025-03-01');
    expect(normalizeOFXDate('2025-03-29')).toBe('2025-03-29');
    expect(normalizeOFXDate('2025-03-29T10:00:00-03:00')).toBe('2025-03-29');
  });

  it('devolve null (e nunca "hoje") para datas inexistentes ou ilegíveis', () => {
    expect(normalizeOFXDate('')).toBeNull();
    expect(normalizeOFXDate(undefined)).toBeNull();
    expect(normalizeOFXDate('[-3:BRT]')).toBeNull();
    expect(normalizeOFXDate('20250230')).toBeNull();
    expect(normalizeOFXDate('31/04/2025')).toBeNull();
    expect(normalizeOFXDate('abc')).toBeNull();
    expect(parseOFXDate('29/03/2025')).toBe('2025-03-29');
  });
});

describe('normalizeOFXAmount', () => {
  it('lê o padrão OFX sem perder o ponto decimal', () => {
    expect(normalizeOFXAmount('-120.50')).toBe(-120.5);
    expect(normalizeOFXAmount('1000')).toBe(1000);
    expect(normalizeOFXAmount('0.01')).toBe(0.01);
  });

  it('lê valores com moeda e formato brasileiro (PagBank)', () => {
    expect(normalizeOFXAmount('R$ 3.327,70')).toBe(3327.7);
    expect(normalizeOFXAmount('R$ -3.327,70')).toBe(-3327.7);
    expect(normalizeOFXAmount('-R$ 1.234.567,89')).toBe(-1234567.89);
    expect(normalizeOFXAmount('R$ 3.327')).toBe(3327);
    expect(normalizeOFXAmount('(10,00)')).toBe(-10);
    expect(normalizeOFXAmount('10,00-')).toBe(-10);
    expect(normalizeOFXAmount('1,250.50')).toBe(1250.5);
    expect(normalizeOFXAmount('BRL 99,9')).toBe(99.9);
  });

  it('devolve null quando não há número', () => {
    expect(normalizeOFXAmount('')).toBeNull();
    expect(normalizeOFXAmount('R$')).toBeNull();
    expect(parseOFXAmount('R$')).toBe(0);
  });
});

describe('parseOFXString: arquivo no estilo PagBank/PagSeguro', () => {
  const PAGBANK = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
ENCODING:USASCII
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>BRL</CURDEF>
<BANKACCTFROM><BANKID>290</BANKID><BRANCHID>0001</BRANCHID><ACCTID>12345678-9</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20250301000000[-3:BRT]</DTSTART>
<DTEND>20250329235959[-3:BRT]</DTEND>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20250305103000[-3:BRT]</DTPOSTED><TRNAMT>1500.00</TRNAMT><FITID>PB1</FITID><MEMO>Pix recebido - Cliente A</MEMO></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20250310090000[-3:BRT]</DTPOSTED><TRNAMT>-172.30</TRNAMT><FITID>PB2</FITID><MEMO>Tarifa de venda</MEMO></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>15/03/2025</DTPOSTED><TRNAMT>R$ -0,50</TRNAMT><FITID>PB3</FITID><MEMO>IOF</MEMO></STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>R$ 3.327,70</BALAMT><DTASOF>29/03/2025</DTASOF></LEDGERBAL>
<AVAILBAL><BALAMT>R$ 1,00</BALAMT><DTASOF>30/03/2025</DTASOF></AVAILBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

  it('importa datas com fuso, data brasileira, saldo com R$ e ignora AVAILBAL', () => {
    const r = parseOFXString(PAGBANK);
    expect(r.hasErrors).toBe(false);
    expect(r.warnings).toEqual([]);
    expect(r.startDate).toBe('2025-03-01');
    expect(r.endDate).toBe('2025-03-29');
    expect(r.ledgerBalance).toEqual({ amount: 3327.7, date: '2025-03-29' });
    expect(r.transactions.map((t) => [t.date, t.amount])).toEqual([
      ['2025-03-05', 1500],
      ['2025-03-10', -172.3],
      ['2025-03-15', -0.5],
    ]);
  });

  it('descarta com aviso o lançamento sem data válida, sem derrubar o arquivo', () => {
    const r = parseOFXString(PAGBANK.replace('15/03/2025', '32/13/2025').replace('<DTASOF>29/03/2025', '<DTASOF>lixo'));
    expect(r.hasErrors).toBe(false);
    expect(r.transactions).toHaveLength(2);
    expect(r.ledgerBalance).toEqual({ amount: 3327.7, date: undefined });
    expect(r.warnings.some((w) => w.includes('IOF') && w.includes('32/13/2025'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('DTASOF'))).toBe(true);
  });
});

describe('NAME + MEMO (InfinitePay)', () => {
  it('junta o favorecido (NAME) ao rótulo genérico (MEMO)', () => {
    const r = parseOFXString(
      wrap(`<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20250110<TRNAMT>-406.37<FITID>N1<NAME>Pix WMS SUPERMERCADOS DO BRASIL LTDA<MEMO>Enviado<CHECKNUM>0</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20250111<TRNAMT>58.11<FITID>N2<NAME>Vendas<MEMO>Depósito InfinitePay<CHECKNUM>0</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20250112<TRNAMT>-5<FITID>N3<NAME>Pix ROGERIO SILVA P BRITO                   <MEMO>Enviado</STMTTRN>`)
    );
    expect(r.transactions.map((t) => t.memo)).toEqual([
      'Pix WMS SUPERMERCADOS DO BRASIL LTDA - Enviado',
      'Vendas - Depósito InfinitePay',
      'Pix ROGERIO SILVA P BRITO - Enviado',
    ]);
  });

  it('não repete quando um texto contém o outro, e usa o que existir', () => {
    expect(describeTransaction('PADARIA CENTRAL', 'PADARIA CENTRAL')).toBe('PADARIA CENTRAL');
    expect(describeTransaction('PADARIA', 'COMPRA PADARIA CENTRAL 12/03')).toBe('COMPRA PADARIA CENTRAL 12/03');
    expect(describeTransaction('Pix JOAO SILVA', 'Pix')).toBe('Pix JOAO SILVA');
    expect(describeTransaction(undefined, 'só memo')).toBe('só memo');
    expect(describeTransaction('só nome', '  ')).toBe('só nome');
    expect(describeTransaction('A &amp; B', 'Enviado')).toBe('A & B - Enviado');
  });

  it('o FITID sintético continua derivado do MEMO (a mesma linha gera o mesmo ID com ou sem NAME)', () => {
    const id = (inner: string) => parseOFXString(wrap(`<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20250110<TRNAMT>-10.00${inner}</STMTTRN>`)).transactions[0].fitid;
    expect(id('<NAME>X<MEMO>Enviado')).toBe(id('<MEMO>Enviado'));
    expect(id('<MEMO>Enviado')).toMatch(/^GEN_20250110_-10\.00_.+_1$/);
  });
});
