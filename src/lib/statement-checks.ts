import type { OpeningStatus } from '@/lib/opening';
import type { ConsistencyCheck } from '@/lib/dre/consistency';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

/**
 * Avisos das demonstrações (DRE, Balanço, Diário) num formato único, para o bloco "Pendências
 * desta demonstração": o que impede, o que pede atenção, observações e o que confere.
 */

export type CheckLevel = 'block' | 'warn' | 'info' | 'ok';

export interface StatementCheck {
  id: string;
  level: CheckLevel;
  title: string;
  /** Detalhes mostrados com o bloco aberto. */
  items?: readonly string[];
  /** Onde resolver. */
  href?: string;
  linkLabel?: string;
}

type MaybeCheck = StatementCheck | null | undefined | false;

const ORDER: Record<CheckLevel, number> = { block: 0, warn: 1, info: 2, ok: 3 };

/** Avisos em ordem (impede, atenção, observação, confere) e quantos pedem ação. */
export function summarizeChecks(checks: readonly MaybeCheck[]) {
  const list = checks.filter((c): c is StatementCheck => Boolean(c)).sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  const issues = list.filter((c) => c.level === 'block' || c.level === 'warn');
  return {
    issues,
    infos: list.filter((c) => c.level === 'info'),
    oks: list.filter((c) => c.level === 'ok'),
    /** Quantos impedem ou pedem atenção (o número do bloco). */
    pending: issues.length,
    blocking: issues.some((c) => c.level === 'block'),
  };
}

/** Abertura sem data única ou sem débitos = créditos. */
export function openingCheck(status: OpeningStatus | null): StatementCheck | null {
  if (!status || status.verified) return null;
  return { id: 'opening', level: 'warn', title: 'Abertura não conferida', items: status.problems, href: '/abertura', linkLabel: 'Conferir saldos de abertura' };
}

/** Competências do período: todas fechadas (definitiva) ou parte aberta (valores podem mudar). */
export function periodLockCheck(lock: { closed: number; total: number }, subject: string): StatementCheck | null {
  if (lock.total === 0) return null;
  if (lock.closed === lock.total) return { id: 'locks', level: 'ok', title: `Todas as competências do período fechadas: ${subject} é definitiva` };
  const open = lock.total - lock.closed;
  return {
    id: 'locks',
    level: 'warn',
    title: lock.closed === 0 ? 'Nenhuma competência do período fechada' : `${open} de ${lock.total} competência(s) do período em aberto`,
    items: ['Os valores ainda podem mudar até o fechamento.'],
    href: '/',
    linkLabel: 'Fechar na Conciliação',
  };
}

/** Auto-classificados que ainda não entram na DRE. */
export function awaitingApprovalCheck(count: number): StatementCheck | null {
  if (count <= 0) return null;
  return {
    id: 'awaiting',
    level: 'warn',
    title: `${count} lançamento(s) auto-classificado(s) aguardando aprovação`,
    items: ['Só entram na DRE depois de aprovados na Conciliação.'],
    href: '/',
    linkLabel: 'Aprovar na Conciliação',
  };
}

const ISSUE_LINK: Partial<Record<ConsistencyCheck['issues'][number]['type'], { href: string; linkLabel: string }>> = {
  SUSPENSE_ENTRIES: { href: '/', linkLabel: 'Abrir na Conciliação' },
  UNLINKED_BANKS: { href: '/contas', linkLabel: 'Vincular em Contas e extratos' },
  UNBALANCED_LEDGER: { href: '/abertura', linkLabel: 'Revisar a abertura' },
};

/** Conferência DRE × resultado no PL do Balanço, com os motivos de pendência. */
export function dreConsistencyChecks(c: ConsistencyCheck, date: string): StatementCheck[] {
  const out: StatementCheck[] = [];
  if (c.isConsistent) {
    out.push({ id: 'dre-pl', level: 'ok', title: `Resultado confere com o Balanço em ${formatDateBR(date)}` });
  }
  for (const issue of c.issues) {
    if (issue.type === 'DIVERGENCE') {
      out.push({
        id: 'dre-pl',
        level: 'block',
        title: `Divergência de ${formatCurrency(Math.abs(c.difference))} entre a DRE e o Balanço`,
        items: [`Resultado na DRE: ${formatCurrency(c.dreNetResult)}`, `Resultado no PL do Balanço: ${formatCurrency(c.balanceCurrentResult)}`],
        href: '/balanco',
        linkLabel: 'Ver no Balanço',
      });
      continue;
    }
    out.push({ id: issue.id, level: issue.severity === 'error' ? 'block' : 'warn', title: issue.title, items: [issue.description], ...ISSUE_LINK[issue.type] });
  }
  return out;
}

