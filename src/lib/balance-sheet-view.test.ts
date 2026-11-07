import { describe, expect, it } from 'vitest';
import type { BankAccount, JournalEntry } from '@/types/firestore';
import {
  bankSetupIssues,
  formatDC,
  hasClosingIn,
  monthsWithData,
  standardNoteFor,
  statementSignatories,
  trialBalanceStage,
  withoutClosingIn,
} from '@/lib/balance-sheet-view';

const entry = (id: string, date: string, yearClosing = false) => ({ id, date, ...(yearClosing ? { yearClosing: true } : {}) }) as JournalEntry;

describe('balancete', () => {
  it('saldo com natureza; zero vira traço', () => {
    expect(formatDC(1234.5)).toMatch(/1\.234,50 D$/);
    expect(formatDC(-10)).toMatch(/10,00 C$/);
    expect(formatDC(0.004)).toBe('—');
  });

  it('encerramento do exercício dentro do período', () => {
    const entries = [entry('a', '2025-06-30'), entry('enc', '2025-12-31', true)];
    expect(hasClosingIn(entries, { start: '2025-12-01', end: '2025-12-31' })).toBe(true);
    expect(hasClosingIn(entries, { start: '2025-01-01', end: '2025-11-30' })).toBe(false);
    expect(withoutClosingIn(entries, { start: '2025-01-01', end: '2025-12-31' }).map((e) => e.id)).toEqual(['a']);
    // Fora do período, o encerramento continua.
    expect(withoutClosingIn(entries, { start: '2026-01-01', end: '2026-12-31' })).toHaveLength(2);
  });

  it('etapa do balancete', () => {
    expect(trialBalanceStage(false, true)).toBeUndefined();
    expect(trialBalanceStage(true, true)).toBe('Antes do encerramento do exercício');
    expect(trialBalanceStage(true, false)).toMatch(/Após/);
  });

  it('meses com movimento: extrato e manuais, sem o encerramento', () => {
    const months = monthsWithData([{ date: '2025-03-10' }, { date: '2025-03-20' }], [entry('a', '2025-05-31'), entry('enc', '2025-12-31', true)]);
    expect([...months].sort()).toEqual(['2025-03', '2025-05']);
  });
});

describe('avisos e assinaturas', () => {
  it('norma pelo porte, só na aba em que importa', () => {
    expect(standardNoteFor('dfc', 'MICROENTIDADE')).toMatch(/facultativa/);
    expect(standardNoteFor('dmpl', 'MICROENTIDADE')).toMatch(/facultativa/);
    expect(standardNoteFor('dmpl', 'PEQUENA_EMPRESA')).toMatch(/obrigatória/);
    expect(standardNoteFor('bs', 'MICROENTIDADE')).toBeNull();
    expect(standardNoteFor('bs', 'PEQUENA_EMPRESA')).toMatch(/NBC TG 1001/);
    expect(standardNoteFor('dlpa', 'PEQUENA_EMPRESA')).toMatch(/NBC TG 1001/);
    expect(standardNoteFor('tb', 'PEQUENA_EMPRESA')).toBeNull();
  });

  it('bancos sem saldo inicial ou sem conta contábil', () => {
    const banks = [
      { id: 'a', openingBalance: 0, ledgerAccountId: 'x' },
      { id: 'b', ledgerAccountId: 'x' },
      { id: 'c', openingBalance: 10 },
    ] as BankAccount[];
    const { missingOpening, unlinked } = bankSetupIssues(banks);
    expect(missingOpening.map((b) => b.id)).toEqual(['b']);
    expect(unlinked.map((b) => b.id)).toEqual(['c']);
  });

  it('representante legal e contador', () => {
    expect(statementSignatories({ legalRepresentativeName: 'Ana', legalRepresentativeCpf: '1' }, { accountantName: 'Rui', accountantCrc: 'SP-1' })).toEqual({
      legalRepresentative: { name: 'Ana', cpf: '1' },
      accountant: { name: 'Rui', crc: 'SP-1' },
    });
    expect(statementSignatories(null, null)).toEqual({ legalRepresentative: { name: undefined, cpf: undefined }, accountant: undefined });
  });
});
