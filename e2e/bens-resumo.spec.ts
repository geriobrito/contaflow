import { expect, test } from '@playwright/test';

/**
 * Resumo de Bens e Contratos: os cinco controles na competência (saldo e rotina do mês), a
 * situação de cada um e a agenda do que vence nos meses seguintes, a partir dos cadastros.
 */

const client = { id: 'c-aurora', orgId: 'local', name: 'Aurora Alimentos Ltda', tradeName: 'Padaria Aurora', cnpj: '11.222.333/0001-81', regime: 'SIMPLES_NACIONAL', createdAt: '', updatedAt: '' };
const reg = { id: 'c-aurora', orgId: 'local', clientId: 'c-aurora', updatedAt: '' };

const seed = {
  contaflow_clients: [client],
  // Veículo de R$ 60.000 a 20% ao ano: R$ 1.000 por mês desde 01/2026.
  contaflow_fixed_assets: [
    {
      ...reg,
      assets: [
        { id: 'a1', description: 'Fiorino', accountId: 'x', accountCode: '1.2.3.04', use: 'EXPENSE', acquisitionDate: '2026-01-01', inUseDate: '2026-01-01', invoiceValue: 60000, annualRate: 20, createdAt: '', updatedAt: '' },
      ],
    },
  ],
  // Seguro de R$ 2.400 em 12 meses desde 10/05/2025: vigência termina em 10/05/2026.
  contaflow_prepaid_expenses: [
    {
      ...reg,
      items: [
        {
          id: 'p1', kind: 'INSURANCE', description: 'Seguro da Fiorino', documentRef: '998', use: 'EXPENSE', amount: 2400, startDate: '2025-05-10', months: 12,
          assetAccountId: 'x', assetAccountCode: '1.1.4.01', payableAccountId: 'y', payableAccountCode: '2.1.3.05', expenseAccountId: 'z', expenseAccountCode: '3.3.2.10', createdAt: '', updatedAt: '',
        },
      ],
    },
  ],
  // Empréstimo de R$ 3.000 em 3 × R$ 1.100, de 05/03 a 05/05/2026.
  contaflow_financing_contracts: [
    {
      ...reg,
      contracts: [
        {
          id: 'f1', kind: 'LOAN', description: 'Capital de giro', lender: 'Banco X', date: '2026-02-05', principal: 3000, installments: 3, installmentAmount: 1100, firstDueDate: '2026-03-05', interestMode: 'PREFIXED',
          counterpartAccountId: 'b', counterpartAccountCode: '1.1.1.02', shortTermAccountId: 's', shortTermAccountCode: '2.1.1.01', longTermAccountId: 'l', longTermAccountCode: '2.2.1.01',
          interestExpenseAccountId: 'j', interestExpenseAccountCode: '3.4.1.01', createdAt: '', updatedAt: '',
        },
      ],
    },
  ],
};

test('resumo: posição dos controles, situação do mês e próximos vencimentos', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date(2026, 2, 16, 12, 0, 0));
  await page.addInitScript((data) => {
    if (sessionStorage.getItem('seeded')) return;
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, JSON.stringify(v));
    sessionStorage.setItem('seeded', '1');
  }, seed);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Usar credenciais de teste local' }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/painel');
  await page.goto('/bens-e-contratos?mes=2026-03');

  // Aba nova, marcada, com a competência levada para as demais.
  const tabs = page.getByRole('navigation', { name: 'Bens e contratos' });
  await expect(tabs.getByRole('link', { name: 'Resumo' })).toHaveAttribute('aria-current', 'page');
  await expect(tabs.getByRole('link', { name: /^Imobilizado/ })).toHaveAttribute('href', '/imobilizado?mes=2026-03');

  // Imobilizado: 3 cotas de R$ 1.000 sobre R$ 60.000.
  const assets = page.getByRole('article', { name: 'Imobilizado' });
  await expect(assets).toContainText('1 bem(ns) em uso');
  await expect(assets).toContainText('R$ 57.000,00');
  await expect(assets).toContainText('R$ 1.000,00');
  await expect(assets.getByText('A lançar')).toBeVisible();

  // Seguro: 11 de 12 cotas até março; resta uma de R$ 200.
  const prepaid = page.getByRole('article', { name: 'Seguros e despesas antecipadas' });
  await expect(prepaid).toContainText('R$ 200,00');

  // Empréstimo: uma parcela em março.
  const loans = page.getByRole('article', { name: 'Empréstimos e financiamentos' });
  await expect(loans).toContainText('1 contrato(s) em aberto');
  await expect(loans).toContainText('1 parcela(s) no mês');
  await expect(loans).toContainText('R$ 1.100,00');

  // Controles sem cadastro levam ao cadastro.
  const stock = page.getByRole('article', { name: 'Estoque e CMV' });
  await expect(stock.getByText('Sem cadastro')).toBeVisible();
  await expect(stock.getByRole('link', { name: /Configurar estoque/ })).toHaveAttribute('href', '/estoque?mes=2026-03');

  // Agenda: parcelas até a quitação e o fim da vigência do seguro.
  const agenda = page.getByRole('region', { name: 'Próximos vencimentos' });
  await expect(agenda).toContainText('2 pede(m) atenção');
  await expect(agenda.getByText('Parcela 1/3: Capital de giro')).toBeVisible();
  await expect(agenda.getByText('Última parcela: Capital de giro')).toBeVisible();
  await expect(agenda.getByText('Fim da vigência: Seguro da Fiorino')).toBeVisible();

  // Outra competência: a posição e a agenda acompanham.
  await page.getByLabel('Competência').fill('2026-06');
  await expect(loans).toContainText('0 contrato(s) em aberto');
  await expect(agenda).toContainText('Nada vence no período');
  await expect(tabs.getByRole('link', { name: /^Imobilizado/ })).toHaveAttribute('href', '/imobilizado?mes=2026-06');
  expect(errors).toEqual([]);
});
