import { describe, expect, it } from 'vitest';
import type { BankAccount, BankTransaction, ClientRequest, ImportBatch } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { buildDashboard, type DashboardInput } from '@/lib/dashboard';

const chart = buildITG1000Chart('c');
let n = 0;
const tx = (date: string, status: BankTransaction['status'], extra: Partial<BankTransaction> = {}): BankTransaction => ({
  id: `t${++n}`, clientId: 'c', fitid: `f${n}`, date, amount: -10, type: 'DEBIT', memo: 'x', status, createdAt: '', ...extra,
});
const batch = (accountKey: string, startDate: string, endDate: string, extra: Partial<ImportBatch> = {}): ImportBatch => ({
  id: `b${++n}`, clientId: 'c', fileName: 'f', fileSize: 0, totalTransactions: 1, importedCount: 1, duplicateCount: 0, autoClassifiedCount: 0, totalDebit: 0, totalCredit: 0, importedAt: '', accountKey, startDate, endDate, ...extra,
});
const bank = (accountKey: string, extra: Partial<BankAccount> = {}): BankAccount => ({
  id: `k${accountKey}`, clientId: 'c', accountKey, nickname: `Banco ${accountKey}`, ledgerAccountId: 'x', openingBalance: 0, openingDate: '2024-12-31', createdAt: '', updatedAt: '', ...extra,
});

const base = (over: Partial<DashboardInput> = {}): DashboardInput => ({
  client: { id: 'c', name: 'Cliente', cnpj: '', regime: 'MEI', legalRepresentativeName: 'R', legalRepresentativeCpf: '1', createdAt: '', updatedAt: '' },
  accounts: chart,
  transactions: [],
  batches: [],
  banks: [],
  locks: [],
  requests: [],
  org: { orgId: 'o', officeName: 'E', accountantName: 'A', accountantCrc: 'SP-1', updatedAt: '' },
  openings: { id: 'c', clientId: 'c', date: '2024-12-31', entries: [], updatedAt: '' },
  today: '2025-06-15',
  nowMs: Date.parse('2025-06-15T12:00:00Z'),
  ...over,
});
const ids = (d: ReturnType<typeof buildDashboard>) => d.alerts.map((a) => a.id);

describe('buildDashboard: meses', () => {
  const d = buildDashboard(
    base({
      transactions: [
        tx('2025-01-10', 'RECONCILED'), tx('2025-01-20', 'RECONCILED'),
        tx('2025-02-10', 'RECONCILED'), tx('2025-02-11', 'PENDING'),
        tx('2025-04-05', 'AUTO_CLASSIFIED'),
      ],
      locks: [{ id: 'c_2025-01', clientId: 'c', month: '2025-01', lockedAt: '', lockedByUid: 'u' }],
    })
  );

  it('estado de cada mês, inclusive os sem movimento no meio do período', () => {
    expect(d.months.map((m) => [m.month, m.state, m.total, m.pending, m.auto])).toEqual([
      ['2025-01', 'LOCKED', 2, 0, 0],
      ['2025-02', 'OPEN', 2, 1, 0],
      ['2025-03', 'EMPTY', 0, 0, 0],
      ['2025-04', 'OPEN', 1, 0, 1],
    ]);
    expect(d.totals).toMatchObject({ pending: 1, auto: 1, monthsLocked: 1, monthsOpen: 2, monthsWithData: 3, transactions: 5 });
  });

  it('alerta de pendências leva ao mês mais antigo aberto, com filtro', () => {
    const a = d.alerts.find((x) => x.id === 'pending')!;
    expect(a).toMatchObject({ severity: 'high', href: '/?mes=2025-02&filtro=PENDING' });
    expect(d.alerts.find((x) => x.id === 'auto')?.href).toBe('/?mes=2025-04&filtro=AUTO_CLASSIFIED');
    expect(d.allClear).toBe(false);
  });

  it('mês 100% conciliado e aberto (passado) está pronto para fechar', () => {
    const r = buildDashboard(base({ transactions: [tx('2025-03-10', 'RECONCILED'), tx('2025-06-02', 'RECONCILED')] }));
    expect(r.months.map((m) => m.state)).toEqual(['READY', 'EMPTY', 'EMPTY', 'READY']);
    // O mês corrente não entra na sugestão de fechar.
    expect(r.alerts.find((x) => x.id === 'ready')?.title).toBe('1 mês pronto para fechar');
    expect(r.allClear).toBe(true);
  });
});

