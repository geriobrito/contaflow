import { manualDepreciationWarning } from '@/lib/fixed-assets';
import { loadMonthDepreciation, postMonthDepreciation } from '@/lib/services/fixed-asset-service';
import { loadMonthAppropriation, postMonthAppropriation } from '@/lib/services/prepaid-service';
import { loadMonthFinancing, postMonthFinancing } from '@/lib/services/financing-service';
import { loadMonthInvestment, postMonthInvestment } from '@/lib/services/investment-service';
import { loadMonthStock, postMonthStock } from '@/lib/services/stock-service';
import { loadMonthPayroll, postMonthPayroll } from '@/lib/services/payroll-service';

/**
 * Rotinas mensais geradas pelos cadastros (depreciação do imobilizado, apropriação das despesas
 * antecipadas, juros/reclassificação de empréstimos e financiamentos, rendimento das aplicações,
 * CMV pelo estoque final e provisão da folha de pagamento): o que falta lançar para fechar a
 * competência, e o lançamento de tudo de uma vez.
 */
export type RoutineKey = 'depreciation' | 'prepaid' | 'financing' | 'investment' | 'stock' | 'payroll';

/** Dado que só o contador informa (ex.: o saldo do extrato da aplicação): a tela onde informar. */
export interface RoutineInput {
  key: RoutineKey;
  label: string;
  href: string;
}

export interface MonthRoutines {
  /** O que impede fechar (uma frase por rotina pendente). */
  problems: string[];
  /** Avisos que não impedem (ex.: depreciação lançada à mão além da gerada). */
  warnings: string[];
  /** Alguma rotina já lançada precisa ser atualizada (e não criada). */
  updates: boolean;
  /** Rotinas que faltam lançar ou atualizar (as que o botão de lançar resolve). */
  pending: RoutineKey[];
  /** Dados a informar antes de lançar. */
  inputs: RoutineInput[];
}

type Status = { kind: string; existing?: unknown };
const needsUpdate = (s: Status | undefined) => Boolean(s && ((s.kind === 'PENDING' && s.existing) || s.kind === 'REMOVE'));
/** O botão de lançar resolve: falta lançar, atualizar ou excluir. */
const postable = (s: Status | undefined) => Boolean(s && (s.kind === 'PENDING' || s.kind === 'REMOVE' || s.kind === 'BLOCKED'));

/** Situação das rotinas da competência, ou null quando a empresa não tem nada cadastrado. */
export async function loadMonthRoutines(clientId: string, month: string): Promise<MonthRoutines | null> {
  const [dep, pre, fin, inv, stk, pay] = await Promise.all([
    loadMonthDepreciation(clientId, month),
    loadMonthAppropriation(clientId, month),
    loadMonthFinancing(clientId, month),
    loadMonthInvestment(clientId, month),
    loadMonthStock(clientId, month),
    loadMonthPayroll(clientId, month),
  ]);
  if (!dep && !pre && !fin && !inv && !stk && !pay) return null;
  const byKey: [RoutineKey, { closeProblem: string | null; status: Status } | null][] = [
    ['depreciation', dep],
    ['prepaid', pre],
    ['financing', fin],
    ['investment', inv],
    ['stock', stk],
    ['payroll', pay],
  ];
  const problems = byKey.map(([, r]) => r?.closeProblem).filter((p): p is string => Boolean(p));
  const warnings = [...(dep ? [manualDepreciationWarning(dep.status, month)].filter((w): w is string => Boolean(w)) : []), ...(stk?.warnings ?? [])];
  return {
    problems,
    warnings,
    updates: byKey.some(([, r]) => needsUpdate(r?.status)),
    pending: byKey.filter(([, r]) => r?.closeProblem && postable(r.status)).map(([k]) => k),
    inputs: [
      ...(inv?.status.kind === 'MISSING' ? [{ key: 'investment' as const, label: 'Informar o saldo da aplicação', href: `/aplicacoes?mes=${month}` }] : []),
      ...(stk?.status.kind === 'MISSING' ? [{ key: 'stock' as const, label: 'Informar o estoque final', href: `/estoque?mes=${month}` }] : []),
      ...(pay?.status.kind === 'MISSING' ? [{ key: 'payroll' as const, label: 'Informar a folha de pagamento', href: `/folha?mes=${month}` }] : []),
    ],
  };
}

const LABEL: Record<RoutineKey, string> = {
  depreciation: 'Depreciação',
  prepaid: 'Apropriação das despesas antecipadas',
  financing: 'Juros de empréstimos e financiamentos',
  investment: 'Rendimento das aplicações',
  stock: 'CMV',
  payroll: 'Folha de pagamento',
};

/** Lança (ou atualiza) as rotinas da competência; devolve o aviso do que foi feito, ou null. */
export async function postMonthRoutines(clientId: string, month: string, authorUid: string): Promise<string | null> {
  const results: [RoutineKey, string][] = [
    ['depreciation', await postMonthDepreciation(clientId, month, authorUid)],
    ['prepaid', await postMonthAppropriation(clientId, month, authorUid)],
    ['financing', await postMonthFinancing(clientId, month, authorUid)],
    ['investment', await postMonthInvestment(clientId, month, authorUid)],
    ['stock', await postMonthStock(clientId, month, authorUid)],
    ['payroll', await postMonthPayroll(clientId, month, authorUid)],
  ];
  const done = results.filter(([, r]) => r !== 'none').map(([k]) => k);
  if (!done.length) return null;
  if (done.length === 1) return `${LABEL[done[0]]} do mês lançad${done[0] === 'financing' ? 'os' : done[0] === 'investment' || done[0] === 'stock' ? 'o' : 'a'}`;
  return done.length === 2 && done.includes('depreciation') && done.includes('prepaid') ? 'Depreciação e apropriação do mês lançadas' : 'Rotinas do mês lançadas';
}

/** Para o fechamento da competência: o motivo de recusar, ou null. */
export async function routinesBlockClose(clientId: string, month: string): Promise<string | null> {
  return (await loadMonthRoutines(clientId, month))?.problems.join(' ') || null;
}
