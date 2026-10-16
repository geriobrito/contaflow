import type { BankAccount, BankTransaction, ClientCompany, ClientRequest, ImportBatch, PeriodLock } from '@/types/firestore';
import { accountStatuses, plural, summarizeQueries } from '@/lib/dashboard';
import { formatMonth, monthOf, monthsBetween } from '@/lib/periods';

/**
 * Visão da carteira no Painel: para cada empresa, o que falta fazer, com dados baratos de ler
 * (contagens no servidor, fechamentos, extratos importados, contas e perguntas ao cliente), sem
 * baixar os lançamentos. Função pura sobre dados já carregados.
 */

export interface PortfolioInput {
  client: ClientCompany;
  /** Lançamentos pendentes de classificação e auto-classificados aguardando aprovação. */
  pending: number;
  auto: number;
  /** Data do pendente e do auto-classificado mais antigos: o atalho abre a Conciliação nesse mês. */
  oldestPending?: string | null;
  oldestAuto?: string | null;
  locks: readonly PeriodLock[];
  batches: readonly ImportBatch[];
  banks: readonly BankAccount[];
  openQueries: readonly BankTransaction[];
  requests: readonly ClientRequest[];
  /** Hoje (YYYY-MM-DD) e em ms (validade dos links). */
  today: string;
  nowMs: number;
}

export type TaskSeverity = 'high' | 'medium' | 'low';

export interface PortfolioTask {
  id: string;
  label: string;
  severity: TaskSeverity;
  /** Tela onde se resolve, já com a empresa selecionada. */
  href: string;
}

export interface PortfolioRow {
  clientId: string;
  name: string;
  /** Competência que deveria estar fechada agora: o mês anterior ao de hoje. */
  focusMonth: string;
  /** Situação da competência de foco: fechada, aberta (com extrato) ou sem extrato. */
  focus: 'closed' | 'open' | 'no-data';
  /** Competências com extrato, até a de foco, ainda não fechadas. */
  openMonths: string[];
  tasks: PortfolioTask[];
  /** Nada urgente nem de atenção (só, no máximo, aguardando o cliente). */
  upToDate: boolean;
  /** Peso para ordenar a lista: mais trabalho primeiro. */
  weight: number;
}

const WEIGHT: Record<TaskSeverity, number> = { high: 100, medium: 10, low: 1 };

/** Competências cobertas pelos extratos importados (do início ao fim de cada um). */
function statementMonths(batches: readonly ImportBatch[]): Set<string> {
  const months = new Set<string>();
  for (const b of batches) {
    if ((b.status && b.status !== 'COMPLETED') || !b.startDate || !b.endDate) continue;
    for (const m of monthsBetween(monthOf(b.startDate), monthOf(b.endDate))) months.add(m);
  }
  return months;
}

/** "set/2026" a partir de "setembro de 2026". */
export const shortMonth = (month: string): string => {
  const [name, , year] = formatMonth(month).split(' ');
  return `${name.slice(0, 3)}/${year}`;
};

export function buildPortfolioRow(input: PortfolioInput): PortfolioRow {
  const { client, pending, auto, locks, batches, banks, openQueries, requests, today, nowMs } = input;
  const focusMonth = previousMonth(today.slice(0, 7));
  const locked = new Set(locks.map((l) => l.month));
  const covered = statementMonths(batches);
  const openMonths = [...covered].filter((m) => m <= focusMonth && !locked.has(m)).sort();
  const focus: PortfolioRow['focus'] = locked.has(focusMonth) ? 'closed' : covered.has(focusMonth) ? 'open' : 'no-data';

  const tasks: PortfolioTask[] = [];
  const add = (t: PortfolioTask) => tasks.push(t);

  const accounts = accountStatuses(banks, batches, today);
  const gaps = accounts.reduce((s, a) => s + a.gaps.length, 0);
  const mismatches = accounts.reduce((s, a) => s + a.mismatches.length, 0);
  const stale = accounts.filter((a) => a.missingSince && a.gaps.length === 0);

  if (batches.length === 0) add({ id: 'no-statements', label: 'Nenhum extrato importado', severity: 'medium', href: '/' });
  if (mismatches > 0) add({ id: 'mismatch', label: `${plural(mismatches, 'saldo divergente', 'saldos divergentes')}`, severity: 'high', href: '/contas' });
  if (gaps > 0) add({ id: 'gaps', label: `${plural(gaps, 'lacuna', 'lacunas')} nos extratos`, severity: 'high', href: '/contas' });
  if (stale.length > 0) {
    add({
      id: 'stale',
      label: stale.length === 1 ? `Extrato de ${stale[0].nickname} desatualizado` : `${stale.length} extratos desatualizados`,
      severity: 'medium',
      href: '/contas',
    });
  }
  // A Conciliação filtra a partir de um mês: o do mais antigo; sem a data, o primeiro mês aberto.
  const filtered = (filter: string, oldest: string | null | undefined) => {
    const month = oldest ? monthOf(oldest) : openMonths[0];
    return month ? `/?mes=${month}&filtro=${filter}` : '/';
  };
  if (pending > 0) add({ id: 'pending', label: plural(pending, 'pendente', 'pendentes'), severity: 'high', href: filtered('PENDING', input.oldestPending) });
  if (auto > 0) add({ id: 'auto', label: `${auto} para aprovar`, severity: 'medium', href: filtered('AUTO_CLASSIFIED', input.oldestAuto) });

  const queries = summarizeQueries(openQueries, requests, nowMs);
  if (queries.answered > 0) add({ id: 'answered', label: plural(queries.answered, 'resposta do cliente', 'respostas do cliente'), severity: 'medium', href: '/pendencias' });
  if (queries.notSent > 0) add({ id: 'not-sent', label: `${plural(queries.notSent, 'pergunta', 'perguntas')} sem link`, severity: 'medium', href: '/pendencias' });
  if (queries.waiting > 0) add({ id: 'waiting', label: `Aguardando cliente (${queries.waiting})`, severity: 'low', href: '/pendencias' });

  if (focus === 'open') add({ id: 'close-focus', label: `Fechar ${shortMonth(focusMonth)}`, severity: 'medium', href: `/?mes=${focusMonth}` });
  const earlier = openMonths.filter((m) => m < focusMonth);
  if (earlier.length > 0) {
    add({ id: 'open-months', label: `${plural(earlier.length, 'mês anterior aberto', 'meses anteriores abertos')}`, severity: 'medium', href: `/?mes=${earlier[0]}` });
  }

  const order: Record<TaskSeverity, number> = { high: 0, medium: 1, low: 2 };
  tasks.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    clientId: client.id,
    name: client.tradeName || client.name,
    focusMonth,
    focus,
    openMonths,
    tasks,
    upToDate: !tasks.some((t) => t.severity !== 'low'),
    weight: tasks.reduce((s, t) => s + WEIGHT[t.severity], 0),
  };
}

function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Linhas da carteira em ordem de trabalho: mais pendências primeiro; empate, pelo nome. */
export const sortPortfolio = (rows: readonly PortfolioRow[]): PortfolioRow[] =>
  [...rows].sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name, 'pt-BR'));
