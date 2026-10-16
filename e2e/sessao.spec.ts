import { expect, test } from '@playwright/test';

const login = async (page: import('@playwright/test').Page) => {
  await page.goto('/login');
  await page.getByLabel(/e-mail/i).fill('teste@exemplo.com');
  await page.getByLabel(/senha/i).first().fill('123456');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/painel/);
};

test('inatividade: aviso, continuar conectado e saída após 30 minutos; versão no rodapé', async ({ page }) => {
  await page.clock.install();
  await login(page);
  await expect(page.getByText(/^Versão \w+/)).toBeVisible();

  await page.clock.runFor(29.5 * 60_000);
  await expect(page.getByRole('alertdialog')).toContainText('Você ainda está aí?');
  await page.getByRole('button', { name: 'Continuar conectado' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  await page.clock.runFor(25 * 60_000);
  await expect(page).toHaveURL(/painel/);
  await page.clock.runFor(6 * 60_000);
  await expect(page).toHaveURL(/login/);
  await expect(page.getByText('Sua sessão foi encerrada após 30 minutos sem uso. Entre novamente para continuar.')).toBeVisible();
});

test('navegador reaberto com login de 13 horas atrás: volta ao login', async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    const u = JSON.parse(localStorage.getItem('contaflow_dev_user')!);
    localStorage.setItem('contaflow_dev_user', JSON.stringify({ ...u, signedInAt: Date.now() - 13 * 3_600_000 }));
  });
  await page.reload();
  await expect(page).toHaveURL(/login/);
  await expect(page.getByText(/sessão dura no máximo 12 horas/)).toBeVisible();
});
