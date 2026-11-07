import type { ChartAccount, JournalEntry } from '@/types/firestore';
import { OPENING_ACCOUNT_CODE, accountKind, type Posting } from '@/lib/ledger';
import { DISTRIBUTED_PROFITS_CODE, PRIOR_ADJUSTMENTS_CODE, yearStartOf } from '@/lib/year-closing';
import { fromCents, toCents } from '@/lib/money';
import { formatDateBR } from '@/lib/utils/formatters';

/**
 * Demonstração das Mutações do Patrimônio Líquido (DMPL — NBC TG 1001, seção 6; NBC TG 1000).
 *
 * Apresenta em forma matricial a movimentação de todos os grupos do Patrimônio Líquido (2.3) no
 * exercício: Capital Social (2.3.1), Reservas de Capital (2.3.2.01), Reservas de Lucros
 * (2.3.2.02), eventuais outros subgrupos do PL (ex.: Quotas/Ações em Tesouraria) e Lucros ou
 * Prejuízos Acumulados (2.3.3, mais o resultado não encerrado).
 *
 * O Lucro ou Prejuízo Líquido do exercício entra na coluna de Lucros ou Prejuízos Acumulados e
 * as linhas seguintes evidenciam as destinações (constituição de reservas e distribuição de
 * lucros/dividendos), bem como mutações de capital (integralização em dinheiro/bens ou
 * incorporação de reservas/lucros). O saldo final de cada coluna e o Total batem com o Balanço
 * Patrimonial na data final, tanto antes quanto depois do encerramento formal do exercício.
 */

export type DMPLRowKind = 'balance' | 'movement';

export interface DMPLColumn {
  /** Identificador estável da coluna ('capital', 'capitalReserves', 'profitReserves', 'retained' ou 'group_2.3.x'). */
  key: string;
  /** Código do grupo ou conta no plano (ex.: '2.3.1', '2.3.2.01', '2.3.2.02', '2.3.3'). */
  code: string;
  /** Título exibido no cabeçalho da coluna. */
  label: string;
}

export interface DMPLRow {
  kind: DMPLRowKind;
  label: string;
  /** Valor em cada coluna ativa (chave da coluna → reais; credor positivo, devedor/redutor negativo). */
  values: Record<string, number>;
  /** Soma horizontal da linha (Total do Patrimônio Líquido). */
  total: number;
}

export interface DMPL {
  year: string;
  start: string;
  end: string;
  /** Colunas ativas do Patrimônio Líquido (a coluna Total fica em `row.total`). */
  columns: DMPLColumn[];
  rows: DMPLRow[];
  /** Patrimônio líquido total no início do exercício. */
  initialEquity: number;
  /** Patrimônio líquido total no fim do período. */
  finalEquity: number;
}

interface ColMeta extends DMPLColumn {
  order: number;
}

const BASE_COLUMNS: readonly ColMeta[] = [
  { key: 'capital', code: '2.3.1', label: 'Capital social', order: 10 },
  { key: 'capitalReserves', code: '2.3.2.01', label: 'Reservas de capital', order: 20 },
  { key: 'profitReserves', code: '2.3.2.02', label: 'Reservas de lucros', order: 30 },
  { key: 'retained', code: '2.3.3', label: 'Lucros ou prejuízos acumulados', order: 90 },
];

const isDistribution = (a: ChartAccount) => a.code === DISTRIBUTED_PROFITS_CODE || /distribu/i.test(a.name);

