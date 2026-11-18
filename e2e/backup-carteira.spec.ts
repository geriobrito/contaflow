import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * Backup da carteira: o Painel lembra as empresas sem backup, o atalho abre o backup da carteira,
 * o .zip sai com um JSON por empresa e o manifesto, a data fica no cartão de cada empresa, o
 * lembrete some, e a restauração lê uma empresa de dentro do .zip.
 */

const company = (id: string, name: string, cnpj: string) => ({ id, orgId: 'local', name, tradeName: name, cnpj, regime: 'SIMPLES_NACIONAL', createdAt: '', updatedAt: '' });
const tx = (clientId: string, n: number) => ({
  id: `${clientId}_t${n}`,
  orgId: 'local',
  clientId,
  fitid: `t${n}`,
  accountKey: 'k1',
  date: '2026-10-10',
  amount: -10 * n,
  type: 'DEBIT',
  memo: `PIX ${clientId} ${n}`,
  status: 'PENDING',
  createdAt: '',
});
const seed = {
  contaflow_clients: [company('c-aurora', 'Aurora', '11.222.333/0001-81'), company('c-beta', 'Beta', '11.444.777/0001-61'), company('c-mar', 'Mar Azul', '44.555.666/0001-81')],
  contaflow_transactions: [tx('c-aurora', 1), tx('c-aurora', 2), tx('c-beta', 3)],
};

test('backup da carteira com lembrete e restauração pelo zip', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date(2026, 10, 17, 12, 0, 0));
  await page.addInitScript((data) => {
    if (sessionStorage.getItem('seeded')) return;
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, JSON.stringify(v));
    sessionStorage.setItem('seeded', '1');
  }, seed);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Usar credenciais de teste local' }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/painel');

  // Painel: nenhuma empresa tem backup.
  const reminder = page.getByRole('region', { name: 'Lembrete de backup' });
  await expect(reminder).toContainText('Backup: 3 nunca tiveram backup.');
  await reminder.getByRole('link', { name: 'Fazer o backup da carteira' }).click();
  await page.waitForURL('**/clientes?backup=1');

  const sheet = page.getByRole('dialog', { name: 'Backup da carteira' });
  await expect(sheet.getByRole('list', { name: 'Empresas do backup' }).getByRole('listitem')).toHaveCount(3);
  await expect(sheet).toContainText('nunca teve backup');
  const download = page.waitForEvent('download');
  await sheet.getByRole('button', { name: 'Gerar backup de 3 empresa(s)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Backup_Carteira_2026-11-17.zip');
  const zipPath = await file.path();
  const zip = readFileSync(zipPath);
  expect(zip.subarray(0, 2).toString()).toBe('PK');
  // Os nomes ficam abertos no diretório do .zip.
  for (const name of ['manifesto.json', 'Backup_Aurora_2026-11-17.json', 'Backup_Beta_2026-11-17.json', 'Backup_Mar_Azul_2026-11-17.json']) {
    expect(zip.includes(Buffer.from(name))).toBe(true);
  }
  await expect(sheet.getByRole('status')).toContainText('Backup de 3 empresa(s) baixado');
  await sheet.getByText('Fechar', { exact: true }).click();

  // A data do backup fica no cartão de cada empresa e sobrevive a recarregar.
  await page.reload();
  const card = page.getByRole('article').filter({ hasText: 'Mar Azul' });
  await expect(card).toContainText('Último backup');
  await expect(card).toContainText('17/11/2026');

  // O lembrete do Painel some.
  await page.goto('/painel');
  await expect(page.getByRole('heading', { name: 'Painel' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Lembrete de backup' })).toHaveCount(0);

  // Restauração de uma empresa de dentro do .zip, como empresa nova.
  await page.goto('/clientes');
  await page.getByRole('button', { name: 'Restaurar backup' }).click();
  const restore = page.getByRole('dialog', { name: 'Restaurar backup' });
  await restore.locator('input[type="file"]').setInputFiles({ name: 'Backup_Carteira_2026-11-17.zip', mimeType: 'application/zip', buffer: zip });
  await restore.getByLabel('Empresa do backup da carteira').selectOption({ label: 'Aurora' });
  await expect(restore).toContainText('Aurora');
  await restore.getByRole('button', { name: 'Restaurar empresa' }).click();
  await expect(restore).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole('article').filter({ hasText: 'Aurora (Restaurada)' })).toBeVisible();
  expect(errors).toEqual([]);
});
