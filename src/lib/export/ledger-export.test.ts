import { describe, expect, it } from 'vitest';
import { generateLedgerPdf } from '@/lib/export/ledger-pdf';
import { generateLedgerExcel } from '@/lib/export/ledger-excel';
import type { BalanceSheet, TrialBalance } from '@/lib/ledger';

const mockClient = {
  name: 'Empresa Teste Contabilidade Ltda',
  cnpj: '12.345.678/0001-90',
  tradeName: 'Empresa Teste',
};

const mockRange = {
  start: '2025-01-01',
  end: '2025-03-31',
};

const mockBalanceSheet: BalanceSheet = {
  date: '2025-03-31',
  assets: [
    { accountId: '1', code: '1.1', name: 'Ativo Circulante', level: 2, synthetic: true, value: 50000 },
    { accountId: '2', code: '1.1.01.001', name: 'Caixa e Equivalentes', level: 4, synthetic: false, value: 50000 },
  ],
  liabilities: [
    { accountId: '3', code: '2.1', name: 'Passivo Circulante', level: 2, synthetic: true, value: 10000 },
    { accountId: '4', code: '2.1.01.001', name: 'Fornecedores a Pagar', level: 4, synthetic: false, value: 10000 },
  ],
  equity: [
    { accountId: '5', code: '2.3', name: 'Patrimônio Líquido', level: 2, synthetic: true, value: 40000 },
    { accountId: '6', code: '2.3.01.001', name: 'Capital Social Realizado', level: 4, synthetic: false, value: 40000 },
  ],
  totalAssets: 50000,
  totalLiabilities: 10000,
  totalEquity: 40000,
  difference: 0,
  suspense: 0,
  unlinkedBanks: 0,
};

const mockTrialBalance: TrialBalance = {
  rows: [
    { accountId: '1', code: '1.1', name: 'Ativo Circulante', level: 2, synthetic: true, kind: 'ASSET', previous: 30000, debits: 25000, credits: 5000, final: 50000 },
    { accountId: '2', code: '1.1.01.001', name: 'Caixa e Equivalentes', level: 4, synthetic: false, kind: 'ASSET', previous: 30000, debits: 25000, credits: 5000, final: 50000 },
    { accountId: '3', code: '2.1', name: 'Passivo Circulante', level: 2, synthetic: true, kind: 'LIABILITY', previous: -10000, debits: 5000, credits: 5000, final: -10000 },
  ],
  totals: { previous: 20000, debits: 30000, credits: 10000, final: 40000 },
  balanced: true,
};

const mockSignatories = {
  legalRepresentative: { name: 'Carlos Administrador', cpf: '123.456.789-00' },
  accountant: { name: 'Ana Contadora', crc: 'CRC/SP 123456' },
};

describe('generateLedgerPdf', () => {
  it('gera PDF oficial do Balanço Patrimonial em formato A4 Retrato', () => {
    const res = generateLedgerPdf({
      client: mockClient,
      range: mockRange,
      balanceSheet: mockBalanceSheet,
      trialBalance: mockTrialBalance,
      documentType: 'bs',
      signatories: mockSignatories,
    });

    expect(res.blob).toBeInstanceOf(Blob);
    expect(res.blob.size).toBeGreaterThan(1000);
    expect(res.fileName).toContain('Balanco_Patrimonial');
    expect(res.fileName).toContain('2025-03-31');
    expect(res.fileName.endsWith('.pdf')).toBe(true);
  });

  it('gera PDF oficial do Balancete de Verificação em formato A4 Retrato', () => {
    const res = generateLedgerPdf({
      client: mockClient,
      range: mockRange,
      balanceSheet: mockBalanceSheet,
      trialBalance: mockTrialBalance,
      documentType: 'tb',
      showSynthetic: true,
      signatories: mockSignatories,
    });

    expect(res.blob).toBeInstanceOf(Blob);
    expect(res.blob.size).toBeGreaterThan(1000);
    expect(res.fileName).toContain('Balancete');
    expect(res.fileName).toContain('2025-01-01_a_2025-03-31');
    expect(res.fileName.endsWith('.pdf')).toBe(true);
  });
});

describe('generateLedgerExcel', () => {
  it('gera arquivo Excel (.xlsx) contendo abas estilizadas de Balanço e Balancete', async () => {
    const res = await generateLedgerExcel({
      client: mockClient,
      range: mockRange,
      balanceSheet: mockBalanceSheet,
      trialBalance: mockTrialBalance,
      signatories: mockSignatories,
    });

    expect(res.blob).toBeInstanceOf(Blob);
    expect(res.blob.size).toBeGreaterThan(1000);
    expect(res.fileName).toContain('Balanco_Balancete');
    expect(res.fileName.endsWith('.xlsx')).toBe(true);
  });
});
