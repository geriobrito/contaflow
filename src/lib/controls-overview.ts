import type { FinancingContract, FixedAsset, InvestmentAccount, PrepaidExpense, StockControl } from '@/types/firestore';
import { assetPositionAt, depreciationSchedule, lastDayOf, nextMonth, postedQuotaCents } from '@/lib/fixed-assets';
import { postedPrepaidCents, prepaidBalanceAt, prepaidEndDate, PREPAID_KIND_LABEL } from '@/lib/prepaid-expenses';
import { contractPositionAt, FINANCING_KIND_LABEL, installmentSchedule, routineRows } from '@/lib/financing';
import { isActiveIn } from '@/lib/investments';
import { countDue } from '@/lib/stock';
import { toCents } from '@/lib/money';

/**
 * Resumo de Bens e Contratos: a posição e a rotina do mês dos cinco controles numa tela só, e a
 * agenda do que vence nos próximos meses (parcelas, fim de vigência, fim da depreciação). Sai só
 * dos cadastros (um documento por controle), sem ler lançamentos.
 */

export type ControlKey = 'depreciation' | 'prepaid' | 'financing' | 'investment' | 'stock';

export interface ControlsRegisters {
  assets: readonly FixedAsset[];
  prepaid: readonly PrepaidExpense[];
  contracts: readonly FinancingContract[];
  investments: readonly InvestmentAccount[];
  stock: StockControl | null;
  /** Competência da implantação: o que é anterior está nos saldos de abertura. */
  implantationMonth: string | null;
}

export interface ControlFigure {
  label: string;
  /** Centavos; null quando o dado ainda não foi informado (saldo da aplicação, estoque final). */
  cents: number | null;
}

export interface ControlSummary {
  key: ControlKey;
  /** Itens cadastrados, ativos ou não. Zero: controle sem uso nesta empresa. */
  registered: number;
  /** Itens com saldo na competência (bens em uso, apólices vigentes, contratos em aberto…). */
  active: number;
  /** Como chamar os itens ativos ("bem(ns) em uso"). */
  activeLabel: string;
  /** Saldo no fim da competência. */
  position: ControlFigure;
  /** O que a rotina do mês leva ao resultado (ou, no estoque e na aplicação, o dado do mês). */
  monthly: ControlFigure;
  /** Informação a mais do mês (ex.: parcelas que vencem). */
  extra?: ControlFigure;
}

const sum = (values: readonly number[]): number => values.reduce((s, v) => s + v, 0);

/** Posição e rotina de cada controle na competência (YYYY-MM), na ordem das abas. */
export function controlsSummary(reg: ControlsRegisters, month: string): ControlSummary[] {
  const imp = reg.implantationMonth;

  const positions = reg.assets.map((a) => assetPositionAt(a, month, imp));
  const depreciation: ControlSummary = {
    key: 'depreciation',
    registered: reg.assets.length,
    active: positions.filter((p) => p.costCents > 0).length,
    activeLabel: 'bem(ns) em uso',
    position: { label: 'Valor líquido', cents: sum(positions.filter((p) => p.costCents > 0).map((p) => p.netCents)) },
    monthly: { label: 'Depreciação do mês', cents: sum(reg.assets.map((a) => postedQuotaCents(a, month, imp))) },
  };

  const balances = reg.prepaid.map((p) => prepaidBalanceAt(p, month, imp));
  const prepaid: ControlSummary = {
    key: 'prepaid',
    registered: reg.prepaid.length,
    active: balances.filter((b) => b > 0).length,
    activeLabel: 'despesa(s) a apropriar',
    position: { label: 'Saldo a apropriar', cents: sum(balances) },
    monthly: { label: 'Apropriação do mês', cents: sum(reg.prepaid.map((p) => postedPrepaidCents(p, month, imp))) },
  };

  const debts = reg.contracts.map((c) => contractPositionAt(c, month).balance);
  const due = reg.contracts.flatMap((c) => installmentSchedule(c).filter((r) => r.dueDate.startsWith(month)));
  const financing: ControlSummary = {
    key: 'financing',
    registered: reg.contracts.length,
    active: debts.filter((b) => b > 0).length,
    activeLabel: 'contrato(s) em aberto',
    position: { label: 'Saldo devedor', cents: sum(debts) },
    monthly: {
      label: 'Juros do mês',
      cents: sum(reg.contracts.flatMap((c) => routineRows(c, imp).filter((r) => r.month === month && r.kind === 'interest').map((r) => r.interest))),
    },
    extra: { label: `${due.length} parcela(s) no mês`, cents: sum(due.map((r) => r.payment)) },
  };

  const activeInv = reg.investments.filter((a) => isActiveIn(a, month));
  const informed = activeInv.filter((a) => a.balances[month] !== undefined);
  const investment: ControlSummary = {
    key: 'investment',
    registered: reg.investments.length,
    active: activeInv.length,
    activeLabel: 'aplicação(ões) ativa(s)',
    // Só fecha o total quando todas as aplicações têm o saldo do extrato do mês.
    position: { label: 'Saldo do extrato', cents: activeInv.length && informed.length === activeInv.length ? sum(informed.map((a) => toCents(a.balances[month]))) : null },
    monthly: { label: activeInv.length ? `${informed.length} de ${activeInv.length} saldo(s) informado(s)` : 'Nenhuma aplicação ativa', cents: null },
  };

  const controlled = Boolean(reg.stock && reg.stock.startMonth <= month);
  const count = controlled ? reg.stock?.counts[month] : undefined;
  const stock: ControlSummary = {
    key: 'stock',
    registered: reg.stock ? 1 : 0,
    active: controlled ? 1 : 0,
    activeLabel: 'controle de estoque',
    position: { label: 'Estoque final', cents: count === undefined ? null : toCents(count) },
    monthly: {
      label: !controlled ? 'Fora do período controlado' : count !== undefined ? 'Estoque do mês informado' : reg.stock && countDue(reg.stock, month) ? 'Falta o estoque final do mês' : 'Mês sem contagem prevista',
      cents: null,
    },
  };

  return [depreciation, prepaid, financing, investment, stock];
}

