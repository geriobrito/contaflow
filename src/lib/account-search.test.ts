import { describe, expect, it } from 'vitest';
import { accountMatches, searchAccounts, singular } from '@/lib/account-search';
import { buildITG1000Chart } from '@/lib/chart/itg1000';

const chart = buildITG1000Chart('c1', '2025-01-01T00:00:00.000Z');
const names = (query: string) => searchAccounts(chart, query).map((a) => a.name);
const codes = (query: string) => searchAccounts(chart, query).map((a) => a.code);

describe('singular', () => {
  it('reduz os plurais comuns do português', () => {
    expect(singular('alugueis')).toBe('aluguel');
    expect(singular('materiais')).toBe('material');
    expect(singular('obrigacoes')).toBe('obrigacao');
    expect(singular('fornecedores')).toBe('fornecedor');
    expect(singular('bens')).toBe('bem');
    expect(singular('salarios')).toBe('salario');
    expect(singular('despesas')).toBe('despesa');
    expect(singular('mes')).toBe('mes');
  });
});

describe('busca de contas', () => {
  it('ignora acentos e maiúsculas', () => {
    expect(names('agua')).toContain('Água e Esgoto');
    expect(names('ENERGIA ELETRICA')).toContain('Energia Elétrica');
  });

  it('tolera singular e plural', () => {
    expect(names('aluguel')).toContain('Aluguéis e Condomínios');
    expect(names('salario')).toContain('Salários e Ordenados');
    expect(names('fornecedor')).toContain('Fornecedores Nacionais');
  });

  it('palavras em qualquer ordem, pelo começo de cada palavra', () => {
    const account = { code: '3.4.1.01.002', name: 'Despesas Bancárias' };
    expect(accountMatches(account, 'despesa banc')).toBe(true);
    expect(accountMatches(account, 'banc desp')).toBe(true);
    expect(accountMatches(account, 'despesa juros')).toBe(false);
  });

  it('número com ponto busca pelo código, começando pelo grupo', () => {
    const found = codes('3.3.2');
    expect(found[0]).toBe('3.3.2');
    expect(found).toContain('3.3.2.07');
    expect(found.every((c) => c.includes('3.3.2'))).toBe(true);
    expect(codes('3.3.2.07')[0]).toBe('3.3.2.07');
  });

  it('mais relevantes primeiro: nome que começa com o texto antes do que só o contém', () => {
    const accounts = [
      { code: '1', name: 'Aluguéis a Pagar' },
      { code: '2', name: 'Despesas com Aluguel' },
      { code: '3', name: 'Aluguéis e Condomínios' },
    ];
    expect(searchAccounts(accounts, 'alugueis').map((a) => a.code)).toEqual(['1', '3', '2']);
  });

  it('ainda acha um trecho no meio da palavra', () => {
    expect(accountMatches({ code: '1', name: 'Receitas Financeiras' }, 'nanc')).toBe(true);
  });

  it('sem texto devolve tudo na ordem original; sem resultado, lista vazia', () => {
    expect(searchAccounts(chart, '  ')).toHaveLength(chart.length);
    expect(searchAccounts(chart, 'xyzzy')).toEqual([]);
  });
});
