import { expect, test } from '@playwright/test';

/**
 * Diagnóstico do cadastro na tela de Clientes: cada empresa mostra o que falta ou diverge, a
 * etiqueta abre o cadastro na aba que resolve, e a carteira filtra, ordena e vira lista.
 */

const full = {
  id: 'c-ok',
  orgId: 'local',
  name: 'Aurora Alimentos Ltda',
  tradeName: 'Padaria Aurora',
  cnpj: '11.222.333/0001-81',
  regime: 'SIMPLES_NACIONAL',
  porte: 'MICROENTIDADE',
  city: 'Recife/PE',
  activity: 'Fabricação de produtos de panificação',
  legalRepresentativeName: 'Ana Administradora',
  legalRepresentativeCpf: '529.982.247-25',
  email: 'ana@aurora.com',
  address: { cep: '51020000', street: 'Rua das Flores' },
  registration: { status: 'ATIVA', fetchedAt: '2026-01-10T12:00:00.000Z', simples: { optant: true }, mei: { optant: false } },
  partners: [{ name: 'Ana Administradora' }],
  createdAt: '',
  updatedAt: '',
};
// Baixada na Receita, optante do Simples com regime Presumido e sem endereço.
const troubled = {
  ...full,
  id: 'c-baixada',
  name: 'Zeta Comércio Ltda',
  tradeName: 'Zeta',
  cnpj: '44.555.666/0001-00',
  regime: 'LUCRO_PRESUMIDO',
  address: undefined,
  registration: { ...full.registration, status: 'BAIXADA' },
};

test('pendências do cadastro: etiquetas, filtro, ordenação, lista e atalho para a aba', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date(2026, 2, 16, 12, 0, 0));
  await page.addInitScript((clients) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.setItem('contaflow_clients', JSON.stringify(clients));
    sessionStorage.setItem('seeded', '1');
  }, [full, troubled]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Usar credenciais de teste local' }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/painel');
  await page.goto('/clientes');

  await expect(page.getByText('1 com pendência de cadastro')).toBeVisible();
  const cards = page.getByRole('article');
  await expect(cards.filter({ hasText: 'Padaria Aurora' }).getByText('Cadastro completo')).toBeVisible();
  const zeta = cards.filter({ hasText: 'Zeta' });
  await expect(zeta.getByRole('button', { name: 'Situação BAIXADA na Receita' })).toBeVisible();
  await expect(zeta.getByRole('button', { name: 'Regime diverge da Receita' })).toBeVisible();

  // Mais pendências primeiro; depois só as com pendência.
  await page.getByLabel('Ordenar por').selectOption('issues');
  await expect(cards.first()).toContainText('Zeta');
  await page.getByRole('radio', { name: /Com pendência · 1/ }).click();
  await expect(cards).toHaveCount(1);
  await page.getByRole('radio', { name: /Em ordem · 1/ }).click();
  await expect(cards.first()).toContainText('Padaria Aurora');
  await page.getByRole('radio', { name: /Todas · 2/ }).click();

  // Lista: mesma carteira em linhas; a visão fica lembrada.
  await page.getByRole('radio', { name: 'Lista' }).click();
  const row = page.getByRole('row', { name: /Zeta/ });
  await expect(row).toContainText('Lucro Presumido');
  await page.reload();
  await expect(page.getByRole('row', { name: /Zeta/ })).toBeVisible();

  // A etiqueta abre o cadastro na aba que resolve a pendência.
  await page.getByRole('row', { name: /Zeta/ }).getByRole('button', { name: 'Situação BAIXADA na Receita' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('radio', { name: /Cartão CNPJ · BAIXADA/ })).toBeChecked();
  await sheet.getByLabel('Situação', { exact: true }).fill('ATIVA');
  await sheet.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Alterações salvas')).toBeVisible();
  await expect(page.getByRole('row', { name: /Zeta/ }).getByRole('button', { name: 'Situação BAIXADA na Receita' })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Zeta/ }).getByRole('button', { name: 'Regime diverge da Receita' })).toBeVisible();
  expect(errors).toEqual([]);
});
