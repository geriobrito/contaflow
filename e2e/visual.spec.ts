/**
 * Testes visuais: fotografa as telas principais nos temas claro e escuro e compara com a imagem
 * de referência em `e2e/visual.spec.ts-snapshots/`. Pegam quebras de aparência que os outros
 * testes não veem (texto invisível no tema escuro, coluna estourada, espaçamento trocado).
 *
 *   npm run test:visual            compara com as referências
 *   npm run test:visual:update     regrava as referências depois de uma mudança visual desejada
 *
 * O relógio do navegador fica parado em uma data fixa e os dados são sempre os mesmos, para a
 * imagem só mudar quando a interface mudar. As referências valem para a máquina que as gerou
 * (a renderização de fontes varia entre sistemas).
 */
import { expect, test, type Page } from '@playwright/test';

const TODAY = new Date(2026, 2, 16, 12, 0, 0); // 16/03/2026: competência de foco = fev/2026.

const company = (id: string, name: string, tradeName: string, cnpj: string) => ({ id, orgId: 'local', name, tradeName, cnpj, regime: 'SIMPLES_NACIONAL', createdAt: '', updatedAt: '' });
const seed = {
  contaflow_clients: [
    company('c-aurora', 'Aurora Alimentos Ltda', 'Padaria Aurora', '11222333000181'),
    company('c-luz', 'Luz Serviços Contábeis Ltda', 'Luz Serviços', '44555666000100'),
    company('c-mar', 'Mar Azul Comércio Ltda', 'Mar Azul', '77888999000122'),
  ],
  contaflow_batches: [
    { id: 'b1', orgId: 'local', clientId: 'c-aurora', accountKey: 'k1', startDate: '2026-01-01', endDate: '2026-01-31', status: 'COMPLETED' },
    { id: 'b2', orgId: 'local', clientId: 'c-aurora', accountKey: 'k1', startDate: '2026-02-01', endDate: '2026-02-28', status: 'COMPLETED' },
    { id: 'b3', orgId: 'local', clientId: 'c-luz', accountKey: 'k2', startDate: '2026-02-01', endDate: '2026-02-28', status: 'COMPLETED' },
    { id: 'b4', orgId: 'local', clientId: 'c-mar', accountKey: 'k3', startDate: '2026-01-01', endDate: '2026-01-31', status: 'COMPLETED' },
  ],
  contaflow_bank_accounts: [
    { id: 'c-aurora_k1', orgId: 'local', clientId: 'c-aurora', accountKey: 'k1', nickname: 'Itaú', createdAt: '', updatedAt: '' },
    { id: 'c-luz_k2', orgId: 'local', clientId: 'c-luz', accountKey: 'k2', nickname: 'Nubank', createdAt: '', updatedAt: '' },
    { id: 'c-mar_k3', orgId: 'local', clientId: 'c-mar', accountKey: 'k3', nickname: 'Bradesco', createdAt: '', updatedAt: '' },
  ],
  contaflow_period_locks: [
    { id: 'c-aurora_2026-01', orgId: 'local', clientId: 'c-aurora', month: '2026-01', lockedAt: '', lockedByUid: 'u' },
    { id: 'c-luz_2026-02', orgId: 'local', clientId: 'c-luz', month: '2026-02', lockedAt: '', lockedByUid: 'u' },
    { id: 'c-mar_2026-01', orgId: 'local', clientId: 'c-mar', month: '2026-01', lockedAt: '', lockedByUid: 'u' },
  ],
  contaflow_transactions: [
    ...[3, 8, 15].map((d) => ({ id: `c-aurora_t${d}`, orgId: 'local', clientId: 'c-aurora', fitid: `t${d}`, accountKey: 'k1', date: `2026-02-${String(d).padStart(2, '0')}`, amount: -50 * d, type: 'DEBIT', memo: `PIX ENVIADO FORNECEDOR ${d}`, status: 'PENDING', createdAt: '' })),
    { id: 'c-aurora_a1', orgId: 'local', clientId: 'c-aurora', fitid: 'a1', accountKey: 'k1', date: '2026-02-20', amount: 900, type: 'CREDIT', memo: 'VENDA CARTAO', status: 'AUTO_CLASSIFIED', createdAt: '' },
  ],
};

/** Telas fotografadas (depois do login). */
const SCREENS: readonly [name: string, path: string][] = [
  ['painel', '/painel'],
  ['conciliacao', '/?mes=2026-02'],
  ['dre', '/dre'],
  ['balanco', '/balanco'],
  ['clientes', '/clientes'],
  ['plano-de-contas', '/plano-de-contas'],
  ['folha', '/folha?mes=2026-02'],
  ['regras', '/regras'],
];

async function prepare(page: Page, theme: 'light' | 'dark') {
  await page.clock.setFixedTime(TODAY);
  await page.addInitScript(
    ({ data, theme }) => {
      localStorage.setItem('contaflow_theme', theme);
      if (sessionStorage.getItem('seeded')) return;
      for (const [k, v] of Object.entries(data)) localStorage.setItem(k, JSON.stringify(v));
      sessionStorage.setItem('seeded', '1');
    },
    { data: seed, theme }
  );
}

/** Espera a tela assentar: rede parada, fontes carregadas e nenhum esqueleto de carregamento. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

async function shoot(page: Page, name: string) {
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    // A versão no rodapé da barra lateral muda a cada commit.
    mask: [page.getByText(/^Versão \w+/)],
    maxDiffPixelRatio: 0.002,
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`aparência das telas principais no tema ${theme === 'light' ? 'claro' : 'escuro'}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await prepare(page, theme);

    await page.goto('/login');
    await shoot(page, `login-${theme}`);

    await page.getByRole('button', { name: 'Usar credenciais de teste local' }).click();
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL('**/painel');
    // Trabalha na Padaria Aurora (a empresa com movimento).
    await page.getByRole('region', { name: 'Carteira' }).getByRole('button', { name: '3 pendentes' }).click();
    await page.waitForURL('**/?mes=2026-02&filtro=PENDING');

    for (const [name, path] of SCREENS) {
      await page.goto(path);
      await shoot(page, `${name}-${theme}`);
    }
  });
}

test('janela estreita (1024px): barra lateral recolhida e conteúdo sem estourar', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await prepare(page, 'light');
  await page.goto('/login');
  await page.getByRole('button', { name: 'Usar credenciais de teste local' }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/painel');
  await expect(page.getByRole('button', { name: 'Expandir barra lateral' })).toBeVisible();
  await settle(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shoot(page, 'painel-estreito');
});
