import { describe, expect, it } from 'vitest';
import { fieldsKeptOutsideForm } from '@/lib/client-record';
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

describe('normalizeDaybookInfo', () => {
  it('só os três textos, cortados em 120 caracteres; número vazio vira 1', () => {
    const extra = { number: '', city: 'x'.repeat(200), registry: 42, outro: 'campo' } as never;
    expect(normalizeDaybookInfo(extra)).toEqual({ number: '1', city: 'x'.repeat(120), registry: '42' });
  });
});
