import type { ClientCompany, ObligationChecks, PayrollRegister, TaxRegime } from '@/types/firestore';
import { dayOfMonth, lastBusinessDayOf, nthBusinessDayOf, shiftMonth, shiftToBusinessDay, addCalendarDays } from '@/lib/business-days';

/**
 * Agenda de obrigações acessórias e guias federais por empresa.
 *
 * O catálogo sugere as obrigações pelo regime tributário e pela folha (pró-labore ou
 * empregados); em cada empresa dá para desligar uma sugerida ou ligar uma opcional. Prazos
 * (legislação vigente em 2026; confira a agenda tributária da Receita a cada ano):
 *   - DAS / PGDAS-D e DAS-MEI: dia 20 do mês seguinte, prorrogado para o dia útil seguinte
 *     (Resolução CGSN 140/2018, art. 40).
 *   - DCTFWeb (inclusive o MIT): último dia útil do mês seguinte (IN RFB 2.248/2025).
 *   - eSocial (eventos periódicos): dia 15 do mês seguinte, antecipado se não for dia útil.
 *   - EFD-Reinf: dia 15 do mês seguinte, prorrogado para o dia útil seguinte.
 *   - DARF da DCTFWeb (INSS e IRRF da folha) e FGTS Digital: dia 20, antecipado.
 *   - PIS/COFINS: dia 25, antecipado. IRPJ/CSLL: último dia útil do mês seguinte ao período.
 *   - EFD-Contribuições: 10º dia útil do 2º mês seguinte.
 *   - ECD: último dia útil de junho; ECF: último dia útil de julho; DEFIS: 31 de março;
 *     DASN-SIMEI: 31 de maio (antecipadas se o dia não for útil).
 */

export type ObligationFrequency = 'monthly' | 'quarterly' | 'annual';
export type ObligationKind = 'guia' | 'declaração';

export interface ObligationDef {
  code: string;
  label: string;
  kind: ObligationKind;
  frequency: ObligationFrequency;
  /** O que é, em uma linha. */
  description: string;
  /** Vencimento (YYYY-MM-DD) do período: competência YYYY-MM, trimestre YYYY-Qn ou ano YYYY. */
  due: (period: string) => string;
  /** Regimes em que é sugerida. */
  regimes: readonly TaxRegime[];
  /** Só com folha (pró-labore ou empregados) ou só com empregados. */
  requires?: 'payroll' | 'employees';
  /** Também sugerida, em qualquer regime, quando há folha. */
  alsoWithPayroll?: boolean;
  /** Oferecida para ligar, mas desligada por padrão. */
  optional?: boolean;
  /** Tela do app que ajuda a cumprir. */
  href?: string;
}

const ALL: readonly TaxRegime[] = ['SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL', 'MEI'];
const NOT_MEI: readonly TaxRegime[] = ['SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL'];
const PRESUMIDO_REAL: readonly TaxRegime[] = ['LUCRO_PRESUMIDO', 'LUCRO_REAL'];

/** Dia `day` do mês seguinte à competência, deslocado para dia útil. */
const nextMonthDay = (day: number, direction: 'next' | 'previous') => (month: string) => shiftToBusinessDay(dayOfMonth(shiftMonth(month, 1), day), direction);
const quarterEndMonth = (period: string) => `${period.slice(0, 4)}-${String(Number(period.slice(6)) * 3).padStart(2, '0')}`;
const annualOn = (mmdd: string) => (year: string) => shiftToBusinessDay(`${Number(year) + 1}-${mmdd}`, 'previous');

