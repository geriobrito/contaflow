import { describe, expect, it } from 'vitest';
import type { MonthStatus } from '@/lib/dashboard';
import type { MonthRoutines } from '@/lib/services/month-routines';
import { monthRoutineSteps, nextStep, workingMonths, type MonthStepsInput } from '@/lib/month-steps';

const month = (m: string, state: MonthStatus['state']): MonthStatus => ({ month: m, total: 10, pending: 0, auto: 0, reconciled: 10, state });

const routines = (over: Partial<MonthRoutines> = {}): MonthRoutines => ({ problems: [], problemsByKey: {}, warnings: [], updates: false, pending: [], inputs: [], ...over });

// Setembro/2026 inteiro em dia: só falta fechar.
const base: MonthStepsInput = {
  month: '2026-09',
  counts: { total: 42, pending: 0, auto: 0 },
  invoices: { total: 5, unlinked: 0 },
  queries: { answered: 0, notSent: 0, waiting: 0 },
  payrollMonths: ['2026-08', '2026-09'],
  routines: routines(),
  journal: { manual: 2, repeatable: 0 },
};
const byKey = (input: Partial<MonthStepsInput>) => Object.fromEntries(monthRoutineSteps({ ...base, ...input }).map((s) => [s.key, s]));

describe('rotina do mês no painel', () => {
  it('competências de trabalho: abertas com extrato até a anterior à de hoje; a corrente só se não houver outra', () => {
    const months = [month('2026-07', 'LOCKED'), month('2026-08', 'OPEN'), month('2026-09', 'READY'), month('2026-10', 'OPEN')];
    expect(workingMonths(months, '2026-10-15')).toEqual(['2026-08', '2026-09']);
    expect(workingMonths([month('2026-09', 'LOCKED'), month('2026-10', 'OPEN')], '2026-10-15')).toEqual(['2026-10']);
    expect(workingMonths([month('2026-09', 'LOCKED'), month('2026-10', 'EMPTY')], '2026-10-15')).toEqual([]);
  });

  it('tudo feito: os passos ficam em dia e o próximo é fechar a competência', () => {
    const steps = monthRoutineSteps(base);
    expect(steps.map((s) => s.key)).toEqual(['reconciliation', 'invoices', 'queries', 'payroll', 'controls', 'journal', 'close']);
    expect(steps.slice(0, 6).every((s) => s.status === 'done')).toBe(true);
    expect(nextStep(steps)).toMatchObject({ key: 'close', href: '/?mes=2026-09' });
  });

  it('conciliação: sem extrato, pendentes e para aprovar levam à fila certa', () => {
    expect(byKey({ counts: null }).reconciliation).toMatchObject({ status: 'todo', detail: 'Extrato do mês ainda não importado' });
    expect(byKey({ counts: { total: 9, pending: 3, auto: 2 } }).reconciliation).toMatchObject({ detail: '3 lançamentos pendentes · 2 para aprovar', href: '/?mes=2026-09&filtro=PENDING' });
    expect(byKey({ counts: { total: 9, pending: 0, auto: 2 } }).reconciliation.href).toBe('/?mes=2026-09&filtro=AUTO_CLASSIFIED');
  });

  it('com passo pendente, o fechamento espera e o próximo passo é o primeiro que falta', () => {
    const steps = monthRoutineSteps({ ...base, counts: { total: 9, pending: 1, auto: 0 }, queries: { answered: 2, notSent: 0, waiting: 1 } });
    expect(steps.at(-1)).toMatchObject({ status: 'na', detail: 'Depois de 2 passos pendentes' });
    expect(nextStep(steps)?.key).toBe('reconciliation');
  });

  it('notas, espera do cliente e lançamentos a repetir são avisos: não seguram o fechamento', () => {
    const s = byKey({ invoices: { total: 4, unlinked: 3 }, queries: { answered: 0, notSent: 0, waiting: 2 }, journal: { manual: 0, repeatable: 3 } });
    expect(s.invoices).toMatchObject({ status: 'hint', detail: '4 notas · 3 sem lançamento vinculado' });
    expect(s.queries.status).toBe('hint');
    expect(s.journal).toMatchObject({ status: 'hint', detail: '3 lançamentos de ago/2026 a repetir' });
    expect(s.close.status).toBe('todo');
  });

  it('folha: lançada, cobrada pela folha recente, com provisão pendente ou fora do escopo', () => {
    expect(byKey({ payrollMonths: ['2026-08'] }).payroll).toMatchObject({ status: 'todo', detail: 'Folha não lançada (a última foi a de ago/2026)', href: '/folha?mes=2026-09' });
    expect(byKey({ payrollMonths: undefined }).payroll.status).toBe('na');
    expect(byKey({ routines: routines({ problemsByKey: { payroll: 'Lance a provisão da folha de 09/2026.' } }) }).payroll).toMatchObject({ status: 'todo', detail: 'Lance a provisão da folha de 09/2026.' });
  });

  it('bens e contratos: aponta a aba da primeira rotina pendente; sem cadastro, não se aplica', () => {
    const pending = routines({
      problemsByKey: { financing: 'Lance os juros de 09/2026.' },
      inputs: [{ key: 'stock', label: 'Informar o estoque final', href: '/estoque?mes=2026-09' }],
    });
    expect(byKey({ routines: pending }).controls).toMatchObject({ status: 'todo', detail: 'Lance os juros de 09/2026. (+ 1 rotina(s))', href: '/financiamentos?mes=2026-09' });
    expect(byKey({ routines: null }).controls).toMatchObject({ status: 'na', detail: 'Nenhum bem ou contrato cadastrado' });
  });

  it('enquanto carrega, o fechamento não é oferecido', () => {
    const s = byKey({ routines: undefined, invoices: undefined, journal: undefined });
    expect([s.controls.status, s.invoices.status, s.journal.status, s.close.status]).toEqual(['loading', 'loading', 'loading', 'loading']);
  });
});
