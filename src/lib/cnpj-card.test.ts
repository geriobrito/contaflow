import { describe, expect, it } from 'vitest';
import { brasilApiCard, cnpjWsCard, formatAddress, formatCnae, formatPartnerDocument, isoDate } from '@/lib/cnpj-card';
import { mapBrasilApiResponse } from '@/lib/cnpj';

/** Trecho real (anonimizado) do formato da BrasilAPI /api/cnpj/v1. */
const brasilApi = {
  cnpj: '11222333000181',
  razao_social: 'TECH SOLUCOES LTDA',
  identificador_matriz_filial: 1,
  data_inicio_atividade: '2015-03-10',
  codigo_natureza_juridica: 2062,
  natureza_juridica: 'Sociedade Empresária Limitada',
  cnae_fiscal: 6201501,
  cnae_fiscal_descricao: 'Desenvolvimento de programas de computador sob encomenda',
  cnaes_secundarios: [
    { codigo: 6202300, descricao: 'Desenvolvimento e licenciamento de programas de computador customizáveis' },
    { codigo: 0, descricao: '' },
  ],
  porte: 'MICRO EMPRESA',
  ente_federativo_responsavel: '',
  descricao_situacao_cadastral: 'ATIVA',
  data_situacao_cadastral: '2015-03-10',
  descricao_motivo_situacao_cadastral: 'SEM MOTIVO',
  situacao_especial: '',
  data_situacao_especial: null,
  capital_social: 50000,
  descricao_tipo_de_logradouro: 'RUA',
  logradouro: 'DAS FLORES',
  numero: '100',
  complemento: 'SALA 2',
  bairro: 'BOA VIAGEM',
  cep: '51020000',
  municipio: 'RECIFE',
  uf: 'PE',
  ddd_telefone_1: '8133334444',
  ddd_telefone_2: '81999998888',
  opcao_pelo_simples: true,
  data_opcao_pelo_simples: '2015-03-10',
  data_exclusao_do_simples: null,
  opcao_pelo_mei: false,
  data_opcao_pelo_mei: null,
  data_exclusao_do_mei: null,
  qsa: [
    {
      nome_socio: 'ANA ADMINISTRADORA',
      cnpj_cpf_do_socio: '***123456**',
      codigo_qualificacao_socio: 49,
      qualificacao_socio: 'Sócio-Administrador',
      data_entrada_sociedade: '2015-03-10',
      faixa_etaria: 'Entre 31 a 40 anos',
      pais: null,
      nome_representante_legal: '',
      cpf_representante_legal: '***000000**',
      qualificacao_representante_legal: 'Não informada',
    },
    { nome_socio: 'HOLDING XYZ LTDA', cnpj_cpf_do_socio: '99888777000166', qualificacao_socio: 'Sócio', data_entrada_sociedade: '2020-01-02' },
  ],
};

