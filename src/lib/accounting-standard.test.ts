import { describe, expect, it } from 'vitest';
import type { CompanyPorte } from '@/types/firestore';
import { accountingStandard, accountingStandardCode, conformityStatement, porteOf } from '@/lib/accounting-standard';

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

describe('declaração de conformidade', () => {
  it('cita a norma do porte e a atividade operacional', () => {
    expect(conformityStatement({ porte: 'MICROENTIDADE', activity: 'Fabricação de produtos de panificação.' })).toBe(
      'Declaração de conformidade: estas demonstrações contábeis foram elaboradas de acordo com a NBC TG 1002 - Contabilidade para Microentidades, aprovada pelo Conselho Federal de Contabilidade (CFC). Atividade operacional da entidade: Fabricação de produtos de panificação.'
    );
    expect(conformityStatement({ porte: 'PEQUENA_EMPRESA', activity: 'Comércio varejista' })).toMatch(/NBC TG 1001 - Contabilidade para Pequenas Empresas.*Atividade operacional da entidade: Comércio varejista\.$/);
  });

  it('sem atividade no cadastro, sai só a declaração', () => {
    const text = conformityStatement({ porte: 'MICROENTIDADE', activity: '   ' });
    expect(text).toMatch(/\(CFC\)\.$/);
    expect(text).not.toMatch(/Atividade/);
    expect(conformityStatement(null)).toMatch(/NBC TG 1002/);
  });
});