describe('buildDashboard: extratos', () => {
  it('divergência de saldo, lacuna entre extratos e extrato desatualizado', () => {
    const d = buildDashboard(
      base({
        banks: [bank('k1'), bank('k2')],
        batches: [
          batch('k1', '2025-01-01', '2025-01-31'),
          batch('k1', '2025-03-01', '2025-03-31', { balanceCheck: { status: 'MISMATCH', difference: 5 } }),
          batch('k2', '2025-03-01', '2025-04-30'),
        ],
      })
    );
    expect(d.accounts.find((a) => a.accountKey === 'k1')?.gaps).toEqual([{ accountKey: 'k1', from: '2025-02-01', to: '2025-02-28' }]);
    expect(ids(d)).toEqual(expect.arrayContaining(['mismatch', 'gap-k1-2025-02-01', 'stale-k2']));
    expect(d.alerts.find((a) => a.id === 'stale-k2')?.title).toBe('Extrato desatualizado desde 01/05/2025');
    // k1 termina em 31/03 (há lacuna) → o alerta de lacuna substitui o de desatualizado
    expect(ids(d)).not.toContain('stale-k1');
  });

  it('extrato até o fim do mês passado está em dia', () => {
    const d = buildDashboard(base({ banks: [bank('k1')], batches: [batch('k1', '2025-05-01', '2025-05-31')] }));
    expect(ids(d).filter((i) => i.startsWith('stale') || i.startsWith('gap'))).toEqual([]);
  });
});

describe('buildDashboard: perguntas ao cliente', () => {
  const q = (status: 'OPEN' | 'RESOLVED' = 'OPEN') => ({ question: '?', status, askedAt: '', askedByUid: 'u' });
  const t1 = tx('2025-05-01', 'PENDING', { clientQuery: q() });
  const t2 = tx('2025-05-02', 'PENDING', { clientQuery: q() });
  const t3 = tx('2025-05-03', 'PENDING', { clientQuery: q() });
  const t4 = tx('2025-05-04', 'PENDING', { clientQuery: q('RESOLVED') });
  const item = (t: BankTransaction, answer?: string) => ({ transactionId: t.id, date: t.date, memo: t.memo, amount: t.amount, question: '?', ...(answer ? { answer } : {}) });
  const req = (items: ReturnType<typeof item>[], over: Partial<ClientRequest> = {}): ClientRequest => ({
    id: 'a'.repeat(32), clientId: 'c', clientName: 'C', items, status: 'OPEN', createdAt: '', createdByUid: 'u', expiresAtMs: Date.parse('2025-07-01'), ...over,
  });

  it('separa sem link, aguardando resposta e respondidas; resolvidas não contam', () => {
    const d = buildDashboard(base({ transactions: [t1, t2, t3, t4], requests: [req([item(t1, 'Fornecedor'), item(t2)])] }));
    expect(d.queries).toEqual({ notSent: 1, waiting: 1, answered: 1 });
    expect(ids(d)).toEqual(expect.arrayContaining(['answered', 'not-sent', 'waiting']));
  });

  it('link vencido volta a ser "sem link"', () => {
    const d = buildDashboard(base({ transactions: [t2], requests: [req([item(t2)], { expiresAtMs: Date.parse('2025-06-01') })] }));
    expect(d.queries).toEqual({ notSent: 1, waiting: 0, answered: 0 });
  });
});

describe('buildDashboard: cadastros', () => {
  it('plano vazio, sem extrato, sem escritório, sem representante', () => {
    const d = buildDashboard(base({ accounts: [], org: null, client: { ...base().client, legalRepresentativeName: undefined } }));
    expect(ids(d)).toEqual(expect.arrayContaining(['chart', 'first-import', 'office', 'representative']));
    expect(d.alerts[0].severity).toBe('high');
  });

  it('banco sem vínculo, sem saldo inicial e saldos de abertura não informados ou que não fecham', () => {
    const d = buildDashboard(base({ banks: [bank('k1', { ledgerAccountId: undefined, openingBalance: undefined, openingDate: undefined })], openings: null }));
    expect(ids(d)).toEqual(expect.arrayContaining(['bank-link', 'bank-opening', 'opening-none']));
    const gap = buildDashboard(base({ banks: [bank('k1', { openingBalance: 400 })] }));
    expect(gap.alerts.find((a) => a.id === 'opening-gap')?.href).toBe('/abertura');
  });

  it('tudo certo: sem alertas altos ou médios', () => {
    const d = buildDashboard(base({ transactions: [tx('2025-05-02', 'RECONCILED')], banks: [bank('k1')], batches: [batch('k1', '2025-05-01', '2025-05-31')] }));
    expect(d.allClear).toBe(true);
  });
});
