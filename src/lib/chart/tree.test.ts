import { describe, expect, it } from 'vitest';
import type { AccountType, ChartAccount, DREGroup } from '@/types/firestore';
import { buildTree, codeError, defaultParent, filterTree, inheritedDREGroup, isCodeTaken, suggestCode } from '@/lib/chart/tree';

function acc(code: string, name: string, type: AccountType, extra: Partial<ChartAccount> = {}): ChartAccount {
  return {
    id: `id-${code}`,
    clientId: 'c1',
    code,
    name,
    type,
    nature: code.split('.').length >= 4 ? 'ANALYTIC' : 'SYNTHETIC',
    level: code.split('.').length,
    createdAt: '',
    updatedAt: '',
    ...extra,
  };
}

const ACCOUNTS: ChartAccount[] = [
  acc('1', 'Ativo', 'ASSET'),
  acc('1.1', 'Circulante', 'ASSET'),
  acc('1.1.01', 'Disponível', 'ASSET'),
  acc('1.1.01.001', 'Caixa', 'ASSET'),
  acc('4', 'Despesas', 'EXPENSE'),
  acc('4.1', 'Operacionais', 'EXPENSE'),
  acc('4.1.02', 'Administrativas', 'EXPENSE', { dreGroup: 'OPERATING_EXPENSES' as DREGroup }),
  acc('4.1.02.001', 'Aluguel', 'EXPENSE'),
  acc('4.1.02.003', 'Energia elétrica', 'EXPENSE'),
];

describe('buildTree', () => {
  it('monta a hierarquia pelo código e ordena numericamente', () => {
    const tree = buildTree(ACCOUNTS);
    expect(tree.map((n) => n.account.code)).toEqual(['1', '4']);
    const adm = tree[1].children[0].children[0];
    expect(adm.account.code).toBe('4.1.02');
    expect(adm.depth).toBe(2);
    expect(adm.children.map((n) => n.account.code)).toEqual(['4.1.02.001', '4.1.02.003']);
  });

  it('pula níveis ausentes ligando ao ancestral mais próximo', () => {
    const tree = buildTree([acc('1', 'Ativo', 'ASSET'), acc('1.1.01.001', 'Caixa', 'ASSET')]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children[0].account.code).toBe('1.1.01.001');
  });
});

describe('filterTree', () => {
  it('mantém os ancestrais de cada conta encontrada', () => {
    const visible = filterTree(buildTree(ACCOUNTS), 'energia');
    expect(visible.map((n) => n.account.code)).toEqual(['4']);
    expect(visible[0].children[0].children[0].children.map((n) => n.account.code)).toEqual(['4.1.02.003']);
  });

  it('mostra os filhos de um grupo encontrado pelo nome', () => {
    const visible = filterTree(buildTree(ACCOUNTS), 'administrativas');
    expect(visible[0].children[0].children[0].children).toHaveLength(2);
  });
});

describe('códigos', () => {
  it('considera ocupado o código usado como prefixo de outra conta', () => {
    expect(isCodeTaken('4.1.02', ACCOUNTS)).toBe(true);
    expect(isCodeTaken('4.1.02.002', ACCOUNTS)).toBe(false);
  });

  it('sugere o próximo código depois do maior usado', () => {
    const adm = ACCOUNTS.find((a) => a.code === '4.1.02');
    expect(suggestCode(adm, ACCOUNTS)).toBe('4.1.02.004');
    expect(suggestCode(undefined, ACCOUNTS)).toBe('');
  });

  it('valida código repetido e fora do grupo', () => {
    const adm = ACCOUNTS.find((a) => a.code === '4.1.02');
    expect(codeError('4.1.02.001', ACCOUNTS, adm)).toBe('Código já utilizado.');
    expect(codeError('4.1.03.001', ACCOUNTS, adm)).toBe('Deve começar com 4.1.02.');
    expect(codeError('4.1.02.010', ACCOUNTS, adm)).toBeNull();
  });
});

describe('sugestões para nova conta', () => {
  it('escolhe o grupo mais específico com mais contas de resultado', () => {
    expect(defaultParent(ACCOUNTS)?.code).toBe('4.1.02');
  });

  it('herda o grupo da DRE do pai', () => {
    const adm = ACCOUNTS.find((a) => a.code === '4.1.02');
    expect(inheritedDREGroup(adm, ACCOUNTS)).toBe('OPERATING_EXPENSES');
    expect(inheritedDREGroup(undefined, ACCOUNTS)).toBe('');
  });
});