export const OBLIGATIONS: readonly ObligationDef[] = [
  {
    code: 'DAS',
    label: 'PGDAS-D e DAS',
    kind: 'guia',
    frequency: 'monthly',
    description: 'Apuração do Simples Nacional e guia do mês.',
    due: nextMonthDay(20, 'next'),
    regimes: ['SIMPLES_NACIONAL'],
  },
  {
    code: 'DAS_MEI',
    label: 'DAS-MEI',
    kind: 'guia',
    frequency: 'monthly',
    description: 'Guia mensal do microempreendedor individual.',
    due: nextMonthDay(20, 'next'),
    regimes: ['MEI'],
  },
  {
    code: 'PIS_COFINS',
    label: 'PIS e COFINS',
    kind: 'guia',
    frequency: 'monthly',
    description: 'DARF do PIS e da COFINS sobre o faturamento.',
    due: nextMonthDay(25, 'previous'),
    regimes: PRESUMIDO_REAL,
  },
  {
    code: 'IRPJ_CSLL_TRIM',
    label: 'IRPJ e CSLL trimestrais',
    kind: 'guia',
    frequency: 'quarterly',
    description: 'DARF do IRPJ e da CSLL do trimestre (cota única ou 1ª quota).',
    due: (q) => lastBusinessDayOf(shiftMonth(quarterEndMonth(q), 1)),
    regimes: ['LUCRO_PRESUMIDO'],
  },
  {
    code: 'IRPJ_CSLL_MENSAL',
    label: 'IRPJ e CSLL por estimativa',
    kind: 'guia',
    frequency: 'monthly',
    description: 'DARF do IRPJ e da CSLL mensais (estimativa do Lucro Real anual).',
    due: (m) => lastBusinessDayOf(shiftMonth(m, 1)),
    regimes: ['LUCRO_REAL'],
    optional: true,
  },
  {
    code: 'DCTFWEB',
    label: 'DCTFWeb',
    kind: 'declaração',
    frequency: 'monthly',
    description: 'Débitos federais do mês: folha (eSocial), retenções (EFD-Reinf) e demais tributos pelo MIT.',
    due: (m) => lastBusinessDayOf(shiftMonth(m, 1)),
    regimes: PRESUMIDO_REAL,
    alsoWithPayroll: true,
  },
  {
    code: 'ESOCIAL',
    label: 'eSocial (folha do mês)',
    kind: 'declaração',
    frequency: 'monthly',
    description: 'Eventos periódicos: remunerações, pró-labore e fechamento da folha.',
    due: nextMonthDay(15, 'previous'),
    regimes: ALL,
    requires: 'payroll',
    href: '/folha',
  },
  {
    code: 'DARF_FOLHA',
    label: 'DARF da folha (INSS e IRRF)',
    kind: 'guia',
    frequency: 'monthly',
    description: 'Guia gerada pela DCTFWeb com as contribuições e o IRRF da folha e do pró-labore.',
    due: nextMonthDay(20, 'previous'),
    regimes: ALL,
    requires: 'payroll',
    href: '/folha',
  },
  {
    code: 'FGTS',
    label: 'FGTS Digital',
    kind: 'guia',
    frequency: 'monthly',
    description: 'Guia mensal do FGTS dos empregados.',
    due: nextMonthDay(20, 'previous'),
    regimes: ALL,
    requires: 'employees',
    href: '/folha',
  },
  {
    code: 'EFD_REINF',
    label: 'EFD-Reinf',
    kind: 'declaração',
    frequency: 'monthly',
    description: 'Retenções na fonte e demais informações fora da folha (serviços tomados, CPRB…).',
    due: nextMonthDay(15, 'next'),
    regimes: NOT_MEI,
    optional: true,
  },
  {
    code: 'EFD_CONTRIB',
    label: 'EFD-Contribuições',
    kind: 'declaração',
    frequency: 'monthly',
    description: 'Escrituração do PIS e da COFINS.',
    due: (m) => nthBusinessDayOf(shiftMonth(m, 2), 10),
    regimes: PRESUMIDO_REAL,
  },
  {
    code: 'DEFIS',
    label: 'DEFIS',
    kind: 'declaração',
    frequency: 'annual',
    description: 'Declaração anual do Simples Nacional (informações socioeconômicas e fiscais).',
    due: annualOn('03-31'),
    regimes: ['SIMPLES_NACIONAL'],
  },
  {
    code: 'DASN_SIMEI',
    label: 'DASN-SIMEI',
    kind: 'declaração',
    frequency: 'annual',
    description: 'Declaração anual do MEI (faturamento do ano).',
    due: annualOn('05-31'),
    regimes: ['MEI'],
  },
  {
    code: 'ECD',
    label: 'ECD (SPED Contábil)',
    kind: 'declaração',
    frequency: 'annual',
    description: 'Escrituração contábil digital do exercício (no Simples, opcional ao registro dos livros).',
    due: (y) => lastBusinessDayOf(`${Number(y) + 1}-06`),
    regimes: PRESUMIDO_REAL,
    href: '/fechamento',
  },
  {
    code: 'ECD_SIMPLES',
    label: 'ECD (SPED Contábil)',
    kind: 'declaração',
    frequency: 'annual',
    description: 'Para quem do Simples entrega a ECD em vez de registrar os livros na Junta ou no cartório.',
    due: (y) => lastBusinessDayOf(`${Number(y) + 1}-06`),
    regimes: ['SIMPLES_NACIONAL'],
    optional: true,
    href: '/fechamento',
  },
  {
    code: 'ECF',
    label: 'ECF',
    kind: 'declaração',
    frequency: 'annual',
    description: 'Escrituração contábil fiscal (IRPJ e CSLL do ano).',
    due: (y) => lastBusinessDayOf(`${Number(y) + 1}-07`),
    regimes: PRESUMIDO_REAL,
  },
];