function resolveColumn(acc: ChartAccount, byCode: ReadonlyMap<string, ChartAccount>, registry: Map<string, ColMeta>): ColMeta {
  const { code, name } = acc;
  if (code === '2.3.1' || code.startsWith('2.3.1.')) return registry.get('capital')!;
  if (code === '2.3.2.01' || code.startsWith('2.3.2.01.') || (code.startsWith('2.3.2.') && /capital/i.test(name))) {
    return registry.get('capitalReserves')!;
  }
  if (code === '2.3.2' || code === '2.3.2.02' || code.startsWith('2.3.2.')) {
    return registry.get('profitReserves')!;
  }
  if (code === '2.3.3' || code.startsWith('2.3.3.')) return registry.get('retained')!;

  if (code.startsWith('2.3.')) {
    const prefix = code.split('.').slice(0, 3).join('.');
    const key = `group_${prefix}`;
    let meta = registry.get(key);
    if (!meta) {
      const groupAcc = byCode.get(prefix) ?? acc;
      meta = { key, code: prefix, label: groupAcc.name, order: 50 };
      registry.set(key, meta);
    }
    return meta;
  }

  if (/capital/i.test(name)) return registry.get('capital')!;
  if (/reserva.*capital/i.test(name)) return registry.get('capitalReserves')!;
  if (/reserva/i.test(name)) return registry.get('profitReserves')!;
  return registry.get('retained')!;
}

const addCents = (map: Map<string, number>, key: string, delta: number) => {
  if (delta !== 0) map.set(key, (map.get(key) ?? 0) + delta);
};

const hasNonZero = (map: ReadonlyMap<string, number>) => [...map.values()].some((v) => v !== 0);

/**
 * Constrói a DMPL do exercício de `end` (1º de janeiro até `end`).
 *
 * `openingLines` (opcional; ver `openingPostings`) identifica as partidas que vieram da
 * implantação de saldos de abertura para que entrem na linha de Saldo Inicial mesmo quando a
 * implantação é datada em 01/01 do próprio exercício.
 */
