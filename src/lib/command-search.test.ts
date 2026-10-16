import { describe, expect, it } from 'vitest';
import { matchScore, normalize, searchCommands, type CommandEntry } from '@/lib/command-search';

const entries: CommandEntry[] = [
  { id: 'p-painel', group: 'Telas', label: 'Painel', hint: 'Rotina', keywords: 'inicio carteira' },
  { id: 'p-conc', group: 'Telas', label: 'Conciliação', hint: 'Rotina', keywords: 'extrato ofx' },
  { id: 'p-bal', group: 'Telas', label: 'Balanço e Balancete', hint: 'Demonstrações', keywords: 'dlpa' },
  { id: 'p-ab', group: 'Telas', label: 'Balanço de Abertura', hint: 'Demonstrações' },
  { id: 'c-aurora', group: 'Empresas', label: 'Padaria Aurora', hint: 'Aurora Alimentos Ltda · 11.222.333/0001-81' },
  { id: 'c-luz', group: 'Empresas', label: 'Luz Contábil', hint: '44.555.666/0001-00' },
  { id: 'a-dark', group: 'Ações', label: 'Tema: Escuro', keywords: 'dark modo noturno' },
];

describe('busca rápida', () => {
  it('ignora acentos e maiúsculas', () => {
    expect(normalize('  Conciliação  BANCÁRIA ')).toBe('conciliacao bancaria');
    expect(searchCommands('conciliacao', entries).map((e) => e.id)).toEqual(['p-conc']);
  });

  it('palavras em qualquer ordem, também nas dicas e palavras-chave', () => {
    expect(searchCommands('abertura balanço', entries).map((e) => e.id)).toEqual(['p-ab']);
    expect(searchCommands('ofx', entries).map((e) => e.id)).toEqual(['p-conc']);
    expect(searchCommands('alimentos', entries).map((e) => e.id)).toEqual(['c-aurora']);
  });

  it('empresa pelo CNPJ, com ou sem pontuação', () => {
    expect(searchCommands('11222333', entries).map((e) => e.id)).toEqual(['c-aurora']);
    expect(searchCommands('44.555', entries).map((e) => e.id)).toEqual(['c-luz']);
  });

  it('empresas primeiro; no grupo, o nome que começa com o texto vem antes', () => {
    expect(searchCommands('bal', entries).map((e) => e.id)).toEqual(['p-bal', 'p-ab']);
    expect(searchCommands('a', entries)[0].group).toBe('Empresas');
    expect(matchScore('balancete', entries[2])).toBe(1);
    expect(matchScore('dlpa', entries[2])).toBe(3);
  });

  it('sem texto, tudo na ordem dos grupos; sem resultado, lista vazia', () => {
    expect(searchCommands('', entries).map((e) => e.group)).toEqual(['Empresas', 'Empresas', 'Telas', 'Telas', 'Telas', 'Telas', 'Ações']);
    expect(searchCommands('xyz', entries)).toEqual([]);
  });
});
