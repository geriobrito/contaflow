import { describe, expect, it } from 'vitest';
import type { AccountType, BankTransaction, ChartAccount } from '@/types/firestore';
import { orderAccountsByDirection, suggestAccounts } from '@/lib/account-suggestions';

const account = (id: string, type: AccountType, nature: ChartAccount['nature'] = 'ANALYTIC'): ChartAccount => ({
  id,
  clientId: 'c',
  code: id,
  name: id,
  type,
  nature,
  level: 4,
  createdAt: '',
  updatedAt: '',
});

const accounts = [
  account('banco', 'ASSET'),
  account('clientes', 'ASSET'),
  account('fornecedores', 'LIABILITY'),
  account('capital', 'EQUITY'),
  account('receita', 'REVENUE'),
  account('cmv', 'COST'),
  account('energia', 'EXPENSE'),
  account('aluguel', 'EXPENSE'),
  account('telefone', 'EXPENSE'),
  account('grupo-despesas', 'EXPENSE', 'SYNTHETIC'),
];

let n = 0;
const tx = (memo: string, amount: number, extra: Partial<BankTransaction> = {}): BankTransaction => ({
  id: `t${++n}`,
  clientId: 'c',
  fitid: `f${n}`,
  date: '2025-03-10',
  amount,
  type: amount < 0 ? 'DEBIT' : 'CREDIT',
  memo,
  status: 'RECONCILED',
  createdAt: '',
  ...extra,
});

describe('ordem das contas pelo sentido', () => {
  it('saída: despesas e custos primeiro; entrada: receitas primeiro; nada fica de fora', () => {
    const out = orderAccountsByDirection(accounts, 'OUT').map((a) => a.id);
    expect(out.slice(0, 5)).toEqual(['energia', 'aluguel', 'telefone', 'grupo-despesas', 'cmv']);
    expect(out).toHaveLength(accounts.length);
    expect(orderAccountsByDirection(accounts, 'IN')[0].id).toBe('receita');
    expect(orderAccountsByDirection(accounts, null).map((a) => a.id)).toEqual(accounts.map((a) => a.id));
  });
});

describe('contas sugeridas', () => {
  const history = [
    tx('Pix enviado - ENERGISA DISTRIBUIDORA', -300, { accountId: 'energia', date: '2025-03-02' }),
    tx('Pix enviado - ENERGISA DISTRIBUIDORA', -310, { accountId: 'energia', date: '2025-02-02' }),
    tx('Pix enviado - IMOBILIARIA CENTRAL', -1200, { accountId: 'aluguel' }),
    tx('Pix enviado - IMOBILIARIA CENTRAL', -1200, { accountId: 'aluguel' }),
    tx('Pix enviado - IMOBILIARIA CENTRAL', -1200, { accountId: 'aluguel' }),
    tx('Pix recebido - ALFA LTDA', 5000, { accountId: 'receita' }),
    tx('Pix enviado - ENERGISA DISTRIBUIDORA', -290, { status: 'PENDING' }),
  ];

  it('nota fiscal, mesmo favorecido, recentes e mais usadas, nesta ordem e sem repetir', () => {
    const s = suggestAccounts({
      memo: 'Pix enviado - ENERGISA DISTRIBUIDORA',
      direction: 'OUT',
      accounts,
      history,
      invoiceAccountId: 'fornecedores',
      recent: ['energia', 'telefone', 'cmv'],
    });
    expect(s.map((x) => x.accountId)).toEqual(['fornecedores', 'energia', 'telefone', 'cmv', 'aluguel']);
    expect(s[0].reason).toBe('da nota fiscal');
    expect(s[1].reason).toBe('usada antes com ENERGISA DISTRIBUIDORA');
    expect(s[2].reason).toBe('usada recentemente');
    expect(s[4].reason).toBe('mais usada no período');
  });

  it('só olha lançamentos classificados do mesmo sentido; ignora os que estão sendo classificados', () => {
    const pending = history[6];
    const s = suggestAccounts({ memo: pending.memo, direction: 'OUT', accounts, history, excludeIds: new Set([history[0].id, history[1].id]) });
    // Sem o histórico da Energisa: só as mais usadas nas saídas (a receita é entrada).
    expect(s.map((x) => x.accountId)).toEqual(['aluguel']);
  });

  it('ignora contas sintéticas ou que não existem mais e respeita o limite', () => {
    const s = suggestAccounts({ memo: null, direction: null, accounts, history: [], recent: ['grupo-despesas', 'apagada', 'cmv'], limit: 1 });
    expect(s).toEqual([{ accountId: 'cmv', reason: 'usada recentemente' }]);
  });

  it('rateio conta todas as contas das linhas', () => {
    const split = tx('Pix enviado - POSTO', -100, { isSplit: true, splits: [{ id: 's1', accountId: 'cmv', amount: -60, memo: '' }, { id: 's2', accountId: 'telefone', amount: -40, memo: '' }] });
    const s = suggestAccounts({ memo: 'Pix enviado - POSTO', direction: 'OUT', accounts, history: [split] });
    expect(s.slice(0, 2).map((x) => x.accountId).sort()).toEqual(['cmv', 'telefone']);
  });
});
