import { describe, expect, it } from 'vitest';
import type { BankAccount, BankTransaction, ClientCompany, ClientRequest, ImportBatch, PeriodLock } from '@/types/firestore';
import { buildPortfolioRow, shortMonth, sortPortfolio, type PortfolioInput } from '@/lib/portfolio';

const client = { id: 'c1', name: 'Aurora Alimentos Ltda', tradeName: 'Padaria Aurora', cnpj: '11222333000181' } as ClientCompany;
const bank = { id: 'b1', clientId: 'c1', accountKey: 'k1', nickname: 'Itaú' } as BankAccount;
const batch = (start: string, end: string, extra: Partial<ImportBatch> = {}) => ({ id: `${start}`, clientId: 'c1', accountKey: 'k1', startDate: start, endDate: end, status: 'COMPLETED', ...extra }) as ImportBatch;
const lock = (month: string) => ({ id: month, clientId: 'c1', month, lockedAt: '', lockedByUid: 'u' }) as PeriodLock;

// Hoje: 15/10/2026 → competência de foco: setembro/2026.
const base: PortfolioInput = {
  client,
  pending: 0,
  auto: 0,
  locks: [lock('2026-07'), lock('2026-08'), lock('2026-09')],
  batches: [batch('2026-07-01', '2026-07-31'), batch('2026-08-01', '2026-08-31'), batch('2026-09-01', '2026-09-30')],
  banks: [bank],
  openQueries: [],
  requests: [],
  today: '2026-10-15',
  nowMs: Date.parse('2026-10-15T12:00:00Z'),
};
const ids = (input: Partial<PortfolioInput>) => buildPortfolioRow({ ...base, ...input }).tasks.map((t) => t.id);

describe('carteira no painel', () => {
  it('empresa em dia: competência anterior fechada, extratos até ela, nada pendente', () => {
    const row = buildPortfolioRow(base);
    expect(row).toMatchObject({ name: 'Padaria Aurora', focusMonth: '2026-09', focus: 'closed', openMonths: [], tasks: [], upToDate: true, weight: 0 });
  });

  it('competência de foco aberta e meses anteriores abertos', () => {
    const row = buildPortfolioRow({ ...base, locks: [lock('2026-07')] });
    expect(row.focus).toBe('open');
    expect(row.openMonths).toEqual(['2026-08', '2026-09']);
    expect(row.tasks.map((t) => [t.id, t.label, t.href])).toEqual([
      ['close-focus', 'Fechar set/2026', '/?mes=2026-09'],
      ['open-months', '1 mês anterior aberto', '/?mes=2026-08'],
    ]);
  });

  it('extrato atrasado: sem o de setembro, a competência fica sem dados e o extrato aparece desatualizado', () => {
    const row = buildPortfolioRow({ ...base, locks: [lock('2026-07'), lock('2026-08')], batches: base.batches.slice(0, 2) });
    expect(row.focus).toBe('no-data');
    expect(row.tasks.map((t) => t.label)).toEqual(['Extrato de Itaú desatualizado']);
    expect(row.upToDate).toBe(false);
  });

  it('pendências, aprovações e perguntas ao cliente, urgentes primeiro', () => {
    const asked = [{ id: 't1' }, { id: 't2' }, { id: 't3' }] as BankTransaction[];
    const requests = [
      { id: 'r1', status: 'OPEN', expiresAtMs: base.nowMs + 1e6, items: [{ transactionId: 't2' }], answers: {} },
    ] as unknown as ClientRequest[];
    expect(ids({ pending: 12, auto: 3, openQueries: asked, requests })).toEqual(['pending', 'auto', 'not-sent', 'waiting']);
    expect(buildPortfolioRow({ ...base, pending: 1 }).tasks[0].label).toBe('1 pendente');
    // O atalho abre a Conciliação no mês do mais antigo, já filtrada; sem a data, no primeiro mês aberto.
    expect(buildPortfolioRow({ ...base, pending: 5, oldestPending: '2026-08-14' }).tasks[0].href).toBe('/?mes=2026-08&filtro=PENDING');
    expect(buildPortfolioRow({ ...base, auto: 2, oldestAuto: null, locks: [lock('2026-07')] }).tasks.find((t) => t.id === 'auto')!.href).toBe('/?mes=2026-08&filtro=AUTO_CLASSIFIED');
    expect(buildPortfolioRow({ ...base, pending: 1 }).tasks[0].href).toBe('/');
    // Só aguardando o cliente: em dia (não depende do escritório).
    expect(buildPortfolioRow({ ...base, openQueries: [asked[1]], requests }).upToDate).toBe(true);
  });

  it('extratos com divergência ou lacuna são urgentes; sem extrato nenhum, pede a primeira importação', () => {
    const gap = [batch('2026-07-01', '2026-07-31'), batch('2026-09-01', '2026-09-30', { balanceCheck: { status: 'MISMATCH' } as ImportBatch['balanceCheck'] })];
    expect(ids({ batches: gap })).toEqual(['mismatch', 'gaps']);
    expect(ids({ batches: [], locks: [] })).toEqual(['no-statements']);
  });

  it('ordena por trabalho e, no empate, pelo nome', () => {
    const rows = [
      buildPortfolioRow({ ...base, client: { ...client, id: 'z', tradeName: 'Zeta' } }),
      buildPortfolioRow({ ...base, client: { ...client, id: 'a', tradeName: 'Alfa' } }),
      buildPortfolioRow({ ...base, client: { ...client, id: 'p', tradeName: 'Beta' }, pending: 4 }),
    ];
    expect(sortPortfolio(rows).map((r) => r.name)).toEqual(['Beta', 'Alfa', 'Zeta']);
    expect(shortMonth('2026-03')).toBe('mar/2026');
  });
});
