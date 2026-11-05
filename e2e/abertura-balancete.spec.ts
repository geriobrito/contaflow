import { expect, test } from '@playwright/test';
import { mockReceita } from './receita';

/**
 * Implantação com balanço anterior: o balancete do contador anterior, colado do Excel, preenche
 * a abertura. Linhas de grupo e de total ficam de fora; uma conta de outro plano é escolhida à mão.
 */
const BALANCETE = [
  'Código\tConta\tSaldo atual\t',
  '1\tATIVO\t9.400,00\tD',
  '1.1.1.01\tCaixa\t1.400,00\tD',
  '1.1.2.01\tClientes\t2.000,00\tD',
  '1.2.3.04\tVeículos\t7.000,00\tD',
  '1.2.3.07\t(-) Depreciação Acumulada\t1.000,00\tC',
  '9.01\tEmpréstimo do sócio José\t1.400,00\tC',
  '2.3.1.01\tCapital Subscrito\t8.000,00\tC',
  'TOTAL DO PASSIVO\t9.400,00\tC',
].join('\n');

test('implantação de saldos colando o balancete anterior', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await mockReceita(page);

  await page.goto('/login');
  await page.getByRole('button', { name: 'Usar credenciais de teste local' }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/painel');

  await page.goto('/clientes');
  await page.getByRole('button', { name: 'Novo cliente' }).first().click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Razão social').fill('Comércio Balancete Ltda');
  await sheet.getByLabel('CNPJ').fill('11222333000181');
  await sheet.getByRole('button', { name: 'Cadastrar cliente' }).click();
  await expect(page.getByText('Cliente cadastrado e definido como ativo')).toBeVisible();

  await page.goto('/plano-de-contas');
  await page.getByRole('button', { name: 'Modelo de plano de contas (CFC)' }).first().click();
  await expect(page.getByRole('tree', { name: 'Plano de contas' })).toBeVisible();

  await page.goto('/abertura');
  await page.getByRole('radiogroup', { name: 'A empresa já tinha contabilidade?' }).getByRole('radio', { name: 'Sim' }).click();
  await page.getByRole('button', { name: 'Colar balancete' }).click();
  const paste = page.getByRole('dialog', { name: 'Colar balancete' });
  await paste.getByLabel('Balancete colado').fill(BALANCETE);
  await paste.getByRole('button', { name: 'Ler balancete' }).click();

  // 5 contas casadas pelo código; o empréstimo do sócio é de outro plano; ATIVO e TOTAL ficam de fora.
  await expect(paste.getByText(/5 casada\(s\) · \d para conferir · \d sem conta · 2 fora/)).toBeVisible();
  await paste.getByRole('button', { name: /Conta do plano para Empréstimo do sócio José/ }).click();
  await page.getByRole('combobox', { name: 'Código ou nome' }).fill('2.2.2.02');
  await page.getByRole('option', { name: /Empréstimos de Sócios/ }).click();
  await expect(paste.getByText(/débitos R\$\s10\.400,00 · créditos R\$\s10\.400,00 · fecham/)).toBeVisible();
  await paste.getByRole('button', { name: 'Preencher 6 conta(s)' }).click();
  await expect(paste).toBeHidden();

  await expect(page.getByRole('status').filter({ hasText: /Balancete aplicado: 6 conta\(s\)/ })).toBeVisible();
  await expect(page.getByLabel(/^Veículos$/)).toHaveValue('7.000,00');
  await expect(page.getByLabel(/Depreciação Acumulada/)).toHaveValue('1.000,00');
  await expect(page.getByLabel(/^Empréstimos de Sócios$/)).toHaveValue('1.400,00');
  await expect(page.getByText('A abertura fecha: ativo = passivo + patrimônio líquido.')).toBeVisible();

  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Abertura salva às/ })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/^Capital Subscrito$/)).toHaveValue('8.000,00');
  expect(pageErrors).toEqual([]);
});
