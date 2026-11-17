import { expect, test } from '@playwright/test';

/**
 * IBS/CBS no Simples: com as notas do ano, a tela mostra a receita por tipo de cliente, observa
 * a alíquota do Simples nas notas de venda, pede a alíquota cheia que as notas não trazem e
 * compara dentro do DAS × por fora, com o relatório em PDF.
 */

const client = { id: 'c-aurora', orgId: 'local', name: 'Aurora Alimentos Ltda', tradeName: 'Padaria Aurora', cnpj: '11.222.333/0001-81', regime: 'SIMPLES_NACIONAL', createdAt: '', updatedAt: '' };
let n = 0;
const inv = (over: Record<string, unknown>) => {
  n++;
  const key = String(n).padStart(44, '0');
  return {
    id: `c-aurora_${key}`,
    orgId: 'local',
    clientId: 'c-aurora',
    key,
    number: String(n),
    series: '1',
    model: '55',
    issueDate: '2026-06-10',
    direction: 'SALE',
    counterpartyDoc: '',
    counterpartyName: 'Cliente',
    total: 0,
    cfops: [],
    installments: [],
    status: 'AUTHORIZED',
    importedAt: '',
    ...over,
  };
};
const invoices = [
  // 60.000 a empresas (uma traz o IBS/CBS do Simples: 3,5%) e 40.000 a pessoa física.
  inv({ total: 50000, counterpartyDoc: '11444777000161', simplesTax: { base: 50000, ibs: 500, cbs: 1250 } }),
  inv({ total: 10000, counterpartyDoc: '44555666000181' }),
  inv({ total: 40000, counterpartyDoc: '52998224725' }),
  // Compra com 2.000 de IBS/CBS, sem a base: a alíquota cheia não é observada.
  inv({ direction: 'PURCHASE', total: 20000, ibs: 200, cbs: 1800, ibsCbsItems: [{ cClassTrib: '000001', cst: '000', ibs: 200, cbs: 1800 }] }),
];

test('simulação IBS/CBS dentro do DAS × por fora', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date(2026, 10, 17, 12, 0, 0));
  await page.addInitScript(
    ({ client, invoices }) => {
      if (sessionStorage.getItem('seeded')) return;
      localStorage.setItem('contaflow_clients', JSON.stringify([client]));
      localStorage.setItem('contaflow_invoice_summaries', JSON.stringify(invoices));
      sessionStorage.setItem('seeded', '1');
    },
    { client, invoices }
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Usar credenciais de teste local' }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/painel');
  // Fora do menu: abre pelo atalho de Notas Fiscais, que fica marcada.
  await page.goto('/nfe');
  await page.getByRole('link', { name: 'IBS/CBS: dentro ou fora do DAS' }).click();
  await page.waitForURL('**/simples-ibs-cbs');
  await expect(page).toHaveTitle('IBS/CBS no Simples · ContaFlow');

  const numbers = page.getByRole('region', { name: 'Números do período' });
  await expect(numbers).toContainText('R$ 100.000,00');
  await expect(numbers).toContainText('R$ 60.000,00');
  await expect(numbers).toContainText('R$ 2.000,00');

  const simplesRate = page.getByLabel('No Simples (parte da alíquota efetiva)');
  await expect(simplesRate).toHaveValue('3,5');
  await expect(page.getByText('Observada em 1 nota(s) de venda (3,5%).')).toBeVisible();
  await expect(page.getByText('Informe as duas alíquotas para comparar.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'PDF' })).toBeDisabled();

  await page.getByLabel('Por fora (alíquota cheia do regime regular)').fill('10');
  const comparison = page.getByRole('region', { name: 'Comparação' });
  // Dentro: 3,5% de 100.000. Por fora: 10% de 100.000 − 2.000 de crédito.
  await expect(comparison.getByRole('row', { name: /IBS \+ CBS pagos pela empresa/ })).toContainText('R$ 3.500,00');
  await expect(comparison.getByRole('row', { name: /IBS \+ CBS pagos pela empresa/ })).toContainText('R$ 8.000,00');
  await expect(comparison.getByRole('row', { name: /Crédito dos clientes empresa/ })).toContainText('R$ 6.000,00');
  // Empata com 69,2% das vendas a empresas; foram 60%.
  await expect(comparison.getByRole('status')).toContainText('passam de 69,2% do total; no período elas foram 60%: dentro do DAS tende a sair mais barato.');

  const pdf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF' }).click();
  expect((await pdf).suggestedFilename()).toBe('IBS_CBS_Simples_Padaria_Aurora.pdf');
  expect(errors).toEqual([]);
});

test('empresa fora do Simples não simula', async ({ page }) => {
  await page.addInitScript((c) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.setItem('contaflow_clients', JSON.stringify([{ ...c, regime: 'LUCRO_PRESUMIDO' }]));
    sessionStorage.setItem('seeded', '1');
  }, client);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Usar credenciais de teste local' }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/painel');
  await page.goto('/simples-ibs-cbs');
  await expect(page.getByText('Simulação para empresa do Simples Nacional')).toBeVisible();
});