export type ControlEventKind = 'installment' | 'last-installment' | 'prepaid-end' | 'depreciation-end';

export interface ControlEvent {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  kind: ControlEventKind;
  control: ControlKey;
  title: string;
  detail: string;
  /** Centavos, quando o evento tem valor (parcela). */
  cents?: number;
  /** Pede decisão do contador ou do cliente (renovar a apólice, conferir a quitação). */
  attention: boolean;
}

/** Último mês (YYYY-MM) da janela de `months` competências que começa em `month`. */
export function horizonEnd(month: string, months: number): string {
  let m = month;
  for (let i = 1; i < months; i++) m = nextMonth(m);
  return m;
}

/**
 * O que vence da competência `month` até `untilMonth` (inclusive), em ordem de data: parcelas de
 * empréstimos e financiamentos (a última marca a quitação), fim da vigência de seguros e despesas
 * antecipadas (renovar?) e bens que terminam de depreciar.
 */
export function upcomingEvents(reg: ControlsRegisters, month: string, untilMonth: string): ControlEvent[] {
  const start = `${month}-01`;
  const end = lastDayOf(untilMonth);
  const within = (date: string) => date >= start && date <= end;
  const events: ControlEvent[] = [];

  for (const c of reg.contracts) {
    const rows = installmentSchedule(c);
    const name = c.description || FINANCING_KIND_LABEL[c.kind];
    for (const r of rows) {
      if (!within(r.dueDate)) continue;
      const last = r.n === rows.length;
      events.push({
        id: `fin-${c.id}-${r.n}`,
        date: r.dueDate,
        kind: last ? 'last-installment' : 'installment',
        control: 'financing',
        title: last ? `Última parcela: ${name}` : `Parcela ${r.n}/${rows.length}: ${name}`,
        detail: [c.lender, c.interestMode === 'FLOATING' ? 'parcela-base, sem os juros pós-fixados' : null, last ? 'contrato quitado depois dela' : null].filter(Boolean).join(' · '),
        cents: r.payment,
        attention: last,
      });
    }
  }

  for (const p of reg.prepaid) {
    const date = prepaidEndDate(p);
    if (!within(date)) continue;
    events.push({
      id: `pre-${p.id}`,
      date,
      kind: 'prepaid-end',
      control: 'prepaid',
      title: `Fim da vigência: ${p.description || PREPAID_KIND_LABEL[p.kind]}`,
      detail: [p.documentRef ? `apólice/contrato ${p.documentRef}` : null, p.kind === 'INSURANCE' ? 'confirme a renovação com o cliente' : 'última apropriação'].filter(Boolean).join(' · '),
      attention: true,
    });
  }

  for (const a of reg.assets) {
    if (a.disposal) continue;
    const rows = depreciationSchedule(a, reg.implantationMonth);
    const lastRow = rows[rows.length - 1];
    if (!lastRow || lastRow.month < month || lastRow.month > untilMonth) continue;
    events.push({
      id: `dep-${a.id}`,
      date: lastDayOf(lastRow.month),
      kind: 'depreciation-end',
      control: 'depreciation',
      title: `Última cota de depreciação: ${a.description}`,
      detail: 'o bem fica totalmente depreciado; segue no cadastro até a baixa',
      attention: false,
    });
  }

  return events.sort((x, y) => x.date.localeCompare(y.date) || x.title.localeCompare(y.title, 'pt-BR'));
}
