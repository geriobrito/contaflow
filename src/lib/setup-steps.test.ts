import { describe, expect, it } from 'vitest';
import type { BankAccount, ChartAccount, OpeningBalances } from '@/types/firestore';
import { nextSetupStep, setupSteps, type SetupInput } from '@/lib/setup-steps';

const account = (id: string, code: string, type: ChartAccount['type'], nature: ChartAccount['nature'] = 'ANALYTIC') => ({ id, clientId: 'c1', code, name: code, type, nature }) as ChartAccount;
const bank = (over: Partial<BankAccount> = {}) => ({ id: 'b1', clientId: 'c1', accountKey: 'k1', nickname: 'Itaú', ledgerAccountId: 'banco', openingBalance: 1000, openingDate: '2026-01-01', ...over }) as BankAccount;

const accounts = [account('banco', '1.1.1.02', 'ASSET'), account('capital', '2.3.1.01', 'EQUITY')];
// Banco com 1.000,00 e capital de 1.000,00: ativo = passivo + PL.
const openings = { id: 'c1', clientId: 'c1', date: '2026-01-01', entries: [{ accountId: 'capital', amount: 1000 }], updatedAt: '' } as unknown as OpeningBalances;

const complete: SetupInput = {
  client: { activity: 'Comércio varejista de pães', legalRepresentativeName: 'Ana Aurora', legalRepresentativeCpf: '11144477735' },
  accounts,
  banks: [bank()],
  openings,
  rules: 3,
  org: { accountantName: 'Rogério', accountantCrc: 'SP-123456/O-0' },
};
const step = (input: Partial<SetupInput>, key: string) => setupSteps({ ...complete, ...input }).find((s) => s.key === key)!;

describe('implantação da empresa', () => {
  it('passos na ordem do menu de Cadastros', () => {
    expect(setupSteps(complete).map((s) => [s.key, s.href])).toEqual([
      ['client', '/clientes'],
      ['chart', '/plano-de-contas'],
      ['banks', '/contas'],
      ['opening', '/abertura'],
      ['rules', '/regras'],
      ['office', '/escritorio'],
    ]);
  });

  it('empresa recém-cadastrada: o plano de contas é o primeiro que trava', () => {
    const steps = setupSteps({ client: {}, accounts: [], banks: [], openings: null, rules: 0, org: null });
    expect(steps.map((s) => s.status)).toEqual(['hint', 'todo', 'todo', 'todo', 'hint', 'hint']);
    expect(nextSetupStep(steps)).toMatchObject({ key: 'chart', detail: expect.stringMatching(/aplique o modelo do CFC/) });
  });

  it('cliente: diz o que falta para as demonstrações', () => {
    expect(step({ client: { activity: 'Padaria' } }, 'client')).toMatchObject({ status: 'hint', detail: expect.stringMatching(/Falta no cadastro: representante legal \(nome e CPF\)\./) });
    expect(step({ client: {} }, 'client').detail).toMatch(/atividade principal e representante legal/);
  });

  it('contas: sem conta, sem vínculo contábil e sem saldo inicial, nessa ordem', () => {
    expect(step({ banks: [] }, 'banks')).toMatchObject({ status: 'todo', detail: expect.stringMatching(/Nenhuma conta bancária/) });
    expect(step({ banks: [bank({ ledgerAccountId: undefined, openingBalance: undefined })] }, 'banks').detail).toMatch(/1 conta bancária sem conta contábil/);
    expect(step({ banks: [bank({ openingBalance: undefined })] }, 'banks').detail).toBe('1 conta bancária sem saldo inicial.');
    expect(step({}, 'banks')).toMatchObject({ status: 'done', detail: '1 conta ligada ao plano, com saldo inicial.' });
  });

  it('abertura: não informada trava; informada e fechando fica conferida na data', () => {
    expect(step({ openings: null }, 'opening')).toMatchObject({ status: 'todo', detail: expect.stringMatching(/Saldos de abertura não informados/) });
    expect(step({}, 'opening')).toMatchObject({ status: 'done', detail: 'Abertura conferida em 01/01/2026.' });
  });

  it('tudo pronto: nada a fazer; só avisos pendentes apontam o primeiro deles', () => {
    expect(nextSetupStep(setupSteps(complete))).toBeNull();
    expect(nextSetupStep(setupSteps({ ...complete, rules: 0, org: null }))?.key).toBe('rules');
  });
});
