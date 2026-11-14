import { describe, expect, it } from 'vitest';
import type { ObligationChecks } from '@/types/firestore';
import { easterSunday, isBusinessDay, lastBusinessDayOf, nthBusinessDayOf, shiftToBusinessDay } from '@/lib/business-days';
import {
  activeObligations,
  buildAgenda,
  emptyChecks,
  obligationDef,
  obligationKey,
  payrollProfile,
  setObligationActive,
  toggleDone,
  type AgendaClient,
} from '@/lib/obligations';

const due = (code: string, period: string) => obligationDef(code)!.due(period);

describe('dias úteis', () => {
  it('Páscoa e feriados móveis', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2025)).toBe('2025-04-20');
    expect(isBusinessDay('2026-02-16')).toBe(false); // Carnaval
    expect(isBusinessDay('2026-02-17')).toBe(false);
    expect(isBusinessDay('2026-04-03')).toBe(false); // Sexta-feira Santa
    expect(isBusinessDay('2026-06-04')).toBe(false); // Corpus Christi
    expect(isBusinessDay('2026-11-20')).toBe(false); // Consciência Negra
    expect(isBusinessDay('2023-11-20')).toBe(true); // antes da Lei 14.759/2023
    expect(isBusinessDay('2026-02-18')).toBe(true);
  });
  it('desloca para o dia útil anterior ou seguinte', () => {
    expect(shiftToBusinessDay('2026-03-15', 'previous')).toBe('2026-03-13');
    expect(shiftToBusinessDay('2026-06-20', 'next')).toBe('2026-06-22');
    expect(lastBusinessDayOf('2026-05')).toBe('2026-05-29');
    expect(nthBusinessDayOf('2026-03', 10)).toBe('2026-03-13');
  });
});

describe('prazos do catálogo (2026)', () => {
  it('Simples e MEI', () => {
    expect(due('DAS', '2026-01')).toBe('2026-02-20');
    expect(due('DAS', '2026-05')).toBe('2026-06-22'); // 20/06 é sábado: prorroga
    expect(due('DAS_MEI', '2026-02')).toBe('2026-03-20');
    expect(due('DEFIS', '2025')).toBe('2026-03-31');
    expect(due('DASN_SIMEI', '2025')).toBe('2026-05-29'); // 31/05 é domingo: antecipa
  });
  it('folha e declarações mensais', () => {
    expect(due('ESOCIAL', '2026-02')).toBe('2026-03-13'); // 15/03 é domingo: antecipa
    expect(due('EFD_REINF', '2026-01')).toBe('2026-02-18'); // 15/02 domingo, 16 e 17 Carnaval
    expect(due('DCTFWEB', '2026-05')).toBe('2026-06-30');
    expect(due('DCTFWEB', '2026-06')).toBe('2026-07-31');
    expect(due('FGTS', '2026-05')).toBe('2026-06-19'); // 20/06 sábado: antecipa
    expect(due('EFD_CONTRIB', '2026-01')).toBe('2026-03-13');
    expect(due('PIS_COFINS', '2026-03')).toBe('2026-04-24'); // 25/04 sábado: antecipa
  });
  it('trimestrais e anuais', () => {
    expect(due('IRPJ_CSLL_TRIM', '2026-Q1')).toBe('2026-04-30');
    expect(due('IRPJ_CSLL_TRIM', '2025-Q4')).toBe('2026-01-30');
    expect(due('ECD', '2025')).toBe('2026-06-30');
    expect(due('ECF', '2025')).toBe('2026-07-31');
  });
});

