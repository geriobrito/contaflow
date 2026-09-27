import { describe, expect, it } from 'vitest';
import { parseOFXAmount, parseOFXDate, parseOFXString } from '@/lib/ofx/parser';
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
