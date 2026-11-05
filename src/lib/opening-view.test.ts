import { describe, expect, it } from 'vitest';
import type { BankAccount, ChartAccount } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { openingPlug, summarizeOpening } from '@/lib/opening';
import { buildOpeningSheet, type OpeningRow, type OpeningSection, type OpeningSheet } from '@/lib/opening-view';

const chart = buildITG1000Chart('c');
const id = (code: string) => `c_itg22_${code}`;
const bank = (key: string, ledger: string | null, opening?: number): BankAccount => ({
  id: key,
  clientId: 'c',
  accountKey: key,
  nickname: `Banco ${key}`,
  ...(ledger ? { ledgerAccountId: id(ledger) } : {}),
  ...(opening !== undefined ? { openingBalance: opening, openingDate: '2025-01-01' } : {}),
  createdAt: '',
  updatedAt: '',
});
const amounts = (entries: Record<string, number>) => new Map(Object.entries(entries).map(([code, v]) => [id(code), v] as const));
const section = (sheet: OpeningSheet, code: string): OpeningSection => {
  const s = [...sheet.assets, ...sheet.claims].find((x) => x.account?.code === code);
  if (!s) throw new Error(`seção ${code} ausente`);
  return s;
};
const rowsOf = (s: OpeningSection): OpeningRow[] => s.groups.flatMap((g) => g.rows);
const codeOf = (r: OpeningRow) => (r.type === 'account' ? r.account.code : r.type === 'bank' ? `bank:${r.bank.id}` : 'plug');

