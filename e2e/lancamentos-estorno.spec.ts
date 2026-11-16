import { expect, test } from '@playwright/test';
import { mockReceita } from './receita';

/**
 * Lançamentos manuais: a provisão do DAS lançada pelo modelo reduz o resultado do período; o
 * estorno grava o lançamento inverso, liga os dois na lista e zera o efeito no resultado.
 */
test('lançamentos manuais: estorno anula o lançamento e fica ligado a ele', async ({ page }) => {
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
    await sheet.getByLabel('Razão social').fill('Enjoy BPO Financeiro Ltda');
    await sheet.getByLabel('CNPJ').fill('11222333000181');
    await sheet.getByRole('button', { name: 'Cadastrar cliente' }).click();
    await expect(page.getByText('Cliente cadastrado e definido como ativo')).toBeVisible();

    await page.goto('/plano-de-contas');
    // Faixa de implantação: na tela do passo, diz o que falta nele.
    const setup = page.getByRole('region', { name: 'Implantação da empresa' });
    await expect(setup.getByText(/Nesta tela:.*Plano de contas vazio/)).toBeVisible();
    await page.getByRole('button', { name: 'Modelo de plano de contas (CFC)' }).first().click();
    await expect(page.getByText(/contas do modelo de plano de contas \(CFC\) adicionadas/)).toBeVisible();
    // Gravado o plano, a faixa relê sozinha e aponta o passo seguinte.
    await expect(setup.getByRole('link', { name: /Plano de Contas \(pronto\)/ })).toBeVisible();
    await expect(setup.getByText('Próximo: Contas e Extratos.')).toBeVisible();
    await setup.getByRole('link', { name: 'Abrir' }).click();
    await page.waitForURL('**/contas');
    await expect(page.getByRole('region', { name: 'Implantação da empresa' }).getByText(/Nesta tela:.*Nenhuma conta bancária/)).toBeVisible();
  });

  await test.step('provisão do DAS pelo modelo', async () => {
    await page.goto('/lancamentos');
    await page.getByRole('button', { name: 'Novo Lançamento' }).first().click();
    const dialog = page.getByRole('dialog');
    // Grade de partidas: digita-se o valor como ele é ("1500" são mil e quinhentos reais), na coluna
    // do lado; ao sair do campo ele aparece formatado, e a diferença fecha com um clique.
    await dialog.getByLabel('Débito da partida 1').pressSequentially('1500');
    await dialog.getByLabel('Débito da partida 1').press('Tab');
    await expect(dialog.getByLabel('Débito da partida 1')).toHaveValue('1.500,00');
    await expect(dialog.getByText(/Diferença de R\$\s1\.500,00 a crédito/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Lançar a diferença' }).click();
    await expect(dialog.getByLabel('Crédito da partida 2')).toHaveValue('1.500,00');
    await expect(dialog.getByText(/Partidas equilibradas/)).toBeVisible();
    await dialog.getByRole('group', { name: 'Modelos de lançamento' }).getByRole('button', { name: 'DAS do Simples Nacional' }).click();
    await dialog.getByLabel('Valor do DAS (PGDAS-D)').fill('812,40');
    await dialog.getByRole('button', { name: 'Preencher as partidas' }).click();
    await dialog.getByRole('button', { name: 'Confirmar Lançamento' }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByRole('row', { name: /Provisão do Simples Nacional \(DAS\)/ })).toHaveCount(1);
    await expect(page.getByText('reduz o lucro do período')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Manuais (1)' })).toBeVisible();
  });

  await test.step('estorno: lançamento inverso, ligado ao original', async () => {
    await page.getByRole('button', { name: 'Estornar o lançamento #1' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Estorno do lançamento #1' })).toBeVisible();
    await expect(dialog.getByPlaceholder(/Provisão mensal de salários/)).toHaveValue(/^Estorno do lançamento #1 de \d{2}\/\d{2}\/\d{4}: Provisão do Simples Nacional/);
    await dialog.getByRole('button', { name: 'Confirmar Estorno' }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText(/Estornado pelo #2, em/)).toBeVisible();
    await expect(page.getByText(/Estorno do #1, de/)).toBeVisible();
    // Já estornado: não se estorna de novo; o estorno anulou a despesa no resultado.
    await expect(page.getByRole('button', { name: 'Estornar o lançamento #1' })).toBeDisabled();
    await expect(page.getByText('sem efeito: só contas patrimoniais')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Manuais (2)' })).toBeVisible();
  });

  expect(pageErrors).toEqual([]);
});