export interface InvertedLine {
  code: string;
  name: string;
  value: number;
  side: 'ASSET' | 'LIABILITY';
}

export interface BalanceChecksInput {
  /** Balanço/DLPA/DFC (`bs`) ou balancete (`tb`). */
  trialBalance: boolean;
  date: string;
  suspense: number;
  unlinkedBanks: readonly string[];
  missingOpeningBanks: readonly string[];
  inverted: readonly InvertedLine[];
  /** Capital social sem saldo (só no balanço). */
  missingCapitalCode: string | null;
  difference: number;
  trialBalanced: boolean;
  consistency: ConsistencyCheck | null;
  /** Observação da norma do porte (ex.: a DFC faz parte do conjunto). */
  standardNote: string | null;
}

/** Avisos do Balanço e balancete, na ordem em que a tela os mostrava. */
export function balanceSheetChecks(i: BalanceChecksInput): StatementCheck[] {
  const out: MaybeCheck[] = [
    i.suspense !== 0 && {
      id: 'suspense',
      level: 'warn',
      title: `${formatCurrency(Math.abs(i.suspense))} em lançamentos a classificar até ${formatDateBR(i.date)}`,
      items: ['Lançamentos ainda não conciliados aparecem como “Lançamentos a classificar”. Concilie-os para um balanço definitivo.'],
      href: '/',
      linkLabel: 'Abrir na Conciliação',
    },
    i.unlinkedBanks.length > 0 && {
      id: 'unlinked',
      level: 'warn',
      title: `${i.unlinkedBanks.length} conta(s) bancária(s) sem conta contábil`,
      items: [i.unlinkedBanks.join(', ')],
      href: '/contas',
      linkLabel: 'Vincular em Contas e extratos',
    },
    i.missingOpeningBanks.length > 0 && {
      id: 'missing-opening',
      level: 'warn',
      title: `Sem saldo inicial: ${i.missingOpeningBanks.join(', ')}`,
      items: ['O saldo dos bancos parte de zero até ser informado.'],
      href: '/contas',
      linkLabel: 'Informar em Contas e extratos',
    },
    !i.trialBalance &&
      i.inverted.length > 0 && {
        id: 'inverted',
        level: 'warn',
        title: `Saldo invertido em ${i.inverted.length} conta(s)`,
        items: i.inverted.map((l) => `${l.code} ${l.name}: ${formatCurrency(-l.value)} ${l.side === 'ASSET' ? 'credor no ativo' : 'devedor no passivo'}`),
      },
    !i.trialBalance &&
      Boolean(i.missingCapitalCode) && {
        id: 'capital',
        level: 'info',
        title: `Capital social (${i.missingCapitalCode}) sem saldo`,
        items: ['Registre-o na Abertura ou por lançamento contábil.'],
        href: '/abertura',
        linkLabel: 'Registrar na Abertura',
      },
    i.trialBalance
      ? i.trialBalanced
        ? { id: 'balance', level: 'ok', title: 'Débitos = créditos' }
        : { id: 'balance', level: 'block', title: 'Débitos e créditos não conferem' }
      : i.difference === 0
        ? { id: 'balance', level: 'ok', title: 'Ativo = Passivo + Patrimônio líquido' }
        : { id: 'balance', level: 'block', title: `Diferença de ${formatCurrency(i.difference)} entre ativo e passivo + PL`, href: '/abertura', linkLabel: 'Revisar a abertura' },
    i.consistency &&
      (i.consistency.isConsistent
        ? { id: 'dre-pl', level: 'ok', title: 'Resultado no PL confere com a DRE' }
        : {
            id: 'dre-pl',
            level: 'block',
            title: `Resultado no PL difere da DRE em ${formatCurrency(Math.abs(i.consistency.difference))}`,
            items: [
              `Resultado no PL: ${formatCurrency(i.consistency.balanceCurrentResult)}`,
              `Resultado na DRE: ${formatCurrency(i.consistency.dreNetResult)}`,
              ...(i.consistency.suspenseAmount !== 0 ? [`${formatCurrency(Math.abs(i.consistency.suspenseAmount))} em lançamentos a classificar`] : []),
            ],
            href: '/dre',
            linkLabel: 'Ver na DRE',
          }),
    i.standardNote ? { id: 'standard', level: 'info', title: i.standardNote } : null,
  ];
  return out.filter((c): c is StatementCheck => Boolean(c));
}
