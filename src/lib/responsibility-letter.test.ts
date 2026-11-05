import { describe, expect, it } from 'vitest';
import { buildResponsibilityLetter, letterGaps } from '@/lib/responsibility-letter';
import { generateResponsibilityLetterPdf } from '@/lib/export/responsibility-letter-pdf';

const client = {
  name: 'Padaria Teste Ltda',
  cnpj: '11222333000181',
  porte: 'MICROENTIDADE' as const,
  city: 'Recife/PE',
  legalRepresentativeName: 'Carlos Administrador',
  legalRepresentativeCpf: '123.456.789-09',
};
const org = { officeName: 'Escritório Contábil Silva', accountantName: 'Ana Contadora', accountantCrc: 'PE-012345/O-6' };
const issuedAt = new Date('2026-03-10T12:00:00Z');

describe('carta de responsabilidade da administração', () => {
  it('monta o texto com a empresa, o exercício, a norma e o contador', () => {
    const l = buildResponsibilityLetter({ client, org, year: '2025', issuedAt });
    expect(l.place).toBe('Recife/PE, 10 de março de 2026.');
    expect(l.addressee).toEqual(['Ao(À)', 'Ana Contadora', 'Contador(a) - CRC PE-012345/O-6', 'Escritório Contábil Silva']);
    expect(l.reference).toBe('Ref.: Demonstrações contábeis do exercício findo em 31 de dezembro de 2025');
    expect(l.intro).toMatch(/administradores da Padaria Teste Ltda, inscrita no CNPJ sob o nº 11\.222\.333\/0001-81/);
    expect(l.intro).toMatch(/de acordo com a NBC TG 1002 - Contabilidade para Microentidades/);
    expect(l.items).toHaveLength(5);
    expect(l.items.map((i) => i.slice(0, 2))).toEqual(['a)', 'b)', 'c)', 'd)', 'e)']);
    expect(l.items.join(' ')).toMatch(/fidedignos.*margem da lei.*idôneos.*estoques.*fraudes.*continuidade/);
    expect(l.signer).toEqual({ name: 'Carlos Administrador', cpf: '123.456.789-09' });
    expect(letterGaps(client, org)).toEqual([]);
  });

  it('pequena empresa cita a NBC TG 1001', () => {
    expect(buildResponsibilityLetter({ client: { ...client, porte: 'PEQUENA_EMPRESA' }, org, year: '2025', issuedAt }).intro).toMatch(/NBC TG 1001 - Contabilidade para Pequenas Empresas/);
  });

  it('sem cadastro completo: sai assim mesmo, e a tela lista o que falta', () => {
    const bare = { name: 'Padaria Teste Ltda', cnpj: '11222333000181' };
    const l = buildResponsibilityLetter({ client: bare, org: null, year: '2025', issuedAt });
    expect(l.place).toBe('10 de março de 2026.');
    expect(l.addressee).toEqual(['Ao(À)', 'Profissional da contabilidade responsável']);
    expect(l.signer).toEqual({ name: undefined, cpf: undefined });
    const gaps = letterGaps(bare, null);
    expect(gaps).toHaveLength(3);
    expect(gaps.join(' ')).toMatch(/Representante legal.*Contador responsável.*Município/);
  });

  it('PDF com o título, o texto, a assinatura do representante e o nome do arquivo', async () => {
    const file = generateResponsibilityLetterPdf({ client: { ...client, tradeName: 'Pão Quente' }, org, year: '2025', issuedAt });
    expect(file.fileName).toBe('Carta_de_Responsabilidade_Pao_Quente_2025.pdf');
    const pdf = Buffer.from(await file.blob.arrayBuffer()).toString('latin1');
    const texts = [...pdf.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
    expect(texts.slice(0, 3)).toEqual(['PADARIA TESTE LTDA', 'CNPJ: 11.222.333/0001-81', 'CARTA DE RESPONSABILIDADE DA ADMINISTRAÇÃO']);
    expect(texts).toEqual(expect.arrayContaining(['Recife/PE, 10 de março de 2026.', 'Ana Contadora', 'Carlos Administrador', 'Representante Legal / Administrador', 'CPF: 123.456.789-09']));
    // O contador não assina a carta: só o representante.
    expect(texts).not.toContain('Profissional da Contabilidade');
  });
});
