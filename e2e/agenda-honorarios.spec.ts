/**
 * Agenda de obrigações e honorários da carteira, e a aba Análise do Balanço, no modo local:
 * marcar obrigação como cumprida (e ela continuar marcada depois de recarregar), cadastrar o
 * honorário de uma empresa e dar baixa no recebimento.
 */
import { expect, test, type Page } from '@playwright/test';

const now = new Date();
const ym = (offset: number) => {
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const company = (id: string, name: string, tradeName: string, regime: string) => ({
  id,
  orgId: 'local',
  name,
  tradeName,
  cnpj: '11222333000181',
  regime,
  // Acompanhada há três meses: a agenda mostra as guias desde então.
  createdAt: `${ym(-3)}-01T12:00:00.000Z`,
  updatedAt: '',
});
const seed = {
  contaflow_clients: [company('c-mei', 'Joana Doces MEI', 'Doces da Joana', 'MEI'), company('c-sn', 'Oficina Boa Ltda', 'Oficina Boa', 'SIMPLES_NACIONAL')],
};

async function login(page: Page) {
  await page.addInitScript((data) => {
    if (sessionStorage.getItem('seeded')) return;
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, JSON.stringify(v));
    sessionStorage.setItem('seeded', '1');
  }, seed);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Usar credenciais de teste local' }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/painel');
}

test('agenda de obrigações: marcar como cumprida e ver depois de recarregar', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);

  await page.goto('/agenda');
  await expect(page.getByRole('heading', { name: 'Agenda e honorários' })).toBeVisible();
  const agenda = page.getByRole('region', { name: 'Agenda de obrigações' });
  await agenda.getByRole('radio', { name: '30 dias' }).click();

  const box = agenda.getByRole('checkbox', { name: /Marcar como cumprida: DAS-MEI de Doces da Joana/ }).first();
  await expect(box).toBeVisible();
  const label = await box.getAttribute('aria-label');
  await box.click();
  await expect(agenda.getByRole('checkbox', { name: label!.replace('Marcar como cumprida', 'Desmarcar') })).toHaveAttribute('aria-checked', 'true');

  // Configuração por empresa: o Simples sugere PGDAS-D e DEFIS; a EFD-Reinf é opcional.
  await agenda.getByRole('button', { name: 'Obrigações por empresa' }).click();
  const sheet = page.getByRole('dialog', { name: 'Obrigações da empresa' });
  await sheet.getByRole('combobox', { name: 'Empresa' }).selectOption({ label: 'Oficina Boa' });
  await expect(sheet.getByText('PGDAS-D e DAS')).toBeVisible();
  await expect(sheet.getByText('Retenções na fonte e demais informações fora da folha', { exact: false })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.reload();
  await page.getByRole('region', { name: 'Agenda de obrigações' }).getByRole('radio', { name: 'Cumpridas' }).click();
  await expect(page.getByRole('region', { name: 'Agenda de obrigações' }).getByRole('checkbox', { name: /Desmarcar: DAS-MEI de Doces da Joana/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('honorários: cadastrar o contrato e dar baixa no recebimento', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);

  await page.goto('/agenda');
  await page.getByRole('radio', { name: 'Honorários' }).click();
  const board = page.getByRole('region', { name: 'Honorários por empresa' });
  await board.getByRole('row', { name: /Oficina Boa/ }).click();

  const sheet = page.getByRole('dialog', { name: 'Cadastrar honorário' });
  await sheet.getByLabel('Valor mensal (R$)').fill('800,00');
  await sheet.getByLabel('Desde a competência').fill(ym(0));
  await sheet.getByLabel('Dia do vencimento').fill('28');
  await sheet.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(board.getByRole('row', { name: /Oficina Boa/ })).toContainText('R$ 800,00');

  await board.getByRole('row', { name: /Oficina Boa/ }).click();
  const edit = page.getByRole('dialog', { name: 'Honorários' });
  await edit.getByRole('button', { name: 'Recebido hoje' }).first().click();
  await expect(edit.getByText('Pago', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(board.getByRole('row', { name: /Oficina Boa/ })).toContainText('Pago');
  await expect(page.getByRole('region', { name: 'Resumo dos honorários' })).toContainText('R$ 800,00');
  expect(errors).toEqual([]);
});

test('balanço: aba Análise disponível', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.goto('/balanco');
  await page.getByRole('radio', { name: 'Análise' }).click();
  await expect(page.getByRole('heading', { name: 'Análise das demonstrações' })).toBeVisible();
});
