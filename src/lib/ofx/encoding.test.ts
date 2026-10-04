import { describe, expect, it } from 'vitest';
import { decodeOFXBytes, hasMojibake, repairMojibake } from '@/lib/ofx/encoding';
import { parseOFXString } from '@/lib/ofx/parser';

const utf8 = (s: string) => new TextEncoder().encode(s);
/** Bytes Windows-1252 de um texto (só para montar fixtures). */
const cp1252 = (s: string) => Uint8Array.from([...s].map((c) => ({ '•': 0x95, '€': 0x80 })[c as '•'] ?? c.charCodeAt(0)));
/** O que o app fazia antes: bytes UTF-8 lidos como Latin-1/Windows-1252. */
const damaged = (s: string) => new TextDecoder('windows-1252').decode(utf8(s));

const MEMO = 'Transferência recebida pelo Pix - HALANDA JESSICA - •••.662.821-•• - NU PAGAMENTOS - IP (0260) Agência: 1';

describe('decodeOFXBytes', () => {
  it('lê UTF-8 (Nubank, PagBank), com ou sem BOM', () => {
    expect(decodeOFXBytes(utf8(MEMO))).toEqual({ text: MEMO, encoding: 'utf-8' });
    const bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8('OFXHEADER:100')]);
    expect(decodeOFXBytes(bom).text).toBe('OFXHEADER:100');
  });

  it('lê Windows-1252 (bancos antigos) quando não é UTF-8 válido', () => {
    const r = decodeOFXBytes(cp1252('PAGAMENTO AÇÃO • Agência'));
    expect(r).toEqual({ text: 'PAGAMENTO AÇÃO • Agência', encoding: 'windows-1252' });
  });

  it('arquivo só ASCII é indiferente', () => {
    expect(decodeOFXBytes(utf8('TARIFA PACOTE')).text).toBe('TARIFA PACOTE');
  });
});

describe('repairMojibake', () => {
  it('desfaz o erro dos extratos do Nubank', () => {
    expect(damaged(MEMO)).not.toBe(MEMO);
    expect(repairMojibake(damaged(MEMO))).toBe(MEMO);
    expect(repairMojibake('transferÃªncia recebida - â€¢â€¢â€¢.662.821-â€¢â€¢ - agÃªncia')).toBe('transferência recebida - •••.662.821-•• - agência');
  });

  it('cobre acentos, cedilha, til, aspas e travessões', () => {
    for (const s of ['São João', 'AÇÃO ÓTIMA', 'Itaú Unibanco', 'União e Negócios', '“aspas” — travessão – e €', 'nº 5 ª via', 'Magalhães', 'Rogério']) {
      expect(repairMojibake(damaged(s))).toBe(s);
    }
  });

  it('não altera texto correto', () => {
    for (const s of ['AÇÃO', 'São Paulo', 'Pagamento de fatura', 'Itaú', 'Â', 'Ã', 'ANDRÉ & CIA', 'Cafe 100% - R$ 10,00', '']) {
      expect(repairMojibake(s)).toBe(s);
    }
  });

  it('texto convertido duas vezes', () => {
    expect(repairMojibake(damaged(damaged('Transferência •')))).toBe('Transferência •');
  });

  it('texto em minúsculas (padrões de regras): ã/â no lugar de Ã/Â', () => {
    const pattern = damaged('Transferência recebida - Agência').toLowerCase();
    expect(pattern).toContain('ãª');
    expect(repairMojibake(pattern, { lowercased: true })).toBe('transferência recebida - agência');
    expect(repairMojibake(damaged('nº do título').toLowerCase(), { lowercased: true })).toBe('nº do título');
    // Sem a opção, o líder minúsculo não é arriscado.
    expect(repairMojibake(pattern)).toBe(pattern);
  });

  it('hasMojibake', () => {
    expect(hasMojibake('agÃªncia')).toBe(true);
    expect(hasMojibake('agência')).toBe(false);
  });
});

describe('parseOFXString com texto já quebrado', () => {
  it('repara o histórico na leitura', () => {
    const ofx = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST><DTSTART>20250301<DTEND>20250331
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20250301<TRNAMT>10.00<FITID>A1<MEMO>${damaged('Transferência recebida - •••.662.821-••')}</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    expect(parseOFXString(ofx).transactions[0].memo).toBe('Transferência recebida - •••.662.821-••');
  });
});