describe('cartão CNPJ e QSA', () => {
  it('formata CNAE, documento do sócio e datas', () => {
    expect(formatCnae(6201501)).toBe('62.01-5-01');
    expect(formatCnae('4711-3/02')).toBe('47.11-3-02');
    expect(formatPartnerDocument('***123456**')).toBe('***.123.456-**');
    expect(formatPartnerDocument('99888777000166')).toBe('99.888.777/0001-66');
    expect(formatPartnerDocument('***000000**')).toBeUndefined();
    expect(isoDate('10/03/2015')).toBe('2015-03-10');
    expect(isoDate('2015-03-10T00:00:00Z')).toBe('2015-03-10');
    expect(isoDate('0000-00-00')).toBeUndefined();
    expect(isoDate(null)).toBeUndefined();
  });

  it('BrasilAPI: endereço, dados do cartão e quadro de sócios', () => {
    const card = brasilApiCard(brasilApi);
    expect(card.address).toEqual({ cep: '51020000', street: 'RUA DAS FLORES', number: '100', complement: 'SALA 2', district: 'BOA VIAGEM', municipality: 'RECIFE', uf: 'PE' });
    expect(card.registration).toEqual({
      branch: 'MATRIZ',
      openedAt: '2015-03-10',
      legalNature: { code: '206-2', description: 'Sociedade Empresária Limitada' },
      mainActivity: { code: '62.01-5-01', description: 'Desenvolvimento de programas de computador sob encomenda' },
      secondaryActivities: [{ code: '62.02-3-00', description: 'Desenvolvimento e licenciamento de programas de computador customizáveis' }],
      sizeLabel: 'MICRO EMPRESA',
      status: 'ATIVA',
      statusDate: '2015-03-10',
      statusReason: 'SEM MOTIVO',
      shareCapital: 50000,
      phone2: '(81) 99999-8888',
      simples: { optant: true, since: '2015-03-10' },
      mei: { optant: false },
      source: 'brasilapi',
    });
    expect(card.partners).toEqual([
      {
        name: 'ANA ADMINISTRADORA',
        document: '***.123.456-**',
        role: 'Sócio-Administrador',
        roleCode: '49',
        since: '2015-03-10',
        ageRange: 'Entre 31 a 40 anos',
        representativeRole: 'Não informada',
      },
      { name: 'HOLDING XYZ LTDA', document: '99.888.777/0001-66', role: 'Sócio', since: '2020-01-02' },
    ]);
    // A consulta completa leva o cartão junto com os campos do cadastro.
    expect(mapBrasilApiResponse(brasilApi)).toMatchObject({ name: 'TECH SOLUCOES LTDA', partners: expect.any(Array), registration: expect.any(Object) });
  });

  it('CNPJ.ws: os mesmos dados no formato dela', () => {
    const card = cnpjWsCard({
      razao_social: 'COMERCIO ALFA LTDA',
      capital_social: '10000.00',
      natureza_juridica: { id: '2062', descricao: 'Sociedade Empresária Limitada' },
      porte: { id: '01', descricao: 'Micro Empresa' },
      simples: { simples: 'Sim', data_opcao_simples: '2019-01-01', mei: 'Não' },
      socios: [{ nome: 'CARLOS SOUZA', cpf_cnpj_socio: '***987654**', data_entrada: '2019-01-01', qualificacao_socio: { id: 49, descricao: 'Sócio-Administrador' } }],
      estabelecimento: {
        tipo: 'Matriz',
        data_inicio_atividade: '2019-01-01',
        situacao_cadastral: 'Ativa',
        data_situacao_cadastral: '2019-01-01',
        atividade_principal: { id: '4711302', subclasse: '4711-3/02', descricao: 'Comércio varejista de mercadorias em geral' },
        atividades_secundarias: [{ id: '4721102', subclasse: '4721-1/02', descricao: 'Padaria e confeitaria' }],
        tipo_logradouro: 'Avenida',
        logradouro: 'Brasil',
        numero: '1',
        bairro: 'Centro',
        cep: '50000-000',
        cidade: { nome: 'Recife' },
        estado: { sigla: 'PE' },
      },
    });
    expect(card.address).toEqual({ cep: '50000000', street: 'Avenida Brasil', number: '1', district: 'Centro', municipality: 'Recife', uf: 'PE' });
    expect(card.registration).toMatchObject({
      branch: 'MATRIZ',
      legalNature: { code: '206-2', description: 'Sociedade Empresária Limitada' },
      mainActivity: { code: '47.11-3-02' },
      secondaryActivities: [{ code: '47.21-1-02', description: 'Padaria e confeitaria' }],
      shareCapital: 10000,
      simples: { optant: true, since: '2019-01-01' },
      mei: { optant: false },
    });
    expect(card.partners).toEqual([{ name: 'CARLOS SOUZA', document: '***.987.654-**', role: 'Sócio-Administrador', roleCode: '49', since: '2019-01-01' }]);
  });

  it('endereço numa linha', () => {
    expect(formatAddress({ street: 'Rua A', number: '10', complement: 'Sala 2', district: 'Centro', municipality: 'Recife', uf: 'PE', cep: '50000000' })).toBe(
      'Rua A, 10, Sala 2 - Centro - Recife/PE - CEP 50000-000'
    );
    expect(formatAddress(undefined)).toBe('');
  });
});
