import { describe, expect, it } from 'vitest';
import { reviewLookup, type ClientFormFields } from '@/lib/cnpj-review';
import { sameCompany } from '@/lib/company-name';
import type { CNPJLookupResult } from '@/lib/cnpj';

const empty: ClientFormFields = { name: '', tradeName: '', city: '', email: '', phone: '', legalRepresentativeName: '', regime: 'SIMPLES_NACIONAL', porte: 'MICROENTIDADE' };

const receita: CNPJLookupResult = {
  cnpj: '11222333000181',
  name: 'PADARIA PAO QUENTE LTDA - ME',
  tradeName: 'PAO QUENTE',
  city: 'Recife/PE',
  email: 'contato@paoquente.com.br',
  regime: 'SIMPLES_NACIONAL',
  porte: 'PEQUENA_EMPRESA',
  situacaoCadastral: 'ATIVA',
  source: 'brasilapi',
};

describe('mesma empresa', () => {
  it('ignora acento, caixa e natureza jurídica; aceita o nome curto contido no longo', () => {
    expect(sameCompany('Padaria Pão Quente Ltda', 'PADARIA PAO QUENTE LTDA - ME')).toBe(true);
    expect(sameCompany('Pão Quente', 'PADARIA PAO QUENTE LTDA')).toBe(true);
    expect(sameCompany('Claro', 'CLARO S.A.')).toBe(true);
  });

  it('nomes de empresas diferentes, mesmo com uma palavra em comum', () => {
    expect(sameCompany('Padaria Pão Quente Ltda', 'CAIXA ESCOLA DA ESCOLA ESTADUAL')).toBe(false);
    expect(sameCompany('Padaria Aurora', 'Padaria Pão Quente')).toBe(false);
    expect(sameCompany('', 'Padaria')).toBe(false);
  });
});

describe('resposta da Receita no cadastro', () => {
  it('formulário vazio: preenche tudo direto', () => {
    const r = reviewLookup(empty, receita, false);
    expect(r).toEqual({
      kind: 'apply',
      fields: { name: receita.name, tradeName: 'PAO QUENTE', city: 'Recife/PE', email: 'contato@paoquente.com.br', regime: 'SIMPLES_NACIONAL', porte: 'PEQUENA_EMPRESA' },
    });
  });

  it('nome digitado da mesma empresa: mantém o que foi digitado e completa os vazios', () => {
    const r = reviewLookup({ ...empty, name: 'Padaria Pão Quente Ltda', city: 'Olinda/PE' }, receita, false);
    expect(r.kind).toBe('apply');
    if (r.kind !== 'apply') return;
    expect(r.fields.name).toBeUndefined();
    expect(r.fields.city).toBeUndefined();
    expect(r.fields.tradeName).toBe('PAO QUENTE');
  });

  it('nome digitado de outra empresa: pergunta antes de preencher', () => {
    const r = reviewLookup({ ...empty, name: 'Mercado Bom Preço' }, receita, false);
    expect(r).toMatchObject({ kind: 'other-company', typed: 'Mercado Bom Preço', receitaName: receita.name, receitaCity: 'Recife/PE' });
    // Ao aceitar, os dados da Receita substituem os digitados.
    if (r.kind === 'other-company') expect(r.fields.name).toBe(receita.name);
  });

  it('atualização pelo botão: lista só o que muda, inclusive regime e porte', () => {
    const form = { ...empty, name: 'Padaria Pão Quente Ltda - ME', tradeName: 'Pao Quente', city: 'Olinda/PE', email: 'contato@paoquente.com.br' };
    const r = reviewLookup(form, receita, true);
    expect(r.kind).toBe('changes');
    if (r.kind !== 'changes') return;
    expect(r.otherCompany).toBe(false);
    expect(r.changes).toEqual([
      { field: 'city', from: 'Olinda/PE', to: 'Recife/PE' },
      { field: 'porte', from: 'MICROENTIDADE', to: 'PEQUENA_EMPRESA' },
    ]);
    expect(r.fields).toEqual({ city: 'Recife/PE', porte: 'PEQUENA_EMPRESA' });
  });

  it('atualização pelo botão sem diferenças: avisa que já está igual', () => {
    const form: ClientFormFields = { ...empty, name: receita.name, tradeName: 'PAO QUENTE', city: 'Recife/PE', email: 'contato@paoquente.com.br', porte: 'PEQUENA_EMPRESA' };
    expect(reviewLookup(form, receita, true)).toEqual({ kind: 'unchanged' });
  });

  it('atualização pelo botão com o nome de outra empresa: marca a divergência', () => {
    const r = reviewLookup({ ...empty, name: 'Mercado Bom Preço' }, receita, true);
    expect(r).toMatchObject({ kind: 'changes', otherCompany: true });
  });
});
