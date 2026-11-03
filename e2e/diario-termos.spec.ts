/**
 * Termos do Livro Diário no cadastro da empresa: o que versões antigas deixaram no navegador
 * passa para o cadastro ao abrir o Diário, e cada edição fica gravada nele (vale em outra máquina).
 */
import { expect, test } from '@playwright/test';

const seed = {
  contaflow_clients: [
    { id: 'c-aurora', orgId: 'local', name: 'Aurora Alimentos Ltda', tradeName: 'Padaria Aurora', cnpj: '11222333000181', regime: 'SIMPLES_NACIONAL', city: 'Recife/PE', createdAt: '', updatedAt: '' },
  ],
  // Formato antigo: dados dos termos guardados só neste navegador.
  'contaflow_daybook_c-aurora': { number: '7', city: 'Olinda/PE', registry: 'NIRE 111' },
};

const stored = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ({
    legacy: localStorage.getItem('contaflow_daybook_c-aurora'),
    daybook: (JSON.parse(localStorage.getItem('contaflow_clients') ?? '[]') as { daybook?: unknown }[])[0]?.daybook ?? null,
  }));

test('termos do Diário: migram do navegador para o cadastro e as edições ficam gravadas', async ({ page }) => {
  await page.addInitScript((data) => {
    if (sessionStorage.getItem('seeded')) return;
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, JSON.stringify(v));
    localStorage.setItem('contaflow_active_client', 'c-aurora');
    sessionStorage.setItem('seeded', '1');
  }, seed);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Usar credenciais de teste local' }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/painel');

  await page.goto('/diario');
  await expect(page.getByLabel('Livro nº')).toHaveValue('7');
  await expect(page.getByLabel(/Sede/)).toHaveValue('Olinda/PE');
  await expect(page.getByLabel(/NIRE/)).toHaveValue('NIRE 111');
  // Migrado: no cadastro da empresa, e a chave antiga some.
  await expect.poll(() => stored(page)).toEqual({ legacy: null, daybook: { number: '7', city: 'Olinda/PE', registry: 'NIRE 111' } });

  // Edição gravada no cadastro logo após a digitação; recarregar mostra o valor salvo.
  await page.getByLabel(/NIRE/).fill('NIRE 222');
  await expect.poll(async () => (await stored(page)).daybook).toEqual({ number: '7', city: 'Olinda/PE', registry: 'NIRE 222' });
  await page.reload();
  await expect(page.getByLabel(/NIRE/)).toHaveValue('NIRE 222');
});
