import { describe, expect, it } from 'vitest';
import type { InvestmentAccount, JournalEntry } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import {
  investmentCloseProblem,
  investmentLockProblem,
  investmentProblem,
  investmentStatus,
  missingBalanceMonths,
  redemptionPresets,
} from '@/lib/investments';

const chart = buildITG1000Chart('c');
const acc = (code: string) => chart.find((a) => a.code === code)!;

const caixinha = (over: Partial<InvestmentAccount> = {}): InvestmentAccount => ({
  id: 'inv1',
  description: 'Caixinha Nubank',
  ledgerAccountId: acc('1.1.1.03').id,
  ledgerAccountCode: '1.1.1.03',
  startMonth: '2025-12',
  balances: { '2025-12': 3088.42 },
  createdAt: '',
  updatedAt: '',
  ...over,
});

// Caso da aula: 4.103,25 em 30/11; resgates brutos de 2.207,55, 502,27, 301,78 e 201,18;
// aplicações de 1.000,00 e 1.174,00. Antes do rendimento, a conta fica com 3.064,47.
const ledger = (cents: number) => (id: string) => (id === acc('1.1.1.03').id ? cents : 0);

describe('aplicações financeiras: rendimento do mês', () => {
  it('rendimento = saldo do extrato − saldo contábil, no último dia: D aplicação / C rendimentos', () => {
    const s = investmentStatus({ investments: [caixinha()], month: '2025-12', accounts: chart, ledgerCents: ledger(306447), existing: null });
    expect(s.kind).toBe('PENDING');
    if (s.kind !== 'PENDING') return;
    expect(s.draft.date).toBe('2025-12-31');
    expect(s.draft.investmentMonth).toBe('2025-12');
    expect(s.draft.lines.map((l) => [l.accountCode, l.type, l.amount])).toEqual([
      ['1.1.1.03', 'DEBIT', 23.95],
      ['3.4.1.02.001', 'CREDIT', 23.95],
    ]);
    expect(investmentCloseProblem(s, '2025-12')).toMatch(/Lance o rendimento.*12\/2025.*23,95/);
    const entry = { ...s.draft, id: 'j', clientId: 'c', entryNumber: 1, createdAt: '', updatedAt: '', createdByUid: 'u' } as JournalEntry;
    expect(investmentStatus({ investments: [caixinha()], month: '2025-12', accounts: chart, ledgerCents: ledger(306447), existing: entry }).kind).toBe('POSTED');
    // Saldo corrigido: o lançamento é atualizado.
    const fixed = investmentStatus({ investments: [caixinha({ balances: { '2025-12': 3090 } })], month: '2025-12', accounts: chart, ledgerCents: ledger(306447), existing: entry });
    expect(fixed.kind === 'PENDING' && fixed.existing).toBe(entry);
  });

  it('sem o saldo informado, o mês não fecha; saldo contábil acima do extrato também não', () => {
    const missing = investmentStatus({ investments: [caixinha({ balances: {} })], month: '2025-12', accounts: chart, ledgerCents: ledger(306447), existing: null });
    expect(missing.kind).toBe('MISSING');
    expect(investmentCloseProblem(missing, '2025-12')).toMatch(/Informe o saldo do extrato de Caixinha Nubank em 12\/2025/);
    const over = investmentStatus({ investments: [caixinha({ balances: { '2025-12': 3000 } })], month: '2025-12', accounts: chart, ledgerCents: ledger(306447), existing: null });
    expect(over.kind).toBe('BLOCKED');
    expect(investmentCloseProblem(over, '2025-12')).toMatch(/falta lançar resgate, IR ou IOF/);
    // Saldo igual ao contábil: nada a lançar.
    expect(investmentStatus({ investments: [caixinha({ balances: { '2025-12': 3064.47 } })], month: '2025-12', accounts: chart, ledgerCents: ledger(306447), existing: null }).kind).toBe('NONE');
    // Fora do período (antes do início ou depois do encerramento): nada exigido.
    expect(investmentStatus({ investments: [caixinha({ startMonth: '2026-01' })], month: '2025-12', accounts: chart, ledgerCents: ledger(0), existing: null }).kind).toBe('NONE');
  });

  it('meses abertos sem saldo; validação e competência fechada', () => {
    expect(missingBalanceMonths([caixinha({ startMonth: '2025-11', balances: { '2025-12': 1 } })], '2026-02', new Set(['2025-11']))).toEqual(['2026-01', '2026-02']);
    expect(missingBalanceMonths([caixinha({ startMonth: '2025-11', closedMonth: '2025-12', balances: {} })], '2026-02', new Set())).toEqual(['2025-11', '2025-12']);
    expect(investmentProblem(caixinha(), chart)).toBeNull();
    expect(investmentProblem(caixinha({ description: ' ' }), chart)).toMatch(/nome/);
    expect(investmentProblem(caixinha({ ledgerAccountId: acc('3.4.1.02.001').id }), chart)).toMatch(/conta analítica do ativo/);
    expect(investmentProblem(caixinha({ balances: { '2025-12': -1 } }), chart)).toMatch(/Saldo inválido/);
    const locked = new Set(['2025-12']);
    expect(investmentLockProblem(caixinha(), caixinha({ balances: { '2025-12': 3100 } }), locked)).toMatch(/12\/2025 está fechada/);
    expect(investmentLockProblem(caixinha(), caixinha({ description: 'Caixinha PJ' }), locked)).toBeNull();
    expect(investmentLockProblem(caixinha(), null, locked)).toMatch(/fechada/);
  });

  it('resgate: IR na despesa no Simples; a recuperar no Presumido e no Real; IOF na despesa', () => {
    expect(redemptionPresets('SIMPLES_NACIONAL').map((p) => [p.key, p.options[0].code])).toEqual([
      ['ir', '3.3.2.19'],
      ['iof', '3.4.1.01.003'],
    ]);
    expect(redemptionPresets('LUCRO_PRESUMIDO')[0].options.map((o) => o.code)).toEqual(['1.1.2.12', '1.1.2.05']);
    for (const code of ['3.3.2.19', '1.1.2.12', '3.4.1.01.003', '3.4.1.02.001']) expect(chart.some((a) => a.code === code && a.nature === 'ANALYTIC')).toBe(true);
  });
});
