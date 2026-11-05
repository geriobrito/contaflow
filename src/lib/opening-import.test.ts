import { describe, expect, it } from 'vitest';
import type { BankAccount } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { buildImport, matchTrialBalance, parseTrialBalanceText } from '@/lib/opening-import';

const chart = buildITG1000Chart('c');
const id = (code: string) => `c_itg22_${code}`;
const bank: BankAccount = { id: 'itau', clientId: 'c', accountKey: 'k', nickname: 'Itaú', ledgerAccountId: id('1.1.1.02'), createdAt: '', updatedAt: '' };
const pick = (text: string) => parseTrialBalanceText(text).map((l) => ({ code: l.code, name: l.name, amount: l.amount, side: l.side, negative: l.negative }));

describe('parseTrialBalanceText', () => {
  it('Excel com cabeçalho: usa a coluna do saldo atual e o D/C ao lado', () => {
    const text = [
      'Código\tConta\tSaldo anterior\tDébito\tCrédito\tSaldo atual\t',
      '1.1.1.01\tCaixa\t100,00\t50,00\t30,00\t120,00\tD',
      '2.3.1.01\tCapital Subscrito\t0,00\t0,00\t10.000,00\t10.000,00\tC',
    ].join('\n');
    expect(pick(text)).toEqual([
      { code: '1.1.1.01', name: 'Caixa', amount: 120, side: 'D', negative: false },
      { code: '2.3.1.01', name: 'Capital Subscrito', amount: 10000, side: 'C', negative: false },
    ]);
  });

  it('Excel só com débito e crédito: saldo pela diferença', () => {
    const text = ['Conta\tDescrição\tDébito\tCrédito', '1.1.2.01\tClientes\t3200\t', '2.1.2.01\tFornecedores\t\t1.800,50'].join('\n');
    expect(pick(text)).toEqual([
      { code: '1.1.2.01', name: 'Clientes', amount: 3200, side: 'D', negative: false },
      { code: '2.1.2.01', name: 'Fornecedores', amount: 1800.5, side: 'C', negative: false },
    ]);
  });

  it('Excel sem cabeçalho: último valor da linha, inclusive sem centavos', () => {
    expect(pick('1.2.3.04\tVeículos\t6000')).toEqual([{ code: '1.2.3.04', name: 'Veículos', amount: 6000, side: null, negative: false }]);
    expect(pick('Caixa;1.200,00;D')).toEqual([{ code: null, name: 'Caixa', amount: 1200, side: 'D', negative: false }]);
  });

  it('texto de PDF: código, nome com pontilhado e o saldo final com D/C', () => {
    const text = ['BALANCETE DE VERIFICAÇÃO', '1.1.1.01 Caixa ........ 100,00D 50,00 30,00 120,00D', '1.2.3.07 (-) Depreciação Acumulada (1.000,00)', '2.3.1.01   Capital Subscrito   10.000,00 C'].join('\n');
    expect(pick(text)).toEqual([
      { code: null, name: 'BALANCETE DE VERIFICAÇÃO', amount: null, side: null, negative: false },
      { code: '1.1.1.01', name: 'Caixa', amount: 120, side: 'D', negative: false },
      { code: '1.2.3.07', name: '(-) Depreciação Acumulada', amount: 1000, side: null, negative: true },
      { code: '2.3.1.01', name: 'Capital Subscrito', amount: 10000, side: 'C', negative: false },
    ]);
  });

  it('ignora linhas vazias e conta o número da linha original', () => {
    const lines = parseTrialBalanceText('\n\n1.1.1.01\tCaixa\t10,00\n');
    expect(lines.map((l) => l.line)).toEqual([3]);
  });
});

