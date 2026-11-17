import { expect, test } from '@playwright/test';

/**
 * Classificação tributária do IBS/CBS (cClassTrib) pela tabela oficial: a nota de compra com um
 * item sem direito a crédito é apontada nas conferências, e o detalhe da nota mostra cada
 * classificação com o efeito no crédito.
 */

const CLIENT_DOC = '11222333000181';
const SUPPLIER_DOC = '11444777000161';
const KEY = `352703${SUPPLIER_DOC}550010000004561123456780`;

const item = (n: number, cst: string, cClassTrib: string, ibs: string, cbs: string) =>
  `<det nItem="${n}"><prod><CFOP>5102</CFOP><vProd>500.00</vProd></prod><imposto><IBSCBS><CST>${cst}</CST><cClassTrib>${cClassTrib}</cClassTrib><gIBSCBS><vBC>500.00</vBC><gIBSUF><vIBSUF>${ibs}</vIBSUF></gIBSUF><vIBS>${ibs}</vIBS><gCBS><vCBS>${cbs}</vCBS></gCBS></gIBSCBS></IBSCBS></imposto></det>`;

const NFE = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${KEY}" versao="4.00">
<ide><mod>55</mod><serie>1</serie><nNF>456</nNF><dhEmi>2027-03-05T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide>
<emit><CNPJ>${SUPPLIER_DOC}</CNPJ><xNome>TRANSPORTADORA ZPE LTDA</xNome></emit>
<dest><CNPJ>${CLIENT_DOC}</CNPJ><xNome>PADARIA AURORA LTDA</xNome></dest>
${item(1, '000', '000001', '10.00', '90.00')}${item(2, '200', '200001', '5.00', '45.00')}
<total><ICMSTot><vNF>1000.00</vNF></ICMSTot><IBSCBSTot><gIBS><vIBS>15.00</vIBS></gIBS><gCBS><vCBS>135.00</vCBS></gCBS></IBSCBSTot></total>
</infNFe></NFe><protNFe versao="4.00"><infProt><chNFe>${KEY}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;

const client = { id: 'c-aurora', orgId: 'local', name: 'Padaria Aurora Ltda', cnpj: '11.222.333/0001-81', regime: 'LUCRO_PRESUMIDO', createdAt: '', updatedAt: '' };

test('nota de compra com classificação sem crédito é apontada e detalhada', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((c) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.setItem('contaflow_clients', JSON.stringify([c]));
    sessionStorage.setItem('seeded', '1');
  }, client);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Usar credenciais de teste local' }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/painel');

  await page.goto('/nfe');
  await page.getByLabel('Arquivos XML das notas fiscais').setInputFiles([{ name: 'nfe-456.xml', mimeType: 'text/xml', buffer: Buffer.from(NFE, 'utf8') }]);
  await expect(page.getByRole('status', { name: 'Resultado da importação' }).getByText(/1 nota\(s\) importada\(s\) · 1 de compra/)).toBeVisible();

  // Gravou só o resumo, com o IBS/CBS por classificação.
  const stored = await page.evaluate(() => localStorage.getItem('contaflow_invoice_summaries') ?? '');
  expect(stored).toContain('"cClassTrib":"200001"');

  const checks = page.getByRole('region', { name: 'Classificação tributária do IBS/CBS' });
  await expect(checks).toContainText('a conferir em 1 nota(s)');
  await expect(checks).toContainText('200001');
  await expect(checks).toContainText('não dá crédito ao adquirente');

  await checks.getByRole('button', { name: /NF-e 456/ }).click();
  const table = page.getByRole('table', { name: 'Classificação tributária do IBS/CBS' });
  await expect(table.getByRole('row').filter({ hasText: '000001' })).toContainText('Dá crédito ao adquirente');
  await expect(table.getByRole('row').filter({ hasText: '200001' })).toContainText('Sem crédito para o adquirente');
  expect(errors).toEqual([]);
});
