import { describe, expect, it } from 'vitest';
import { defaultNotes, mergeNotes, placeholdersIn } from '@/lib/notes';

const client = { name: 'ALPHA LTDA', cnpj: '11222333000181', regime: 'SIMPLES_NACIONAL' as const };

describe('notas explicativas', () => {
  it('base de preparação cita a norma do porte, nunca a ITG 1000', () => {
    const micro = defaultNotes(client, '2025').find((n) => n.id === 'basis')!;
    expect(micro.text).toMatch(/NBC TG 1002 - Contabilidade para Microentidades/);
    expect(micro.text).toMatch(/31 de dezembro de 2025/);
    const small = defaultNotes({ ...client, porte: 'PEQUENA_EMPRESA' }, '2025').find((n) => n.id === 'basis')!;
    expect(small.text).toMatch(/NBC TG 1001 - Contabilidade para Pequenas Empresas/);
    expect(small.text).toMatch(/Lucros ou Prejuízos Acumulados/);
    for (const n of defaultNotes(client, '2025')) expect(n.text).not.toMatch(/ITG 1000/);
  });

  it('contexto traz razão social, CNPJ formatado e regime', () => {
    const ctx = defaultNotes(client, '2025').find((n) => n.id === 'context')!;
    expect(ctx.text).toMatch(/ALPHA LTDA, inscrita no CNPJ sob o nº 11\.222\.333\/0001-81/);
    expect(ctx.text).toMatch(/Simples Nacional/);
    expect(placeholdersIn(ctx.text).length).toBeGreaterThan(0);
  });

  it('CBS e IBS: marcada no regime normal, desmarcada no Simples; texto de 2026 com as alíquotas-teste', () => {
    const simples = defaultNotes(client, '2026').find((n) => n.id === 'consumption-taxes')!;
    expect(simples.enabled).toBe(false);
    const presumido = defaultNotes({ ...client, regime: 'LUCRO_PRESUMIDO' }, '2026').find((n) => n.id === 'consumption-taxes')!;
    expect(presumido.enabled).toBe(true);
    expect(presumido.text).toMatch(/CBS \(0,9%\) e o IBS \(0,1%\)/);
    expect(presumido.text).toMatch(/arts\. 343, 346 e 348, § 1º, da Lei Complementar nº 214\/2025 e dos itens 17, 29\.5 e 29\.7 da Orientação Técnica CFC nº 01\/2026 \(combinados com a NBC TG 25\)/);
    expect(presumido.text).not.toMatch(/493/);
    expect(defaultNotes({ ...client, regime: 'LUCRO_REAL' }, '2025').find((n) => n.id === 'consumption-taxes')!.text).toMatch(/a partir de 2026/);
  });

  it('patrimônio líquido preenchido com os saldos de 31/12', () => {
    const figures = { capital: 50000, capitalToPay: 10000, netResult: 3767.5, distributions: 1000, retained: 12500.25, closed: true };
    const equity = defaultNotes(client, '2025', figures).find((n) => n.id === 'equity')!.text;
    expect(equity).toMatch(/capital social subscrito é de R\$\s50\.000,00, dos quais R\$\s10\.000,00 a integralizar/);
    expect(equity).toMatch(/O lucro de R\$\s3\.767,50 do exercício de 2025 foi transferido/);
    expect(equity).toMatch(/distribuídos lucros aos sócios no valor de R\$\s1\.000,00/);
    expect(equity).toMatch(/saldo de lucros acumulados é de R\$\s12\.500,25/);
    const open = defaultNotes(client, '2025', { ...figures, capitalToPay: 0, netResult: -200, distributions: 0, retained: -200, closed: false }).find((n) => n.id === 'equity')!.text;
    expect(open).toMatch(/totalmente integralizado/);
    expect(open).toMatch(/O prejuízo de R\$\s200,00 do exercício de 2025 será transferido, no encerramento do exercício,/);
    expect(open).toMatch(/saldo de prejuízos acumulados é de R\$\s200,00/);
    // Sem saldos, ficam os campos a preencher.
    expect(placeholdersIn(defaultNotes(client, '2025').find((n) => n.id === 'equity')!.text).length).toBeGreaterThan(0);
  });

  it('rascunho guardado substitui texto e seleção, mantendo a ordem e os blocos novos', () => {
    const defaults = defaultNotes(client, '2025');
    const merged = mergeNotes(defaults, [{ id: 'subsequent', text: 'Nada a relatar.', enabled: false }, { id: 'context', title: 'Contexto' }]);
    expect(merged.map((n) => n.id)).toEqual(defaults.map((n) => n.id));
    expect(merged.find((n) => n.id === 'subsequent')).toMatchObject({ text: 'Nada a relatar.', enabled: false });
    expect(merged.find((n) => n.id === 'context')?.title).toBe('Contexto');
    expect(mergeNotes(defaults, null)).toEqual(defaults);
  });
});
