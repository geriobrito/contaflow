import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * DANFSe no navegador: o XML da NFS-e vira PDF pelo gerador oficial da Receita (WebAssembly em
 * public/danfse/), sem servidor e sem guardar o XML; arquivo que não é NFS-e é recusado.
 */

const KEY = '35503080211444777000161000000000001027010000000016';
const NFSE = `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS${KEY}">
<xLocEmi>São Paulo</xLocEmi><xLocPrestacao>São Paulo</xLocPrestacao><nNFSe>1</nNFSe><cLocIncid>3550308</cLocIncid><xLocIncid>São Paulo</xLocIncid><xTribNac>Assessoria ou consultoria de qualquer natureza</xTribNac><verAplic>1.0</verAplic><ambGer>2</ambGer><tpEmis>1</tpEmis><procEmi>1</procEmi><cStat>100</cStat><dhProc>2027-01-12T09:00:00-03:00</dhProc><nDFSe>123</nDFSe>
<emit><CNPJ>11444777000161</CNPJ><xNome>ESCRITORIO DE ASSESSORIA LTDA</xNome><enderNac><xLgr>Rua das Flores</xLgr><nro>100</nro><xBairro>Centro</xBairro><cMun>3550308</cMun><UF>SP</UF><CEP>01001000</CEP></enderNac></emit>
<valores><vBC>1000.00</vBC><pAliqAplic>2.00</pAliqAplic><vISSQN>20.00</vISSQN><vLiq>1000.00</vLiq></valores>
<DPS versao="1.01"><infDPS Id="DPS355030821144477700016100900000000000000001"><tpAmb>2</tpAmb><dhEmi>2027-01-10T15:30:00-03:00</dhEmi><verAplic>1.0</verAplic><serie>900</serie><nDPS>1</nDPS><dCompet>2027-01-10</dCompet><tpEmit>1</tpEmit><cLocEmi>3550308</cLocEmi>
<prest><CNPJ>11444777000161</CNPJ><regTrib><opSimpNac>1</opSimpNac><regEspTrib>0</regEspTrib></regTrib></prest>
<toma><CNPJ>11222333000181</CNPJ><xNome>PADARIA AURORA LTDA</xNome></toma>
<serv><locPrest><cLocPrestacao>3550308</cLocPrestacao></locPrest><cServ><cTribNac>170101</cTribNac><xDescServ>Consultoria contábil mensal</xDescServ></cServ></serv>
<valores><vServPrest><vServ>1000.00</vServ></vServPrest><trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun><totTrib><indTotTrib>0</indTotTrib></totTrib></trib></valores>
</infDPS></DPS></infNFSe></NFSe>`;

const client = { id: 'c-aurora', orgId: 'local', name: 'Padaria Aurora Ltda', cnpj: '11.222.333/0001-81', regime: 'LUCRO_PRESUMIDO', createdAt: '', updatedAt: '' };

test('DANFSe gerada no navegador a partir do XML da NFS-e', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const cspViolations: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.text().includes('Content Security Policy') && cspViolations.push(m.text()));
  await page.addInitScript((c) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.setItem('contaflow_clients', JSON.stringify([c]));
    sessionStorage.setItem('seeded', '1');
  }, client);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Usar credenciais de teste local' }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/painel');

  await page.goto('/nfe');
  await page.getByRole('button', { name: 'DANFSe' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('XML da NFS-e').setInputFiles([
    { name: 'nfse-1.xml', mimeType: 'text/xml', buffer: Buffer.from(NFSE, 'utf8') },
    { name: 'outra.xml', mimeType: 'text/xml', buffer: Buffer.from('<nada/>', 'utf8') },
  ]);
  await sheet.getByRole('radio', { name: 'Cancelada' }).click();

  const download = page.waitForEvent('download', { timeout: 60_000 });
  await sheet.getByRole('button', { name: 'Gerar 2 DANFSe' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('DANFSe_1_ESCRITORIO_DE_ASSESSORIA_LTDA.pdf');
  const pdf = readFileSync(await file.path());
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.length).toBeGreaterThan(10_000);

  const results = sheet.getByRole('list', { name: 'Resultado da geração' });
  await expect(results).toContainText('nfse-1.xml: NFS-e 1 · ESCRITORIO DE ASSESSORIA LTDA');
  await expect(results).toContainText('outra.xml: não é o XML de uma NFS-e do padrão nacional');
  expect(cspViolations).toEqual([]);
  expect(errors).toEqual([]);
});
