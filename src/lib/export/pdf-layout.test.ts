import { describe, expect, it } from 'vitest';
import { generateDREPdf } from '@/lib/export/dre-pdf';
import { generateLedgerPdf } from '@/lib/export/ledger-pdf';
import { generateDLPAPdf } from '@/lib/export/dlpa-export';
import { formatAccounting, formatPercent } from '@/lib/export/dre-rows';
import { buildDRE } from '@/lib/dre/build';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import type { BalanceSheet, BalanceSheetLine } from '@/lib/ledger';
import type { BankTransaction } from '@/types/firestore';

/** Conteúdo do PDF (sem compressão no jsPDF) com os textos em WinAnsi legíveis. */
const pdfText = async (blob: Blob) => Buffer.from(await blob.arrayBuffer()).toString('latin1');
/** Textos desenhados, na ordem do arquivo. */
const drawn = (pdf: string) => [...pdf.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));

const client = { name: 'Empresa Teste Ltda', cnpj: '11222333000181', tradeName: 'Teste', porte: 'MICROENTIDADE' as const };
const signatories = { legalRepresentative: { name: 'Carlos Administrador', cpf: '123.456.789-00' }, accountant: { name: 'Ana Contadora', crc: 'SP-123456/O-5' } };

describe('formatação de valores da DRE', () => {
  it('redutores entre parênteses e percentuais sem "-0,0%" nem espaço antes do símbolo', () => {
    expect(formatAccounting(-14358.85)).toBe('(14.358,85)');
    expect(formatAccounting(-0)).toBe('0,00');
    expect(formatAccounting(-0.001)).toBe('0,00');
    expect(formatPercent(-0)).toBe('0,0%');
    expect(formatPercent(-0.04)).toBe('0,0%');
    expect(formatPercent(-35.24)).toBe('-35,2%');
    expect(formatPercent(null)).toBe('-');
  });
});

describe('PDF da DRE', () => {
  const accounts = buildITG1000Chart('c1', '2025-01-01T00:00:00.000Z');
  const tx = (code: string, amount: number, n: number): BankTransaction => ({
    id: `t${n}`, clientId: 'c1', fitid: `f${n}`, date: '2025-03-10', amount, type: amount < 0 ? 'DEBIT' : 'CREDIT', memo: 'x', status: 'RECONCILED', createdAt: '', accountId: `c1_itg22_${code}`,
  });
  const range = { start: '2025-01-01', end: '2025-12-31' };
  const statement = buildDRE([tx('3.1.1.01', 40_000, 1), tx('3.2.1.03', -14_358.85, 2)], accounts, range);

  it('custos entre parênteses, despesas zeradas em 0,0% e cabeçalho e assinaturas padronizados', async () => {
    const pdf = await pdfText(generateDREPdf({ client, range, statement, signatories, issuedAt: new Date('2026-03-01T12:00:00Z') }).blob);
    const texts = drawn(pdf);
    expect(texts).toContain('(14.358,85)');
    expect(texts.some((t) => /\d\)?\(\)/.test(t))).toBe(false);
    expect(texts).toContain('0,0%');
    expect(texts.some((t) => t.includes('-0,0'))).toBe(false);
    expect(texts.slice(0, 4)).toEqual(['EMPRESA TESTE LTDA', 'CNPJ: 11.222.333/0001-81', 'DEMONSTRAÇÃO DO RESULTADO DO EXERCÍCIO', 'NBC TG 1002 - Microentidades']);
    expect(texts).toEqual(expect.arrayContaining(['Ana Contadora', 'Profissional da Contabilidade', 'CRC: SP-123456/O-5']));
  });
});

