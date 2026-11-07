import type { BankAccount, BankTransaction, ClientCompany, CompanyPorte, JournalEntry, OrgSettings } from '@/types/firestore';
import { formatCurrency } from '@/lib/utils/formatters';
import { monthOf } from '@/lib/periods';
import type { BalanceSheet, BalanceSheetLine } from '@/lib/ledger';

/**
 * Tela do Balanço (balanço, balancete, DLPA, DMPL e DFC): o que ela mostra além das demonstrações —
 * saldo com natureza, o encerramento do exercício no período, a nota da norma pelo porte, os
 * cadastros de banco incompletos e quem assina.
 */

export type StatementView = 'bs' | 'tb' | 'dlpa' | 'dmpl' | 'dfc';

interface Range {
  start: string;
  end: string;
}

/** Saldo de balancete com natureza: "1.234,56 D" (devedor) ou "… C" (credor); "—" quando zero. */
export const formatDC = (v: number) => (Math.abs(v) < 0.005 ? '—' : `${formatCurrency(Math.abs(v))} ${v > 0 ? 'D' : 'C'}`);

const isClosingIn = (j: Pick<JournalEntry, 'yearClosing' | 'date'>, range: Range) =>
  Boolean(j.yearClosing) && j.date >= range.start && j.date <= range.end;

/** Algum lançamento de encerramento do exercício cai no período. */
export const hasClosingIn = (entries: readonly JournalEntry[], range: Range) => entries.some((j) => isClosingIn(j, range));

/** Lançamentos manuais sem os de encerramento do período: o balancete "antes do encerramento". */
export const withoutClosingIn = (entries: readonly JournalEntry[], range: Range) => entries.filter((j) => !isClosingIn(j, range));

/** Rótulo da etapa do balancete quando o encerramento cai no período; undefined se não cai. */
export function trialBalanceStage(closingInRange: boolean, beforeClosing: boolean): string | undefined {
  if (!closingInRange) return undefined;
  return beforeClosing ? 'Antes do encerramento do exercício' : 'Após o encerramento do exercício (ARE)';
}

/** Meses com movimento: extrato e lançamentos manuais (fora os de encerramento). */
export function monthsWithData(transactions: readonly Pick<BankTransaction, 'date'>[], entries: readonly JournalEntry[]): Set<string> {
  return new Set([...transactions.map((t) => monthOf(t.date)), ...entries.filter((j) => !j.yearClosing).map((j) => monthOf(j.date))]);
}

/** Aviso da norma das demonstrações pelo porte, na aba em que ele importa; null nas demais. */
export function standardNoteFor(view: StatementView, porte: CompanyPorte): string | null {
  if (view === 'dfc' && porte === 'MICROENTIDADE') {
    return 'Microentidade (NBC TG 1002): a DFC é facultativa. Apresente-a se ajudar a leitura das demonstrações.';
  }
  if (view === 'dmpl' && porte === 'MICROENTIDADE') {
    return 'Microentidade (NBC TG 1002): a DMPL é facultativa e pode substituir a DLPA no conjunto das demonstrações.';
  }
  if (view === 'dmpl' && porte === 'PEQUENA_EMPRESA') {
    return 'Pequena empresa (NBC TG 1001): a DMPL substitui a DLPA e é obrigatória quando há movimento em Capital Social ou Reservas.';
  }
  if ((view === 'bs' || view === 'dlpa') && porte === 'PEQUENA_EMPRESA') {
    return 'Pequena empresa (NBC TG 1001): o conjunto completo inclui a Demonstração dos Fluxos de Caixa, na aba DFC.';
  }
  return null;
}

/** Contas bancárias sem saldo inicial e sem conta contábil vinculada. */
export function bankSetupIssues(banks: readonly BankAccount[]): { missingOpening: BankAccount[]; unlinked: BankAccount[] } {
  return {
    missingOpening: banks.filter((b) => b.openingBalance === undefined),
    unlinked: banks.filter((b) => !b.ledgerAccountId),
  };
}

/** Assinaturas das demonstrações exportadas: representante legal e contador. */
export function statementSignatories(
  client: Pick<ClientCompany, 'legalRepresentativeName' | 'legalRepresentativeCpf'> | null | undefined,
  org: Pick<OrgSettings, 'accountantName' | 'accountantCrc'> | null | undefined
) {
  return {
    legalRepresentative: { name: client?.legalRepresentativeName, cpf: client?.legalRepresentativeCpf },
    accountant: org ? { name: org.accountantName, crc: org.accountantCrc } : undefined,
  };
}

/* =========================================================================
   Comparativo com o exercício anterior
   ========================================================================= */

/** 31/12 do exercício anterior ao de `date`: a coluna de comparação do balanço. */
export const previousYearEnd = (date: string): string => `${Number(date.slice(0, 4)) - 1}-12-31`;

/** Linha do balanço com o saldo no fim do exercício anterior. */
export interface ComparativeLine extends BalanceSheetLine {
  previous: number;
}

/**
 * Linhas da posição atual e do fim do exercício anterior juntas (contas que só têm saldo num dos
 * dois aparecem com zero no outro), na ordem do plano; as sem código (virtuais) por último.
 */
export function comparativeLines(current: readonly BalanceSheetLine[], previous: readonly BalanceSheetLine[] | null): ComparativeLine[] {
  const prev = new Map((previous ?? []).map((l) => [l.accountId, l] as const));
  const out: ComparativeLine[] = current.map((l) => ({ ...l, previous: prev.get(l.accountId)?.value ?? 0 }));
  const seen = new Set(current.map((l) => l.accountId));
  for (const l of previous ?? []) if (!seen.has(l.accountId)) out.push({ ...l, value: 0, previous: l.value });
  return out.sort((a, b) =>
    a.code && b.code ? a.code.localeCompare(b.code, undefined, { numeric: true }) : a.code ? -1 : b.code ? 1 : a.name.localeCompare(b.name)
  );
}

/** O exercício anterior tem saldo para comparar (empresa implantada depois dele não tem). */
export const hasComparable = (bs: Pick<BalanceSheet, 'assets' | 'liabilities' | 'equity'>): boolean =>
  bs.assets.length + bs.liabilities.length + bs.equity.length > 0;
