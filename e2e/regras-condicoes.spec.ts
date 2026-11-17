import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Regras de aprendizado: sugestão de favorecido recorrente, regra só para um sentido, filtros,
 * edição da conta de destino e cópia das regras de outra empresa (contas casadas pelo código).
 */

const company = (id: string, name: string, cnpj: string) => ({ id, orgId: 'local', name, tradeName: name, cnpj, regime: 'SIMPLES_NACIONAL', createdAt: '', updatedAt: '' });
const account = (id: string, clientId: string, code: string, name: string, type: string) => ({ id, orgId: 'local', clientId, code, name, type, nature: 'ANALYTIC', level: 4 });
const tx = (n: number, memo: string, amount: number, extra: object = {}) => ({
  id: `c-a_t${n}`, orgId: 'local', clientId: 'c-a', fitid: `t${n}`, accountKey: 'k1', date: `2026-02-${String(n).padStart(2, '0')}`, amount,
  type: amount < 0 ? 'DEBIT' : 'CREDIT', memo, status: 'PENDING', createdAt: '', ...extra,
});
const rule = (id: string, clientId: string, pattern: string, accountId: string, accountCode: string, extra: object = {}) => ({
  id, orgId: 'local', clientId, pattern, matchType: 'CONTAINS', accountId, accountCode, accountName: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
});
const manual = { status: 'RECONCILED', accountId: 'a-alim', accountCode: '3.3.2.10', accountName: 'Alimentação' };

const seed = {
  contaflow_clients: [company('c-a', 'Aurora', '11.222.333/0001-81'), company('c-b', 'Beta', '44.555.666/0001-81')],
  contaflow_accounts: [
    account('a-transp', 'c-a', '3.3.2.05', 'Transporte', 'EXPENSE'),
    account('a-alim', 'c-a', '3.3.2.10', 'Alimentação', 'EXPENSE'),
    account('a-rec', 'c-a', '3.1.1.01', 'Receita de serviços', 'REVENUE'),
    account('b-transp', 'c-b', '3.3.2.05', 'Transporte', 'EXPENSE'),
    account('b-rara', 'c-b', '9.9.9.99', 'Conta só da Beta', 'EXPENSE'),
  ],
  contaflow_transactions: [
    // Conciliados à mão três vezes na mesma conta, sem regra: viram sugestão.
    tx(1, 'Pix enviado - Padaria Sol', -50, manual),
    tx(2, 'Pix enviado - Padaria Sol', -60, manual),
    tx(3, 'Pix enviado - Padaria Sol', -70, manual),
    // O mesmo favorecido nos dois sentidos.
    tx(10, 'Pix recebido - Joao Socio', 1000),
    tx(11, 'Pix enviado - Joao Socio', -800),
  ],
  contaflow_rules: [
    rule('r-netflix', 'c-a', 'netflix', 'a-transp', '3.3.2.05', { overrideCount: 2 }),
    rule('rb-uber', 'c-b', 'uber', 'b-transp', '3.3.2.05', { direction: 'OUT' }),
    rule('rb-netflix', 'c-b', 'netflix', 'b-transp', '3.3.2.05'),
    rule('rb-raro', 'c-b', 'raro', 'b-rara', '9.9.9.99'),
  ],
};

/** Escolhe a conta num campo de conta com busca. */
async function pickAccount(page: Page, trigger: Locator, code: string, name: RegExp) {
  await trigger.click();
  await page.getByPlaceholder('Código ou nome').fill(code);
  await page.getByRole('option', { name }).click();
}

