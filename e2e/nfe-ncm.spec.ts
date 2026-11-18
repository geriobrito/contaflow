import { expect, test } from '@playwright/test';
import { mockReceita } from './receita';

/**
 * Sugestão de conta pelo NCM: a nota do fornecedor (CFOP 5102) de um computador, numa empresa que
 * não vende computadores, vem sugerida como equipamento de informática, com o motivo; o detalhe
 * da nota mostra o NCM e o capítulo.
 */

const CLIENT_DOC = '11222333000181';
const SUPPLIER_DOC = '11444777000161';
const KEY = `352503${SUPPLIER_DOC}550010000007771123456780`;

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
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20250320120000[-3:BRT]<TRNAMT>-4500.00<FITID>NCM_001<MEMO>PAGAMENTO DE BOLETO - LOJA DE INFORMATICA</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>-4500.00<DTASOF>20250331235959[-3:BRT]</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

const NFE = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${KEY}" versao="4.00">
<ide><mod>55</mod><serie>1</serie><nNF>777</nNF><dhEmi>2025-03-05T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide>
<emit><CNPJ>${SUPPLIER_DOC}</CNPJ><xNome>LOJA DE INFORMATICA LTDA</xNome></emit>
<dest><CNPJ>${CLIENT_DOC}</CNPJ><xNome>PADARIA NCM LTDA</xNome></dest>
<det nItem="1"><prod><NCM>84713012</NCM><CFOP>5102</CFOP><vProd>4500.00</vProd></prod></det>
<total><ICMSTot><vNF>4500.00</vNF></ICMSTot></total>
</infNFe></NFe><protNFe versao="4.00"><infProt><chNFe>${KEY}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;

test('compra de computador do fornecedor: sugestão pelo NCM', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockReceita(page);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Usar credenciais de teste local' }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/painel');

  await page.goto('/clientes');
  await page.getByRole('button', { name: 'Novo cliente' }).first().click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Razão social').fill('Padaria NCM Ltda');
  await sheet.getByLabel('CNPJ').fill(CLIENT_DOC);
  await sheet.getByRole('button', { name: 'Cadastrar cliente' }).click();
  await expect(page.getByText('Cliente cadastrado e definido como ativo')).toBeVisible();

  await page.goto('/plano-de-contas');
  await page.getByRole('button', { name: 'Modelo de plano de contas (CFC)' }).first().click();
  await expect(page.getByText(/contas do modelo de plano de contas \(CFC\) adicionadas/)).toBeVisible();

  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({ name: 'extrato.ofx', mimeType: 'application/x-ofx', buffer: Buffer.from(OFX, 'latin1') });
  await expect(page.getByRole('row', { name: /LOJA DE INFORMATICA/ })).toBeVisible();

  await page.goto('/nfe');
  await page.getByLabel('Arquivos XML das notas fiscais').setInputFiles([{ name: 'nfe-777.xml', mimeType: 'text/xml', buffer: Buffer.from(NFE, 'utf8') }]);
  await expect(page.getByRole('status', { name: 'Resultado da importação' }).getByText(/1 nota\(s\) importada\(s\)/)).toBeVisible();
  // Detalhe da nota: o NCM e o capítulo.
  await page.getByRole('row', { name: /LOJA DE INFORMATICA/ }).click();
  const ncms = page.getByRole('list', { name: 'Produtos por NCM' });
  await expect(ncms).toContainText('NCM 84713012');
  await expect(ncms).toContainText(/84 · .*máquinas/);
  await page.keyboard.press('Escape');

  await page.goto('/?mes=2025-03');
  await page.getByRole('row', { name: /LOJA DE INFORMATICA/ }).click();
  const card = page.getByRole('dialog').getByRole('region', { name: 'Nota fiscal correspondente' });
  await expect(card).toContainText(
    /Conta sugerida \(pelo NCM: NCM 8471: equipamentos de informática e telecomunicação que a empresa não vende\):\s*1\.2\.3\.06 Equipamentos de Informática/
  );
  expect(errors).toEqual([]);
});
