/**
 * Polimento da conciliação e das demonstrações: o aviso "Desfazer" (botão e Ctrl+Z) volta a
 * aprovação ao estado anterior, e os valores da DRE ficam alinhados pela vírgula (parênteses inclusive).
 */
import { expect, test, type Page } from '@playwright/test';
import { buildITG1000Chart } from '../src/lib/chart/itg1000';

const now = new Date();
const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const id = (code: string) => `c1_itg22_${code}`;

const tx = (fitid: string, day: number, amount: number, status: string, code?: string) => ({
  id: `c1_${fitid}`, orgId: 'local', clientId: 'c1', fitid, accountKey: 'k1', date: `${month}-${String(day).padStart(2, '0')}`, amount,
  type: amount < 0 ? 'DEBIT' : 'CREDIT', memo: `MEMO ${fitid}`, status, createdAt: '',
  ...(code ? { accountId: id(code), accountCode: code, accountName: code } : {}),
});

const seed = {
  contaflow_clients: [{ id: 'c1', orgId: 'local', name: 'Empresa Teste Ltda', tradeName: 'Teste', cnpj: '11222333000181', regime: 'SIMPLES_NACIONAL', createdAt: '', updatedAt: '' }],
  contaflow_accounts: buildITG1000Chart('c1', '2025-01-01T00:00:00.000Z').map((a) => ({ ...a, orgId: 'local' })),
  contaflow_bank_accounts: [{ id: 'c1_k1', orgId: 'local', clientId: 'c1', accountKey: 'k1', nickname: 'Itaú', ledgerAccountId: id('1.1.1.02'), createdAt: '', updatedAt: '' }],
  contaflow_transactions: [
    tx('r1', 3, 12345.67, 'RECONCILED', '3.1.1.01'),
    tx('e1', 4, -234.56, 'RECONCILED', '3.3.2.06'),
    tx('e2', 5, -1.2, 'RECONCILED', '3.3.2.07'),
    tx('a1', 6, -80, 'AUTO_CLASSIFIED', '3.3.2.06'),
    tx('a2', 7, -90, 'AUTO_CLASSIFIED', '3.3.2.06'),
  ],
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

const statusOf = (page: Page, fitid: string) =>
  page.evaluate((f) => (JSON.parse(localStorage.getItem('contaflow_transactions')!) as { fitid: string; status: string }[]).find((t) => t.fitid === f)!.status, fitid);

test('desfazer a aprovação pelo aviso (botão e Ctrl+Z)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.goto(`/?mes=${month}&filtro=AUTO_CLASSIFIED`);
  await expect(page.getByRole('row').filter({ hasText: 'MEMO a2' })).toBeVisible({ timeout: 15000 });

  // Atalho A aprova a linha focada; o aviso oferece Desfazer.
  await page.locator('body').click({ position: { x: 700, y: 20 } });
  await page.keyboard.press('j');
  await page.keyboard.press('a');
  const toast = page.getByRole('status').filter({ hasText: 'aprovado' });
  await expect(toast).toBeVisible();
  await expect(toast.getByRole('button', { name: 'Desfazer' })).toBeVisible();
  const approved = (await statusOf(page, 'a1')) === 'RECONCILED' ? 'a1' : 'a2';
  expect(await statusOf(page, approved)).toBe('RECONCILED');

  // Ctrl+Z desfaz enquanto o aviso está na tela.
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('status').filter({ hasText: 'Desfeito' })).toBeVisible();
  await expect.poll(() => statusOf(page, approved)).toBe('AUTO_CLASSIFIED');

  // E pelo botão.
  await page.keyboard.press('j');
  await page.keyboard.press('a');
  await expect(page.getByRole('status').filter({ hasText: 'aprovado' })).toBeVisible();
  await page.getByRole('button', { name: 'Desfazer' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Desfeito' })).toBeVisible();
  await expect.poll(async () => [await statusOf(page, 'a1'), await statusOf(page, 'a2')]).toEqual(['AUTO_CLASSIFIED', 'AUTO_CLASSIFIED']);
  expect(errors).toEqual([]);
});

test('valores da DRE alinhados pela vírgula', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.goto('/dre');
  await expect(page.getByText('12.345,67').first()).toBeVisible();

  // Posição horizontal da vírgula de cada valor da coluna R$ da demonstração.
  const commas = await page.evaluate(() => {
    const out: { text: string; x: number }[] = [];
    for (const el of document.querySelectorAll('main span.font-mono.tabular-nums')) {
      const text = el.textContent ?? '';
      if (!/R\$/.test(text)) continue;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = (n.textContent ?? '').lastIndexOf(',');
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 1);
        const box = r.getBoundingClientRect();
        if (box.width > 0) out.push({ text: text.trim(), x: Math.round(box.right * 10) / 10 });
      }
    }
    return out;
  });
  const column = commas.filter((c) => c.x > 900);
  expect(column.length).toBeGreaterThanOrEqual(4);
  expect(column.some((c) => c.text.startsWith('('))).toBe(true);
  expect(column.some((c) => !c.text.startsWith('('))).toBe(true);
  const xs = column.map((c) => c.x);
  expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1);
});
