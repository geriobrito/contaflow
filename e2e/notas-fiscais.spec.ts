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
