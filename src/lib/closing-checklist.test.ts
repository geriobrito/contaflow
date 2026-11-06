import { describe, expect, it } from 'vitest';
import type { ChartAccount } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { buildTrialBalance, type Posting } from '@/lib/ledger';
import {
  closingChecks,
  depreciationCheck,
  disposalRenames,
  hasStockBalance,
  invertedBalancesCheck,
  manualItems,
  missingCostCheck,
  provisionRenames,
  retainedGroupCheck,
  terminologyChecks,
  withoutProvisionTerm,
} from '@/lib/closing-checklist';

const chart = buildITG1000Chart('c');
const id = (code: string) => chart.find((a) => a.code === code)!.id;
/** Partida e contrapartida (no banco) na data; valor positivo = débito na conta. */
const p = (code: string, value: number, date = '2025-06-10'): Posting[] => [
  { accountId: id(code), date, value },
  { accountId: id('1.1.1.02'), date, value: -value },
];
const tb = (postings: Posting[], accounts: ChartAccount[] = chart) => buildTrialBalance(postings, accounts, { start: '2025-01-01', end: '2025-12-31' });

describe('checklist do fechamento: conferências automáticas', () => {
  it('prestadora com receita e sem custo: aviso para o custo dos serviços prestados', () => {
    const noCost = tb([...p('3.1.1.01', -10000), ...p('3.3.2.01', 3000)]);
    const check = missingCostCheck(noCost, chart)!;
    expect(check.level).toBe('warn');
    expect(check.title).toMatch(/sem custo dos serviços prestados/);
    expect(check.items!.join(' ')).toMatch(/3\.2\.1\.03/);
    expect(missingCostCheck(tb([...p('3.1.1.02', -10000)]), chart)!.title).toMatch(/custo das mercadorias vendidas/);
    expect(missingCostCheck(tb([...p('3.1.1.01', -10000), ...p('3.2.1.03', 2000)]), chart)!.level).toBe('ok');
    expect(missingCostCheck(tb([]), chart)).toBeNull();
  });

  it('saldo virado: caixa credor, obrigação devedora e despesa credora; deduções da receita são devedoras', () => {
    const postings = [...p('1.1.1.01', -500), ...p('2.1.5.01', 1800), ...p('3.3.2.08', -194.1), ...p('3.1.2.01', 300), ...p('3.1.1.01', -1000)];
    const check = invertedBalancesCheck(tb(postings), tb(postings), chart)!;
    expect(check.level).toBe('warn');
    const text = check.items!.join('\n');
    expect(text).toMatch(/1\.1\.1\.01 Caixa: R\$\s500,00 credor/);
    expect(text).toMatch(/2\.1\.5\.01 Simples Nacional a Recolher: R\$\s1\.800,00 devedor/);
    expect(text).toMatch(/3\.3\.2\.08 Telefone e Internet: R\$\s194,10 credor/);
    expect(text).not.toMatch(/3\.1\.2\.01|3\.1\.1\.01/);
  });

  it('terminologia: provisão de férias, lucro no ativo, multa fora do financeiro e contas genéricas', () => {
    const legacy = chart.map((a) => (a.code === '2.1.1.05' ? { ...a, name: 'Provisão de Férias e Encargos' } : a));
    const multa = { ...chart.find((a) => a.code === '3.3.2.17')!, id: 'multa', code: '3.3.2.18', name: 'Multas de trânsito' };
    const antecipacao = { ...chart.find((a) => a.code === '1.1.2.06')!, id: 'ant', code: '1.1.2.99', name: 'Antecipação de Lucros' };
    const accounts = [...legacy, multa, antecipacao];
    const postings: Posting[] = [
      { accountId: 'multa', date: '2025-05-01', value: 120 },
      { accountId: 'ant', date: '2025-05-01', value: 5000 },
      { accountId: id('1.1.1.02'), date: '2025-05-01', value: -5120 },
      ...p('3.3.2.17', 80),
    ];
    const checks = terminologyChecks(tb(postings, accounts), tb(postings, accounts), accounts);
    expect(checks.map((c) => c.id)).toEqual(['provision-term', 'profit-in-asset', 'financial-misplaced', 'generic-accounts']);
    expect(checks[0].items![0]).toBe('2.1.1.05 Provisão de Férias e Encargos → Férias e Encargos a Pagar');
    expect(checks[3].level).toBe('info');
  });

  it('renomeia contas de férias e 13º sem "provisão"', () => {
    expect(withoutProvisionTerm('Provisão de 13º Salário e Encargos')).toBe('13º Salário e Encargos a Pagar');
    expect(withoutProvisionTerm('Provisão para férias')).toBe('Férias a Pagar');
    expect(withoutProvisionTerm('PROVISAO DE FERIAS A PAGAR')).toBe('FERIAS A PAGAR');
    expect(provisionRenames(chart)).toEqual([]);
  });

  it('contas da venda de bens com "ganho" ou "perda": aviso e nome novo (receita e custo)', () => {
    const legacy = chart.map((a) =>
      a.code === '3.3.9.02' ? { ...a, name: 'Ganho na Venda de Imobilizado' } : a.code === '3.3.9.04' ? { ...a, name: 'Perda na Baixa de Imobilizado' } : a
    );
    expect(disposalRenames(legacy).map((r) => [r.account.code, r.name])).toEqual([
      ['3.3.9.02', 'Receita na Venda de Imobilizado e Intangível'],
      ['3.3.9.04', 'Custo do Imobilizado e Intangível Baixado'],
    ]);
    const check = terminologyChecks(tb([]), tb([]), legacy).find((c) => c.id === 'disposal-term')!;
    expect(check.items![0]).toBe('3.3.9.02 Ganho na Venda de Imobilizado → Receita na Venda de Imobilizado e Intangível');
    expect(disposalRenames(chart)).toEqual([]);
  });

  it('grupo de lucros acumulados com saldo além de lucros/prejuízos acumulados, só depois do encerramento', () => {
    const postings = p('2.3.3.04', -300);
    expect(retainedGroupCheck(tb(postings), chart, false)).toBeNull();
    const check = retainedGroupCheck(tb(postings), chart, true)!;
    expect(check.level).toBe('warn');
    expect(check.items![0]).toMatch(/2\.3\.3\.04 Balanço de Abertura: R\$\s300,00 credor/);
    expect(retainedGroupCheck(tb(p('2.3.3.01', -300)), chart, true)!.level).toBe('ok');
  });

  it('imobilizado sem depreciação, depreciação maior que o custo e terreno fora da conta', () => {
    expect(depreciationCheck(tb(p('1.2.3.01', 100000)), tb(p('1.2.3.01', 100000)), chart)).toBeNull();
    const car = p('1.2.3.04', 72280);
    expect(depreciationCheck(tb(car), tb(car), chart)!.title).toMatch(/sem depreciação/);
    const withDep = [...car, ...p('3.3.2.15', 1204.67), { accountId: id('1.2.3.07'), date: '2025-06-10', value: -1204.67 }, { accountId: id('1.1.1.02'), date: '2025-06-10', value: 1204.67 }];
    expect(depreciationCheck(tb(withDep), tb(withDep), chart)!.level).toBe('ok');
    const over = [...car, { accountId: id('1.2.3.07'), date: '2025-06-10', value: -80000 }, { accountId: id('1.1.1.02'), date: '2025-06-10', value: 80000 }];
    expect(depreciationCheck(tb(over), tb(over), chart)!.title).toMatch(/maior que o custo/);
  });

  it('junta as conferências e lista os itens manuais (estoque só com saldo)', () => {
    const postings = [...p('3.1.1.01', -10000), ...p('3.2.1.03', 2000)];
    const checks = closingChecks({ client: {}, accounts: chart, beforeClosing: tb(postings), final: tb(postings), yearClosed: false });
    expect(checks[0]).toMatchObject({ id: 'porte', level: 'info' });
    expect(checks.find((c) => c.id === 'cost')?.level).toBe('ok');
    expect(manualItems(false).map((i) => i.id)).toEqual(['cash', 'taxes', 'payroll', 'equity', 'revenue', 'norm']);
    expect(manualItems(true).some((i) => i.id === 'stock')).toBe(true);
    expect(hasStockBalance(tb(p('1.1.3.01', 500)), chart)).toBe(true);
  });
});
