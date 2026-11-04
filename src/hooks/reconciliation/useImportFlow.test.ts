import { describe, expect, it } from 'vitest';
import { importToastMessage } from '@/hooks/reconciliation/useImportFlow';
import { importNeedsAttention } from '@/components/conciliacao/ImportSummary';
import type { ImportResult } from '@/hooks/reconciliation/types';

const result = (extra: Partial<ImportResult> = {}): ImportResult => ({
  added: 11,
  duplicates: 0,
  autoClassified: 0,
  latestDate: '2025-03-28',
  balanceCheck: { status: 'BASELINE' },
  gaps: [],
  outOfRange: 0,
  ...extra,
});

describe('resultado da importação', () => {
  it('aviso do rodapé no singular e no plural; duplicados só quando houver', () => {
    expect(importToastMessage(result())).toBe('11 importados · 0 auto-classificados');
    expect(importToastMessage(result({ added: 1, autoClassified: 1, duplicates: 2 }))).toBe('1 importado · 1 auto-classificado · 2 duplicados ignorados');
  });

  it('o cartão de resumo só fica na tela quando há algo a conferir', () => {
    expect(importNeedsAttention(result())).toBe(false);
    expect(importNeedsAttention(result({ balanceCheck: { status: 'OK' } }))).toBe(false);
    expect(importNeedsAttention(result({ balanceCheck: { status: 'MISMATCH', expected: 10, reported: 12, difference: 2 } }))).toBe(true);
    expect(importNeedsAttention(result({ gaps: [{ accountKey: 'k', from: '2025-02-01', to: '2025-02-28' }] }))).toBe(true);
    expect(importNeedsAttention(result({ outOfRange: 3 }))).toBe(true);
  });
});
