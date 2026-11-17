import { expect, test } from '@playwright/test';

/**
 * Balanço de abertura × Bens e Contratos: o veículo cadastrado antes da abertura precisa estar
 * nela (custo e depreciação acumulada); um clique usa os valores do cadastro. A composição de um
 * saldo fica gravada e o relatório do balanço de abertura sai em PDF e Excel.
 */

const client = { id: 'c-aurora', orgId: 'local', name: 'Aurora Alimentos Ltda', tradeName: 'Padaria Aurora', cnpj: '11.222.333/0001-81', regime: 'SIMPLES_NACIONAL', createdAt: '', updatedAt: '' };
// Veículo de R$ 60.000 a 20% a.a. em uso desde 01/01/2025: na abertura de 01/03/2026, 14 cotas de R$ 1.000.
const register = {
  id: 'c-aurora',
  orgId: 'local',
  clientId: 'c-aurora',
  updatedAt: '',
  assets: [
    { id: 'a1', description: 'Fiorino', accountId: 'fora-do-plano', accountCode: '1.2.3.04', use: 'EXPENSE', acquisitionDate: '2025-01-01', inUseDate: '2025-01-01', invoiceValue: 60000, annualRate: 20, createdAt: '', updatedAt: '' },
  ],
};

test('abertura: conferência com os cadastros, composição do saldo e relatório', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    ({ client, register }) => {
      if (sessionStorage.getItem('seeded')) return;
      localStorage.setItem('contaflow_clients', JSON.stringify([client]));
      localStorage.setItem('contaflow_fixed_assets', JSON.stringify([register]));
      sessionStorage.setItem('seeded', '1');
    },
    { client, register }
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Usar credenciais de teste local' }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/painel');

  await page.goto('/plano-de-contas');
  await page.getByRole('button', { name: 'Modelo de plano de contas (CFC)' }).first().click();
  await expect(page.getByRole('tree', { name: 'Plano de contas' })).toBeVisible();

  await page.goto('/abertura');
  await page.getByLabel('Data do balanço de abertura').fill('2026-03-01');

  const check = page.getByRole('region', { name: 'Conferência com Bens e Contratos' });
  await expect(check).toContainText('2 conta(s) a conferir');
  await expect(check.getByRole('listitem').filter({ hasText: 'Veículos' })).toContainText('R$ 60.000,00');
  await expect(check.getByRole('listitem').filter({ hasText: 'Depreciação' })).toContainText('R$ 14.000,00');
  await expect(check).toContainText('até 02/2026');
  await check.getByRole('button', { name: 'Usar os valores dos cadastros (2)' }).click();
  await expect(check).toContainText('Tudo confere');
  await expect(page.getByLabel('Veículos', { exact: true })).toHaveValue('60.000,00');

  // Saldo sem bem cadastrado em outra conta do imobilizado é apontado.
  await page.getByRole('checkbox', { name: 'Mostrar todas as contas' }).check();
  await page.getByLabel('Máquinas e Equipamentos', { exact: true }).fill('9000');
  await expect(check.getByRole('listitem').filter({ hasText: 'Máquinas' })).toContainText('saldo na abertura sem bem cadastrado');
  await page.getByLabel('Máquinas e Equipamentos', { exact: true }).fill('');
  await page.getByRole('checkbox', { name: 'Mostrar todas as contas' }).uncheck();

  // Composição do saldo do veículo.
  await page.getByRole('button', { name: 'Composição de Veículos' }).click();
  await page.getByLabel('Composição do saldo de Veículos').fill('Fiorino 2024 — NF 4471 — 60.000,00');

  // Sem salvar, o relatório não sai.
  await expect(page.getByRole('button', { name: 'PDF' })).toBeDisabled();
  await page.getByRole('button', { name: 'Salvar' }).first().click();
  await expect(page.getByRole('button', { name: 'PDF' })).toBeEnabled();

  // A composição voltou do que foi gravado.
  await page.reload();
  await page.getByRole('button', { name: 'Composição de Veículos' }).click();
  await expect(page.getByLabel('Composição do saldo de Veículos')).toHaveValue('Fiorino 2024 — NF 4471 — 60.000,00');

  const pdf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF' }).click();
  expect((await pdf).suggestedFilename()).toBe('Balanco_de_Abertura_Padaria_Aurora_2026-03-01.pdf');
  const xlsx = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel' }).click();
  expect((await xlsx).suggestedFilename()).toBe('Balanco_de_Abertura_Padaria_Aurora_2026-03-01.xlsx');

  expect(errors).toEqual([]);
});