describe('matchTrialBalance', () => {
  const match = (text: string, banks: BankAccount[] = []) => matchTrialBalance(parseTrialBalanceText(text), chart, banks);

  it('por código, por nome igual e por nome parecido', () => {
    const rows = match(['1.1.1.01\tCaixa\t100,00', '9.9.9\tClientes\t50,00', 'Móveis utensilios\t70,00', 'Conta esquisita qualquer\t10,00'].join('\n'));
    expect(rows.map((r) => [r.status, r.accountId])).toEqual([
      ['matched', id('1.1.1.01')],
      ['matched', id('1.1.2.01')],
      ['suggested', id('1.2.3.05')],
      ['unmatched', null],
    ]);
  });

  it('fora: grupos (pela linha seguinte ou pelo plano), totais, resultado, zerados e sem valor', () => {
    const rows = match(
      [
        '1\tATIVO\t1.000,00',
        '1.1\tATIVO CIRCULANTE\t1.000,00',
        '1.1.1.01\tCaixa\t1.000,00',
        '1.1.4\tDespesas Antecipadas\t1.000,00',
        'TOTAL DO ATIVO\t1.000,00',
        '3.1.1.01\tReceita de Prestação de Serviços\t5.000,00',
        '1.1.2.01\tClientes\t0,00',
        '2.1.2.01\tFornecedores Nacionais',
      ].join('\n')
    );
    expect(rows.map((r) => r.status)).toEqual(['ignored', 'ignored', 'matched', 'ignored', 'ignored', 'ignored', 'ignored', 'ignored']);
    expect(rows[3].reason).toMatch(/Grupo do plano/);
    expect(rows[5].reason).toMatch(/resultado/);
  });

  it('a linha da conta do banco casa com a conta contábil do banco', () => {
    const rows = match('1.1.1.02\tBancos Conta Movimento\t8.000,00', [bank]);
    expect(rows[0]).toMatchObject({ status: 'matched', accountId: id('1.1.1.02') });
  });
});

describe('buildImport', () => {
  const run = (text: string, banks: BankAccount[] = []) => buildImport(matchTrialBalance(parseTrialBalanceText(text), chart, banks), chart, banks);

  it('valores no lado natural; retificadora entra positiva; banco com o saldo devedor', () => {
    const r = run(
      ['1.1.1.01\tCaixa\t1.200,00\tD', '1.1.1.02\tBancos\t8.000,00\tD', '1.2.3.07\t(-) Depreciação Acumulada\t1.000,00\tC', '2.3.1.01\tCapital Subscrito\t8.200,00\tC'].join('\n'),
      [bank]
    );
    expect(Object.fromEntries(r.values)).toEqual({ [id('1.1.1.01')]: 1200, [id('1.2.3.07')]: 1000, [id('2.3.1.01')]: 8200 });
    expect(Object.fromEntries(r.bankValues)).toEqual({ itau: 8000 });
    expect(r).toMatchObject({ used: 4, debits: 9200, credits: 9200, inverted: [] });
  });

  it('sem D/C: lado natural; negativo ou entre parênteses, o contrário', () => {
    const r = run(['2.1.2.01\tFornecedores Nacionais\t500,00', '1.2.3.07\t(-) Depreciação Acumulada\t300,00', '1.1.2.01\tClientes\t(50,00)'].join('\n'));
    expect(r.values.get(id('2.1.2.01'))).toBe(500);
    expect(r.values.get(id('1.2.3.07'))).toBe(300);
    // Clientes credor: contrário à natureza, não dá para informar.
    expect(r.inverted).toEqual([{ accountId: id('1.1.2.01'), amount: 50 }]);
    expect(r.credits).toBe(850);
  });

  it('várias linhas na mesma conta somam', () => {
    const rows = matchTrialBalance(parseTrialBalanceText(['A\tBanco A\t100,00\tD', 'B\tBanco B\t50,00\tD'].join('\n')), chart, []).map((row) => ({
      ...row,
      status: 'matched' as const,
      accountId: id('1.1.1.03'),
    }));
    expect(buildImport(rows, chart, []).values.get(id('1.1.1.03'))).toBe(150);
  });
});