describe('PDF do Balanço Patrimonial', () => {
  const line = (code: string, name: string, level: number, value: number, synthetic = level < 4): BalanceSheetLine => ({ accountId: code || name, code, name, level, synthetic, value });
  const bs: BalanceSheet = {
    date: '2025-12-31',
    assets: [line('1', 'ATIVO', 1, 1712.82), line('1.1', 'ATIVO CIRCULANTE', 2, 1712.82), line('1.1.1.05', 'Nubank', 4, 1712.82)],
    liabilities: [line('2', 'PASSIVO E PATRIMÔNIO LÍQUIDO', 1, 100), line('2.1', 'PASSIVO CIRCULANTE', 2, 100), line('2.1.5.01', 'Simples Nacional a Recolher', 4, 100)],
    equity: [
      line('2', 'PASSIVO E PATRIMÔNIO LÍQUIDO', 1, 1000),
      line('2.3', 'PATRIMÔNIO LÍQUIDO', 2, 1000),
      line('2.3.1.01', 'Capital Social', 4, 1000),
      line('', 'Resultado do exercício', 4, 612.82, false),
    ],
    totalAssets: 1712.82,
    totalLiabilities: 100,
    totalEquity: 1612.82,
    difference: 0,
    suspense: 0,
    unlinkedBanks: 0,
  };
  const trialBalance = { rows: [], totals: { previous: 0, debits: 0, credits: 0, final: 0 }, balanced: true };

  it('cabeçalho no topo da página 1 e cada grupo uma vez só', async () => {
    const pdf = await pdfText(generateLedgerPdf({ client, range: { start: '2025-01-01', end: '2025-12-31' }, balanceSheet: bs, trialBalance, documentType: 'bs', signatories }).blob);
    const texts = drawn(pdf);
    expect(texts.slice(0, 5)).toEqual(['EMPRESA TESTE LTDA', 'CNPJ: 11.222.333/0001-81', 'BALANÇO PATRIMONIAL', 'NBC TG 1002 - Microentidades', 'Posição em 31/12/2025']);
    // Primeiro texto desenhado a 18 mm do topo (A4 = 841,89 pt de altura).
    const firstY = Number(/([\d.]+) Td\s*\(EMPRESA TESTE LTDA\) Tj/.exec(pdf)?.[1]);
    expect(841.89 - firstY).toBeLessThan(18 * 2.835 + 1);

    const count = (t: string) => texts.filter((x) => x === t).length;
    expect(count('ATIVO')).toBe(1);
    expect(count('PASSIVO')).toBe(1);
    expect(count('PASSIVO E PATRIMÔNIO LÍQUIDO')).toBe(0);
    expect(count('PATRIMÔNIO LÍQUIDO')).toBe(1);
    expect(count('2.3')).toBe(1);
    expect(count('2')).toBe(0);
    expect(texts).toEqual(expect.arrayContaining(['ATIVO CIRCULANTE', 'PASSIVO CIRCULANTE', 'Capital Social', 'Resultado do exercício', 'TOTAL DO PASSIVO E DO PATRIMÔNIO LÍQUIDO']));
  });

  it('balancete mostra saldo zero em vez de deixar a célula em branco', async () => {
    const tb = {
      rows: [{ accountId: 'n', code: '1.1.1.05', name: 'Nubank', level: 4, synthetic: false, kind: 'ASSET' as const, previous: 0, debits: 500, credits: 500, final: 0 }],
      totals: { previous: 0, debits: 500, credits: 500, final: 0 },
      balanced: true,
    };
    const pdf = await pdfText(generateLedgerPdf({ client, range: { start: '2025-01-01', end: '2025-12-31' }, balanceSheet: bs, trialBalance: tb, documentType: 'tb' }).blob);
    const texts = drawn(pdf);
    const row = texts.slice(texts.indexOf('1.1.1.05'), texts.indexOf('1.1.1.05') + 6);
    expect(row).toEqual(['1.1.1.05', 'Nubank', 'R$ 0,00', '500,00', '500,00', 'R$ 0,00']);
  });
});

describe('PDF da DLPA', () => {
  it('usa o mesmo cabeçalho das demais demonstrações', async () => {
    const dlpa = { year: '2025', start: '2025-01-01', end: '2025-12-31', opening: 0, openingBalance: 0, adjustments: 0, netResult: 100, distributions: 0, closing: 100, rows: [{ kind: 'balance' as const, label: 'Saldo em 31/12/2025', value: 100 }] };
    const texts = drawn(await pdfText(generateDLPAPdf({ client, dlpa, signatories }).blob));
    expect(texts.slice(0, 4)).toEqual(['EMPRESA TESTE LTDA', 'CNPJ: 11.222.333/0001-81', 'DEMONSTRAÇÃO DE LUCROS OU PREJUÍZOS ACUMULADOS', 'NBC TG 1002 - Microentidades']);
  });
});
