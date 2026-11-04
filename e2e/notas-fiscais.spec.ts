import { expect, test } from '@playwright/test';

/**
 * Notas fiscais: importar o XML de uma compra, ver a conta sugerida no pagamento do boleto na
 * Conciliação, conciliar e ver a nota como paga.
 */

const CLIENT_DOC = '11222333000181';
const SUPPLIER_DOC = '11444777000161';
const KEY = `352503${SUPPLIER_DOC}550010000001231123456780`;

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
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20250331120000[-3:BRT]<LANGUAGE>POR<FI><ORG>BANCO DE TESTE S.A.<FID>999</FI></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS><STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>0999<BRANCHID>0001<ACCTID>12345-6<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20250301000000[-3:BRT]<DTEND>20250331235959[-3:BRT]
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20250302120000[-3:BRT]<TRNAMT>3000.00<FITID>NF_001<MEMO>DEPOSITO EM DINHEIRO</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20250320120000[-3:BRT]<TRNAMT>-1500.00<FITID>NF_002<MEMO>PAGAMENTO DE BOLETO - ACME DISTRIBUIDORA</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>1500.00<DTASOF>20250331235959[-3:BRT]</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

const NFE = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${KEY}" versao="4.00">
<ide><mod>55</mod><serie>1</serie><nNF>123</nNF><dhEmi>2025-03-05T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide>
<emit><CNPJ>${SUPPLIER_DOC}</CNPJ><xNome>ACME DISTRIBUIDORA DE ALIMENTOS LTDA</xNome></emit>
<dest><CNPJ>${CLIENT_DOC}</CNPJ><xNome>PADARIA NOTAS E2E LTDA</xNome></dest>
<det nItem="1"><prod><CFOP>5102</CFOP><vProd>1500.00</vProd></prod></det>
<total><ICMSTot><vNF>1500.00</vNF></ICMSTot></total>
</infNFe></NFe><protNFe versao="4.00"><infProt><chNFe>${KEY}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;