const BY_CODE = new Map(OBLIGATIONS.map((o) => [o.code, o] as const));
export const obligationDef = (code: string): ObligationDef | undefined => BY_CODE.get(code);

/** O que a folha diz da empresa: há folha (pró-labore ou salários) e há empregados. */
export interface PayrollProfile {
  hasPayroll: boolean;
  hasEmployees: boolean;
}

export function payrollProfile(register: Pick<PayrollRegister, 'summaries'> | null | undefined): PayrollProfile {
  const summaries = register?.summaries ?? [];
  return {
    hasPayroll: summaries.some((s) => s.grossSalaries > 0 || s.grossProLabore > 0),
    hasEmployees: summaries.some((s) => s.grossSalaries > 0 || s.fgts > 0),
  };
}

/** Sugerida pelo regime e pela folha (antes das escolhas da empresa). */
export function isSuggested(def: ObligationDef, regime: TaxRegime, profile: PayrollProfile): boolean {
  if (def.optional) return false;
  if (def.requires === 'payroll' && !profile.hasPayroll) return false;
  if (def.requires === 'employees' && !profile.hasEmployees) return false;
  return def.regimes.includes(regime) || Boolean(def.alsoWithPayroll && profile.hasPayroll);
}

/** Pode ser ligada nesta empresa (aparece na configuração). */
export const isAvailable = (def: ObligationDef, regime: TaxRegime): boolean => def.regimes.includes(regime) || Boolean(def.alsoWithPayroll);

/** Obrigações ativas da empresa: as sugeridas, menos as desligadas, mais as ligadas. */
export function activeObligations(regime: TaxRegime, profile: PayrollProfile, checks: Pick<ObligationChecks, 'enabled' | 'disabled'> | null | undefined): ObligationDef[] {
  const enabled = new Set(checks?.enabled ?? []);
  const disabled = new Set(checks?.disabled ?? []);
  return OBLIGATIONS.filter((d) => !disabled.has(d.code) && (enabled.has(d.code) || isSuggested(d, regime, profile)));
}

export const obligationKey = (code: string, period: string): string => `${code}|${period}`;

