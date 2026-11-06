import { describe, expect, it } from 'vitest';
import type { JournalEntry, StockControl } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { countDue, missingCountMonths, stockCloseProblem, stockLockProblem, stockProblem, stockRequestText, stockStatus, stockWarnings } from '@/lib/stock';

const chart = buildITG1000Chart('c');
const acc = (code: string) => chart.find((a) => a.code === code)!;

const control = (over: Partial<StockControl> = {}): StockControl => ({
  id: 'c',
  clientId: 'c',
  stockAccountId: acc('1.1.3.01').id,
  stockAccountCode: '1.1.3.01',
  costAccountId: acc('3.2.1.01').id,
  costAccountCode: '3.2.1.01',
  startMonth: '2026-07',
  frequency: 'MONTHLY',
  counts: { '2026-07': 511749.82 },
  updatedAt: '',
  ...over,
});

describe('estoque e CMV', () => {
  it('caso da aula: estoque contábil de 1.297.086,78 e final de 511.749,82 dão CMV de 785.336,96 (D CMV / C Estoque)', () => {
    const s = stockStatus({ control: control(), month: '2026-07', accounts: chart, ledgerCents: 129708678, existing: null });
    expect(s.kind).toBe('PENDING');
    if (s.kind !== 'PENDING') return;
    expect(s.draft.date).toBe('2026-07-31');
    expect(s.draft.stockMonth).toBe('2026-07');
    expect(s.draft.lines.map((l) => [l.accountCode, l.type, l.amount])).toEqual([
      ['3.2.1.01', 'DEBIT', 785336.96],
      ['1.1.3.01', 'CREDIT', 785336.96],
    ]);
    expect(stockCloseProblem(s, '2026-07')).toMatch(/Lance o CMV de 07\/2026.*785\.336,96/);
    const entry = { ...s.draft, id: 'j', clientId: 'c', entryNumber: 1, createdAt: '', updatedAt: '', createdByUid: 'u' } as JournalEntry;
    expect(stockStatus({ control: control(), month: '2026-07', accounts: chart, ledgerCents: 129708678, existing: entry }).kind).toBe('POSTED');
  });

  it('compras lançadas direto no custo: o estoque que sobrou volta ao ativo (D Estoque / C CMV)', () => {
    const s = stockStatus({ control: control({ counts: { '2026-07': 450000 } }), month: '2026-07', accounts: chart, ledgerCents: 40000000, existing: null });
    expect(s.kind === 'PENDING' && s.draft.lines.map((l) => [l.accountCode, l.type, l.amount])).toEqual([
      ['1.1.3.01', 'DEBIT', 50000],
      ['3.2.1.01', 'CREDIT', 50000],
    ]);
  });

  it('sem o estoque final: só aviso (e o de lucros distribuídos sem CMV); trimestral pede só no fim do trimestre', () => {
    const missing = stockStatus({ control: control({ counts: {} }), month: '2026-07', accounts: chart, ledgerCents: 1, existing: null });
    expect(missing.kind).toBe('MISSING');
    expect(stockCloseProblem(missing, '2026-07')).toBeNull();
    const warnings = stockWarnings(missing, '2026-07', 1000000);
    expect(warnings[0]).toMatch(/Estoque final de 07\/2026 não informado/);
    expect(warnings[1]).toMatch(/distribuição de lucros em 07\/2026 \(R\$\s10\.000,00\) sem o CMV/);
    const quarterly = control({ frequency: 'QUARTERLY', counts: {} });
    expect(countDue(quarterly, '2026-08')).toBe(false);
    expect(countDue(quarterly, '2026-09')).toBe(true);
    expect(stockStatus({ control: quarterly, month: '2026-08', accounts: chart, ledgerCents: 1, existing: null }).kind).toBe('NONE');
    expect(missingCountMonths(quarterly, '2026-12', new Set(['2026-09']))).toEqual(['2026-12']);
    expect(missingCountMonths(control({ counts: { '2026-07': 1 } }), '2026-09', new Set())).toEqual(['2026-08', '2026-09']);
    // Estoque igual ao contábil: nada a lançar.
    expect(stockStatus({ control: control(), month: '2026-07', accounts: chart, ledgerCents: 51174982, existing: null }).kind).toBe('MATCHED');
  });

  it('validação, competência fechada e o pedido ao cliente', () => {
    expect(stockProblem(control(), chart)).toBeNull();
    expect(stockProblem(control({ costAccountId: acc('1.1.3.01').id }), chart)).toMatch(/conta do custo/);
    expect(stockProblem(control({ counts: { '2026-07': -1 } }), chart)).toMatch(/inválido/);
    const locked = new Set(['2026-07']);
    expect(stockLockProblem(control(), control({ counts: { '2026-07': 500000 } }), locked)).toMatch(/07\/2026 está fechada/);
    expect(stockLockProblem(control(), control({ counts: { '2026-07': 511749.82, '2026-08': 1 } }), locked)).toBeNull();
    expect(stockLockProblem(control(), control({ costAccountId: acc('3.2.1.02').id }), locked)).toMatch(/fechada/);
    expect(stockRequestText('Loja Alfa', '2026-07')).toMatch(/estoque em 31\/07\/2026.*sem os impostos recuperáveis/);
  });
});
