import { describe, expect, it } from 'vitest';
import type { BankAccount } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import {
  defaultOpeningDate,
  describePlug,
  implantationDate,
  implantationProblem,
  missingOpeningAccounts,
  openingAccounts,
  openingModeOf,
  openingStatus,
  parseMoneyInput,
  parseSignedMoneyInput,
  summarizeOpening,
} from '@/lib/opening';

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

  it('lançamento manual a partir do próprio dia da implantação (posição no início do dia)', () => {
    expect(implantationProblem('2025-01-01', '2025-01-01')).toBeNull();
    expect(implantationProblem('2024-12-31', '2025-01-01')).toMatch(/01\/01\/2025/);
    expect(implantationProblem('2024-06-01', '2025-01-01')).not.toBeNull();
    expect(implantationProblem('2025-01-02', '2025-01-01')).toBeNull();
    expect(implantationProblem('2020-01-01', null)).toBeNull();
  });
});

describe('balanço de abertura (sem contabilidade anterior)', () => {
  const opening = (entries: { accountId: string; amount: number }[]) =>
    ({ id: 'c', clientId: 'c', date: '2025-01-01', mode: 'OPENING_BALANCE' as const, entries, updatedAt: '' });
  const bankAt = (balance: number): BankAccount => ({
    id: 'a', clientId: 'c', accountKey: 'a', nickname: 'a', ledgerAccountId: id('1.1.1.02'), openingBalance: balance, openingDate: '2025-01-01', createdAt: '', updatedAt: '',
  });

  it('a diferença vai para a 2.3.3.04 e a abertura fica conferida', () => {
    // Banco 1.500 + imobilizado 4.000 − depreciação 1.000 = 4.500; DAS 200 + capital 1.000 = 1.200 → 3.300 credora.
    const s = openingStatus(
      opening([{ accountId: id('1.2.3.03'), amount: 4000 }, { accountId: id('1.2.3.07'), amount: 1000 }, { accountId: id('2.1.5.01'), amount: 200 }, { accountId: id('2.3.1.01'), amount: 1000 }]),
      chart,
      [bankAt(1500)]
    );
    expect(s).toMatchObject({ mode: 'OPENING_BALANCE', verified: true, problems: [], pending: 0, plug: { amount: 3300, nature: 'C' } });
    expect(describePlug(s.plug!)).toMatch(/2\.3\.3\.04 Balanço de Abertura: R\$\s3\.300,00 \(Credor\)/);
    // Passivo maior que o ativo: contrapartida devedora.
    expect(openingStatus(opening([{ accountId: id('2.2.2.02'), amount: 5000 }]), chart, [bankAt(1000)]).plug).toEqual({ amount: 4000, nature: 'D' });
  });

  it('sem a 2.3.3.04 no plano, a diferença segue a detalhar', () => {
    const withoutPlug = chart.filter((a) => a.code !== '2.3.3.04');
    const s = openingStatus(opening([{ accountId: id('2.3.1.01'), amount: 1000 }]), withoutPlug, [bankAt(400)]);
    expect(s.verified).toBe(false);
    expect(s.pending).toBe(-600);
    expect(s.problems.join(' ')).toMatch(/2\.3\.3\.04.*não está no plano/);
    expect(missingOpeningAccounts('c', withoutPlug).map((a) => a.code)).toEqual(['2.3.3.04']);
    expect(missingOpeningAccounts('c', chart)).toEqual([]);
  });

  it('documento sem o tipo de implantação continua como transferência com balanço anterior', () => {
    expect(openingModeOf({})).toBe('CONTINUITY');
    expect(openingModeOf(null)).toBe('CONTINUITY');
  });

  it('a 2.3.3.04 não recebe digitação; retificadoras aparecem, inclusive pelo nome', () => {
    const codes = new Set(openingAccounts(chart, []).map((a) => a.code));
    expect(codes.has('2.3.3.04')).toBe(false);
    expect(codes.has('1.2.3.07')).toBe(true);
    expect(codes.has('2.3.1.02')).toBe(true);
    const handmade = { ...chart.find((a) => a.code === '1.2.3.07')!, isContra: undefined, name: 'Depreciação Acumulada de Veículos' };
    const s = summarizeOpening([{ accountId: id('1.2.3.04'), amount: 50000 }, { accountId: handmade.id, amount: 10000 }], chart.map((a) => (a.id === handmade.id ? handmade : a)), []);
    expect(s.assets).toBe(40000);
  });

  it('data padrão: o saldo bancário mais antigo ou 1º de janeiro do primeiro extrato, nunca o ano corrente com movimento anterior', () => {
    const today = new Date('2026-10-14T12:00:00Z');
    expect(defaultOpeningDate([{ openingDate: '2025-03-01' }, { openingDate: '2025-01-01' }], '2025-01-02', today)).toBe('2025-01-01');
    expect(defaultOpeningDate([{ openingDate: '2026-02-01' }], '2025-01-15', today)).toBe('2025-01-01');
    expect(defaultOpeningDate([], '2025-04-10', today)).toBe('2025-01-01');
    expect(defaultOpeningDate([], null, today)).toBe('2026-01-01');
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

  it('saldo de banco aceita negativo', () => {
    expect(parseSignedMoneyInput('-1.234,56')).toBe(-1234.56);
    expect(parseSignedMoneyInput('250')).toBe(250);
    expect(parseSignedMoneyInput('-')).toBeNull();
    expect(parseSignedMoneyInput('')).toBe(0);
  });
});
