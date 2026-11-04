import { expect, test } from '@playwright/test';
import { mockReceita } from './receita';

/**
 * Consulta de CNPJ no cadastro de cliente: com o formulário vazio preenche direto; com um nome
 * digitado de outra empresa, pergunta antes; "Atualizar pela Receita" mostra o que vai mudar.
 */

const RECEITA = {
  cnpj: '11222333000181',
  name: 'PADARIA PAO QUENTE LTDA',
  tradeName: 'PAO QUENTE',
  city: 'Recife/PE',
  regime: 'SIMPLES_NACIONAL',
  porte: 'MICROENTIDADE',
  situacaoCadastral: 'ATIVA',
  source: 'brasilapi',
};

test('CNPJ de outra empresa pede confirmação; atualização mostra o que muda', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await mockReceita(page, RECEITA);

  await page.goto('/login');
  await page.getByRole('button', { name: 'Usar credenciais de teste local' }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/painel');
  await page.goto('/clientes');

  await test.step('nome digitado de outra empresa: nada é preenchido até decidir', async () => {
    await page.getByRole('button', { name: 'Novo cliente' }).first().click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Razão social').fill('Mercado Bom Preço Ltda');
    await sheet.getByLabel('CNPJ').fill(RECEITA.cnpj);
    const review = sheet.getByRole('alertdialog', { name: 'Este CNPJ é de outra empresa?' });
    await expect(review).toBeVisible();
    await expect(review.getByText('PADARIA PAO QUENTE LTDA')).toBeVisible();
    await expect(sheet.getByLabel('Nome fantasia')).toHaveValue('');

    await review.getByRole('button', { name: 'Manter o que digitei' }).click();
    await expect(review).toBeHidden();
    await expect(sheet.getByLabel('Razão social')).toHaveValue('Mercado Bom Preço Ltda');
    await expect(sheet.getByText(/Mantidos os dados digitados/)).toBeVisible();
    await sheet.getByRole('button', { name: 'Fechar' }).first().click();
  });

  await test.step('aceitando, os dados da Receita substituem os digitados', async () => {
    await page.getByRole('button', { name: 'Novo cliente' }).first().click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Razão social').fill('Mercado Bom Preço Ltda');
    await sheet.getByLabel('CNPJ').fill(RECEITA.cnpj);
    await sheet.getByRole('button', { name: 'Usar dados da Receita' }).click();
    await expect(sheet.getByLabel('Razão social')).toHaveValue('PADARIA PAO QUENTE LTDA');
    await expect(sheet.getByLabel('Nome fantasia')).toHaveValue('PAO QUENTE');
    await expect(sheet.getByLabel('Município/UF')).toHaveValue('Recife/PE');
    await sheet.getByRole('button', { name: 'Cadastrar cliente' }).click();
    await expect(page.getByText('Cliente cadastrado e definido como ativo')).toBeVisible();
  });

  await test.step('atualizar pela Receita: confirma a lista do que muda', async () => {
    await page.getByRole('button', { name: 'Editar PADARIA PAO QUENTE LTDA' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Município/UF').fill('Olinda/PE');
    await sheet.getByRole('button', { name: 'Atualizar pela Receita' }).click();
    const review = sheet.getByRole('alertdialog', { name: 'Atualizar o cadastro pela Receita?' });
    await expect(review.getByText(/Município\/UF: Olinda\/PE/)).toBeVisible();
    await review.getByRole('button', { name: 'Aplicar alterações' }).click();
    await expect(sheet.getByLabel('Município/UF')).toHaveValue('Recife/PE');
    await expect(sheet.getByText('1 campo(s) atualizado(s) pela Receita.')).toBeVisible();
  });

  expect(pageErrors).toEqual([]);
});
