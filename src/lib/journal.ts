import type { JournalEntry, JournalEntryLine } from '@/types/firestore';
import { isISODate, MONTH_NAMES } from '@/lib/periods';
import { toCents } from '@/lib/money';

/**
 * Máximo de partidas por lançamento manual. As regras do Firestore não têm laços: somam
 * as partidas uma a uma (`linesNet` em firestore.rules), e este é o teto de lá.
 */
export const MAX_JOURNAL_LINES = 20;

/** Totais de débito e crédito das partidas, somados em centavos. */
export function journalTotals(lines: readonly Pick<JournalEntryLine, 'type' | 'amount'>[]): {
  debit: number;
  credit: number;
  difference: number;
} {
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    const value = toCents(Number(l.amount) || 0);
    if (l.type === 'DEBIT') debit += value;
    else credit += value;
  }
  return { debit: debit / 100, credit: credit / 100, difference: Math.abs(debit - credit) / 100 };
}

/**
 * Primeiro problema que impede gravar o lançamento, ou null se ele respeita as partidas
 * dobradas. As regras (`validJournal` em firestore.rules) conferem data, quantidade de
 * partidas e débito = crédito; conta e valor positivo por partida são conferidos só aqui.
 */
export function journalEntryProblem(entry: Pick<JournalEntry, 'date' | 'lines'>): string | null {
  if (!isISODate(entry.date)) return 'Informe uma data válida para o lançamento.';
  const { lines } = entry;
  if (lines.length < 2) return 'Adicione pelo menos 2 partidas (débito e crédito).';
  if (lines.length > MAX_JOURNAL_LINES) {
    return `Um lançamento aceita no máximo ${MAX_JOURNAL_LINES} partidas. Divida-o em dois lançamentos.`;
  }
  for (const [i, l] of lines.entries()) {
    if (!l.accountId) return `A linha #${i + 1} está sem conta contábil selecionada.`;
    if (l.type !== 'DEBIT' && l.type !== 'CREDIT') return `A linha #${i + 1} não é débito nem crédito.`;
    if (!Number.isFinite(l.amount) || l.amount <= 0) return `A linha #${i + 1} possui valor zerado ou inválido.`;
  }
  const { debit, difference } = journalTotals(lines);
  if (debit <= 0) return 'O lançamento precisa de ao menos um débito e um crédito.';
  if (difference > 0) {
    return `O lançamento está desbalanceado em R$ ${difference.toFixed(2).replace('.', ',')}. Débitos e créditos devem ser iguais.`;
  }
  return null;
}

/** Recusa lançamentos que não fecham; os repositórios chamam antes de gravar. */
export function assertValidJournalEntry(entry: Pick<JournalEntry, 'date' | 'lines'>): void {
  const problem = journalEntryProblem(entry);
  if (problem) throw new Error(problem);
}

/* =========================================================================
   Comprovante (link)
   ========================================================================= */

const MAX_ATTACHMENT_URL = 2000;
const FILE_EXTENSIONS = /\.(pdf|jpe?g|png|gif|docx?|xlsx?|csv|txt|zip|rar|xml|ofx)$/i;

/**
 * Link do comprovante de um lançamento: `null` se vazio, o endereço normalizado (com
 * `https://` quando faltar) e o site, ou o motivo de não servir. Só http/https: um caminho
 * do computador ou um nome de arquivo não abre em outro aparelho, e outros esquemas
 * (`javascript:`, `data:`) não são links de documento.
 */
