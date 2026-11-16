import type { Dashboard, MonthStatus } from '@/lib/dashboard';
import { missingPayroll, plural, previousMonthOf } from '@/lib/dashboard';
import type { MonthRoutines, RoutineKey } from '@/lib/services/month-routines';
import { shortMonth } from '@/lib/portfolio';

/**
 * Rotina do mês no Painel da empresa: os passos do menu (Conciliação, Notas Fiscais, Pendências,
 * Folha, Bens e Contratos, Lançamentos Manuais) e o fechamento, com a situação de cada um na
 * competência em que se está trabalhando. Função pura sobre dados já carregados.
 */

/**
 * - `done`: feito;
 * - `todo`: falta fazer (impede ou atrasa o fechamento);
 * - `hint`: vale conferir, mas não impede;
 * - `na`: não se aplica a esta empresa ou ainda não é a vez do passo;
 * - `loading`: situação ainda sendo lida.
 */
export type StepStatus = 'done' | 'todo' | 'hint' | 'na' | 'loading';

export interface RoutineStep {
  key: 'reconciliation' | 'invoices' | 'queries' | 'payroll' | 'controls' | 'journal' | 'close';
  label: string;
  status: StepStatus;
  detail: string;
  /** Tela do passo, já na competência quando a tela aceita. */
  href: string;
}

export interface MonthStepsInput {
  month: string;
  /** Contagens do extrato na competência; null quando não há lançamento importado nela. */
  counts: Pick<MonthStatus, 'total' | 'pending' | 'auto'> | null;
  /** Notas da competência (fora as canceladas) e quantas sem lançamento vinculado; undefined enquanto carrega. */
  invoices: { total: number; unlinked: number } | undefined;
  /** Perguntas ao cliente em aberto (de qualquer competência). */
  queries: Dashboard['queries'];
  /** Competências com folha lançada. */
  payrollMonths?: readonly string[];
  /** Rotinas geradas pelos cadastros: undefined enquanto carrega, null sem nada cadastrado. */
  routines: MonthRoutines | null | undefined;
  /** Lançamentos manuais da competência e os do mês anterior ainda não repetidos; undefined enquanto carrega. */
  journal: { manual: number; repeatable: number } | undefined;
}

/** Tela de cada rotina de Bens e Contratos. */
const CONTROL_HREF: Partial<Record<RoutineKey, string>> = {
  depreciation: '/imobilizado',
  prepaid: '/despesas-antecipadas',
  financing: '/financiamentos',
  investment: '/aplicacoes',
  stock: '/estoque',
};
const CONTROL_KEYS = Object.keys(CONTROL_HREF) as RoutineKey[];

/**
 * Competências em que há trabalho: com extrato e ainda não fechadas, da mais antiga para a mais
 * recente, até a anterior à de hoje (a corrente ainda está acontecendo). Sem nenhuma, a corrente
 * entra se já tiver extrato.
 */
export function workingMonths(months: readonly MonthStatus[], today: string): string[] {
  const current = today.slice(0, 7);
  const open = months.filter((m) => m.state === 'OPEN' || m.state === 'READY').map((m) => m.month);
  const due = open.filter((m) => m < current);
  return due.length ? due : open.filter((m) => m === current);
}

