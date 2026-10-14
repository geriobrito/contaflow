import type { JournalEntry, JournalEntryLine } from '@/types/firestore';
import { isISODate } from '@/lib/periods';

/**
 * Máximo de partidas por lançamento manual. As regras do Firestore não têm laços: somam
 * as partidas uma a uma (`linesNet` em firestore.rules), e este é o teto de lá.
 */
export const MAX_JOURNAL_LINES = 20;

const toCents = (n: number) => Math.round(n * 100);

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
