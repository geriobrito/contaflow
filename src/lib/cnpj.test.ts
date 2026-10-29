import { describe, expect, it } from 'vitest';
import {
  fetchCNPJFromProviders,
  formatBrazilianPhone,
  formatCityUF,
  mapBrasilApiResponse,
  mapCnpjWsResponse,
} from '@/lib/cnpj';

describe('consulta e mapeamento de CNPJ', () => {
  it('formata município/UF e telefone brasileiro', () => {
    expect(formatCityUF('RECIFE', 'pe')).toBe('Recife/PE');
    expect(formatCityUF('SAO BERNARDO DO CAMPO', 'SP')).toBe('Sao Bernardo do Campo/SP');
    expect(formatBrazilianPhone('8133334444')).toBe('(81) 3333-4444');
    expect(formatBrazilianPhone('81999998888')).toBe('(81) 99999-8888');
  });

  it('mapeia resposta da BrasilAPI para MEI, Simples e EPP com representante legal', () => {
    const mei = mapBrasilApiResponse({
      cnpj: '11.222.333/0001-81',
      razao_social: 'MARIA SILVA CONFEITARIA',
      nome_fantasia: 'DOCES DA MARIA',
      municipio: 'OLINDA',
      uf: 'PE',
      opcao_pelo_mei: true,
      opcao_pelo_simples: true,
      email: 'CONTATO@DOCES.COM.BR',
      ddd_telefone_1: '81988887777',
      descricao_situacao_cadastral: 'ATIVA',
      qsa: [{ nome_socio: 'MARIA DA SILVA', qualificacao_socio: 'Empresário' }],
    });

    expect(mei).toEqual({
      cnpj: '11222333000181',
      name: 'MARIA SILVA CONFEITARIA',
      tradeName: 'DOCES DA MARIA',
      city: 'Olinda/PE',
      regime: 'MEI',
      porte: 'MICROENTIDADE',
      email: 'contato@doces.com.br',
      phone: '(81) 98888-7777',
      legalRepresentativeName: 'MARIA DA SILVA',
      situacaoCadastral: 'ATIVA',
      source: 'brasilapi',
    });

    const epp = mapBrasilApiResponse({
      cnpj: '11222333000181',
      razao_social: 'TECH SOLUCOES LTDA',
      municipio: 'RECIFE',
      uf: 'PE',
      opcao_pelo_mei: false,
      opcao_pelo_simples: true,
      codigo_porte: 3,
      porte: 'EMPRESA DE PEQUENO PORTE',
      qsa: [
        { nome_socio: 'SOCIO INVESTIDOR', codigo_qualificacao_socio: 22, qualificacao_socio: 'Sócio' },
        { nome_socio: 'ANA ADMINISTRADORA', codigo_qualificacao_socio: 49, qualificacao_socio: 'Sócio-Administrador' },
      ],
    });

    expect(epp).toMatchObject({
      regime: 'SIMPLES_NACIONAL',
      porte: 'PEQUENA_EMPRESA',
      legalRepresentativeName: 'ANA ADMINISTRADORA',
    });
  });

  it('mapeia resposta do fallback CNPJ.ws', () => {
    const mapped = mapCnpjWsResponse({
      razao_social: 'COMERCIO ALFA LTDA',
      porte: { id: '01', descricao: 'Micro Empresa' },
      simples: { simples: 'Sim', mei: 'Não' },
      socios: [{ nome: 'CARLOS SOUZA', qualificacao_socio: { id: 49, descricao: 'Sócio-Administrador' } }],
      estabelecimento: {
        cnpj: '11222333000181',
        nome_fantasia: 'ALFA',
        situacao_cadastral: 'Ativa',
        email: 'adm@alfa.com.br',
        ddd1: '11',
        telefone1: '30304040',
        cidade: { nome: 'SAO PAULO' },
        estado: { sigla: 'SP' },
      },
    });

    expect(mapped).toEqual({
      cnpj: '11222333000181',
      name: 'COMERCIO ALFA LTDA',
      tradeName: 'ALFA',
      city: 'Sao Paulo/SP',
      regime: 'SIMPLES_NACIONAL',
      porte: 'MICROENTIDADE',
      email: 'adm@alfa.com.br',
      phone: '(11) 3030-4040',
      legalRepresentativeName: 'CARLOS SOUZA',
      situacaoCadastral: 'Ativa',
      source: 'cnpjws',
    });
  });

  it('faz fallback automático quando o provedor primário falha e retorna 404 quando inexistente', async () => {
    const fallbackFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('brasilapi')) {
        return new Response('rate limit', { status: 429 });
      }
      return Response.json({
        razao_social: 'FALLBACK LTDA',
        estabelecimento: {
          cnpj: '11222333000181',
          cidade: { nome: 'RECIFE' },
          estado: { sigla: 'PE' },
        },
      });
    };

    const ok = await fetchCNPJFromProviders('11.222.333/0001-81', fallbackFetch);
    expect(ok).toMatchObject({
      ok: true,
      data: { name: 'FALLBACK LTDA', city: 'Recife/PE', source: 'cnpjws' },
    });

    const notFoundFetch: typeof fetch = async () => new Response('not found', { status: 404 });
    const miss = await fetchCNPJFromProviders('11222333000181', notFoundFetch);
    expect(miss).toEqual({
      ok: false,
      status: 404,
      error: 'CNPJ não encontrado na base pública da Receita Federal.',
    });
  });
});

