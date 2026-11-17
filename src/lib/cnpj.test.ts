import { describe, expect, it } from 'vitest';
import {
  DIRECT_LOOKUP_ORIGINS,
  fetchCNPJFromProviders,
  isFinalLookupStatus,
  formatActivity,
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

    expect(mei).toMatchObject({
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

    expect(mapped).toMatchObject({
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

  it('atividade principal: descrição do CNAE nas duas fontes, em frase normal', () => {
    expect(formatActivity('COMERCIO VAREJISTA DE PRODUTOS DE PADARIA')).toBe('Comercio varejista de produtos de padaria');
    expect(formatActivity('  Desenvolvimento de programas   de computador sob encomenda ')).toBe('Desenvolvimento de programas de computador sob encomenda');
    expect(formatActivity('')).toBeUndefined();
    expect(formatActivity('x'.repeat(400))).toHaveLength(300);

    const brasil = mapBrasilApiResponse({ cnpj: '11222333000181', razao_social: 'PADARIA LTDA', cnae_fiscal_descricao: 'Fabricação de produtos de panificação industrial' });
    expect(brasil?.activity).toBe('Fabricação de produtos de panificação industrial');
    const ws = mapCnpjWsResponse({
      razao_social: 'PADARIA LTDA',
      estabelecimento: { cnpj: '11222333000181', atividade_principal: { id: '1091101', descricao: 'Fabricação de produtos de panificação industrial' } },
    });
    expect(ws?.activity).toBe('Fabricação de produtos de panificação industrial');
    expect(mapBrasilApiResponse({ cnpj: '11222333000181', razao_social: 'PADARIA LTDA' })?.activity).toBeUndefined();
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

    // BrasilAPI recusa (403) e a Minha Receita, no mesmo formato, responde: segundo provedor.
    const calls: string[] = [];
    const secondFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      // Sem User-Agent a BrasilAPI responde 403 ao fetch do servidor: todo provedor o recebe.
      expect(new Headers(init?.headers).get('user-agent')).toBeTruthy();
      if (url.includes('brasilapi')) return new Response('forbidden', { status: 403 });
      return Response.json({ cnpj: '11222333000181', razao_social: 'SEGUNDA LTDA' });
    };
    expect(await fetchCNPJFromProviders('11222333000181', secondFetch)).toMatchObject({ ok: true, data: { name: 'SEGUNDA LTDA' } });
    expect(calls).toEqual(['https://brasilapi.com.br/api/cnpj/v1/11222333000181', 'https://minhareceita.org/11222333000181']);

    const notFoundFetch: typeof fetch = async () => new Response('not found', { status: 404 });
    const miss = await fetchCNPJFromProviders('11222333000181', notFoundFetch);
    expect(miss).toEqual({
      ok: false,
      status: 404,
      error: 'CNPJ não encontrado na base pública da Receita Federal.',
    });
  });

  it('consulta direta do navegador: só provedores com CORS aberto, só o cabeçalho Accept, e cancelável', async () => {
    const calls: string[] = [];
    const down: typeof fetch = async (input, init) => {
      calls.push(String(input));
      // Cabeçalho fora do padrão dispararia a verificação prévia de CORS.
      expect([...new Headers(init?.headers).keys()]).toEqual(['accept']);
      return new Response('fora', { status: 503 });
    };
    expect(await fetchCNPJFromProviders('11222333000181', down, { direct: true })).toMatchObject({ ok: false, status: 502 });
    expect(calls).toEqual(['https://brasilapi.com.br/api/cnpj/v1/11222333000181', 'https://minhareceita.org/11222333000181']);
    // Todo provedor direto precisa estar liberado na CSP.
    for (const url of calls) expect(DIRECT_LOOKUP_ORIGINS).toContain(new URL(url).origin);

    const ok: typeof fetch = async () => Response.json({ cnpj: '11222333000181', razao_social: 'DIRETA LTDA', opcao_pelo_mei: true });
    expect(await fetchCNPJFromProviders('11222333000181', ok, { direct: true })).toMatchObject({ ok: true, data: { name: 'DIRETA LTDA', regime: 'MEI' } });

    const aborted = new AbortController();
    aborted.abort();
    const never: typeof fetch = async () => {
      throw new Error('não deveria consultar');
    };
    expect(await fetchCNPJFromProviders('11222333000181', never, { direct: true, signal: aborted.signal })).toMatchObject({ ok: false });
  });

  it('respostas da rota que não adianta repetir pelo navegador', () => {
    expect([400, 404, 429].every(isFinalLookupStatus)).toBe(true);
    expect([401, 403, 500, 502, 503, 504].some(isFinalLookupStatus)).toBe(false);
  });
});

