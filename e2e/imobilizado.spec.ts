import { expect, test } from '@playwright/test';
import { mockReceita } from './receita';

/**
 * Imobilizado: o veículo do exemplo da NBC TG 1002 (R$ 72.280,00 a 20% ao ano) comprado em
 * 01/03/2025. O cadastro calcula a cota de R$ 1.204,67, o fechamento de março exige a
 * depreciação lançada, e o Diário e o Balanço mostram o lançamento e o valor líquido.
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

test('imobilizado: cadastro do bem, depreciação no fechamento e balanço', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await mockReceita(page);

  await test.step('login, empresa e plano de contas', async () => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Usar credenciais de teste local' }).click();
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL('**/painel');
    await expect(page.getByText('Modo local')).toBeVisible();

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
  });

  await test.step('compra do veículo no extrato', async () => {
    await page.goto('/');
    await page.locator('input[type="file"]').setInputFiles({ name: 'extrato-veiculo.ofx', mimeType: 'application/x-ofx', buffer: Buffer.from(OFX, 'latin1') });
    await page.getByRole('row', { name: /PAGAMENTO CONCESSIONARIA/ }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByPlaceholder('Buscar por código ou nome').fill('1.2.3.04');
    await sheet.getByRole('option', { name: /Veículos/ }).click();
    await sheet.locator('#learn-rule').setChecked(false, { force: true });
    await sheet.getByRole('button', { name: 'Conciliar' }).click();
    await expect(sheet).toBeHidden();
  });

  await test.step('cadastro do bem', async () => {
    await page.goto('/imobilizado');
    await page.getByRole('button', { name: 'Cadastrar o primeiro bem' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Descrição').fill('Veículo de passeio');
    await sheet.getByLabel('Conta do bem').selectOption({ label: '1.2.3.04 · Veículos' });
    await sheet.getByLabel('Uso do bem').selectOption({ label: 'Administrativo ou comercial (despesa)' });
    await sheet.getByLabel('Data da nota fiscal').fill('2025-03-01');
    await sheet.getByLabel('Valor da nota').fill('72.280,00');
    // Taxa sugerida para veículos pela IN RFB 1700/2017.
    await expect(sheet.getByLabel('Taxa anual de depreciação (%)')).toHaveValue('20');
    await expect(sheet.getByText(/Cota mensal: R\$\s1\.204,67 · vida útil de 60 meses/)).toBeVisible();
    await sheet.getByRole('button', { name: 'Cadastrar' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText('Bem cadastrado')).toBeVisible();

    await page.getByLabel('Posição no fim de').fill('2025-03');
    const row = page.getByRole('row', { name: /Veículo de passeio/ });
    await expect(row).toContainText('1.204,67');
    await expect(row).toContainText('71.075,33');
  });

  await test.step('seguro do veículo (despesa antecipada)', async () => {
    await page.getByRole('link', { name: 'Seguros e despesas antecipadas' }).click();
    await page.getByRole('button', { name: 'Cadastrar a primeira apólice' }).click();
    const sheet = page.getByRole('dialog');
    // O bem segurado traz o uso e sugere a descrição.
    await sheet.getByLabel('Bem segurado').selectOption({ label: 'Veículo de passeio' });
    await expect(sheet.getByLabel('Descrição')).toHaveValue('Seguro - Veículo de passeio');
    await sheet.getByLabel('Apólice nº').fill('0531.12345');
    await sheet.getByLabel('Prêmio líquido total').fill('1.410,88');
    await sheet.getByLabel(/Data da apólice/).fill('2025-03-01');
    await expect(sheet.getByText(/apropriação de R\$\s117,57 por mês/)).toBeVisible();
    await sheet.getByRole('button', { name: 'Cadastrar' }).click();
    await expect(sheet).toBeHidden();
    await page.getByLabel('Posição no fim de').fill('2025-03');
    const row = page.getByRole('row', { name: /Seguro - Veículo de passeio/ });
    await expect(row).toContainText('117,57');
    await expect(row).toContainText('1.293,31');
  });

  await test.step('empréstimo com tabela Price', async () => {
    await page.getByRole('link', { name: 'Empréstimos e financiamentos' }).click();
    await page.getByRole('button', { name: 'Cadastrar o primeiro contrato' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('combobox', { name: /^Tipo/ }).selectOption({ label: 'Empréstimo' });
    await sheet.getByLabel('Descrição', { exact: true }).fill('Capital de giro');
    await sheet.getByLabel('Banco ou financiadora').fill('Financiadora Beta S.A.');
    await sheet.getByLabel('Data do contrato', { exact: true }).fill('2025-03-01');
    await sheet.getByLabel('Valor do crédito').fill('72.280,00');
    await sheet.getByLabel(/Encargos da contratação financiados/).fill('3.899,94');
    await sheet.getByLabel('Parcelas', { exact: true }).fill('36');
    await sheet.getByLabel('Valor da parcela', { exact: true }).fill('2.574,15');
    await sheet.getByLabel('1º vencimento').fill('2025-04-07');
    await sheet.getByLabel('Taxa de juros ao mês (%)').fill('1,10');
    // 21 parcelas vencem até 31/12/2026 (curto prazo) e 15 depois.
    await expect(sheet.getByText(/21 parcela\(s\) no curto prazo \(até 31\/12\/2026\) e 15 no longo/)).toBeVisible();
    await expect(sheet.getByText(/Juros da 1ª parcela: R\$\s837,98/)).toBeVisible();
    await sheet.getByRole('button', { name: 'Cadastrar' }).click();
    await expect(sheet).toBeHidden();
    await page.getByRole('button', { name: 'Ver parcelas de Capital de giro' }).click();
    const schedule = page.getByRole('table', { name: 'Parcelas de Capital de giro' });
    await expect(schedule.getByRole('row', { name: /1\/36.*07\/04\/2025.*2\.574,15.*837,98.*1\.736,17.*74\.443,77/ })).toBeVisible();
  });

  await test.step('fechamento exige depreciação e apropriação do mês', async () => {
    await page.goto('/');
    await expect(page.getByText(/Lance a depreciação de 03\/2025 \(R\$\s1\.204,67\)/)).toBeVisible();
    await expect(page.getByText(/Lance a apropriação de seguros e despesas antecipadas de 03\/2025 \(R\$\s117,57\)/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fechar competência' })).toBeDisabled();
    await page.getByRole('button', { name: 'Lançar rotinas do mês' }).click();
    await expect(page.getByText('Depreciação e apropriação do mês lançadas')).toBeVisible();
    await page.getByRole('button', { name: 'Fechar competência' }).click();
    await page.getByRole('button', { name: 'Clique para confirmar o fechamento' }).click();
    await expect(page.getByText('Competência fechada', { exact: true })).toBeVisible();
  });

  await test.step('Livro Diário e Balanço', async () => {
    await page.goto('/diario');
    await expect(page.getByText('Vlr. ref. cota de depreciação de veículos referente ao mês de março/2025').first()).toBeVisible();
    await expect(page.getByText(/Apropriação 1 de 12 - Seguro - Veículo de passeio/).first()).toBeVisible();
    await expect(page.getByText(/Empréstimo Financiadora Beta S\.A\. - Capital de giro: 36 parcela\(s\)/).first()).toBeVisible();

    await page.goto('/balanco');
    await expect(page.getByRole('heading', { name: 'Balanço patrimonial' })).toBeVisible();
    // Imobilizado: 72.280,00 − 1.204,67.
    await expect(page.getByText(/71\.075,33/).first()).toBeVisible();
  });

  await test.step('cadastro travado e lançamento gerado protegido', async () => {
    await page.goto('/imobilizado');
    await page.getByRole('button', { name: 'Editar Veículo de passeio' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText(/já foi lançada em competência fechada/)).toBeVisible();
    await expect(sheet.getByLabel('Valor da nota')).toBeDisabled();
    await sheet.getByRole('button', { name: 'Fechar' }).first().click();
  });

  expect(pageErrors).toEqual([]);
});
