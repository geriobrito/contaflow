import { describe, expect, it } from 'vitest';
import { blockingIssues, clientIssues, duplicateCnpjs, sortClients } from '@/lib/client-health';
import type { ClientCompany } from '@/types/firestore';

const today = '2026-11-16';

/** Cadastro sem nenhuma pendência. */
const full: ClientCompany = {
  id: 'c1',
  name: 'Aurora Alimentos Ltda',
  tradeName: 'Padaria Aurora',
  cnpj: '11.222.333/0001-81',
  regime: 'SIMPLES_NACIONAL',
  city: 'Recife/PE',
  activity: 'Fabricação de produtos de panificação',
  legalRepresentativeName: 'Ana',
  legalRepresentativeCpf: '529.982.247-25',
  email: 'ana@aurora.com',
  address: { cep: '51020000', street: 'Rua das Flores' },
  registration: { status: 'ATIVA', fetchedAt: '2026-06-01T12:00:00.000Z', simples: { optant: true }, mei: { optant: false } },
  partners: [{ name: 'Ana' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

const ids = (c: ClientCompany, duplicates?: Set<string>) => clientIssues(c, { today, duplicates }).map((i) => i.id);

describe('clientIssues', () => {
  it('cadastro completo e conferido na Receita: nenhuma pendência', () => {
    expect(ids(full)).toEqual([]);
  });

  it('cadastro mínimo: aponta o que falta, graves e médias antes das leves', () => {
    const bare: ClientCompany = { id: 'c2', name: 'Mínima Ltda', cnpj: '11222333000181', regime: 'SIMPLES_NACIONAL', createdAt: '', updatedAt: '' };
    expect(ids(bare)).toEqual(['representative', 'activity', 'city', 'receita', 'address', 'partners', 'contact']);
    expect(blockingIssues(clientIssues(bare, { today })).map((i) => i.id)).toEqual(['representative', 'activity', 'city']);
  });

  it('situação diferente de ATIVA é grave e vem primeiro', () => {
    const issues = clientIssues({ ...full, activity: undefined, registration: { ...full.registration, status: 'Baixada', statusReason: 'Extinção' } }, { today });
    expect(issues[0]).toMatchObject({ id: 'status', severity: 'high', label: 'Situação BAIXADA na Receita', tab: 'cartao' });
    expect(issues[0].detail).toContain('Extinção');
  });

  it('regime x opção pelo Simples/SIMEI do cartão CNPJ', () => {
    const withReg = (regime: ClientCompany['regime'], simples: boolean, mei: boolean): ClientCompany => ({
      ...full,
      regime,
      registration: { ...full.registration, simples: { optant: simples }, mei: { optant: mei } },
    });
    expect(ids(withReg('SIMPLES_NACIONAL', false, false))).toEqual(['regime']);
    expect(ids(withReg('SIMPLES_NACIONAL', true, true))).toEqual(['regime']);
    expect(ids(withReg('LUCRO_PRESUMIDO', true, false))).toEqual(['regime']);
    expect(ids(withReg('MEI', true, false))).toEqual(['regime']);
    expect(ids(withReg('MEI', true, true))).toEqual([]);
    expect(ids(withReg('LUCRO_REAL', false, false))).toEqual([]);
    // Sem a informação da Receita, não há o que comparar.
    expect(ids({ ...full, regime: 'LUCRO_REAL', registration: { status: 'ATIVA', fetchedAt: full.registration?.fetchedAt } })).toEqual([]);
  });

  it('MEI não tem quadro de sócios a cobrar', () => {
    expect(ids({ ...full, regime: 'MEI', partners: undefined, registration: { ...full.registration, mei: { optant: true } } })).toEqual([]);
  });

  it('consulta à Receita com um ano ou mais é antiga', () => {
    const at = (fetchedAt: string) => clientIssues({ ...full, registration: { ...full.registration, fetchedAt } }, { today });
    expect(at('2025-11-17T00:00:00.000Z')).toEqual([]);
    expect(at('2025-11-16T00:00:00.000Z')[0]).toMatchObject({ id: 'receita', severity: 'low', label: 'Receita consultada há 12 meses' });
    expect(at('2024-01-10T00:00:00.000Z')[0].label).toBe('Receita consultada há 34 meses');
  });

  it('cartão preenchido à mão (sem data de consulta) não é cobrado como "não consultado"', () => {
    expect(ids({ ...full, registration: { status: 'ATIVA', source: 'manual' } })).toEqual([]);
  });

  it('CNPJ inválido e CNPJ repetido na carteira', () => {
    expect(ids({ ...full, cnpj: '11.222.333/0001-00' })).toEqual(['cnpj']);
    const twin = { ...full, id: 'c9', cnpj: '11222333000181' };
    const dup = duplicateCnpjs([full, twin, { ...full, id: 'c3', cnpj: '44.555.666/0001-00', deletingAt: 'T' }]);
    expect([...dup]).toEqual(['11222333000181']);
    expect(ids(full, dup)).toEqual(['duplicate']);
  });

  it('empresa com exclusão incompleta não é diagnosticada', () => {
    expect(ids({ ...full, activity: undefined, deletingAt: 'T' })).toEqual([]);
  });
});

describe('sortClients', () => {
  const a: ClientCompany = { ...full, id: 'a', tradeName: 'Zeta', clientSince: '2020-05-01', updatedAt: '2026-03-01' };
  const b: ClientCompany = { ...full, id: 'b', tradeName: undefined, name: 'Álamo Ltda', clientSince: undefined, activity: undefined, updatedAt: '2026-09-01' };
  const c: ClientCompany = { ...full, id: 'c', tradeName: 'Mar', clientSince: '2018-01-01', email: undefined, updatedAt: '2026-01-01', registration: { ...full.registration, status: 'INAPTA' } };
  const issuesOf = (x: ClientCompany) => clientIssues(x, { today });
  const order = (sort: Parameters<typeof sortClients>[1], list = [a, b, c]) => sortClients(list, sort, issuesOf).map((x) => x.id);

  it('por nome de exibição, sem diferenciar acento', () => {
    expect(order('name')).toEqual(['b', 'c', 'a']);
  });

  it('por pendências: uma grave pesa mais que as demais', () => {
    expect(order('issues')).toEqual(['c', 'b', 'a']);
  });

  it('por cliente desde (sem data no fim) e por alteração mais recente', () => {
    expect(order('since')).toEqual(['c', 'a', 'b']);
    expect(order('recent')).toEqual(['b', 'a', 'c']);
  });

  it('exclusão incompleta fica sempre no topo', () => {
    const d: ClientCompany = { ...full, id: 'd', tradeName: 'Zzz', deletingAt: 'T' };
    expect(order('name', [a, b, d])[0]).toBe('d');
  });
});
