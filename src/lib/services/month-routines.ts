import { manualDepreciationWarning } from '@/lib/fixed-assets';
import { loadMonthDepreciation, postMonthDepreciation } from '@/lib/services/fixed-asset-service';
import { loadMonthAppropriation, postMonthAppropriation } from '@/lib/services/prepaid-service';
import { loadMonthFinancing, postMonthFinancing } from '@/lib/services/financing-service';

/**
 * Rotinas mensais geradas pelos cadastros (depreciação do imobilizado, apropriação das despesas
 * antecipadas e juros/reclassificação de empréstimos e financiamentos): o que falta lançar para
 * fechar a competência, e o lançamento de tudo de uma vez.
 */
export type RoutineKey = 'depreciation' | 'prepaid' | 'financing';

export interface MonthRoutines {
  /** O que impede fechar (uma frase por rotina pendente). */
  problems: string[];
  /** Avisos que não impedem (ex.: depreciação lançada à mão além da gerada). */
  warnings: string[];
  /** Alguma rotina já lançada precisa ser atualizada (e não criada). */
  updates: boolean;
  /** Rotinas que faltam lançar ou atualizar. */
  pending: RoutineKey[];
}

type Status = { kind: string; existing?: unknown };
const needsUpdate = (s: Status | undefined) => Boolean(s && ((s.kind === 'PENDING' && s.existing) || s.kind === 'REMOVE'));

/** Situação das rotinas da competência, ou null quando a empresa não tem nada cadastrado. */
export async function loadMonthRoutines(clientId: string, month: string): Promise<MonthRoutines | null> {
  const [dep, pre, fin] = await Promise.all([loadMonthDepreciation(clientId, month), loadMonthAppropriation(clientId, month), loadMonthFinancing(clientId, month)]);
  if (!dep && !pre && !fin) return null;
  const byKey: [RoutineKey, { closeProblem: string | null; status: Status } | null][] = [
    ['depreciation', dep],
    ['prepaid', pre],
    ['financing', fin],
  ];
  const problems = byKey.map(([, r]) => r?.closeProblem).filter((p): p is string => Boolean(p));
  const warnings = dep ? [manualDepreciationWarning(dep.status, month)].filter((w): w is string => Boolean(w)) : [];
  return {
    problems,
    warnings,
    updates: byKey.some(([, r]) => needsUpdate(r?.status)),
    pending: byKey.filter(([, r]) => r?.closeProblem).map(([k]) => k),
  };
}

const LABEL: Record<RoutineKey, string> = {
  depreciation: 'Depreciação',
  prepaid: 'Apropriação das despesas antecipadas',
  financing: 'Juros de empréstimos e financiamentos',
};

/** Lança (ou atualiza) as rotinas da competência; devolve o aviso do que foi feito, ou null. */
export async function postMonthRoutines(clientId: string, month: string, authorUid: string): Promise<string | null> {
  const results: [RoutineKey, string][] = [
    ['depreciation', await postMonthDepreciation(clientId, month, authorUid)],
    ['prepaid', await postMonthAppropriation(clientId, month, authorUid)],
    ['financing', await postMonthFinancing(clientId, month, authorUid)],
  ];
  const done = results.filter(([, r]) => r !== 'none').map(([k]) => k);
  if (!done.length) return null;
  if (done.length === 1) return `${LABEL[done[0]]} do mês lançad${done[0] === 'financing' ? 'os' : 'a'}`;
  return done.length === 2 && done.includes('depreciation') && done.includes('prepaid') ? 'Depreciação e apropriação do mês lançadas' : 'Rotinas do mês lançadas';
}

/** Para o fechamento da competência: o motivo de recusar, ou null. */
export async function routinesBlockClose(clientId: string, month: string): Promise<string | null> {
  return (await loadMonthRoutines(clientId, month))?.problems.join(' ') || null;
}
