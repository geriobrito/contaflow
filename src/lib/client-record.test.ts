import { describe, expect, it } from 'vitest';
import { clientInitials, fieldsKeptOutsideForm, filterClients } from '@/lib/client-record';
import { normalizeDaybookInfo } from '@/lib/daybook';
import type { ClientCompany } from '@/types/firestore';

const base: ClientCompany = { id: 'c1', name: 'Empresa', cnpj: '11222333000181', regime: 'SIMPLES_NACIONAL', createdAt: 'T', updatedAt: 'T' };

describe('campos do cadastro gravados fora do formulário de Clientes', () => {
  it('seguem com a empresa: termos do Diário e contas do modelo ignoradas', () => {
    const existing: ClientCompany = { ...base, ignoredTemplateCodes: ['1.1'], daybook: { number: '2', city: 'Recife/PE', registry: '' } };
    expect(fieldsKeptOutsideForm(existing)).toEqual({ ignoredTemplateCodes: ['1.1'], daybook: { number: '2', city: 'Recife/PE', registry: '' } });
  });

  it('empresa nova ou sem esses campos: nada a carregar', () => {
    expect(fieldsKeptOutsideForm(null)).toEqual({});
    expect(fieldsKeptOutsideForm({ ...base, ignoredTemplateCodes: [] })).toEqual({});
  });
});

describe('filterClients', () => {
  const alpha: ClientCompany = { ...base, id: 'a', name: 'Alpha Comércio Ltda', tradeName: 'Padaria Sol', cnpj: '11.222.333/0001-81' };
  const beta: ClientCompany = { ...base, id: 'b', name: 'Beta Serviços', cnpj: '12.ABC.345/01DE-35' };

  it('busca por razão social, nome fantasia e CNPJ com ou sem máscara', () => {
    expect(filterClients([alpha, beta], 'beta').map((c) => c.id)).toEqual(['b']);
    expect(filterClients([alpha, beta], 'PADARIA').map((c) => c.id)).toEqual(['a']);
    expect(filterClients([alpha, beta], '11222333').map((c) => c.id)).toEqual(['a']);
    expect(filterClients([alpha, beta], '12.abc').map((c) => c.id)).toEqual(['b']);
  });

  it('nome sem dígitos não casa com CNPJ alfanumérico', () => {
    expect(filterClients([beta], 'abc')).toEqual([]);
  });

  it('busca vazia devolve todas', () => {
    expect(filterClients([alpha, beta], '  ')).toHaveLength(2);
  });
});

describe('clientInitials', () => {
  it('usa as duas primeiras palavras com mais de duas letras', () => {
    expect(clientInitials('Casa de Pães da Vila')).toBe('CP');
    expect(clientInitials('A e B')).toBe('');
  });
});

describe('normalizeDaybookInfo', () => {
  it('só os três textos, cortados em 120 caracteres; número vazio vira 1', () => {
    const extra = { number: '', city: 'x'.repeat(200), registry: 42, outro: 'campo' } as never;
    expect(normalizeDaybookInfo(extra)).toEqual({ number: '1', city: 'x'.repeat(120), registry: '42' });
  });
});
