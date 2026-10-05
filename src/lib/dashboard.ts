import type {
  BankAccount,
  BankTransaction,
  ChartAccount,
  ClientCompany,
  ClientRequest,
  ImportBatch,
  OpeningBalances,
  OrgSettings,
  PeriodLock,
} from '@/types/firestore';
import { addDays, findCoverageGaps, type CoverageGap } from '@/lib/statement';
import { formatMonth, monthOf, monthsBetween } from '@/lib/periods';
import { summarizeOpening } from '@/lib/opening';
import { formatDateBR } from '@/lib/utils/formatters';

/**
 * Painel do cliente: o que falta fazer, mês a mês, extratos, perguntas ao cliente e cadastros.
 * Função pura sobre dados já carregados.
 */

export interface DashboardInput {
  client: ClientCompany;
  accounts: readonly ChartAccount[];
  transactions: readonly BankTransaction[];
  batches: readonly ImportBatch[];
  banks: readonly BankAccount[];
  locks: readonly PeriodLock[];
  requests: readonly ClientRequest[];
  org: OrgSettings | null;
  openings: OpeningBalances | null;
  /** Hoje (YYYY-MM-DD) e em ms (validade dos links). */
  today: string;
  nowMs: number;
}

export type MonthState = 'LOCKED' | 'READY' | 'OPEN' | 'EMPTY';

export interface MonthStatus {
  month: string;
  total: number;
  pending: number;
  /** Auto-classificados aguardando aprovação. */
  auto: number;
  reconciled: number;
  state: MonthState;
}

export interface AccountStatus {
  accountKey: string;
  nickname: string;
  lastEnd?: string;
  lastLedgerBalance?: number;
  gaps: CoverageGap[];
  mismatches: ImportBatch[];
  /** Faltam extratos desde esta data até o fim do mês passado. */
  missingSince?: string;
}

export type Severity = 'high' | 'medium' | 'low';

export interface Alert {
  id: string;
  severity: Severity;
  title: string;
  detail?: string;
  href: string;
}

