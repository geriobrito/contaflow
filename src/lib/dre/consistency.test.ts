import { describe, expect, it } from 'vitest';
import { checkAccountingConsistency } from '@/lib/dre/consistency';
import type { BankAccount, BankTransaction, ChartAccount } from '@/types/firestore';

const acc = (id: string, code: string, name: string, type: ChartAccount['type']): ChartAccount => ({
  id,
  clientId: 'c1',
  code,
  name,
  type,
  nature: 'ANALYTIC',
  level: code.split('.').length,
  createdAt: '',
  updatedAt: '',
});

const bank = (id: string, accountKey: string, ledgerAccountId?: string): BankAccount => ({
  id,
  clientId: 'c1',
  accountKey,
  nickname: 'Banco Itaú',
  ledgerAccountId,
  createdAt: '',
  updatedAt: '',
});

const tx = (id: string, date: string, amount: number, accountId: string, status: BankTransaction['status'] = 'RECONCILED'): BankTransaction => ({
  id,
  clientId: 'c1',
  fitid: id,
  accountKey: 'itau-1',
  date,
  amount,
  type: amount >= 0 ? 'CREDIT' : 'DEBIT',
  memo: `Lançamento ${id}`,
  status,
  accountId,
  createdAt: '',
});

describe('checkAccountingConsistency (DRE vs. Balanço Patrimonial)', () => {
  const accounts: ChartAccount[] = [
    acc('banco', '1.1.1.02.001', 'Itaú Movimento', 'ASSET'),
    acc('receita', '3.1.01.001', 'Receita de Serviços', 'REVENUE'),
    acc('despesa', '4.1.01.001', 'Despesas com Energia', 'EXPENSE'),
  ];
  const banks: BankAccount[] = [bank('b1', 'itau-1', 'banco')];

  it('valida que DRE e Balanço são 100% consistentes quando todos os lançamentos estão conciliados', () => {
    const transactions: BankTransaction[] = [
      tx('t1', '2025-03-10', 1000, 'receita', 'RECONCILED'),
      tx('t2', '2025-03-15', -300, 'despesa', 'RECONCILED'),
    ];

    const result = checkAccountingConsistency({
      transactions,
      accounts,
      banks,
      date: '2025-03-31',
    });

    expect(result.isConsistent).toBe(true);
    expect(result.dreNetResult).toBe(700);
    expect(result.balanceCurrentResult).toBe(700);
    expect(result.difference).toBe(0);
    expect(result.issues).toHaveLength(0);
  });

  it('detecta lançamentos a classificar / pendentes como causa de fechamento provisório', () => {
    const transactions: BankTransaction[] = [
      tx('t1', '2025-03-10', 1000, 'receita', 'RECONCILED'),
      tx('t2', '2025-03-15', -300, 'despesa', 'PENDING'),
    ];

    const result = checkAccountingConsistency({
      transactions,
      accounts,
      banks,
      date: '2025-03-31',
    });

    // A DRE só contabiliza lançamentos RECONCILED (1000 de receita)
    expect(result.dreNetResult).toBe(1000);
    expect(result.pendingCount).toBe(1);
    expect(result.suspenseAmount).toBe(300);

    const suspenseIssue = result.issues.find((i) => i.type === 'SUSPENSE_ENTRIES');
    expect(suspenseIssue).toBeDefined();
    expect(suspenseIssue?.description).toContain('1 lançamento(s) pendente(s)');
    expect(suspenseIssue?.description).toContain('300,00');
  });

  it('detecta contas bancárias sem vínculo contábil como causa de inconsistência', () => {
    const banksWithoutLedger: BankAccount[] = [bank('b1', 'itau-1', undefined)];
    const transactions: BankTransaction[] = [tx('t1', '2025-03-10', 500, 'receita', 'RECONCILED')];

    const result = checkAccountingConsistency({
      transactions,
      accounts,
      banks: banksWithoutLedger,
      date: '2025-03-31',
    });

    const unlinkedIssue = result.issues.find((i) => i.type === 'UNLINKED_BANKS');
    expect(unlinkedIssue).toBeDefined();
    expect(result.unlinkedBanksCount).toBe(1);
  });

  it('mantém 100% de consistência contábil ao incluir lançamentos manuais de fechamento (JournalEntry)', () => {
    const transactions: BankTransaction[] = [
      tx('t1', '2025-03-10', 1000, 'receita', 'RECONCILED'),
    ];

    const passivoConta: ChartAccount = acc('salarios_a_pagar', '2.1.01.001', 'Salários a Pagar', 'LIABILITY');
    const allAccounts = [...accounts, passivoConta];

    const journal: import('@/types/firestore').JournalEntry = {
      id: 'j1',
      clientId: 'c1',
      entryNumber: 1,
      date: '2025-03-31',
      memo: 'Provisão de folha mensal',
      category: 'PAYROLL',
      lines: [
        { id: 'l1', accountId: 'despesa', type: 'DEBIT', amount: 400, memo: 'Despesa' },
        { id: 'l2', accountId: 'salarios_a_pagar', type: 'CREDIT', amount: 400, memo: 'Passivo' },
      ],
      totalAmount: 400,
      createdAt: '',
      updatedAt: '',
      createdByUid: 'u1',
    };

    const result = checkAccountingConsistency({
      transactions,
      accounts: allAccounts,
      banks,
      date: '2025-03-31',
      journalEntries: [journal],
    });

    expect(result.isConsistent).toBe(true);
    expect(result.dreNetResult).toBe(600); // 1000 receita - 400 despesa provisionada
    expect(result.balanceCurrentResult).toBe(600);
    expect(result.difference).toBe(0);
    expect(result.issues).toHaveLength(0);
  });
});
