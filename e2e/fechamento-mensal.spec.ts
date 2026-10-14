import { expect, test, type Page } from '@playwright/test';

/**
 * Fluxo completo de um fechamento mensal, do cadastro da empresa aos demonstrativos:
 * login → empresa → plano de contas ITG 1000 → importar extrato OFX → classificar →
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

  await test.step('plano de contas ITG 1000', async () => {
    await page.goto('/plano-de-contas');
    await page.getByRole('button', { name: 'Aplicar plano ITG 1000 (2022)' }).first().click();
    await expect(page.getByText(/contas do plano ITG 1000 adicionadas/)).toBeVisible();
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
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('heading', { name: 'Novo Lançamento Contábil Manual' })).toBeHidden();
  });

  expect(pageErrors).toEqual([]);
});
