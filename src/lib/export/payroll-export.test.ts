import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { generatePayrollExcel, generatePayrollPdf, PAYROLL_EXPORT_TITLE } from '@/lib/export/payroll-export';
import { buildPayrollJournalDraft, buildPayrollSummary, matchBankTransactionsWithPayroll } from '@/lib/payroll';
import { buildITG1000Chart } from '@/lib/chart/itg1000';

describe('payroll-export — PDF e Excel do espelho da folha', () => {
  const accounts = buildITG1000Chart('c1', '2025-01-01T00:00:00Z');
  const input = {
    month: '2025-10',
    grossSalaries: 10000,
    inssEmployees: 950,
    irrfEmployees: 300,
    grossProLabore: 4000,
    inssProLabore: 440,
    fgts: 800,
    inssEmployer: 1800,
    vacationProvision: 1111.11,
    thirteenthProvision: 833.33,
  };
  const draft = buildPayrollJournalDraft(input, accounts);
  const summary = buildPayrollSummary('c1', input, ['je_1'], '2025-10-31T00:00:00Z');
  const obligations = matchBankTransactionsWithPayroll(summary, [], accounts);
  const client = {
    name: 'Clínica Exemplo Ltda.',
    tradeName: 'Clínica Exemplo',
    cnpj: '12.345.678/0001-90',
    porte: 'MICROENTIDADE' as const,
    activity: 'SERVICOS' as const,
  };

  it('gera arquivo PDF com nome padronizado e conteúdo válido', () => {
    const { blob, fileName } = generatePayrollPdf({
      client,
      summary,
      journalLines: draft.lines,
      obligations,
      issuedAt: new Date('2025-11-10T12:00:00Z'),
    });

    expect(fileName).toBe('Espelho_Folha_Clinica_Exemplo_2025-10.pdf');
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('gera planilha Excel com resumo, lançamento contábil e conciliação bancária', async () => {
    const { blob, fileName } = await generatePayrollExcel({
      client,
      summary,
      journalLines: draft.lines,
      obligations,
      issuedAt: new Date('2025-11-10T12:00:00Z'),
    });

    expect(fileName).toBe('Espelho_Folha_Clinica_Exemplo_2025-10.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const ws = wb.getWorksheet('Folha de Pagamento');
    expect(ws).toBeDefined();

    const texts: string[] = [];
    ws!.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === 'string') texts.push(cell.value);
      });
    });

    expect(texts.some((t) => t.includes(PAYROLL_EXPORT_TITLE))).toBe(true);
    expect(texts.some((t) => t.includes('Salários e Ordenados Brutos (CLT)'))).toBe(true);
    expect(texts.some((t) => t.includes('3. Obrigação no Passivo'))).toBe(true);
  });
});