test('regras: sugestão, sentido, filtros, edição da conta e cópia entre empresas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((data) => {
    if (sessionStorage.getItem('seeded')) return;
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, JSON.stringify(v));
    localStorage.setItem('contaflow_active_client', 'c-a');
    sessionStorage.setItem('seeded', '1');
  }, seed);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Usar credenciais de teste local' }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/painel');
  await page.goto('/regras');

  const rowOf = (term: string) => page.getByRole('row').filter({ has: page.getByTitle(term, { exact: true }) });

  await test.step('sugestão de favorecido recorrente vira regra só de saídas', async () => {
    const suggestions = page.getByRole('region', { name: 'Sugestões de regra' });
    await expect(suggestions).toContainText('Padaria Sol');
    await expect(suggestions).toContainText('3 saída(s)');
    await expect(suggestions).toContainText('Alimentação');
    await suggestions.getByRole('button', { name: 'Criar regra para Padaria Sol' }).click();
    await expect(page.getByText('Regra criada. Nenhum pendente em período aberto casou com ela.')).toBeVisible();
    await expect(rowOf('padaria sol')).toContainText('só saídas');
    await expect(rowOf('padaria sol')).toContainText('Alimentação');
    // Agora a regra cobre o favorecido: a sugestão some.
    await expect(suggestions).toHaveCount(0);
  });

  await test.step('regra só para entradas não leva a saída do mesmo favorecido', async () => {
    const form = page.locator('form').filter({ hasText: 'Nova regra' });
    await form.getByLabel('Termo', { exact: true }).fill('joao socio');
    await pickAccount(page, form.getByRole('button', { name: /Conta de destino/ }), '3.1.1.01', /Receita de serviços/);
    await form.getByLabel('Sentido do lançamento').selectOption('IN');
    await form.getByRole('button', { name: 'Adicionar' }).click();
    // Dois pendentes do favorecido; só a entrada é classificada.
    await expect(page.getByText('Regra criada e aplicada a 1 lançamento(s) pendente(s).')).toBeVisible();
    await expect(rowOf('joao socio')).toContainText('só entradas');
  });

  await test.step('filtros: corrigidas e sem uso', async () => {
    const filters = page.getByRole('group', { name: 'Filtrar regras' });
    await filters.getByRole('button', { name: /Corrigidas\s*1/ }).click();
    await expect(page.getByRole('row')).toHaveCount(2); // cabeçalho + netflix
    await expect(rowOf('netflix')).toContainText('Corrigida à mão 2 vez(es)');
    await filters.getByRole('button', { name: /Sem uso\s*1/ }).click();
    await expect(rowOf('netflix')).toBeVisible();
    await expect(page.getByText('Excluir as 1 sem uso')).toBeVisible();
    await filters.getByRole('button', { name: /Todas\s*3/ }).click();
  });

  await test.step('edição troca a conta de destino e põe condição', async () => {
    await rowOf('netflix').hover();
    await page.getByRole('button', { name: 'Editar regra netflix' }).click();
    const editing = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Salvar regra' }) });
    await pickAccount(page, editing.getByRole('button', { name: /Conta de destino/ }), '3.3.2.10', /Alimentação/);
    await editing.getByLabel('Sentido do lançamento').selectOption('OUT');
    await editing.getByLabel('Valor máximo').fill('100');
    await editing.getByRole('button', { name: 'Salvar regra' }).click();
    await expect(rowOf('netflix')).toContainText('Alimentação');
    await expect(rowOf('netflix')).toContainText('só saídas');
    await expect(rowOf('netflix')).toContainText('até R$ 100,00');

    // Retirar a condição também grava (valor neutro), e a etiqueta some depois de recarregar.
    await rowOf('netflix').hover();
    await page.getByRole('button', { name: 'Editar regra netflix' }).click();
    await editing.getByLabel('Sentido do lançamento').selectOption('');
    await editing.getByRole('button', { name: 'Salvar regra' }).click();
    await expect(rowOf('netflix')).not.toContainText('só saídas');
    await page.reload();
    await expect(rowOf('netflix')).toContainText('até R$ 100,00');
    await expect(rowOf('netflix')).not.toContainText('só saídas');
  });

  await test.step('cópia de outra empresa casa a conta pelo código', async () => {
    await page.getByRole('button', { name: 'Copiar de outra empresa' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Empresa de origem').selectOption('c-b');
    // A "netflix" do destino agora tem condição de valor: a da origem, sem condição, é outra regra.
    await expect(sheet.getByRole('status')).toContainText('2 regra(s) a copiar · 1 fica(m) de fora');
    await expect(sheet).toContainText('1 conta sem correspondente no plano do destino: raro (9.9.9.99)');
    await sheet.getByRole('button', { name: 'Copiar 2 regra(s)' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText(/2 regra\(s\) copiada\(s\)/)).toBeVisible();

    // Copiar de novo: tudo já existe no destino.
    await page.getByRole('button', { name: 'Copiar de outra empresa' }).click();
    await sheet.getByLabel('Empresa de origem').selectOption('c-b');
    await expect(sheet.getByRole('status')).toContainText('0 regra(s) a copiar · 3 fica(m) de fora');
    await expect(sheet).toContainText('2 já existe no destino: uber, netflix');
    await sheet.getByRole('button', { name: 'Fechar' }).click();
    await expect(rowOf('uber')).toContainText('Transporte');
    await expect(rowOf('uber')).toContainText('só saídas');
  });

  expect(errors).toEqual([]);
});
