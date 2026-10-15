import { expect, test, type Page } from '@playwright/test';

/**
 * Fluxo completo de um fechamento mensal, do cadastro da empresa aos demonstrativos:
 * login → empresa → modelo de plano de contas → importar extrato OFX → classificar →
 * fechar a competência → DRE, Livro Diário e Balanço.
 */

const stmt = (date: string, amount: string, fitid: string, memo: string) => `
<STMTTRN>
<TRNTYPE>${amount.startsWith('-') ? 'DEBIT' : 'CREDIT'}
<DTPOSTED>${date}120000[-3:BRT]
<TRNAMT>${amount}
<FITID>${fitid}
<MEMO>${memo}
</STMTTRN>`;

/** Extrato de março/2025: uma receita, um aluguel e uma tarifa. Resultado: 5000 − 1200 − 32,50 = 3.767,50. */
const OFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>20250331120000[-3:BRT]
<LANGUAGE>POR
<FI>
<ORG>BANCO DE TESTE S.A.
<FID>999
</FI>
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>0999
<BRANCHID>0001
<ACCTID>12345-6
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20250301000000[-3:BRT]
<DTEND>20250331235959[-3:BRT]
${stmt('20250305', '5000.00', 'E2E_001', 'RECEBIMENTO CLIENTE ALFA COMERCIO LTDA')}
${stmt('20250310', '-1200.00', 'E2E_002', 'ALUGUEL SALA COMERCIAL IMOBILIARIA CENTRAL')}
${stmt('20250320', '-32.50', 'E2E_003', 'TAR PACOTE MENSAL SERVICOS')}
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>3767.50
<DTASOF>20250331235959[-3:BRT]
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

