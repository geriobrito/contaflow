import { describe, expect, it } from 'vitest';
import type { BankAccount } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { implantationDate, implantationProblem, openingAccounts, openingStatus, parseMoneyInput, summarizeOpening } from '@/lib/opening';

const chart = buildITG1000Chart('c');
const id = (code: string) => `c_itg22_${code}`;
const bank = (ledger: string | null, opening?: number): BankAccount => ({
  id: 'b', clientId: 'c', accountKey: 'k', nickname: 'k', ...(ledger ? { ledgerAccountId: id(ledger) } : {}), ...(opening !== undefined ? { openingBalance: opening, openingDate: '2024-12-31' } : {}), createdAt: '', updatedAt: '',
});

describe('openingAccounts', () => {
  it('só analíticas patrimoniais, sem resultado e sem a conta de banco vinculada', () => {
    const list = openingAccounts(chart, [bank('1.1.1.02')]);
    const codes = new Set(list.map((a) => a.code));
    expect(codes.has('1.1.2.01')).toBe(true); // clientes
    expect(codes.has('2.3.1.01')).toBe(true); // capital
    expect(codes.has('1.1.1.02')).toBe(false); // banco vinculado
    expect(codes.has('3.1.1.01')).toBe(false); // receita
    expect(codes.has('1.1')).toBe(false); // sintética
    expect(openingAccounts(chart, []).some((a) => a.code === '1.1.1.02')).toBe(true);
  });
});

describe('summarizeOpening', () => {
  it('fecha quando ativo (com bancos) = passivo + PL; retificadora reduz o grupo', () => {
    const s = summarizeOpening(
      [
        { accountId: id('1.1.2.01'), amount: 500 },
        { accountId: id('1.2.3.03'), amount: 4000 },
        { accountId: id('1.2.3.07'), amount: 1000 },
        { accountId: id('2.1.2.01'), amount: 800 },
        { accountId: id('2.3.1.01'), amount: 3700 },
      ],
      chart,
      [bank('1.1.1.02', 1000)]
    );
    expect(s).toMatchObject({ assets: 3500, banks: 1000, liabilities: 800, equity: 3700, difference: 0, balanced: true });
  });

  it('mostra a diferença a detalhar', () => {
    const s = summarizeOpening([{ accountId: id('2.3.1.01'), amount: 1000 }], chart, [bank('1.1.1.02', 400)]);
    expect(s.difference).toBe(-600);
    expect(s.balanced).toBe(false);
  });
});

describe('data de implantação e conferência', () => {
  const openings = (date: string, entries = [{ accountId: id('2.3.1.01'), amount: 1000 }]) => ({ id: 'c', clientId: 'c', date, entries, updatedAt: '' });
  const bankAt = (key: string, date: string, balance: number): BankAccount => ({
    id: key, clientId: 'c', accountKey: key, nickname: key, ledgerAccountId: id('1.1.1.02'), openingBalance: balance, openingDate: date, createdAt: '', updatedAt: '',
  });

  it('implantação: a data dos saldos de abertura ou, sem eles, o saldo bancário mais antigo', () => {
    expect(implantationDate(openings('2024-12-31'), [bankAt('a', '2025-01-31', 1)])).toBe('2024-12-31');
    expect(implantationDate(null, [bankAt('a', '2025-01-31', 1), bankAt('b', '2024-12-31', 1)])).toBe('2024-12-31');
    expect(implantationDate(null, [])).toBeNull();
  });

  it('conferida: abertura fecha e bancos na mesma data', () => {
    const s = openingStatus(openings('2024-12-31'), chart, [bankAt('a', '2024-12-31', 1000)]);
    expect(s).toMatchObject({ date: '2024-12-31', verified: true, problems: [] });
  });

  it('banco com saldo inicial em outra data é divergência; banco aberto depois com saldo zero não', () => {
    const s = openingStatus(openings('2024-12-31'), chart, [bankAt('a', '2024-12-31', 1000), bankAt('b', '2025-03-31', 250), bankAt('c', '2025-05-31', 0)]);
    expect(s.mismatchedBanks.map((b) => b.accountKey)).toEqual(['b']);
    expect(s.verified).toBe(false);
    expect(s.problems.join(' ')).toMatch(/b em 31\/03\/2025/);
    // Saldo inicial antes da implantação é sempre divergência.
    expect(openingStatus(openings('2024-12-31'), chart, [bankAt('d', '2024-06-30', 0)]).mismatchedBanks).toHaveLength(1);
  });

  it('sem saldos de abertura ou com diferença, não conferida', () => {
    expect(openingStatus(null, chart, []).problems.join(' ')).toMatch(/não informados/);
    const gap = openingStatus(openings('2024-12-31'), chart, [bankAt('a', '2024-12-31', 400)]);
    expect(gap.summary.balanced).toBe(false);
    expect(gap.problems.join(' ')).toMatch(/Faltam R\$\s600,00/);
  });

  it('lançamento manual só depois da implantação', () => {
    expect(implantationProblem('2024-12-31', '2024-12-31')).toMatch(/31\/12\/2024/);
    expect(implantationProblem('2024-06-01', '2024-12-31')).not.toBeNull();
    expect(implantationProblem('2025-01-01', '2024-12-31')).toBeNull();
    expect(implantationProblem('2020-01-01', null)).toBeNull();
  });
});

describe('parseMoneyInput', () => {
  it('formatos digitados', () => {
    expect(parseMoneyInput('1.234,56')).toBe(1234.56);
    expect(parseMoneyInput('1234,5')).toBe(1234.5);
    expect(parseMoneyInput('1234.56')).toBe(1234.56);
    expect(parseMoneyInput('1.234')).toBe(1234);
    expect(parseMoneyInput('')).toBe(0);
    expect(parseMoneyInput('abc')).toBeNull();
    expect(parseMoneyInput('-5')).toBeNull();
  });
});
