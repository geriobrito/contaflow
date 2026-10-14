import { describe, expect, it } from 'vitest';
import { assertValidJournalEntry, journalEntryProblem, journalTotals, MAX_JOURNAL_LINES } from '@/lib/journal';
import type { JournalEntryLine } from '@/types/firestore';

const line = (type: 'DEBIT' | 'CREDIT', amount: number, accountId = 'acc'): JournalEntryLine => ({
  id: `${type}-${amount}-${Math.random()}`,
  accountId,
  type,
  amount,
});

const entry = (lines: JournalEntryLine[], date = '2025-03-31') => ({ date, lines });

describe('lançamentos manuais: partidas dobradas', () => {
  it('soma em centavos (sem erro de ponto flutuante)', () => {
    expect(journalTotals([line('DEBIT', 0.1), line('DEBIT', 0.2), line('CREDIT', 0.3)])).toEqual({ debit: 0.3, credit: 0.3, difference: 0 });
  });

  it('aceita lançamento equilibrado, simples ou composto', () => {
    expect(journalEntryProblem(entry([line('DEBIT', 100), line('CREDIT', 100)]))).toBeNull();
    expect(journalEntryProblem(entry([line('DEBIT', 0.1), line('DEBIT', 0.2), line('CREDIT', 0.3)]))).toBeNull();
  });

  it('recusa débito diferente de crédito', () => {
    expect(journalEntryProblem(entry([line('DEBIT', 100), line('CREDIT', 99.99)]))).toMatch(/desbalanceado em R\$ 0,01/);
    expect(journalEntryProblem(entry([line('DEBIT', 100), line('DEBIT', 100)]))).toMatch(/desbalanceado/);
    expect(() => assertValidJournalEntry(entry([line('DEBIT', 100), line('CREDIT', 50)]))).toThrow(/desbalanceado/);
  });

  it('recusa partida sem conta, com valor não positivo ou tipo desconhecido', () => {
    expect(journalEntryProblem(entry([line('DEBIT', 100, ''), line('CREDIT', 100)]))).toMatch(/linha #1 está sem conta/);
    expect(journalEntryProblem(entry([line('DEBIT', 0), line('CREDIT', 0)]))).toMatch(/valor zerado/);
    expect(journalEntryProblem(entry([line('DEBIT', -5), line('CREDIT', -5)]))).toMatch(/valor zerado/);
    expect(journalEntryProblem(entry([line('DEBIT', Number.NaN), line('CREDIT', 1)]))).toMatch(/valor zerado/);
    expect(journalEntryProblem(entry([{ ...line('DEBIT', 5), type: 'X' as never }, line('CREDIT', 5)]))).toMatch(/não é débito nem crédito/);
  });

  it('exige de 2 partidas até o teto das regras, e data válida', () => {
    expect(journalEntryProblem(entry([line('DEBIT', 1)]))).toMatch(/pelo menos 2/);
    const many = Array.from({ length: MAX_JOURNAL_LINES / 2 }, () => [line('DEBIT', 1), line('CREDIT', 1)]).flat();
    expect(journalEntryProblem(entry(many))).toBeNull();
    expect(journalEntryProblem(entry([...many, line('DEBIT', 1), line('CREDIT', 1)]))).toMatch(new RegExp(`no máximo ${MAX_JOURNAL_LINES}`));
    expect(journalEntryProblem(entry([line('DEBIT', 1), line('CREDIT', 1)], '2025-3-1'))).toMatch(/data válida/);
  });
});
