import { describe, expect, it } from 'vitest';
import type { BankTransaction, ChartAccount } from '@/types/firestore';
import { buildDaybook } from '@/lib/daybook';
import { generateDaybookPdf } from '@/lib/export/daybook-pdf';

const account = (id: string, code: string, type: ChartAccount['type']): ChartAccount => ({ id, clientId: 'c1', code, name: `Conta ${id}`, type, nature: 'ANALYTIC', level: 2, createdAt: '', updatedAt: '' });
const accounts = [account('banco', '1.1.1.02', 'ASSET'), account('receita', '3.1.1.01', 'REVENUE'), account('despesa', '4.1.1.01', 'EXPENSE')];
const banks = [{ id: 'b1', clientId: 'c1', accountKey: 'k1', nickname: 'Itaú', ledgerAccountId: 'banco', createdAt: '', updatedAt: '' }];
const tx = (n: number): BankTransaction => ({
  id: `t${String(n).padStart(4, '0')}`,
  clientId: 'c1',
  fitid: `F${n}`,
  date: `2025-${String((n % 12) + 1).padStart(2, '0')}-${String((n % 28) + 1).padStart(2, '0')}`,
  amount: n % 2 ? -(n + 0.5) : n + 10,
  type: n % 2 ? 'DEBIT' : 'CREDIT',
  memo: `Pix FORNECEDOR DE EMBALAGENS E SERVIÇOS LTDA ${n} - Enviado`,
  status: 'RECONCILED',
  accountId: n % 2 ? 'despesa' : 'receita',
  accountKey: 'k1',
  createdAt: '',
});
const client = { name: 'Empresa Teste Contabilidade Ltda', cnpj: '12.345.678/0001-90', tradeName: 'Empresa Teste' };
const range = { start: '2025-01-01', end: '2025-12-31' };
const signatories = { legalRepresentative: { name: 'Carlos Administrador', cpf: '123.456.789-00' }, accountant: { name: 'Ana Contadora', crc: 'SP-123456/O-5' } };

describe('generateDaybookPdf', () => {
  it('gera o livro com termo de abertura, lançamentos paginados e termo de encerramento', () => {
    const daybook = buildDaybook({ transactions: Array.from({ length: 300 }, (_, i) => tx(i + 1)), bankAccounts: banks, accounts, range });
    expect(daybook.entries).toHaveLength(300);
    const res = generateDaybookPdf({ client, daybook, book: { number: '2', city: 'Recife/PE' }, provisional: 'há 3 lançamento(s) a classificar', signatories, issuedAt: new Date('2026-01-15T12:00:00Z') });
    expect(res.blob).toBeInstanceOf(Blob);
    expect(res.blob.size).toBeGreaterThan(5000);
    // Abertura + várias páginas de lançamentos + encerramento.
    expect(res.pages).toBeGreaterThan(4);
    expect(res.fileName).toBe('Livro_Diario_Empresa_Teste_2025-01-01_a_2025-12-31.pdf');
  });

  it('período sem lançamentos ainda sai com os dois termos', () => {
    const res = generateDaybookPdf({ client, daybook: buildDaybook({ transactions: [], bankAccounts: banks, accounts, range }), book: { number: '' } });
    expect(res.pages).toBe(3);
  });
});
