import { describe, expect, it } from 'vitest';
import type { CompanyPorte } from '@/types/firestore';
import { accountingStandard, accountingStandardCode, porteOf } from '@/lib/accounting-standard';

describe('norma contábil pelo porte', () => {
  it('microentidade: NBC TG 1002; pequena empresa: NBC TG 1001', () => {
    expect(accountingStandard({ porte: 'MICROENTIDADE' })).toBe('NBC TG 1002 - Microentidades');
    expect(accountingStandard({ porte: 'PEQUENA_EMPRESA' })).toBe('NBC TG 1001 - Pequenas Empresas');
    expect(accountingStandardCode({ porte: 'PEQUENA_EMPRESA' })).toBe('NBC TG 1001');
  });

  it('cadastro sem porte (ou com valor desconhecido) conta como microentidade', () => {
    expect(porteOf({})).toBe('MICROENTIDADE');
    expect(porteOf(null)).toBe('MICROENTIDADE');
    expect(porteOf({ porte: 'GRANDE' as CompanyPorte })).toBe('MICROENTIDADE');
    expect(accountingStandard(undefined)).toBe('NBC TG 1002 - Microentidades');
  });

  it('nunca cita a ITG 1000, revogada', () => {
    for (const porte of ['MICROENTIDADE', 'PEQUENA_EMPRESA'] as const) {
      expect(accountingStandard({ porte })).not.toMatch(/ITG/);
    }
  });
});
