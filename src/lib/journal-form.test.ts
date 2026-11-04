import { describe, expect, it } from 'vitest';
import type { JournalEntryLine } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { JOURNAL_TEMPLATES, MAX_JOURNAL_LINES } from '@/lib/journal';
import { buildJournalEntry, emptyJournalLines, nextJournalLine, parseTemplateValues, type JournalForm } from '@/lib/journal-form';

const chart = buildITG1000Chart('c', '2025-01-01T00:00:00.000Z');
const acc = (code: string) => chart.find((a) => a.code === code)!;

const line = (id: string, type: 'DEBIT' | 'CREDIT', amount: number, accountId = ''): JournalEntryLine => ({ id, accountId, type, amount, memo: '' });

describe('partidas', () => {
  it('começa com um débito e um crédito vazios', () => {
    expect(emptyJournalLines().map((l) => [l.type, l.amount, l.accountId])).toEqual([
      ['DEBIT', 0, ''],
      ['CREDIT', 0, ''],
    ]);
  });

  it('nova partida: lado oposto à última; crédito já com o que falta', () => {
    expect(nextJournalLine([line('1', 'DEBIT', 1000.1), line('2', 'CREDIT', 400)], 'n')).toMatchObject({ id: 'n', type: 'DEBIT', amount: 0 });
    expect(nextJournalLine([line('1', 'DEBIT', 1000.1), line('2', 'CREDIT', 400), line('3', 'DEBIT', 0.2)], 'n')).toMatchObject({ type: 'CREDIT', amount: 600.3 });
    // Créditos maiores que os débitos: o crédito novo vem zerado.
    expect(nextJournalLine([line('1', 'CREDIT', 50), line('2', 'DEBIT', 10)], 'n')).toMatchObject({ type: 'CREDIT', amount: 0 });
    expect(nextJournalLine(Array.from({ length: MAX_JOURNAL_LINES }, (_, i) => line(`${i}`, 'DEBIT', 1)), 'n')).toBeNull();
  });
});

describe('valores dos modelos', () => {
  const template = JOURNAL_TEMPLATES[0];

  it('lê "1.234,56"; em branco vale zero; inválido aponta o campo', () => {
    const raw = Object.fromEntries(template.fields.map((f, i) => [f.key, i === 0 ? '1.234,56' : '']));
    const parsed = parseTemplateValues(template, raw);
    expect('values' in parsed && parsed.values[template.fields[0].key]).toBe(1234.56);
    const bad = parseTemplateValues(template, { [template.fields[0].key]: 'abc' });
    expect(bad).toEqual({ problem: expect.stringContaining(template.fields[0].label) });
  });
});

describe('lançamento a gravar', () => {
  const debit = acc('3.3.2.10');
  const credit = acc('2.1.1.01');
  const form = (over: Partial<JournalForm> = {}): JournalForm => ({
    clientId: 'c',
    date: '2025-03-31',
    category: 'PROVISION',
    memo: '  Provisão de material  ',
    documentRef: ' ',
    attachmentUrl: '',
    lines: [
      { ...line('1', 'DEBIT', 150, debit.id), memo: ' material ' },
      line('2', 'CREDIT', 150, credit.id),
    ],
    ...over,
  });

  it('partidas com código e nome da conta; textos vazios saem', () => {
    const built = buildJournalEntry(form({ attachmentUrl: 'https://drive.google.com/file/d/abc' }), chart);
    expect('entry' in built).toBe(true);
    if (!('entry' in built)) return;
    expect(built.entry).toMatchObject({
      clientId: 'c',
      memo: 'Provisão de material',
      totalAmount: 150,
      documentRef: undefined,
      attachmentUrl: 'https://drive.google.com/file/d/abc',
      createdByUid: '',
    });
    expect(built.entry.lines[0]).toMatchObject({ accountCode: debit.code, accountName: debit.name, memo: 'material' });
    expect(built.entry.lines[1].memo).toBeUndefined();
  });

  it('recusa competência fechada, sem histórico, desbalanceado e comprovante que não é link', () => {
    expect(buildJournalEntry(form(), chart, '2025-03')).toEqual({ problem: 'A competência 2025-03 está bloqueada para alterações.' });
    expect(buildJournalEntry(form({ memo: ' ' }), chart)).toEqual({ problem: expect.stringMatching(/histórico/) });
    expect(buildJournalEntry(form({ lines: [line('1', 'DEBIT', 150, debit.id), line('2', 'CREDIT', 100, credit.id)] }), chart)).toHaveProperty('problem');
    expect(buildJournalEntry(form({ attachmentUrl: 'C:\\notas\\nf.pdf' }), chart)).toEqual({ problem: expect.stringMatching(/^Link do comprovante: /) });
  });
});
