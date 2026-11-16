import { expect, test } from '@playwright/test';
import { mockReceita } from './receita';

/**
 * Pendências do cliente de ponta a ponta: a pergunta sai da Conciliação, vira link, o cliente
 * responde pela página pública (o rascunho sobrevive a recarregar a página), a resposta volta para
 * o escritório e o lançamento é classificado. No fim, a Auditoria mostra a trilha, com os filtros
 * e o intervalo de datas.
 */

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
<ACCTID>55555-1
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20250301000000[-3:BRT]
<DTEND>20250331235959[-3:BRT]
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20250301120000[-3:BRT]
<TRNAMT>-72280.00
<FITID>E2E_VEIC_001
<MEMO>PAGAMENTO CONCESSIONARIA AUTO SUL VEICULO
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>-72280.00
<DTASOF>20250331235959[-3:BRT]
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;


test('pendências: pergunta, link público com rascunho, resposta, classificação e auditoria', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await mockReceita(page);

  await test.step('login, empresa, plano de contas e extrato', async () => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Usar credenciais de teste local' }).click();
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL('**/painel');

    await page.goto('/clientes');
    await page.getByRole('button', { name: 'Novo cliente' }).first().click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Razão social').fill('Enjoy BPO Financeiro Ltda');
    await sheet.getByLabel('CNPJ').fill('11222333000181');
    await sheet.getByRole('button', { name: 'Cadastrar cliente' }).click();
    await expect(page.getByText('Cliente cadastrado e definido como ativo')).toBeVisible();

    await page.goto('/plano-de-contas');
    await page.getByRole('button', { name: 'Modelo de plano de contas (CFC)' }).first().click();
    await expect(page.getByText(/contas do modelo de plano de contas \(CFC\) adicionadas/)).toBeVisible();

    await page.goto('/');
    await page.locator('input[type="file"]').setInputFiles({ name: 'extrato.ofx', mimeType: 'application/x-ofx', buffer: Buffer.from(OFX, 'latin1') });
    await expect(page.getByRole('row', { name: /PAGAMENTO CONCESSIONARIA/ })).toBeVisible();
  });

  await test.step('Conciliação: perguntar ao cliente', async () => {
    await page.getByRole('row', { name: /PAGAMENTO CONCESSIONARIA/ }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('radio', { name: 'Perguntar ao cliente' }).click();
    await sheet.getByRole('button', { name: 'Enviar para pendências do cliente' }).click();
    await expect(sheet).toBeHidden();
  });

  let link = '';
  await test.step('Pendências: a pergunta ainda não enviada vira link', async () => {
    await page.goto('/pendencias');
    await expect(page.getByRole('region', { name: 'Ainda não enviadas' }).getByText('PAGAMENTO CONCESSIONARIA AUTO SUL VEICULO').first()).toBeVisible();
    await page.getByRole('button', { name: 'Gerar link com 1 pergunta(s)' }).click();
    await expect(page.getByText('Link criado · envie ao cliente')).toBeVisible();
    link = await page.getByLabel('Link para o cliente').first().inputValue();
    expect(link).toMatch(/\/responder#t=.{32,}/);
    await expect(page.getByRole('region', { name: 'Aguardando o cliente' })).toBeVisible();
  });

  await test.step('link público: o rascunho sobrevive a recarregar e a resposta é enviada', async () => {
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Informações sobre lançamentos' })).toBeVisible();
    await page.getByLabel('Resposta 1').fill('Compra do veículo da empresa, nota 1234 da Auto Sul');
    await expect(page.getByText(/fica guardado neste aparelho até enviar/)).toBeVisible();

    // O cliente fecha a aba antes de enviar: ao voltar, o texto está lá e nada foi para o escritório.
    await page.reload();
    await expect(page.getByLabel('Resposta 1')).toHaveValue('Compra do veículo da empresa, nota 1234 da Auto Sul');
    await expect(page.getByText(/Recuperamos o que você já tinha escrito neste aparelho/)).toBeVisible();

    await page.getByRole('button', { name: 'Enviar respostas (1 de 1)' }).click();
    await expect(page.getByText(/Respostas enviadas\. Obrigado!/)).toBeVisible();
    // Enviado: o rascunho é apagado e a página reabre com a resposta gravada, sem o aviso.
    await page.reload();
    await expect(page.getByLabel('Resposta 1')).toHaveValue('Compra do veículo da empresa, nota 1234 da Auto Sul');
    await expect(page.getByText(/Recuperamos o que você já tinha escrito/)).toHaveCount(0);
  });

  await test.step('Pendências: a resposta chega e o lançamento é classificado', async () => {
    await page.goto('/pendencias');
    const answered = page.getByRole('region', { name: 'Respondidas · prontas para classificar' });
    await expect(answered.getByText('Compra do veículo da empresa, nota 1234 da Auto Sul')).toBeVisible();
    await expect(answered.getByText('Nova resposta')).toBeVisible();
    await answered.getByRole('button', { name: 'Classificar e concluir' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByPlaceholder('Buscar por código ou nome').fill('1.2.3.04');
    await sheet.getByRole('option', { name: /Veículos/ }).click();
    await sheet.locator('#learn-rule').setChecked(false, { force: true });
    await sheet.getByRole('button', { name: 'Conciliar' }).click();
    await expect(page.getByText('Classificado e pendência concluída')).toBeVisible();
    await expect(page.getByText('Nenhuma pendência em aberto')).toBeVisible();
  });

  await test.step('Auditoria: a trilha, os filtros com contagem e o intervalo de datas', async () => {
    await page.goto('/auditoria');
    await expect(page.getByRole('heading', { name: 'Auditoria' })).toBeVisible();
    await expect(page.getByText(/registro\(s\) carregado\(s\)/)).toBeVisible();
    await expect(page.getByText(/Não há registros mais antigos neste intervalo/)).toBeVisible();
    // A pergunta, a conclusão dela e a classificação ficam em "Classificações".
    const manual = page.getByRole('radio', { name: /^Classificações \(\d+\)$/ });
    await expect(manual).toBeVisible();
    await manual.click();
    await expect(page.getByText('PAGAMENTO CONCESSIONARIA AUTO SUL VEICULO').first()).toBeVisible();

    // Intervalo que termina antes de hoje: nada. Limpar as datas traz a trilha de volta.
    await page.getByLabel('Data final').fill('2020-01-01');
    await expect(page.getByText('Nenhum registro encontrado.')).toBeVisible();
    await page.getByRole('button', { name: 'Limpar datas' }).click();
    await expect(page.getByText('PAGAMENTO CONCESSIONARIA AUTO SUL VEICULO').first()).toBeVisible();
  });

  expect(pageErrors).toEqual([]);
});
