import { expect, test } from '@playwright/test';
import { mockReceita } from './receita';

/**
 * Cadastro completo da empresa: o CNPJ traz o cartão CNPJ e o QSA, o CEP preenche o endereço
 * (mantendo número e complemento), "Cliente desde" em DD/MM/AAAA, e tudo volta na edição.
 */

const RECEITA = {
  cnpj: '11222333000181',
  name: 'TECH SOLUCOES LTDA',
  tradeName: 'TECH',
  city: 'Recife/PE',
  regime: 'SIMPLES_NACIONAL',
  porte: 'MICROENTIDADE',
  situacaoCadastral: 'ATIVA',
  legalRepresentativeName: 'ANA ADMINISTRADORA',
  activity: 'Desenvolvimento de programas de computador sob encomenda',
  address: { cep: '51020000', street: 'RUA DAS FLORES', number: '100', complement: 'SALA 2', district: 'BOA VIAGEM', municipality: 'RECIFE', uf: 'PE' },
  registration: {
    branch: 'MATRIZ',
    openedAt: '2015-03-10',
    legalNature: { code: '206-2', description: 'Sociedade Empresária Limitada' },
    mainActivity: { code: '62.01-5-01', description: 'Desenvolvimento de programas de computador sob encomenda' },
    secondaryActivities: [{ code: '62.02-3-00', description: 'Desenvolvimento e licenciamento de programas customizáveis' }],
    sizeLabel: 'MICRO EMPRESA',
    status: 'ATIVA',
    statusDate: '2015-03-10',
    shareCapital: 50000,
    simples: { optant: true, since: '2015-03-10' },
    mei: { optant: false },
    source: 'brasilapi',
  },
  partners: [
    { name: 'ANA ADMINISTRADORA', document: '***.123.456-**', role: 'Sócio-Administrador', since: '2015-03-10' },
    { name: 'BRUNO SOCIO', document: '***.654.321-**', role: 'Sócio', since: '2018-07-01' },
  ],
  source: 'brasilapi',
};

test('cadastro com cartão CNPJ, QSA, CEP e cliente desde; tudo editável e preservado', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockReceita(page, RECEITA);
  await page.route('**/api/cep/**', (route) =>
    route.fulfill({ json: { cep: '50030230', street: 'Avenida Rio Branco', district: 'Recife', municipality: 'Recife', uf: 'PE', source: 'brasilapi' } })
  );
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('/login');
  await page.getByRole('button', { name: 'Usar credenciais de teste local' }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/painel');
  await page.goto('/clientes');

  await page.getByRole('button', { name: 'Novo cliente' }).first().click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('CNPJ').fill(RECEITA.cnpj);
  await expect(sheet.getByLabel('Razão social')).toHaveValue('TECH SOLUCOES LTDA');

  // Cartão CNPJ: dados da Receita, editáveis.
  await sheet.getByRole('radio', { name: /Cartão CNPJ · ATIVA/ }).click();
  await expect(sheet.getByRole('textbox', { name: 'Código' }).nth(1)).toHaveValue('62.01-5-01');
  await expect(sheet.getByText('Atividades econômicas secundárias (1)')).toBeVisible();
  await sheet.getByLabel('Motivo').fill('SEM MOTIVO');

  // QSA: escolhe quem assina.
  await sheet.getByRole('radio', { name: /Sócios \(QSA\) · 2/ }).click();
  await expect(sheet.getByText('Assina as demonstrações')).toBeVisible();
  await sheet.getByRole('button', { name: 'Usar como representante legal' }).click();

  // Endereço: o CEP troca logradouro e bairro, e mantém número e complemento.
  await sheet.getByRole('radio', { name: 'Endereço' }).click();
  await expect(sheet.getByLabel('Logradouro')).toHaveValue('RUA DAS FLORES');
  await sheet.getByLabel('CEP').fill('50030230');
  await expect(sheet.getByLabel('Logradouro')).toHaveValue('Avenida Rio Branco');
  await expect(sheet.getByLabel('Número')).toHaveValue('100');
  await expect(sheet.getByLabel('Complemento')).toHaveValue('SALA 2');

  // Cliente desde, em DD/MM/AAAA.
  await sheet.getByRole('radio', { name: 'Cadastro' }).click();
  await expect(sheet.getByLabel('Nome do representante')).toHaveValue('BRUNO SOCIO');
  const since = sheet.getByLabel('Cliente desde');
  await since.fill('31022020');
  await expect(sheet.getByText('Data inválida: use DD/MM/AAAA.')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Cadastrar cliente' })).toBeDisabled();
  await since.fill('01052020');
  await expect(since).toHaveValue('01/05/2020');
  await sheet.getByRole('button', { name: 'Cadastrar cliente' }).click();
  await expect(page.getByText('Cliente cadastrado e definido como ativo')).toBeVisible();

  // Edição: tudo voltou.
  await page.getByRole('button', { name: 'Editar TECH SOLUCOES LTDA' }).click();
  const edit = page.getByRole('dialog');
  await expect(edit.getByLabel('Cliente desde')).toHaveValue('01/05/2020');
  await edit.getByRole('radio', { name: 'Endereço' }).click();
  await expect(edit.getByLabel('CEP')).toHaveValue('50030-230');
  await expect(edit.getByLabel('Logradouro')).toHaveValue('Avenida Rio Branco');
  await edit.getByRole('radio', { name: /Cartão CNPJ/ }).click();
  await expect(edit.getByLabel('Motivo')).toHaveValue('SEM MOTIVO');
  await expect(edit.getByLabel('Data de abertura')).toHaveValue('10/03/2015');
  await edit.getByRole('radio', { name: /Sócios/ }).click();
  await expect(edit.getByLabel('Nome / razão social').nth(1)).toHaveValue('BRUNO SOCIO');
  expect(errors).toEqual([]);
});