export function parseAttachmentUrl(raw: string): { url: string; host: string } | { problem: string } | null {
  const text = raw.trim();
  if (!text) return null;
  if (text.length > MAX_ATTACHMENT_URL) return { problem: 'Link longo demais.' };
  if (/^[a-z]:[\\/]/i.test(text) || /^(\\\\|\/|~|file:)/i.test(text)) {
    return { problem: 'Isto é um caminho do computador. Envie o documento para a nuvem (Drive, OneDrive…) e cole o link de compartilhamento.' };
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text);
  if (!hasScheme && !text.includes('/') && FILE_EXTENSIONS.test(text)) {
    return { problem: 'Isto parece o nome de um arquivo. Cole o link de compartilhamento do documento (https://…).' };
  }
  let parsed: URL;
  try {
    parsed = new URL(hasScheme ? text : `https://${text}`);
  } catch {
    return { problem: 'Link inválido. Cole o endereço completo do documento (https://…).' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { problem: 'Use um link que comece com https://.' };
  if (!parsed.hostname.includes('.')) return { problem: 'Link inválido. Cole o endereço completo do documento (https://…).' };
  return { url: parsed.href, host: parsed.hostname.replace(/^www\./, '') };
}

/* =========================================================================
   Recorrência mensal ("repetir do mês anterior")
   ========================================================================= */

/** Categorias que costumam se repetir todo mês: vêm marcadas ao repetir. */
const RECURRING_CATEGORIES: ReadonlySet<JournalEntry['category']> = new Set(['PAYROLL', 'DEPRECIATION', 'TAX', 'PROVISION']);

/** Competência (YYYY-MM) anterior. */
export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Mesmo dia na competência `targetMonth`; dia que não existe nela (31 em fevereiro) vira o último. */
export function sameDayIn(date: string, targetMonth: string): string {
  const [y, m] = targetMonth.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${targetMonth}-${String(Math.min(Number(date.slice(8, 10)) || last, last)).padStart(2, '0')}`;
}

/**
 * Troca no texto as menções à competência `from` pelas de `to`, nos formatos usados nos
 * históricos e documentos: `2025-04`, `04/2025`, `04-2025`, `abril/2025`, `abril de 2025`.
 */
export function shiftCompetence(text: string, from: string, to: string): string {
  const [fy, fm] = from.split('-');
  const [ty, tm] = to.split('-');
  const name = (mm: string) => MONTH_NAMES[Number(mm) - 1] ?? '';
  const keepCase = (original: string, replacement: string) =>
    original === original.toUpperCase()
      ? replacement.toUpperCase()
      : original[0] === original[0].toUpperCase()
        ? replacement[0].toUpperCase() + replacement.slice(1)
        : replacement;
  return text
    .replaceAll(`${fy}-${fm}`, `${ty}-${tm}`)
    .replace(new RegExp(`(?<![0-9])${fm}([/-])${fy}(?![0-9])`, 'g'), `${tm}$1${ty}`)
    .replace(new RegExp(`(?<![A-Za-zÀ-ÿ])(${name(fm)})(\\s+de\\s+|\\s*/\\s*)${fy}(?![0-9])`, 'gi'), (_, word: string, sep: string) => `${keepCase(word, name(tm))}${sep}${ty}`);
}

export interface RepeatCandidate {
  entry: JournalEntry;
  /** Vem marcado: é de categoria recorrente ou já foi, ele próprio, repetido de um mês anterior. */
  suggested: boolean;
  /** Motivo de não poder ser repetido (conta que saiu do plano), ou null. */
  problem: string | null;
}

/**
 * Lançamentos manuais da competência anterior a `targetMonth` que ainda não foram repetidos
 * nela, do mais antigo para o mais recente.
 */
export function repeatCandidates(
  entries: readonly JournalEntry[],
  targetMonth: string,
  accounts: readonly { id: string; nature: string }[]
): RepeatCandidate[] {
  const source = previousMonth(targetMonth);
  const done = new Set(entries.filter((e) => e.date.startsWith(targetMonth) && e.repeatedFromId).map((e) => e.repeatedFromId));
  const analytic = new Set(accounts.filter((a) => a.nature === 'ANALYTIC').map((a) => a.id));
  return entries
    .filter((e) => e.date.startsWith(source) && !done.has(e.id))
    .sort((a, b) => a.date.localeCompare(b.date) || a.entryNumber - b.entryNumber)
    .map((entry) => {
      const missing = entry.lines.find((l) => !analytic.has(l.accountId));
      return {
        entry,
        suggested: !missing && (Boolean(entry.repeatedFromId) || RECURRING_CATEGORIES.has(entry.category)),
        problem: missing ? `${['A conta', missing.accountCode, missing.accountName].filter(Boolean).join(' ')} não aceita mais lançamentos.` : null,
      };
    });
}

/**
 * Cópia de `entry` para a competência `targetMonth`: mesmas partidas e valores, mesmo dia do
 * mês, histórico e documento com a competência atualizada. O comprovante não é copiado (é do
 * mês de origem). Número, autor e datas de gravação ficam com quem grava.
 */
export function repeatDraft(
  entry: JournalEntry,
  targetMonth: string
): Pick<JournalEntry, 'clientId' | 'date' | 'memo' | 'category' | 'lines' | 'totalAmount' | 'documentRef' | 'repeatedFromId'> {
  const source = entry.date.slice(0, 7);
  const shift = (text: string) => shiftCompetence(text, source, targetMonth);
  return {
    clientId: entry.clientId,
    date: sameDayIn(entry.date, targetMonth),
    memo: shift(entry.memo),
    category: entry.category,
    lines: entry.lines.map((l) => ({ ...l, ...(l.memo ? { memo: shift(l.memo) } : {}) })),
    totalAmount: entry.totalAmount,
    ...(entry.documentRef ? { documentRef: shift(entry.documentRef) } : {}),
    repeatedFromId: entry.id,
  };
}
