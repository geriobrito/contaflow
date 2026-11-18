import { expect, test } from '@playwright/test';

/**
 * Conciliação: o período abre no mês do lançamento mais recente (setembro) e, depois, a escolha
 * do usuário fica. Antes, o posicionamento rodava de novo a cada troca e voltava para setembro.
 */

const client = { id: 'c-aurora', orgId: 'local', name: 'Aurora Alimentos Ltda', tradeName: 'Padaria Aurora', cnpj: '11.222.333/0001-81', regime: 'SIMPLES_NACIONAL', createdAt: '', updatedAt: '' };
const tx = (id: string, date: string, memo: string, amount: number) => ({
  id: `c-aurora_${id}`,
  orgId: 'local',
  clientId: 'c-aurora',
  fitid: id,
  accountKey: 'k1',
  date,
  amount,
  type: amount < 0 ? 'DEBIT' : 'CREDIT',
  memo,
  status: 'PENDING',
  createdAt: '',
});
const seed = {
  contaflow_clients: [client],
  contaflow_bank_accounts: [{ id: 'c-aurora_k1', orgId: 'local', clientId: 'c-aurora', accountKey: 'k1', nickname: 'Itaú', createdAt: '', updatedAt: '' }],
  contaflow_transactions: [tx('t6', '2026-06-10', 'PIX JUNHO FORNECEDOR', -100), tx('t9', '2026-09-15', 'PIX SETEMBRO FORNECEDOR', -200)],
};

test('a escolha de mês e de trimestre fica, sem voltar para o mês do último lançamento', async ({ page }) => {
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
  await page.goto('/');

  const months = page.getByRole('radiogroup', { name: 'Mês' });
  // Abre no mês do lançamento mais recente.
  await expect(months.getByRole('radio', { name: 'Set' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('row', { name: /PIX SETEMBRO/ })).toBeVisible();

  await months.getByRole('radio', { name: 'Jun' }).click();
  await expect(page.getByRole('row', { name: /PIX JUNHO/ })).toBeVisible();
  // Dá tempo para qualquer reposicionamento indevido acontecer.
  await page.waitForTimeout(1500);
  await expect(months.getByRole('radio', { name: 'Jun' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('row', { name: /PIX SETEMBRO/ })).toHaveCount(0);

  await page.getByRole('radiogroup', { name: 'Tipo de período' }).getByRole('radio', { name: 'Trimestre' }).click();
  const quarters = page.getByRole('radiogroup', { name: 'Trimestre' });
  await quarters.getByRole('radio', { name: 'T2' }).click();
  await page.waitForTimeout(1500);
  await expect(quarters.getByRole('radio', { name: 'T2' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('row', { name: /PIX JUNHO/ })).toBeVisible();
});