test('nota fiscal de compra sugere a conta do pagamento na conciliação', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/login');
  await page.getByRole('button', { name: 'Usar credenciais de teste local' }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/painel');

  await page.goto('/clientes');
  await page.getByRole('button', { name: 'Novo cliente' }).first().click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Razão social').fill('Padaria Notas E2E Ltda');
  await sheet.getByLabel('CNPJ').fill(CLIENT_DOC);
  await sheet.getByRole('button', { name: 'Cadastrar cliente' }).click();
  await expect(page.getByText('Cliente cadastrado e definido como ativo')).toBeVisible();

  await page.goto('/plano-de-contas');
  await page.getByRole('button', { name: 'Modelo de plano de contas (CFC)' }).first().click();
  await expect(page.getByText(/contas do modelo de plano de contas \(CFC\) adicionadas/)).toBeVisible();

  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({ name: 'extrato.ofx', mimeType: 'application/x-ofx', buffer: Buffer.from(OFX, 'latin1') });
  await expect(page.getByRole('row', { name: /PAGAMENTO DE BOLETO - ACME/ })).toBeVisible();

  await test.step('importa o XML: só o resumo', async () => {
    await page.goto('/nfe');
    await expect(page.getByRole('heading', { name: 'Notas fiscais' })).toBeVisible();
    await page.getByLabel('Arquivos XML das notas fiscais').setInputFiles([
      { name: 'nfe-123.xml', mimeType: 'text/xml', buffer: Buffer.from(NFE, 'utf8') },
      { name: 'outra-coisa.txt', mimeType: 'text/plain', buffer: Buffer.from('x') },
    ]);
    const result = page.getByRole('status', { name: 'Resultado da importação' });
    await expect(result.getByText(/1 nota\(s\) importada\(s\) · 1 de compra/)).toBeVisible();
    await expect(result.getByText(/outra-coisa\.txt/)).toBeVisible();
    // A lista vai para março/2025, o mês da nota.
    const row = page.getByRole('row', { name: /ACME DISTRIBUIDORA/ });
    await expect(row).toContainText('Sem lançamento');
    await expect(row).toContainText('1.500,00');
    // O XML não fica guardado: só o resumo.
    const stored = await page.evaluate(() => localStorage.getItem('contaflow_invoice_summaries') ?? '');
    expect(stored).toContain('"total":1500');
    expect(stored).not.toContain('nfeProc');
  });

  await test.step('na conciliação, o boleto vem com a nota e a conta sugerida', async () => {
    await page.goto('/?mes=2025-03');
    const boleto = page.getByRole('row', { name: /PAGAMENTO DE BOLETO - ACME/ });
    await expect(boleto.getByRole('img', { name: 'Nota fiscal encontrada: conta sugerida' })).toBeVisible();
    await expect(page.getByRole('row', { name: /DEPOSITO EM DINHEIRO/ }).getByRole('img', { name: /Nota fiscal/ })).toHaveCount(0);
    await boleto.click();
    const dialog = page.getByRole('dialog');
    const card = dialog.getByRole('region', { name: 'Nota fiscal correspondente' });
    await expect(card).toContainText('NF-e 123/1 · ACME DISTRIBUIDORA DE ALIMENTOS LTDA');
    await expect(card).toContainText('nome do extrato confere com a nota');
    await expect(card).toContainText(/Conta sugerida \(pelo CFOP\):\s*3\.2\.1\.01 Custo das Mercadorias Vendidas/);
    await page.screenshot({ path: 'test-results/nfe-sugestao.png' });
    await dialog.getByRole('button', { name: 'Conciliar' }).click();
    await expect(dialog).toBeHidden();
    await expect(boleto).toContainText('Custo das Mercadorias Vendidas');
    await expect(boleto.getByRole('img', { name: 'Nota fiscal vinculada' })).toBeVisible();
  });

  await test.step('a nota aparece como paga', async () => {
    await page.goto('/nfe');
    await page.getByRole('button', { name: 'Ano anterior' }).click();
    await page.getByRole('radio', { name: 'Mar' }).click();
    await expect(page.getByRole('row', { name: /ACME DISTRIBUIDORA/ })).toContainText('Paga');
    await page.screenshot({ path: 'test-results/nfe-lista.png', fullPage: true });
  });

  expect(pageErrors).toEqual([]);
});

/* NFS-e tomada com IBS/CBS (2027), empresa do Lucro Presumido: o pagamento sai rateado com o crédito. */

const PROVIDER_DOC = '22333444000155';
const NFSE_KEY = `3550308${'1'}${'2'}${PROVIDER_DOC}${'10'.padStart(13, '0')}2701${'123456789'}${'0'}`;

const OFX_2027 = OFX.replace(/2025(\d{4})/g, '2027$1')
  .replace(/<TRNAMT>-1500\.00<FITID>NF_002<MEMO>[^<]+/, '<TRNAMT>-1000.00<FITID>NF_002<MEMO>PIX ENVIADO - ESCRITORIO DE ASSESSORIA')
  .replace('<BALAMT>1500.00', '<BALAMT>2000.00');

const NFSE = `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS${NFSE_KEY}">
<nNFSe>10</nNFSe><cStat>100</cStat><dhProc>2027-03-05T09:00:00-03:00</dhProc>
<emit><CNPJ>${PROVIDER_DOC}</CNPJ><xNome>ESCRITORIO DE ASSESSORIA LTDA</xNome></emit>
<valores><vLiq>1000.00</vLiq></valores>
<IBSCBS><totCIBS><gIBS><vIBSTot>1.00</vIBSTot></gIBS><gCBS><vCBS>88.00</vCBS></gCBS></totCIBS></IBSCBS>
<DPS versao="1.01"><infDPS Id="DPS1"><dhEmi>2027-03-05T08:00:00-03:00</dhEmi>
<prest><CNPJ>${PROVIDER_DOC}</CNPJ></prest><toma><CNPJ>${CLIENT_DOC}</CNPJ><xNome>PADARIA NOTAS E2E LTDA</xNome></toma>
<serv><cServ><cTribNac>170201</cTribNac></cServ></serv><valores><vServPrest><vServ>1000.00</vServ></vServPrest></valores>
</infDPS></DPS></infNFSe></NFSe>`;