/** Abre o lançamento, escolhe a conta pelo código e concilia. */
async function classify(page: Page, memo: RegExp, accountCode: string, accountName: RegExp, options: { learnRule: boolean }) {
  await page.getByRole('row', { name: memo }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Classificar lançamento' })).toBeVisible();
  await sheet.getByPlaceholder('Buscar por código ou nome').fill(accountCode);
  await sheet.getByRole('option', { name: accountName }).click();
  await sheet.locator('#learn-rule').setChecked(options.learnRule, { force: true });
  await sheet.getByRole('button', { name: 'Conciliar' }).click();
  await expect(sheet).toBeHidden();
}

test('fechamento mensal: do extrato à DRE', async ({ page }) => {
  // Qualquer erro de script na página reprova o teste.
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await test.step('login no modo local', async () => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Usar credenciais de teste local' }).click();
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL('**/painel');
    // Garante que os dados vão para o localStorage, nunca para um projeto Firebase.
    await expect(page.getByText('Modo local')).toBeVisible();
  });

  await test.step('cadastro da empresa', async () => {
    await page.goto('/clientes');
    await page.getByRole('button', { name: 'Novo cliente' }).first().click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Razão social').fill('Padaria Teste E2E Ltda');
    await sheet.getByLabel('CNPJ').fill('11222333000181');
    await sheet.getByRole('button', { name: 'Cadastrar cliente' }).click();
    await expect(page.getByText('Cliente cadastrado e definido como ativo')).toBeVisible();
  });

  await test.step('modelo de plano de contas', async () => {
    await page.goto('/plano-de-contas');
    await page.getByRole('button', { name: 'Modelo de plano de contas (CFC)' }).first().click();
    await expect(page.getByText(/contas do modelo de plano de contas \(CFC\) adicionadas/)).toBeVisible();
    await expect(page.getByRole('tree', { name: 'Plano de contas' })).toBeVisible();
  });

  await test.step('importação do extrato OFX', async () => {
    await page.goto('/');
    await page.locator('input[type="file"]').setInputFiles({ name: 'extrato-marco.ofx', mimeType: 'application/x-ofx', buffer: Buffer.from(OFX, 'latin1') });
    // A tela vai para o mês do extrato e lista os três lançamentos.
    await expect(page.getByRole('row', { name: /RECEBIMENTO CLIENTE ALFA/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /ALUGUEL SALA COMERCIAL/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /TAR PACOTE MENSAL/ })).toBeVisible();
  });

  await test.step('classificação dos lançamentos', async () => {
    await classify(page, /RECEBIMENTO CLIENTE ALFA/, '3.1.1.01', /Receita de Prestação de Serviços/, { learnRule: false });
    // Com "Lembrar essa classificação": cria a regra de aprendizado junto.
    await classify(page, /ALUGUEL SALA COMERCIAL/, '3.3.2.07', /Aluguéis e Condomínios/, { learnRule: true });
    await classify(page, /TAR PACOTE MENSAL/, '3.4.1.01.002', /Despesas Bancárias/, { learnRule: false });
    await expect(page.getByText(/1\s+regra\(s\) ativa\(s\)/)).toBeVisible();
  });

  await test.step('fechamento da competência', async () => {
    await page.getByRole('button', { name: 'Fechar competência' }).click();
    await page.getByRole('button', { name: 'Toque para confirmar o fechamento' }).click();
    await expect(page.getByText('Competência fechada', { exact: true })).toBeVisible();
    // Mês fechado: o lançamento abre só para consulta, sem botão de conciliar.
    await page.getByRole('row', { name: /ALUGUEL SALA COMERCIAL/ }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: /Conciliar|Salvar nova classificação/ })).toHaveCount(0);
    await page.getByRole('dialog').getByRole('button', { name: 'Fechar' }).first().click();
  });

  await test.step('DRE do período', async () => {
    await page.goto('/dre');
    await expect(page.getByText(/Resultado líquido do exercício/).first()).toBeVisible();
    await expect(page.getByText(/3\.767,50/).first()).toBeVisible();
    await expect(page.getByText(/5\.000,00/).first()).toBeVisible();
  });

  await test.step('Livro Diário', async () => {
    await page.goto('/diario');
    await expect(page.getByText('RECEBIMENTO CLIENTE ALFA COMERCIO LTDA')).toBeVisible();
    // Tudo classificado e competência fechada: o livro não é provisório.
    await expect(page.getByText(/Diário provisório/)).toHaveCount(0);
    await expect(page.getByText(/6\.232,50/).first()).toBeVisible();
  });

  await test.step('Balanço patrimonial', async () => {
    await page.goto('/balanco');
    await expect(page.getByRole('heading', { name: 'Balanço patrimonial' })).toBeVisible();
    // Banco: 5000 − 1200 − 32,50.
    await expect(page.getByText(/3\.767,50/).first()).toBeVisible();
  });

  await test.step('DLPA e encerramento do exercício', async () => {
    await page.getByRole('radio', { name: 'DLPA' }).click();
    await expect(page.getByRole('heading', { name: 'Lucros ou prejuízos acumulados' }).first()).toBeVisible();
    const dlpa = page.getByRole('region', { name: 'Demonstração de lucros ou prejuízos acumulados' });
    await expect(dlpa.getByRole('row', { name: /Lucro ou prejuízo líquido do exercício.*3\.767,50/ })).toBeVisible();
    // Dezembro ainda aberto: o exercício não pode ser encerrado.
    const closing = page.getByRole('region', { name: 'Encerramento do exercício' });
    await expect(closing.getByText(/Feche a competência de dezembro/)).toBeVisible();
    await expect(closing.getByRole('button', { name: 'Encerrar exercício' })).toBeDisabled();
  });

  await test.step('Balancete: filtro do encerramento (ARE)', async () => {
    await page.getByRole('radio', { name: 'Balancete' }).click();
    const ignore = page.getByLabel(/Ignorar lançamentos de encerramento \(ARE\)/);
    await expect(ignore).toBeChecked();
    await expect(page.getByText('(nenhum no período)')).toBeVisible();
  });

  await test.step('Livro Razão', async () => {
    await page.goto('/razao');
    await expect(page.getByRole('heading', { name: 'Livro Razão Analítico' })).toBeVisible();
    // Abre na conta do banco, no mês do extrato: as 3 partidas e o saldo final.
    await expect(page.getByText(/3 partidas no período/)).toBeVisible();
    await expect(page.getByText(/3\.767,50/).first()).toBeVisible();
  });

  await test.step('Contas e extratos', async () => {
    await page.goto('/contas');
    await expect(page.getByRole('heading', { name: 'Contas e extratos' })).toBeVisible();
    await expect(page.getByText('extrato-marco.ofx')).toBeVisible();
    // O saldo contábil na data do extrato confere com o saldo informado pelo banco.
    await expect(page.getByText(/confere/)).toBeVisible();
  });

  await test.step('Regras de aprendizado', async () => {
    await page.goto('/regras');
    await expect(page.getByRole('heading', { name: 'Regras de aprendizado' })).toBeVisible();
    await expect(page.getByText(/1\s+regra\(s\) ativa\(s\)/)).toBeVisible();
    await expect(page.getByRole('table').getByText(/Aluguéis e Condomínios/)).toBeVisible();
  });

  await test.step('Lançamentos manuais', async () => {
    await page.goto('/lancamentos');
    await page.getByRole('button', { name: 'Novo Lançamento' }).first().click();
    await expect(page.getByRole('heading', { name: 'Novo Lançamento Contábil Manual' })).toBeVisible();
    // Modelo de provisão: o valor do DAS vira as partidas nas contas do modelo de plano de contas.
    await page.getByRole('group', { name: 'Modelos de lançamento' }).getByRole('button', { name: 'DAS do Simples Nacional' }).click();
    await page.getByLabel('Valor do DAS (PGDAS-D)').fill('812,40');
    await page.getByRole('button', { name: 'Preencher as partidas' }).click();
    await expect(page.getByPlaceholder(/Provisão mensal de salários/)).toHaveValue(/Provisão do Simples Nacional \(DAS\) - competência/);
    await expect(page.getByText(/812,40/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('heading', { name: 'Novo Lançamento Contábil Manual' })).toBeHidden();
  });

  await test.step('Notas explicativas', async () => {
    await page.goto('/notas');
    await expect(page.getByRole('heading', { name: 'Notas explicativas' })).toBeVisible();
    // Exercício do extrato (o padrão é o ano anterior ao corrente).
    await page.locator('select').first().selectOption('2025');
    await expect(page.getByRole('region', { name: 'Base de preparação' }).getByRole('textbox', { name: /Texto da nota/ })).toHaveValue(/NBC TG 1002 - Contabilidade para Microentidades/);
    await expect(page.getByText(/trecho\(s\) entre colchetes/)).toBeVisible();
    // Patrimônio líquido já vem com o resultado do exercício; a edição é gravada para a empresa.
    const equity = page.getByRole('region', { name: 'Patrimônio líquido' }).getByRole('textbox', { name: /Texto da nota/ });
    await expect(equity).toHaveValue(/O lucro de R\$\s3\.767,50 do exercício/);
    await equity.fill('Capital social de R$ 10.000,00.');
    await expect(page.getByText('Salvo (modo local)')).toBeVisible();
    await page.reload();
    await page.locator('select').first().selectOption('2025');
    await expect(page.getByRole('region', { name: 'Patrimônio líquido' }).getByRole('textbox', { name: /Texto da nota/ })).toHaveValue('Capital social de R$ 10.000,00.');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Gerar PDF' }).click();
    expect((await download).suggestedFilename()).toMatch(/^Notas_Explicativas_.*\.pdf$/);
  });

  await test.step('Balanço de abertura (sem contabilidade anterior)', async () => {
    await page.goto('/abertura');
    await expect(page.getByRole('heading', { name: 'Balanço de abertura' })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Balanço de abertura \(sem contabilidade anterior/ })).toBeChecked();
    // Movimento em 2025: a data sugerida nunca é do ano corrente.
    await expect(page.getByLabel(/Data do balanço de abertura/)).toHaveValue(/^2025-/);
    // Banco 1.500 e capital 1.000: os 500 de diferença vão, credores, para a 2.3.3.04.
    await page.locator('input[id^="bank-"]').first().fill('1.500,00');
    await page.getByLabel(/^Capital Subscrito$/).fill('1.000,00');
    await expect(page.getByText(/Contrapartida automática na conta 2\.3\.3\.04 Balanço de Abertura: R\$\s500,00 \(Credor\)/)).toBeVisible();
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('status').filter({ hasText: /Abertura salva às/ })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(/^Capital Subscrito$/)).toHaveValue('1000,00');
    await expect(page.locator('input[id^="bank-"]').first()).toHaveValue('1500,00');
    // Abertura conferida: o balanço não avisa de diferença, e a 2.3.3.04 aparece no PL.
    await page.goto('/balanco');
    await expect(page.getByRole('heading', { name: 'Balanço patrimonial' })).toBeVisible();
    await expect(page.getByText('Abertura não conferida')).toHaveCount(0);
    await expect(page.getByRole('main').getByText('Balanço de Abertura', { exact: true })).toBeVisible();
    await expect(page.getByText('Ativo = Passivo + Patrimônio líquido')).toBeVisible();
  });

  expect(pageErrors).toEqual([]);
});
