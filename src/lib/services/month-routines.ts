import type { DataRepository } from '@/lib/data/repository';
import { getRepository } from '@/lib/services/data-service';
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
  /** O mesmo impedimento, por rotina (para sinalizar a aba de cada cadastro). */
  problemsByKey: Partial<Record<RoutineKey, string>>;
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

/**
 * Encapsula o repositório durante uma verificação única de `loadMonthRoutines`, reaproveitando
 * promessas idênticas de Diário, extrato e snapshots quando mais de uma rotina lê a competência.
 */
function sharedRoutineRepo(base: DataRepository): DataRepository {
  const journalByRange = new Map<string, ReturnType<DataRepository['listJournalEntries']>>();
  const txByRange = new Map<string, ReturnType<DataRepository['listTransactions']>>();
  const snapshotsByClient = new Map<string, ReturnType<DataRepository['listPeriodSnapshots']>>();
  const countsByKey = new Map<string, ReturnType<DataRepository['countTransactions']>>();

  return {
    ...base,
    listJournalEntries(clientId, range) {
      const fullKey = `${clientId}|0000-01-01|${range?.end ?? ''}`;
      if (range && range.start !== '0000-01-01' && journalByRange.has(fullKey)) {
        return journalByRange.get(fullKey)!.then((list) => list.filter((e) => e.date >= range.start && e.date <= range.end));
      }
      const key = `${clientId}|${range?.start ?? ''}|${range?.end ?? ''}`;
      let p = journalByRange.get(key);
      if (!p) {
        p = base.listJournalEntries(clientId, range);
        journalByRange.set(key, p);
      }
      return p;
    },
    listTransactions(clientId, range) {
      const key = `${clientId}|${range?.start ?? ''}|${range?.end ?? ''}`;
      let p = txByRange.get(key);
      if (!p) {
        p = base.listTransactions(clientId, range);
        txByRange.set(key, p);
      }
      return p;
    },
    listPeriodSnapshots(clientId) {
      let p = snapshotsByClient.get(clientId);
      if (!p) {
        p = base.listPeriodSnapshots(clientId);
        snapshotsByClient.set(clientId, p);
      }
      return p;
    },
    countTransactions(clientId, untilDate) {
      const key = `${clientId}|${untilDate ?? ''}`;
      let p = countsByKey.get(key);
      if (!p) {
        p = base.countTransactions(clientId, untilDate);
        countsByKey.set(key, p);
      }
      return p;
    },
  };
}

/** Situação das rotinas da competência, ou null quando a empresa não tem nada cadastrado. */
export async function loadMonthRoutines(clientId: string, month: string, baseRepo: DataRepository = getRepository()): Promise<MonthRoutines | null> {
  const repo = sharedRoutineRepo(baseRepo);
  const [dep, pre, fin, inv, stk, pay] = await Promise.all([
    loadMonthDepreciation(clientId, month, repo),
    loadMonthAppropriation(clientId, month, repo),
    loadMonthFinancing(clientId, month, repo),
    loadMonthInvestment(clientId, month, repo),
    loadMonthStock(clientId, month, repo),
    loadMonthPayroll(clientId, month, repo),
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
    problemsByKey: Object.fromEntries(byKey.flatMap(([k, r]) => (r?.closeProblem ? [[k, r.closeProblem]] : []))),
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