test('NFS-e tomada com IBS/CBS: pagamento rateado com o crédito a recuperar', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/login');
  await page.getByRole('button', { name: 'Usar credenciais de teste local' }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/painel');

  await page.goto('/clientes');
  await page.getByRole('button', { name: 'Novo cliente' }).first().click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Razão social').fill('Padaria Notas E2E Ltda');
  await sheet.getByLabel('CNPJ').fill(CLIENT_DOC);
  await sheet.getByRole('radiogroup', { name: 'Regime tributário' }).getByRole('radio', { name: 'Presumido' }).click();
  await sheet.getByRole('button', { name: 'Cadastrar cliente' }).click();
  await expect(page.getByText('Cliente cadastrado e definido como ativo')).toBeVisible();

  await page.goto('/plano-de-contas');
  await page.getByRole('button', { name: 'Modelo de plano de contas (CFC)' }).first().click();
  await expect(page.getByText(/contas do modelo de plano de contas \(CFC\) adicionadas/)).toBeVisible();

  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({ name: 'extrato.ofx', mimeType: 'application/x-ofx', buffer: Buffer.from(OFX_2027, 'latin1') });
  await expect(page.getByRole('row', { name: /PIX ENVIADO - ESCRITORIO/ })).toBeVisible();

  await page.goto('/nfe');
  await page.getByLabel('Arquivos XML das notas fiscais').setInputFiles([{ name: 'nfse-10.xml', mimeType: 'text/xml', buffer: Buffer.from(NFSE, 'utf8') }]);
  await expect(page.getByRole('status', { name: 'Resultado da importação' }).getByText(/1 nota\(s\) importada\(s\) · 1 de compra/)).toBeVisible();
  const row = page.getByRole('row', { name: /ESCRITORIO DE ASSESSORIA/ });
  await expect(row).toContainText('NFS-e');
  await expect(row).toContainText(/IBS R\$\s*1,00 · CBS R\$\s*88,00/);

  await page.goto('/?mes=2027-03');
  const pix = page.getByRole('row', { name: /PIX ENVIADO - ESCRITORIO/ });
  await pix.click();
  const dialog = page.getByRole('dialog');
  const card = dialog.getByRole('region', { name: 'Nota fiscal correspondente' });
  await expect(card).toContainText('NFS-e 10 · ESCRITORIO DE ASSESSORIA LTDA');
  await expect(card).toContainText(/Conta sugerida \(pelo CFOP\):\s*3\.3\.2\.17 Outras Despesas Gerais/);
  await expect(card).toContainText(/Crédito a recuperar: IBS R\$\s*1,00 e CBS R\$\s*88,00/);
  await card.getByRole('button', { name: 'Lançar com o crédito' }).click();

  await expect(dialog.getByText(/O rateio fica vinculado à NFS-e 10/)).toBeVisible();
  await expect(dialog.getByLabel('Descrição da linha 2')).toHaveValue('IBS a recuperar (nota fiscal)');
  await expect(dialog.getByLabel('Descrição da linha 3')).toHaveValue('CBS a recuperar (nota fiscal)');
  await page.screenshot({ path: 'test-results/nfse-credito.png' });
  await dialog.getByRole('button', { name: 'Salvar rateio' }).click();
  await expect(dialog).toBeHidden();
  await expect(pix.getByRole('img', { name: 'Nota fiscal vinculada' })).toBeVisible();

  // O rateio gravado: despesa pelo líquido do crédito e as contas a recuperar.
  const stored = await page.evaluate(() => localStorage.getItem('contaflow_transactions') ?? '');
  expect(stored).toContain('"amount":-911');
  expect(stored).toContain('"amount":-1,');
  expect(stored).toContain('"amount":-88');

  await page.goto('/nfe');
  await page.getByRole('button', { name: 'Próximo ano' }).click();
  await page.getByRole('radio', { name: 'Mar' }).click();
  await expect(page.getByRole('row', { name: /ESCRITORIO DE ASSESSORIA/ })).toContainText('Paga');

  expect(pageErrors).toEqual([]);
});