describe('obrigações de cada empresa', () => {
  const none = { hasPayroll: false, hasEmployees: false };
  const codes = (list: { code: string }[]) => list.map((o) => o.code).sort();

  it('sugere pelo regime e pela folha', () => {
    expect(codes(activeObligations('MEI', none, null))).toEqual(['DASN_SIMEI', 'DAS_MEI']);
    expect(codes(activeObligations('SIMPLES_NACIONAL', none, null))).toEqual(['DAS', 'DEFIS']);
    expect(codes(activeObligations('SIMPLES_NACIONAL', { hasPayroll: true, hasEmployees: false }, null))).toEqual(['DARF_FOLHA', 'DAS', 'DCTFWEB', 'DEFIS', 'ESOCIAL']);
    expect(codes(activeObligations('LUCRO_PRESUMIDO', { hasPayroll: true, hasEmployees: true }, null))).toEqual(
      ['DARF_FOLHA', 'DCTFWEB', 'ECD', 'ECF', 'EFD_CONTRIB', 'ESOCIAL', 'FGTS', 'IRPJ_CSLL_TRIM', 'PIS_COFINS'].sort()
    );
  });

  it('a empresa liga opcionais e desliga sugeridas', () => {
    let checks = emptyChecks('c1', 'T');
    checks = setObligationActive(checks, obligationDef('EFD_REINF')!, true, false);
    checks = setObligationActive(checks, obligationDef('DEFIS')!, false, true);
    expect(checks.enabled).toEqual(['EFD_REINF']);
    expect(checks.disabled).toEqual(['DEFIS']);
    expect(codes(activeObligations('SIMPLES_NACIONAL', none, checks))).toEqual(['DAS', 'EFD_REINF']);
    // Voltar ao sugerido não deixa resto.
    checks = setObligationActive(checks, obligationDef('DEFIS')!, true, true);
    expect(checks.disabled).toEqual([]);
  });

  it('lê a folha: pró-labore conta como folha, FGTS só com empregados', () => {
    const s = (grossSalaries: number, grossProLabore: number, fgts = 0) => ({ grossSalaries, grossProLabore, fgts }) as never;
    expect(payrollProfile(null)).toEqual(none);
    expect(payrollProfile({ summaries: [s(0, 1500)] })).toEqual({ hasPayroll: true, hasEmployees: false });
    expect(payrollProfile({ summaries: [s(2000, 0, 160)] })).toEqual({ hasPayroll: true, hasEmployees: true });
  });
});

describe('agenda', () => {
  const client = (id: string, regime: AgendaClient['client']['regime'], checks: ObligationChecks | null = null, createdAt = '2025-01-01'): AgendaClient => ({
    client: { id, regime, createdAt },
    profile: { hasPayroll: false, hasEmployees: false },
    checks,
  });

  it('classifica atrasado, hoje, semana e depois; respeita o que já foi cumprido', () => {
    const done = { ...emptyChecks('a', 'T'), done: [{ key: obligationKey('DAS', '2026-03'), doneAt: '2026-04-18T10:00:00Z' }] };
    const items = buildAgenda({ clients: [client('a', 'SIMPLES_NACIONAL', done)], today: '2026-05-18', from: '2026-03-01', to: '2026-06-30' });
    const byPeriod = Object.fromEntries(items.map((i) => [i.period, i.status]));
    expect(byPeriod['2026-02']).toBe('overdue'); // 20/03
    expect(byPeriod['2026-03']).toBe('done');
    expect(byPeriod['2026-04']).toBe('week'); // 20/05
    expect(byPeriod['2026-05']).toBe('later'); // 22/06
    expect(byPeriod['2025']).toBe('overdue'); // DEFIS 31/03/2026
    expect(items.map((i) => i.due)).toEqual([...items.map((i) => i.due)].sort());
  });

  it('não cobra períodos de antes do cadastro da empresa nem empresas em exclusão', () => {
    const items = buildAgenda({ clients: [client('a', 'MEI', null, '2026-04-10')], today: '2026-05-01', from: '2026-01-01', to: '2026-05-31' });
    expect(items.map((i) => `${i.code}|${i.period}`)).toEqual(['DAS_MEI|2026-04']);
    const gone = { ...client('b', 'MEI'), client: { id: 'b', regime: 'MEI' as const, createdAt: '2025-01-01', deletingAt: 'x' } };
    expect(buildAgenda({ clients: [gone], today: '2026-05-01', from: '2026-01-01', to: '2026-05-31' })).toEqual([]);
  });

  it('marcar e desmarcar como cumprido', () => {
    const base = emptyChecks('a', 'T');
    const marked = toggleDone(base, 'DAS|2026-04', '2026-05-10T00:00:00Z', '2023-01-01');
    expect(marked.done).toEqual([{ key: 'DAS|2026-04', doneAt: '2026-05-10T00:00:00Z' }]);
    expect(toggleDone(marked, 'DAS|2026-04', null, '2023-01-01').done).toEqual([]);
    // Marcações antigas são descartadas ao gravar.
    const old = { ...base, done: [{ key: 'DAS|2020-01', doneAt: '2020-02-10' }] };
    expect(toggleDone(old, 'DAS|2026-04', '2026-05-10', '2023-01-01').done.map((d) => d.key)).toEqual(['DAS|2026-04']);
  });
});
