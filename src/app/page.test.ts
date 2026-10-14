import { createElement, type ComponentType } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { BankTransaction, ClassificationRule, PeriodLock } from '@/types/firestore';

/**
 * Renderização da tela de conciliação com dados simulados (sem navegador, sem Firestore):
 * garante que a página monta com lançamentos de todos os tipos e mostra o que deve.
 */

const tx = (n: number, extra: Partial<BankTransaction> = {}): BankTransaction => ({
  id: `c1_${n}`,
  clientId: 'c1',
  fitid: `f${n}`,
  date: `2025-03-${String((n % 28) + 1).padStart(2, '0')}`,
  amount: n % 2 ? -(n * 10.5) : n * 20,
  type: n % 2 ? 'DEBIT' : 'CREDIT',
  memo: `LANCAMENTO ${n}`,
  status: 'PENDING',
  createdAt: '',
  ...extra,
});

const transactions: BankTransaction[] = [
  tx(1),
  tx(2, { status: 'AUTO_CLASSIFIED', accountId: 'a1', accountCode: '3.1.01', accountName: 'Despesas bancárias', matchedRuleId: 'r1' }),
  tx(3, { status: 'RECONCILED', accountId: 'a1', accountCode: '3.1.01', accountName: 'Despesas bancárias' }),
  tx(4, {
    status: 'RECONCILED',
    isSplit: true,
    splits: [
      { id: 's1', accountId: 'a1', accountCode: '3.1.01', accountName: 'Despesas bancárias', amount: 50, memo: 'parte 1' },
      { id: 's2', accountId: 'a2', accountCode: '3.1.02', accountName: 'Tarifas', amount: 30, memo: '' },
    ],
  }),
  tx(5, { status: 'RECONCILED', accountId: 'a3', accountName: 'Transferências', transferPairId: 'c1_6' }),
  tx(6, { clientQuery: { question: 'O que é?', status: 'OPEN', askedAt: 'T', askedByUid: 'u' } }),
  tx(7, { date: '2025-02-10', memo: 'MES FECHADO' }),
  tx(8, { memo: 'transferÃªncia quebrada' }),
  // Mais de uma página.
  ...Array.from({ length: 60 }, (_, i) => tx(100 + i)),
];
const rules: ClassificationRule[] = [{ id: 'r1', clientId: 'c1', pattern: 'TARIFA', accountId: 'a1', createdAt: '', updatedAt: '' }];
const locks: PeriodLock[] = [{ id: 'c1_2025-02', clientId: 'c1', month: '2025-02', lockedAt: 'T', lockedByUid: 'u' }];

const action = () => Promise.reject(new Error('não usado no teste'));
const recon = {
  transactions,
  rules,
  locks,
  lockedMonths: new Set(['2025-02']),
  metrics: { total: 68, pending: 63, autoClassified: 1, reconciled: 4, reconciledPercent: 6, credits: 1234.5, debits: 987.65 },
  isLoading: false,
  isSaving: false,
  error: 'Falha ao importar o extrato (rede).',
  checkImport: action,
  updateMemos: action,
  importTransactions: action,
  classifyTransaction: action,
  classifyMany: action,
  splitTransaction: action,
  unreconcileTransaction: action,
  approveAutoClassified: action,
  closeMonth: action,
  reopenMonth: action,
  loadAudit: action,
  reconcileTransfers: action,
  askClient: action,
  resolveClientQuery: action,
  reload: action,
};

vi.mock('next/link', async () => {
  const react = await import('react');
  return {
    default: ({ href, children, ...rest }: { href: string; children?: unknown }) => react.createElement('a', { href, ...rest }, children as never),
  };
});
vi.mock('@/contexts/ClientContext', () => ({
  useClient: () => ({
    clients: [],
    currentClient: { id: 'c1', name: 'Empresa Teste Ltda', tradeName: 'Empresa Teste', cnpj: '', regime: 'MEI', createdAt: '', updatedAt: '' },
    isLoading: false,
    loadError: null,
  }),
}));
vi.mock('@/hooks/useReconciliation', async (original) => ({
  ...(await original<typeof import('@/hooks/useReconciliation')>()),
  useReconciliation: () => recon,
}));

const render = (Page: ComponentType) => renderToString(createElement(Page));

describe('tela de conciliação', () => {
  it('monta com lançamentos de todos os tipos: resumo, erro, tabela paginada e ações', async () => {
    const html = render((await import('@/app/page')).default);
    expect(html).toContain('Conciliação bancária');
    expect(html).toContain('Empresa Teste');
    // Resumo e erro da última operação.
    expect(html).toContain('Conciliado');
    expect(html).toContain('Falha ao importar o extrato (rede).');
    // Primeira página (50 de 68), com paginação.
    expect(html.match(/Selecionar lançamento /g)).toHaveLength(50);
    expect(html).toContain('LANCAMENTO 1');
    expect(html).toContain('Próxima');
    // Selos por situação do lançamento.
    expect(html).toContain('Rateado em');
    expect(html).toContain('Transferência entre contas próprias');
    expect(html).toContain('Aguardando resposta do cliente');
    expect(html).toContain('Competência fechada');
    // Aviso de acentuação quebrada e aprovação em lote disponível.
    expect(html).toContain('Corrigir em Contas e Extratos');
    expect(html).toContain('Aprovar todos os auto-classificados');
  });
});
