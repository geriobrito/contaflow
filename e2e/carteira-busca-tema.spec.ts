/**
 * Painel com a visão da carteira, busca rápida (Ctrl+K), seletor de tema sem piscar e as telas
 * abrindo sem erro (esqueletos de carregamento), no modo local com três empresas semeadas.
 */
import { expect, test, type Page } from '@playwright/test';

// Hoje (no navegador) define a competência de foco; os dados usam datas relativas a ele.
const now = new Date();
const ym = (offset: number) => {
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const lastDay = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};
const prev = ym(-1);
const prev2 = ym(-2);

const company = (id: string, name: string, tradeName: string, cnpj: string) => ({ id, orgId: 'local', name, tradeName, cnpj, regime: 'SIMPLES_NACIONAL', createdAt: '', updatedAt: '' });
const seed = {
  contaflow_clients: [
    company('c-aurora', 'Aurora Alimentos Ltda', 'Padaria Aurora', '11222333000181'),
    company('c-luz', 'Luz Serviços Contábeis Ltda', 'Luz Serviços', '44555666000100'),
    company('c-mar', 'Mar Azul Comércio Ltda', 'Mar Azul', '77888999000122'),
  ],
  contaflow_batches: [
    // Aurora: extratos até o mês passado, com o mês passado aberto e pendências.
    { id: 'b1', orgId: 'local', clientId: 'c-aurora', accountKey: 'k1', startDate: `${prev2}-01`, endDate: lastDay(prev2), status: 'COMPLETED' },
    { id: 'b2', orgId: 'local', clientId: 'c-aurora', accountKey: 'k1', startDate: `${prev}-01`, endDate: lastDay(prev), status: 'COMPLETED' },
    // Luz: em dia (mês passado fechado).
    { id: 'b3', orgId: 'local', clientId: 'c-luz', accountKey: 'k2', startDate: `${prev}-01`, endDate: lastDay(prev), status: 'COMPLETED' },
    // Mar Azul: extrato parou no retrasado.
    { id: 'b4', orgId: 'local', clientId: 'c-mar', accountKey: 'k3', startDate: `${prev2}-01`, endDate: lastDay(prev2), status: 'COMPLETED' },
  ],
  contaflow_bank_accounts: [
    { id: 'c-aurora_k1', orgId: 'local', clientId: 'c-aurora', accountKey: 'k1', nickname: 'Itaú', createdAt: '', updatedAt: '' },
    { id: 'c-luz_k2', orgId: 'local', clientId: 'c-luz', accountKey: 'k2', nickname: 'Nubank', createdAt: '', updatedAt: '' },
    { id: 'c-mar_k3', orgId: 'local', clientId: 'c-mar', accountKey: 'k3', nickname: 'Bradesco', createdAt: '', updatedAt: '' },
  ],
  contaflow_period_locks: [
    { id: `c-aurora_${prev2}`, orgId: 'local', clientId: 'c-aurora', month: prev2, lockedAt: '', lockedByUid: 'u' },
    { id: `c-luz_${prev}`, orgId: 'local', clientId: 'c-luz', month: prev, lockedAt: '', lockedByUid: 'u' },
    { id: `c-mar_${prev2}`, orgId: 'local', clientId: 'c-mar', month: prev2, lockedAt: '', lockedByUid: 'u' },
  ],
  contaflow_transactions: [
    ...[3, 8, 15].map((d) => ({ id: `c-aurora_t${d}`, orgId: 'local', clientId: 'c-aurora', fitid: `t${d}`, accountKey: 'k1', date: `${prev}-${String(d).padStart(2, '0')}`, amount: -50, type: 'DEBIT', memo: 'PIX', status: 'PENDING', createdAt: '' })),
    { id: 'c-aurora_a1', orgId: 'local', clientId: 'c-aurora', fitid: 'a1', accountKey: 'k1', date: `${prev}-20`, amount: 900, type: 'CREDIT', memo: 'VENDA', status: 'AUTO_CLASSIFIED', createdAt: '' },
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

test('carteira no painel, busca rápida (Ctrl+K), tema e telas sem erro', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);

  // ── Carteira ─────────────────────────────────────────────────────────
  const carteira = page.getByRole('region', { name: 'Carteira' });
  await expect(carteira.getByRole('listitem')).toHaveCount(3);
  await expect(carteira.getByText('1 de 3 em dia')).toBeVisible();
  const first = carteira.getByRole('listitem').first();
  await expect(first).toContainText('Padaria Aurora');
  await expect(first.getByRole('button', { name: '3 pendentes' })).toBeVisible();
  await expect(first.getByRole('button', { name: '1 para aprovar' })).toBeVisible();
  await expect(carteira.getByRole('listitem').filter({ hasText: 'Mar Azul' })).toContainText('Extrato de Bradesco desatualizado');
  await expect(carteira.getByRole('listitem').filter({ hasText: 'Luz Serviços' })).toContainText('Em dia');

  await first.getByRole('button', { name: '3 pendentes' }).click();
  await page.waitForURL(`**/?mes=${prev}&filtro=PENDING`);
  await expect(page.locator('aside').getByText('Padaria Aurora').first()).toBeVisible();

  // ── Busca rápida (Ctrl+K) ────────────────────────────────────────────
  await page.locator('body').click({ position: { x: 900, y: 600 } });
  await page.keyboard.press('Control+K');
  const dialog = page.getByRole('dialog', { name: 'Busca rápida' });
  await expect(dialog).toBeVisible();
  await page.keyboard.type('razao');
  await expect(dialog.getByRole('option').first()).toContainText('Livro Razão');
  await page.keyboard.press('Enter');
  await page.waitForURL('**/razao');
  await expect(dialog).toHaveCount(0);

  // Trocar de empresa pelo CNPJ.
  await page.keyboard.press('Control+K');
  await page.keyboard.type('44555');
  await expect(dialog.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('aside').getByText('Luz Serviços').first()).toBeVisible();
  await expect(page).toHaveURL(/\/razao$/);

  // Esc fecha; Ctrl+K de novo abre e fecha.
  await page.keyboard.press('Control+K');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // ── Tema ─────────────────────────────────────────────────────────────
  await page.emulateMedia({ colorScheme: 'light' });
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  expect(await theme()).toBe('light');
  await page.getByRole('radio', { name: 'Escuro' }).click();
  expect(await theme()).toBe('dark');
  // Recarregar: o <head> já aplica o escuro antes de qualquer script do app.
  const atFirstPaint = page.waitForEvent('domcontentloaded').then(() => theme());
  await page.reload();
  expect(await atFirstPaint).toBe('dark');
  await page.goto('/painel');
  await expect(page.getByRole('region', { name: 'Carteira' })).toBeVisible();
  // Sistema: segue o sistema operacional, ao vivo.
  await page.getByRole('radio', { name: 'Sistema' }).click();
  expect(await theme()).toBe('light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(theme).toBe('dark');
  await page.getByRole('radio', { name: 'Claro' }).click();
  expect(await theme()).toBe('light');

  // Menu ainda cabe em 1440×900 com o seletor de tema.
  const nav = await page.locator('aside nav').first().evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  expect(nav.scroll).toBeLessThanOrEqual(nav.client);

  // ── Esqueletos: todas as telas abrem sem erro ───────────────────────
  for (const path of ['/', '/pendencias', '/contas', '/lancamentos', '/dre', '/balanco', '/diario', '/razao', '/notas', '/abertura', '/clientes', '/plano-de-contas', '/regras', '/escritorio', '/auditoria']) {
    await page.goto(path);
    await expect(page.locator('main').first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