export function buildDMPL(
  postings: readonly Posting[],
  accounts: readonly ChartAccount[],
  journalEntries?: readonly JournalEntry[] | null,
  end = '',
  openingLines?: readonly Posting[] | null
): DMPL {
  const year = end.slice(0, 4);
  const start = yearStartOf(year);
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const byCode = new Map(accounts.map((a) => [a.code, a] as const));
  const registry = new Map<string, ColMeta>(BASE_COLUMNS.map((c) => [c.key, c]));

  // Partidas de implantação no período (exceto 2.3.3.04 Balanço de Abertura) contam como saldo inicial.
  const openingKey = (accountId: string, date: string, cents: number) => `${accountId}|${date}|${cents}`;
  const openingPool = new Map<string, number>();
  for (const l of openingLines ?? []) {
    if (l.date < start || l.date > end) continue;
    const acc = byId.get(l.accountId);
    const cents = toCents(l.value);
    if (!acc || cents === 0 || accountKind(acc) !== 'EQUITY' || acc.code === OPENING_ACCOUNT_CODE) continue;
    const k = openingKey(l.accountId, l.date, cents);
    openingPool.set(k, (openingPool.get(k) ?? 0) + 1);
  }

  const openingByCol = new Map<string, number>();
  const moveByCol = new Map<string, number>();

  let resultInYear = 0;
  let openingAccountInYear = 0;
  let distributionsInYear = 0;
  let priorAdjInYear = 0;
  let otherRetainedInYear = 0;

  for (const p of postings) {
    if (p.date > end) continue;
    const cents = toCents(p.value);
    if (cents === 0) continue;
    const acc = byId.get(p.accountId);
    if (!acc) continue;
    const credit = -cents;
    const kind = accountKind(acc);

    if (kind === 'RESULT') {
      if (p.date < start) addCents(openingByCol, 'retained', credit);
      else resultInYear += credit;
      continue;
    }
    if (kind !== 'EQUITY') continue;

    const col = resolveColumn(acc, byCode, registry);
    if (acc.code === OPENING_ACCOUNT_CODE) {
      openingAccountInYear += credit;
      continue;
    }
    if (p.date < start) {
      addCents(openingByCol, col.key, credit);
      continue;
    }

    const k = openingKey(p.accountId, p.date, cents);
    const left = openingPool.get(k) ?? 0;
    if (left > 0) {
      openingPool.set(k, left - 1);
      addCents(openingByCol, col.key, credit);
      continue;
    }

    if (col.key === 'retained') {
      if (isDistribution(acc)) distributionsInYear += credit;
      else if (acc.code === PRIOR_ADJUSTMENTS_CODE) priorAdjInYear += credit;
      else otherRetainedInYear += credit;
    } else {
      addCents(moveByCol, col.key, credit);
    }
  }

  // Efeito do encerramento do próprio exercício: retira-se das transferências para exibir o lucro e as mutações originais.
  let closingOnResult = 0;
  let closingOnOpening = 0;
  let closingOnDistribution = 0;
  let closingOnPriorAdj = 0;
  let closingOnOtherRetained = 0;

  const capitalInternal = new Map<string, number>();
  const reserveConstitution = new Map<string, number>();
  const reserveReversal = new Map<string, number>();

  for (const e of journalEntries ?? []) {
    if (e.date > end) continue;
    if (e.yearClosing === year) {
      for (const l of e.lines) {
        const acc = byId.get(l.accountId);
        if (!acc) continue;
        const credit = (l.type === 'CREDIT' ? 1 : -1) * toCents(l.amount);
        if (accountKind(acc) === 'RESULT') closingOnResult += credit;
        else if (acc.code === OPENING_ACCOUNT_CODE) closingOnOpening += credit;
        else if (accountKind(acc) === 'EQUITY' && resolveColumn(acc, byCode, registry).key === 'retained') {
          if (isDistribution(acc)) closingOnDistribution += credit;
          else if (acc.code === PRIOR_ADJUSTMENTS_CODE) closingOnPriorAdj += credit;
          else closingOnOtherRetained += credit;
        }
      }
      continue;
    }

    if (e.date < start) continue;

    // Analisa lançamentos manuais do exercício para identificar transferências internas entre colunas do PL.
    const entryCols = new Map<string, number>();
    let nonEquityOrSpecialCents = 0;
    for (const l of e.lines) {
      const cents = toCents(l.amount);
      if (cents === 0) continue;
      const credit = (l.type === 'CREDIT' ? 1 : -1) * cents;
      const acc = byId.get(l.accountId);
      if (!acc || accountKind(acc) !== 'EQUITY' || acc.code === OPENING_ACCOUNT_CODE || acc.code === PRIOR_ADJUSTMENTS_CODE || isDistribution(acc)) {
        nonEquityOrSpecialCents += Math.abs(cents);
        continue;
      }
      const col = resolveColumn(acc, byCode, registry);
      addCents(entryCols, col.key, credit);
    }

    const activeEntryCols = [...entryCols.entries()].filter(([, v]) => v !== 0);
    const sumEntryCols = activeEntryCols.reduce((s, [, v]) => s + v, 0);

    if (nonEquityOrSpecialCents === 0 && activeEntryCols.length >= 2 && sumEntryCols === 0) {
      // Lançamento permutativo puro entre grupos do PL (total = 0).
      const target =
        (entryCols.get('capital') ?? 0) !== 0
          ? capitalInternal
          : (entryCols.get('profitReserves') ?? 0) + (entryCols.get('capitalReserves') ?? 0) > 0
            ? reserveConstitution
            : reserveReversal;

      for (const [colKey, val] of activeEntryCols) {
        addCents(target, colKey, val);
        if (colKey === 'retained') otherRetainedInYear -= val;
        else addCents(moveByCol, colKey, -val);
      }
      continue;
    }

    // Lançamento misto (ex.: destina parte do lucro para reservas e parte para dividendos a pagar no passivo).
    const retDelta = entryCols.get('retained') ?? 0;
    const profDelta = Math.max(0, entryCols.get('profitReserves') ?? 0);
    const capResDelta = Math.max(0, entryCols.get('capitalReserves') ?? 0);
    const totalResCredit = profDelta + capResDelta;
    if (retDelta < 0 && totalResCredit > 0 && -retDelta >= totalResCredit) {
      if (profDelta > 0) {
        addCents(reserveConstitution, 'profitReserves', profDelta);
        addCents(moveByCol, 'profitReserves', -profDelta);
      }
      if (capResDelta > 0) {
        addCents(reserveConstitution, 'capitalReserves', capResDelta);
        addCents(moveByCol, 'capitalReserves', -capResDelta);
      }
      addCents(reserveConstitution, 'retained', -totalResCredit);
      otherRetainedInYear -= -totalResCredit;
      entryCols.set('retained', retDelta + totalResCredit);
    }

    // Débito direto em Lucros Acumulados para distribuição de dividendos (contra passivo ou banco).
    const remRetained = entryCols.get('retained') ?? 0;
    const isDividendEntry =
      /distribu|dividend/i.test(e.memo) ||
      e.lines.some((l) => /distribu|dividend/i.test(l.memo ?? '') || /distribu|dividend/i.test(byId.get(l.accountId)?.name ?? ''));
    if (remRetained < 0 && isDividendEntry) {
      distributionsInYear += remRetained;
      otherRetainedInYear -= remRetained;
    }
  }

  const openingBalance = openingAccountInYear - closingOnOpening;
  const netResult = resultInYear - closingOnResult;
  const distributions = distributionsInYear - closingOnDistribution;
  const adjustments = priorAdjInYear - closingOnPriorAdj + (otherRetainedInYear - closingOnOtherRetained);

  const capitalExternal = moveByCol.get('capital') ?? 0;
  const otherExternal = new Map<string, number>();
  for (const [k, v] of moveByCol) {
    if (k !== 'capital' && k !== 'retained' && v !== 0) otherExternal.set(k, v);
  }

  interface RawMovement {
    label: string;
    cents: Map<string, number>;
    always?: boolean;
  }

  const rawMovements: RawMovement[] = [
    { label: `(+/-) Balanço de abertura (${OPENING_ACCOUNT_CODE})`, cents: new Map([['retained', openingBalance]]) },
    { label: '(+/-) Ajustes de exercícios anteriores e outras movimentações', cents: new Map([['retained', adjustments]]) },
    {
      label: capitalExternal >= 0 ? '(+) Aumento de capital' : '(-) Redução de capital',
      cents: new Map([['capital', capitalExternal]]),
    },
    { label: '(+/-) Aumento de capital com reservas ou lucros', cents: capitalInternal },
    { label: '(+/-) Outras mutações patrimoniais', cents: otherExternal },
    { label: '(+/-) Lucro ou prejuízo líquido do exercício', cents: new Map([['retained', netResult]]), always: true },
    { label: 'Constituição de reservas', cents: reserveConstitution },
    { label: 'Reversão de reservas / absorção de prejuízos', cents: reserveReversal },
    { label: '(-) Lucros distribuídos', cents: new Map([['retained', distributions]]) },
  ].filter((m) => m.always || hasNonZero(m.cents));

  const closingByCol = new Map<string, number>(openingByCol);
  for (const m of rawMovements) {
    for (const [colKey, val] of m.cents) {
      addCents(closingByCol, colKey, val);
    }
  }

  const activeColumns: DMPLColumn[] = [...registry.values()]
    .filter(
      (c) =>
        c.key === 'capital' ||
        c.key === 'retained' ||
        (openingByCol.get(c.key) ?? 0) !== 0 ||
        (closingByCol.get(c.key) ?? 0) !== 0 ||
        rawMovements.some((m) => (m.cents.get(c.key) ?? 0) !== 0)
    )
    .sort((a, b) => a.order - b.order || a.code.localeCompare(b.code, undefined, { numeric: true }))
    .map(({ key, code, label }) => ({ key, code, label }));

  const toRow = (kind: DMPLRowKind, label: string, centsMap: ReadonlyMap<string, number>): DMPLRow => {
    const values: Record<string, number> = {};
    let sumCents = 0;
    for (const col of activeColumns) {
      const c = centsMap.get(col.key) ?? 0;
      values[col.key] = fromCents(c);
      sumCents += c;
    }
    return { kind, label, values, total: fromCents(sumCents) };
  };

  const firstRow = toRow('balance', `Saldo em ${formatDateBR(start)}`, openingByCol);
  const lastRow = toRow('balance', `Saldo em ${formatDateBR(end)}`, closingByCol);
  const rows: DMPLRow[] = [firstRow, ...rawMovements.map((m) => toRow('movement', m.label, m.cents)), lastRow];

  return {
    year,
    start,
    end,
    columns: activeColumns,
    rows,
    initialEquity: firstRow.total,
    finalEquity: lastRow.total,
  };
}

