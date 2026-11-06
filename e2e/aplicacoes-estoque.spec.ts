import { expect, test } from '@playwright/test';
import { mockReceita } from './receita';

/**
 * Aplicações financeiras e estoque: cadastrar a aplicação, informar o saldo do extrato e lançar
 * o rendimento; configurar o controle de estoque, informar o estoque final e lançar o ajuste.
 */
test('aplicações e estoque: saldo informado vira lançamento do mês', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await mockReceita(page);

  await test.step('login, empresa e plano de contas', async () => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Usar credenciais de teste local' }).click();
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL('**/painel');

    await page.goto('/clientes');
    await page.getByRole('button', { name: 'Novo cliente' }).first().click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Razão social').fill('Loja Alfa Ltda');
    await sheet.getByLabel('CNPJ').fill('11222333000181');
    await sheet.getByRole('button', { name: 'Cadastrar cliente' }).click();
    await expect(page.getByText('Cliente cadastrado e definido como ativo')).toBeVisible();

    await page.goto('/plano-de-contas');
    await page.getByRole('button', { name: 'Modelo de plano de contas (CFC)' }).first().click();
    await expect(page.getByText(/contas do modelo de plano de contas \(CFC\) adicionadas/)).toBeVisible();
  });

  await test.step('aplicação: saldo do extrato e rendimento', async () => {
    await page.goto('/aplicacoes');
    await page.getByRole('button', { name: 'Cadastrar a primeira aplicação' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Nome', { exact: true }).fill('Caixinha Nubank');
    await sheet.getByRole('button', { name: 'Cadastrar' }).click();
    await expect(page.getByText('Aplicação cadastrada')).toBeVisible();

    await page.getByRole('textbox', { name: /Saldo de Caixinha Nubank/ }).fill('1.000,00');
    await page.getByRole('button', { name: 'Gravar' }).click();
    await expect(page.getByText(/Lance o rendimento das aplicações de .*R\$\s1\.000,00/)).toBeVisible();
    await page.getByRole('button', { name: 'Lançar o rendimento' }).click();
    await expect(page.getByText('Rendimento lançado e conferido com os saldos informados.')).toBeVisible();
  });

  await test.step('estoque: configuração, estoque final e ajuste', async () => {
    await page.goto('/estoque');
    await page.getByRole('button', { name: 'Configurar' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Configurar' }).click();
    await expect(page.getByText('Controle de estoque salvo')).toBeVisible();

    await page.getByLabel('Estoque final (R$)').fill('500,00');
    await page.getByRole('button', { name: 'Gravar' }).click();
    await expect(page.getByText(/= Volta ao estoque/)).toBeVisible();
    await page.getByRole('button', { name: 'Lançar o CMV' }).click();
    await expect(page.getByText('CMV lançado e conferido com o estoque informado.')).toBeVisible();
  });

  expect(pageErrors).toEqual([]);
});