export function monthRoutineSteps(input: MonthStepsInput): RoutineStep[] {
  const { month, counts, invoices, queries, payrollMonths, routines, journal } = input;
  const q = `?mes=${month}`;
  const steps: RoutineStep[] = [];

  /* 1. Conciliação */
  if (!counts || counts.total === 0) {
    steps.push({ key: 'reconciliation', label: 'Conciliação', status: 'todo', detail: 'Extrato do mês ainda não importado', href: `/${q}` });
  } else if (counts.pending > 0) {
    const auto = counts.auto > 0 ? ` · ${counts.auto} para aprovar` : '';
    steps.push({ key: 'reconciliation', label: 'Conciliação', status: 'todo', detail: `${plural(counts.pending, 'lançamento pendente', 'lançamentos pendentes')}${auto}`, href: `/${q}&filtro=PENDING` });
  } else if (counts.auto > 0) {
    steps.push({ key: 'reconciliation', label: 'Conciliação', status: 'todo', detail: `${counts.auto} auto-classificado(s) para aprovar`, href: `/${q}&filtro=AUTO_CLASSIFIED` });
  } else {
    steps.push({ key: 'reconciliation', label: 'Conciliação', status: 'done', detail: `${plural(counts.total, 'lançamento conciliado', 'lançamentos conciliados')}`, href: `/${q}` });
  }

  /* 2. Notas fiscais: informativo, não impede o fechamento */
  steps.push(
    !invoices
      ? { key: 'invoices', label: 'Notas Fiscais', status: 'loading', detail: 'Conferindo…', href: '/nfe' }
      : invoices.total === 0
        ? { key: 'invoices', label: 'Notas Fiscais', status: 'hint', detail: 'Nenhuma nota do mês importada', href: '/nfe' }
        : invoices.unlinked > 0
          ? { key: 'invoices', label: 'Notas Fiscais', status: 'hint', detail: `${plural(invoices.total, 'nota', 'notas')} · ${invoices.unlinked} sem lançamento vinculado`, href: '/nfe' }
          : { key: 'invoices', label: 'Notas Fiscais', status: 'done', detail: `${plural(invoices.total, 'nota vinculada', 'notas vinculadas')} a lançamentos`, href: '/nfe' }
  );

  /* 3. Pendências do cliente */
  const open = queries.answered + queries.notSent + queries.waiting;
  steps.push(
    queries.answered > 0
      ? { key: 'queries', label: 'Pendências do Cliente', status: 'todo', detail: `${plural(queries.answered, 'resposta', 'respostas')} do cliente para classificar`, href: '/pendencias' }
      : queries.notSent > 0
        ? { key: 'queries', label: 'Pendências do Cliente', status: 'todo', detail: `${plural(queries.notSent, 'pergunta', 'perguntas')} ainda sem link enviado`, href: '/pendencias' }
        : queries.waiting > 0
          ? { key: 'queries', label: 'Pendências do Cliente', status: 'hint', detail: `Aguardando o cliente em ${plural(queries.waiting, 'pergunta', 'perguntas')}`, href: '/pendencias' }
          : { key: 'queries', label: 'Pendências do Cliente', status: open === 0 ? 'done' : 'na', detail: 'Nenhuma pergunta em aberto', href: '/pendencias' }
  );

  /* 4. Folha de pagamento */
  const payrollHref = `/folha${q}`;
  const payrollProblem = routines?.problemsByKey.payroll;
  const missing = missingPayroll(payrollMonths, month, false);
  steps.push(
    payrollProblem
      ? { key: 'payroll', label: 'Folha de Pagamento', status: 'todo', detail: payrollProblem, href: payrollHref }
      : payrollMonths?.includes(month)
        ? { key: 'payroll', label: 'Folha de Pagamento', status: 'done', detail: 'Folha do mês lançada', href: payrollHref }
        : missing
          ? { key: 'payroll', label: 'Folha de Pagamento', status: 'todo', detail: `Folha não lançada (a última foi a de ${shortMonth(missing)})`, href: payrollHref }
          : { key: 'payroll', label: 'Folha de Pagamento', status: 'na', detail: 'Sem folha recente nesta empresa', href: payrollHref }
  );

  /* 5. Bens e contratos */
  if (routines === undefined) {
    steps.push({ key: 'controls', label: 'Bens e Contratos', status: 'loading', detail: 'Conferindo…', href: `/imobilizado${q}` });
  } else {
    const pending = CONTROL_KEYS.filter((k) => routines?.problemsByKey[k] || routines?.inputs.some((i) => i.key === k));
    const hasControls = routines !== null;
    steps.push(
      pending.length > 0
        ? {
            key: 'controls',
            label: 'Bens e Contratos',
            status: 'todo',
            detail: routines?.problemsByKey[pending[0]] ?? routines?.inputs.find((i) => i.key === pending[0])?.label ?? '',
            href: `${CONTROL_HREF[pending[0]]}${q}`,
          }
        : hasControls
          ? { key: 'controls', label: 'Bens e Contratos', status: 'done', detail: 'Rotinas do mês lançadas', href: `/imobilizado${q}` }
          : { key: 'controls', label: 'Bens e Contratos', status: 'na', detail: 'Nenhum bem ou contrato cadastrado', href: `/imobilizado${q}` }
    );
    if (pending.length > 1) steps[steps.length - 1].detail += ` (+ ${pending.length - 1} rotina(s))`;
  }

  /* 6. Lançamentos manuais: o que se repete todo mês é sugerido, não exigido */
  steps.push(
    !journal
      ? { key: 'journal', label: 'Lançamentos Manuais', status: 'loading', detail: 'Conferindo…', href: '/lancamentos' }
      : journal.repeatable > 0
        ? { key: 'journal', label: 'Lançamentos Manuais', status: 'hint', detail: `${plural(journal.repeatable, 'lançamento', 'lançamentos')} de ${shortMonth(previousMonthOf(month))} a repetir`, href: '/lancamentos' }
        : journal.manual > 0
          ? { key: 'journal', label: 'Lançamentos Manuais', status: 'done', detail: plural(journal.manual, 'lançamento manual no mês', 'lançamentos manuais no mês'), href: '/lancamentos' }
          : { key: 'journal', label: 'Lançamentos Manuais', status: 'na', detail: 'Nenhum lançamento manual no mês', href: '/lancamentos' }
  );

  /* Fechamento: só depois do que falta */
  const todo = steps.filter((s) => s.status === 'todo').length;
  const loading = steps.some((s) => s.status === 'loading');
  steps.push(
    todo > 0
      ? { key: 'close', label: 'Fechar a competência', status: 'na', detail: `Depois de ${plural(todo, 'passo pendente', 'passos pendentes')}`, href: `/${q}` }
      : loading
        ? { key: 'close', label: 'Fechar a competência', status: 'loading', detail: 'Conferindo…', href: `/${q}` }
        : { key: 'close', label: 'Fechar a competência', status: 'todo', detail: 'Tudo pronto: feche o mês na Conciliação', href: `/${q}` }
  );
  return steps;
}

/** O passo em que se está: o primeiro que falta fazer. */
export const nextStep = (steps: readonly RoutineStep[]): RoutineStep | null => steps.find((s) => s.status === 'todo') ?? null;