describe('buildOpeningSheet', () => {
  it('monta as duas colunas pelas seções do plano', () => {
    const sheet = buildOpeningSheet({ accounts: chart, banks: [], amounts: new Map(), plug: null });
    expect(sheet.assets.map((s) => s.account?.code)).toEqual(['1.1', '1.2']);
    expect(sheet.claims.map((s) => s.account?.code)).toEqual(['2.1', '2.2', '2.3']);
    expect(sheet.claims.map((s) => s.kind)).toEqual(['LIABILITY', 'LIABILITY', 'EQUITY']);
    // Grupos na ordem do plano, com as analíticas dentro.
    const circulante = section(sheet, '1.1');
    expect(circulante.groups.map((g) => g.account?.code)).toEqual(['1.1.1', '1.1.2', '1.1.3', '1.1.4']);
    expect(circulante.groups[0].rows.map(codeOf)).toEqual(['1.1.1.01', '1.1.1.02', '1.1.1.03', '1.1.1.04']);
    // Contas de resultado e sintéticas não viram linha.
    const all = [...sheet.assets, ...sheet.claims].flatMap(rowsOf).map(codeOf);
    expect(all.some((c) => c.startsWith('3') || c.startsWith('4'))).toBe(false);
    expect(all).not.toContain('1.1.1');
    // A 2.3.3.04 recebe só a contrapartida: sem diferença, não aparece.
    expect(all).not.toContain('2.3.3.04');
  });

  it('coloca o banco no lugar da conta contábil vinculada, sem campo para ela', () => {
    const sheet = buildOpeningSheet({ accounts: chart, banks: [bank('itau', '1.1.1.02', 8000)], amounts: new Map(), plug: null });
    const disponivel = section(sheet, '1.1').groups[0];
    expect(disponivel.rows.map(codeOf)).toEqual(['1.1.1.01', 'bank:itau', '1.1.1.03', '1.1.1.04']);
    expect(disponivel.subtotal).toBe(8000);
    expect(sheet.totals.assets).toBe(8000);
  });

  it('banco sem conta contábil fica num grupo próprio no topo do ativo', () => {
    const sheet = buildOpeningSheet({ accounts: chart, banks: [bank('x', null, 300)], amounts: new Map(), plug: null });
    const first = sheet.assets[0].groups[0];
    expect(first.title).toBe('Bancos sem conta contábil vinculada');
    expect(first.rows.map(codeOf)).toEqual(['bank:x']);
    expect(sheet.totals.assets).toBe(300);
  });

  it('cartão vinculado ao passivo vai para a coluna do passivo, com o sinal invertido', () => {
    const card = { ...bank('card', '2.1.3.04', -1200), kind: 'CARD' as const };
    const sheet = buildOpeningSheet({ accounts: chart, banks: [card], amounts: new Map(), plug: null });
    const rows = rowsOf(section(sheet, '2.1'));
    expect(rows.find((r) => codeOf(r) === 'bank:card')?.value).toBe(1200);
    expect(sheet.totals.liabilities).toBe(1200);
    expect(sheet.totals.assets).toBe(0);
  });

  it('retificadora reduz o subtotal do grupo e da seção', () => {
    const sheet = buildOpeningSheet({ accounts: chart, banks: [], amounts: amounts({ '1.2.3.04': 6000, '1.2.3.07': 1000 }), plug: null });
    const imobilizado = section(sheet, '1.2').groups.find((g) => g.account?.code === '1.2.3')!;
    const dep = imobilizado.rows.find((r) => codeOf(r) === '1.2.3.07');
    expect(dep).toMatchObject({ type: 'account', contra: true, amount: 1000, value: -1000 });
    expect(imobilizado.subtotal).toBe(5000);
    expect(section(sheet, '1.2').subtotal).toBe(5000);
  });

  it('retificadora do PL a débito reduz o PL', () => {
    const sheet = buildOpeningSheet({ accounts: chart, banks: [], amounts: amounts({ '2.3.1.01': 10000, '2.3.1.02': 4000 }), plug: null });
    expect(sheet.totals.equity).toBe(6000);
  });

  it('a diferença bate com summarizeOpening e a contrapartida credora fecha a abertura', () => {
    const banks = [bank('itau', '1.1.1.02', 8000), { ...bank('card', '2.1.3.04', -500), kind: 'CARD' as const }, bank('solto', null, 200)];
    const entered = { '1.1.1.01': 1200, '1.1.2.01': 3200, '1.2.3.04': 6000, '1.2.3.07': 1000, '2.1.2.01': 1800, '2.1.5.01': 1400, '2.3.1.01': 10000 };
    const map = amounts(entered);
    const entries = [...map].map(([accountId, amount]) => ({ accountId, amount }));
    const summary = summarizeOpening(entries, chart, banks);

    const open = buildOpeningSheet({ accounts: chart, banks, amounts: map, plug: null });
    expect(open.totals.difference).toBe(summary.difference);

    const plug = openingPlug(summary)!;
    expect(plug.nature).toBe('C');
    const closed = buildOpeningSheet({ accounts: chart, banks, amounts: map, plug });
    expect(closed.totals.difference).toBe(0);
    const plugRow = rowsOf(section(closed, '2.3')).find((r) => r.type === 'plug');
    expect(plugRow).toMatchObject({ value: plug.amount, account: { code: '2.3.3.04' } });
    // Está no grupo de lucros ou prejuízos acumulados, onde fica a conta.
    expect(section(closed, '2.3').groups.find((g) => g.rows.includes(plugRow!))?.account?.code).toBe('2.3.3');
  });

  it('contrapartida devedora reduz o PL', () => {
    const map = amounts({ '2.1.2.01': 700 });
    const summary = summarizeOpening([...map].map(([accountId, amount]) => ({ accountId, amount })), chart, []);
    const plug = openingPlug(summary)!;
    expect(plug.nature).toBe('D');
    const sheet = buildOpeningSheet({ accounts: chart, banks: [], amounts: map, plug });
    expect(sheet.totals.equity).toBe(-700);
    expect(sheet.totals.difference).toBe(0);
  });

  it('sem a 2.3.3.04 no plano, a contrapartida aparece no grupo de lucros ou prejuízos', () => {
    const accounts = chart.filter((a) => a.code !== '2.3.3.04');
    const sheet = buildOpeningSheet({ accounts, banks: [], amounts: amounts({ '1.1.1.01': 100 }), plug: { amount: 100, nature: 'C' } });
    const plugGroup = section(sheet, '2.3').groups.find((g) => g.rows.some((r) => r.type === 'plug'));
    expect(plugGroup?.account?.code).toBe('2.3.3');
    expect(plugGroup?.rows.find((r) => r.type === 'plug')).toMatchObject({ account: null, value: 100 });
    expect(sheet.totals.difference).toBe(0);
  });

  it('o filtro esconde linhas e grupos, mas o subtotal conta tudo', () => {
    const sheet = buildOpeningSheet({
      accounts: chart,
      banks: [bank('itau', '1.1.1.02', 500)],
      amounts: amounts({ '1.1.2.01': 300, '1.1.3.01': 200 }),
      plug: null,
      showAccount: (a) => a.code === '1.1.2.01',
      showBank: () => false,
    });
    const circulante = section(sheet, '1.1');
    expect(circulante.groups.map((g) => g.account?.code)).toEqual(['1.1.2']);
    expect(rowsOf(circulante).map(codeOf)).toEqual(['1.1.2.01']);
    expect(circulante.subtotal).toBe(1000);
    // Seção sem nada no filtro continua na coluna, com hasRows para a mensagem.
    expect(section(sheet, '2.2')).toMatchObject({ groups: [], hasRows: true, subtotal: 0 });
  });

  it('as contas fora do filtro ficam disponíveis para adicionar na seção, sem bancos nem a contrapartida', () => {
    const sheet = buildOpeningSheet({
      accounts: chart,
      banks: [bank('itau', '1.1.1.02', 500)],
      amounts: amounts({ '1.1.1.01': 100 }),
      plug: { amount: 600, nature: 'C' },
      showAccount: (_a, amount) => amount > 0,
    });
    const circulante = section(sheet, '1.1');
    expect(circulante.addable.map((a) => a.code)).not.toContain('1.1.1.01'); // já visível
    expect(circulante.addable.map((a) => a.code)).not.toContain('1.1.1.02'); // é o banco
    expect(circulante.addable.map((a) => a.code)).toContain('1.1.2.01');
    expect(circulante.addable.every((a) => a.code.startsWith('1.1.'))).toBe(true);
    const pl = section(sheet, '2.3');
    expect(pl.addable.map((a) => a.code)).toContain('2.3.1.01');
    expect(pl.addable.map((a) => a.code)).not.toContain('2.3.3.04');
  });

  it('valor salvo numa conta que virou conta de banco continua visível, para poder ser apagado', () => {
    const sheet = buildOpeningSheet({ accounts: chart, banks: [bank('itau', '1.1.1.02', 0)], amounts: amounts({ '1.1.1.02': 50 }), plug: null });
    const rows = section(sheet, '1.1').groups[0].rows.map(codeOf);
    expect(rows).toEqual(['1.1.1.01', 'bank:itau', '1.1.1.02', '1.1.1.03', '1.1.1.04']);
    expect(sheet.totals.assets).toBe(50);
  });

  it('contas analíticas fora de uma seção vão para "Outras contas"', () => {
    const extra: ChartAccount = { id: 'x', clientId: 'c', code: '9', name: 'Conta solta', type: 'LIABILITY', nature: 'ANALYTIC', level: 1, createdAt: '', updatedAt: '' };
    const sheet = buildOpeningSheet({ accounts: [...chart, extra], banks: [], amounts: new Map([['x', 40]]), plug: null });
    const other = sheet.claims.find((s) => s.key === 'other-LIABILITY');
    expect(other?.title).toBe('Outras contas do passivo');
    expect(other?.subtotal).toBe(40);
    expect(sheet.totals.liabilities).toBe(40);
  });
});