export interface Dashboard {
  months: MonthStatus[];
  accounts: AccountStatus[];
  totals: {
    pending: number;
    auto: number;
    reconciled: number;
    transactions: number;
    monthsWithData: number;
    monthsLocked: number;
    monthsReady: number;
    monthsOpen: number;
  };
  queries: { notSent: number; waiting: number; answered: number };
  alerts: Alert[];
  /** Tudo em dia: sem alertas altos ou médios. */
  allClear: boolean;
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

const lastDayOfPrevMonth = (today: string): string => addDays(`${today.slice(0, 7)}-01`, -1);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function buildDashboard(input: DashboardInput): Dashboard {
  const { client, accounts, transactions, batches, banks, locks, requests, org, openings, today, nowMs } = input;
  const alerts: Alert[] = [];
  const add = (a: Alert) => alerts.push(a);

  /* ── Meses ─────────────────────────────────────────────────────────── */
  const lockedMonths = new Set(locks.map((l) => l.month));
  const byMonth = new Map<string, { total: number; pending: number; auto: number; reconciled: number }>();
  for (const t of transactions) {
    const m = monthOf(t.date);
    const c = byMonth.get(m) ?? { total: 0, pending: 0, auto: 0, reconciled: 0 };
    c.total++;
    if (t.status === 'PENDING') c.pending++;
    else if (t.status === 'AUTO_CLASSIFIED') c.auto++;
    else c.reconciled++;
    byMonth.set(m, c);
  }
  const monthKeys = [...byMonth.keys()].sort();
  const months: MonthStatus[] = monthKeys.length
    ? monthsBetween(monthKeys[0], monthKeys[monthKeys.length - 1]).map((month) => {
        const c = byMonth.get(month) ?? { total: 0, pending: 0, auto: 0, reconciled: 0 };
        const state: MonthState = lockedMonths.has(month) ? 'LOCKED' : c.total === 0 ? 'EMPTY' : c.pending + c.auto === 0 ? 'READY' : 'OPEN';
        return { month, ...c, state };
      })
    : [];

  const totals = {
    pending: months.reduce((s, m) => s + m.pending, 0),
    auto: months.reduce((s, m) => s + m.auto, 0),
    reconciled: months.reduce((s, m) => s + m.reconciled, 0),
    transactions: transactions.length,
    /** Meses com lançamentos (ou fechados): base do "fechados/total". */
    monthsWithData: months.filter((m) => m.state !== 'EMPTY').length,
    monthsLocked: months.filter((m) => m.state === 'LOCKED').length,
    monthsReady: months.filter((m) => m.state === 'READY').length,
    monthsOpen: months.filter((m) => m.state === 'OPEN').length,
  };

  /* ── Extratos por conta ────────────────────────────────────────────── */
  const keys = new Set([...banks.map((b) => b.accountKey), ...batches.map((b) => b.accountKey).filter((k): k is string => Boolean(k))]);
  const prevMonthEnd = lastDayOfPrevMonth(today);
  const accountStatus: AccountStatus[] = [...keys].sort().map((accountKey) => {
    const own = batches.filter((b) => b.accountKey === accountKey);
    const lastEnd = own.map((b) => b.endDate).filter((d): d is string => Boolean(d)).sort().pop();
    const lastWithBalance = [...own].filter((b) => b.ledgerBalance !== undefined).sort((a, b) => (b.ledgerDate ?? '').localeCompare(a.ledgerDate ?? ''))[0];
    return {
      accountKey,
      nickname: banks.find((b) => b.accountKey === accountKey)?.nickname ?? accountKey,
      lastEnd,
      lastLedgerBalance: lastWithBalance?.ledgerBalance,
      gaps: findCoverageGaps(own),
      mismatches: own.filter((b) => b.balanceCheck?.status === 'MISMATCH'),
      missingSince: lastEnd && lastEnd < prevMonthEnd ? addDays(lastEnd, 1) : undefined,
    };
  });

  /* ── Perguntas ao cliente ──────────────────────────────────────────── */
  const asked = transactions.filter((t) => t.clientQuery?.status === 'OPEN');
  const inOpenLink = new Set(requests.filter((r) => r.status === 'OPEN' && r.expiresAtMs > nowMs).flatMap((r) => r.items.map((i) => i.transactionId)));
  const answeredIds = new Set(requests.flatMap((r) => r.items.filter((i) => i.answer || i.files?.length).map((i) => i.transactionId)));
  const queries = { notSent: 0, waiting: 0, answered: 0 };
  for (const t of asked) {
    if (answeredIds.has(t.id)) queries.answered++;
    else if (inOpenLink.has(t.id)) queries.waiting++;
    else queries.notSent++;
  }

  /* ── Alertas ───────────────────────────────────────────────────────── */
  if (accounts.length === 0) {
    add({ id: 'chart', severity: 'high', title: 'Plano de contas vazio', detail: 'Aplique o modelo ITG 1000 para poder classificar lançamentos.', href: '/plano-de-contas' });
  }
  if (transactions.length === 0) {
    add({ id: 'first-import', severity: 'medium', title: 'Nenhum extrato importado', detail: 'Importe o OFX do banco na Conciliação para começar.', href: '/' });
  }

  const mismatchCount = accountStatus.reduce((s, a) => s + a.mismatches.length, 0);
  if (mismatchCount > 0) {
    add({
      id: 'mismatch',
      severity: 'high',
      title: `Divergência de saldo em ${plural(mismatchCount, 'extrato', 'extratos')}`,
      detail: accountStatus.some((a) => a.mismatches.length > 0 && a.gaps.length > 0)
        ? 'O saldo do banco não confere com o extrato anterior mais a movimentação; em parte, por causa dos extratos que faltam.'
        : 'O saldo informado pelo banco não confere com o extrato anterior mais a movimentação.',
      href: '/contas',
    });
  }
  for (const a of accountStatus) {
    for (const g of a.gaps) {
      add({
        id: `gap-${a.accountKey}-${g.from}`,
        severity: 'high',
        title: `Faltam extratos de ${formatDateBR(g.from)} a ${formatDateBR(g.to)}`,
        detail: a.nickname,
        href: '/',
      });
    }
    if (a.missingSince && a.gaps.length === 0) {
      add({
        id: `stale-${a.accountKey}`,
        severity: 'medium',
        title: `Extrato desatualizado desde ${formatDateBR(a.missingSince)}`,
        detail: `${a.nickname}: o último extrato termina em ${formatDateBR(a.lastEnd)}.`,
        href: '/',
      });
    }
  }

  const oldestPending = months.find((m) => m.pending > 0 && m.state !== 'LOCKED');
  if (totals.pending > 0) {
    const pendingMonths = months.filter((m) => m.pending > 0).length;
    add({
      id: 'pending',
      severity: 'high',
      title: `${plural(totals.pending, 'lançamento pendente', 'lançamentos pendentes')} de classificação`,
      detail: `Em ${plural(pendingMonths, 'mês', 'meses')}. Comece por ${formatMonth(oldestPending?.month ?? months.find((m) => m.pending > 0)!.month)}.`,
      href: `/?mes=${(oldestPending ?? months.find((m) => m.pending > 0)!).month}&filtro=PENDING`,
    });
  }
  if (totals.auto > 0) {
    const m = months.find((x) => x.auto > 0 && x.state !== 'LOCKED');
    add({
      id: 'auto',
      severity: 'medium',
      title: `${plural(totals.auto, 'lançamento auto-classificado aguarda', 'lançamentos auto-classificados aguardam')} aprovação`,
      detail: 'Eles ainda não entram na DRE.',
      href: m ? `/?mes=${m.month}&filtro=AUTO_CLASSIFIED` : '/',
    });
  }

  if (queries.answered > 0) {
    add({ id: 'answered', severity: 'medium', title: `${plural(queries.answered, 'resposta do cliente', 'respostas do cliente')} para classificar`, href: '/pendencias' });
  }
  if (queries.notSent > 0) {
    add({ id: 'not-sent', severity: 'medium', title: `${plural(queries.notSent, 'pergunta', 'perguntas')} ao cliente ainda sem link`, detail: 'Gere o link em Pendências do cliente.', href: '/pendencias' });
  }
  if (queries.waiting > 0) {
    add({ id: 'waiting', severity: 'low', title: `Aguardando o cliente: ${plural(queries.waiting, 'pergunta', 'perguntas')}`, href: '/pendencias' });
  }

  const ready = months.filter((m) => m.state === 'READY' && m.month < today.slice(0, 7));
  if (ready.length > 0) {
    add({
      id: 'ready',
      severity: 'low',
      title: `${plural(ready.length, 'mês pronto', 'meses prontos')} para fechar`,
      detail: `${ready.map((m) => formatMonth(m.month)).slice(0, 3).join(', ')}${ready.length > 3 ? '…' : ''}: tudo conciliado e aberto.`,
      href: `/?mes=${ready[0].month}`,
    });
  }

  /* ── Cadastros ─────────────────────────────────────────────────────── */
  const unlinked = banks.filter((b) => !b.ledgerAccountId);
  if (unlinked.length > 0) {
    add({ id: 'bank-link', severity: 'medium', title: `${plural(unlinked.length, 'conta bancária', 'contas bancárias')} sem conta contábil`, detail: 'O balanço mostra esses saldos como “Bancos sem vínculo”.', href: '/contas' });
  }
  const noOpening = banks.filter((b) => b.openingBalance === undefined);
  if (noOpening.length > 0) {
    add({ id: 'bank-opening', severity: 'medium', title: `${plural(noOpening.length, 'conta bancária', 'contas bancárias')} sem saldo inicial`, detail: noOpening.map((b) => b.nickname).join(', '), href: '/contas' });
  }
  if (banks.length > 0 || openings) {
    const sum = summarizeOpening(openings?.entries ?? [], accounts, banks);
    if (!openings) {
      add({ id: 'opening-none', severity: 'medium', title: 'Saldos de abertura não informados', detail: 'Sem eles o balanço patrimonial só tem os bancos.', href: '/abertura' });
    } else if (!sum.balanced) {
      add({ id: 'opening-gap', severity: 'medium', title: 'Os saldos de abertura não fecham', detail: `Faltam ${Math.abs(sum.difference).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} para ativo = passivo + patrimônio líquido.`, href: '/abertura' });
    }
  }
  if (!org?.accountantName || !org?.accountantCrc) {
    add({ id: 'office', severity: 'low', title: 'Contador responsável não cadastrado', detail: 'A DRE exportada sai sem a assinatura do profissional.', href: '/escritorio' });
  }
  if (!client.legalRepresentativeName || !client.legalRepresentativeCpf) {
    add({ id: 'representative', severity: 'low', title: 'Representante legal da empresa não cadastrado', detail: 'Nome e CPF assinam a DRE exportada.', href: '/clientes' });
  }

  alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return {
    months,
    accounts: accountStatus,
    totals,
    queries,
    alerts,
    allClear: !alerts.some((a) => a.severity !== 'low'),
  };
}