export function periodLabel(def: Pick<ObligationDef, 'frequency'>, period: string): string {
  if (def.frequency === 'annual') return `Ano-calendário ${period}`;
  if (def.frequency === 'quarterly') return `${period.slice(6)}º trimestre de ${period.slice(0, 4)}`;
  const [y, m] = period.split('-');
  return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m) - 1]}/${y}`;
}

/** Períodos cujo vencimento pode cair entre `from` e `to` (margem generosa; o filtro final é pela data). */
function candidatePeriods(def: ObligationDef, from: string, to: string): string[] {
  const out: string[] = [];
  if (def.frequency === 'monthly') {
    for (let m = shiftMonth(from.slice(0, 7), -3); m <= to.slice(0, 7); m = shiftMonth(m, 1)) out.push(m);
  } else if (def.frequency === 'quarterly') {
    for (let y = Number(from.slice(0, 4)) - 1; y <= Number(to.slice(0, 4)); y++) for (let q = 1; q <= 4; q++) out.push(`${y}-Q${q}`);
  } else {
    for (let y = Number(from.slice(0, 4)) - 2; y <= Number(to.slice(0, 4)); y++) out.push(String(y));
  }
  return out;
}

/** Fim do período (para não cobrar obrigação de período anterior ao início do acompanhamento). */
function periodEnd(def: ObligationDef, period: string): string {
  if (def.frequency === 'annual') return `${period}-12-31`;
  const month = def.frequency === 'quarterly' ? quarterEndMonth(period) : period;
  return addCalendarDays(`${shiftMonth(month, 1)}-01`, -1);
}

export type AgendaStatus = 'done' | 'overdue' | 'today' | 'week' | 'later';

export interface AgendaItem {
  key: string;
  clientId: string;
  code: string;
  label: string;
  kind: ObligationKind;
  period: string;
  periodLabel: string;
  due: string;
  status: AgendaStatus;
  doneAt?: string;
  href?: string;
}

export interface AgendaClient {
  client: Pick<ClientCompany, 'id' | 'regime' | 'createdAt' | 'deletingAt'>;
  profile: PayrollProfile;
  checks: ObligationChecks | null;
}

/**
 * Itens da agenda com vencimento entre `from` e `to`, de todas as empresas. Períodos que
 * terminaram antes do início do acompanhamento (`trackFrom` ou o cadastro da empresa) ficam de
 * fora, para a agenda não nascer cheia de pendências antigas.
 */
export function buildAgenda(args: { clients: readonly AgendaClient[]; today: string; from: string; to: string }): AgendaItem[] {
  const { clients, today, from, to } = args;
  const weekEnd = addCalendarDays(today, 7);
  const items: AgendaItem[] = [];
  for (const { client, profile, checks } of clients) {
    if (client.deletingAt) continue;
    const done = new Map((checks?.done ?? []).map((d) => [d.key, d.doneAt] as const));
    const trackFrom = (client.createdAt || '').slice(0, 10);
    for (const def of activeObligations(client.regime, profile, checks)) {
      for (const period of candidatePeriods(def, from, to)) {
        const due = def.due(period);
        if (due < from || due > to) continue;
        if (trackFrom && periodEnd(def, period) < trackFrom) continue;
        const key = obligationKey(def.code, period);
        const doneAt = done.get(key);
        const status: AgendaStatus = doneAt ? 'done' : due < today ? 'overdue' : due === today ? 'today' : due <= weekEnd ? 'week' : 'later';
        items.push({
          key,
          clientId: client.id,
          code: def.code,
          label: def.label,
          kind: def.kind,
          period,
          periodLabel: periodLabel(def, period),
          due,
          status,
          ...(doneAt ? { doneAt } : {}),
          ...(def.href ? { href: def.href } : {}),
        });
      }
    }
  }
  return items.sort((a, b) => a.due.localeCompare(b.due) || a.clientId.localeCompare(b.clientId) || a.label.localeCompare(b.label));
}

/** Marca ou desmarca um item como cumprido (guarda só os últimos 36 meses de marcações). */
export function toggleDone(checks: ObligationChecks, key: string, doneAt: string | null, keepFrom: string): ObligationChecks {
  const others = checks.done.filter((d) => d.key !== key && d.doneAt >= keepFrom);
  return { ...checks, done: doneAt ? [...others, { key, doneAt }] : others };
}

/** Liga/desliga uma obrigação na empresa, guardando só o que difere da sugestão. */
export function setObligationActive(checks: ObligationChecks, def: ObligationDef, active: boolean, suggested: boolean): ObligationChecks {
  const enabled = new Set(checks.enabled);
  const disabled = new Set(checks.disabled);
  enabled.delete(def.code);
  disabled.delete(def.code);
  if (active && !suggested) enabled.add(def.code);
  if (!active && suggested) disabled.add(def.code);
  return { ...checks, enabled: [...enabled].sort(), disabled: [...disabled].sort() };
}

export const emptyChecks = (clientId: string, now: string): ObligationChecks => ({ id: clientId, clientId, enabled: [], disabled: [], done: [], updatedAt: now });
