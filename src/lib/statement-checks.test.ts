import { describe, expect, it } from 'vitest';
import type { ConsistencyCheck } from '@/lib/dre/consistency';
import type { OpeningStatus } from '@/lib/opening';
import {
  awaitingApprovalCheck,
  balanceSheetChecks,
  dreConsistencyChecks,
  openingCheck,
  periodLockCheck,
  summarizeChecks,
  type BalanceChecksInput,
} from '@/lib/statement-checks';

const consistency = (extra: Partial<ConsistencyCheck> = {}): ConsistencyCheck =>
  ({
    isConsistent: true,
    dreNetResult: 1000,
    balanceCurrentResult: 1000,
    difference: 0,
    suspenseAmount: 0,
    pendingCount: 0,
    awaitingApprovalCount: 0,
    unlinkedBanksCount: 0,
    issues: [],
    ...extra,
  }) as ConsistencyCheck;

const balance = (extra: Partial<BalanceChecksInput> = {}): BalanceChecksInput => ({
  trialBalance: false,
  date: '2025-03-31',
  suspense: 0,
  unlinkedBanks: [],
  missingOpeningBanks: [],
  inverted: [],
  missingCapitalCode: null,
  difference: 0,
  trialBalanced: true,
  consistency: null,
  standardNote: null,
  ...extra,
});

describe('resumo das pendências', () => {
  it('ordena por gravidade e conta só o que impede ou pede atenção', () => {
    const s = summarizeChecks([
      { id: 'a', level: 'ok', title: 'confere' },
      { id: 'b', level: 'info', title: 'observação' },
      null,
      { id: 'c', level: 'warn', title: 'atenção' },
      false,
      { id: 'd', level: 'block', title: 'impede' },
    ]);
    expect(s.issues.map((c) => c.id)).toEqual(['d', 'c']);
    expect(s.pending).toBe(2);
    expect(s.blocking).toBe(true);
    expect(s.infos.map((c) => c.id)).toEqual(['b']);
    expect(s.oks.map((c) => c.id)).toEqual(['a']);
  });
});

describe('avisos comuns', () => {
  it('abertura: só aparece quando não conferida, com os motivos', () => {
    expect(openingCheck(null)).toBeNull();
    expect(openingCheck({ verified: true, problems: [] } as unknown as OpeningStatus)).toBeNull();
    const c = openingCheck({ verified: false, problems: ['Saldos de abertura não informados'] } as unknown as OpeningStatus);
    expect(c).toMatchObject({ level: 'warn', title: 'Abertura não conferida', items: ['Saldos de abertura não informados'], href: '/abertura' });
  });

  it('competências: todas fechadas confere; parte aberta pede atenção', () => {
    expect(periodLockCheck({ closed: 0, total: 0 }, 'esta DRE')).toBeNull();
    expect(periodLockCheck({ closed: 3, total: 3 }, 'esta DRE')?.level).toBe('ok');
    expect(periodLockCheck({ closed: 1, total: 3 }, 'esta DRE')).toMatchObject({ level: 'warn', title: '2 de 3 competência(s) do período em aberto' });
    expect(periodLockCheck({ closed: 0, total: 3 }, 'esta DRE')?.title).toBe('Nenhuma competência do período fechada');
  });

  it('auto-classificados aguardando aprovação', () => {
    expect(awaitingApprovalCheck(0)).toBeNull();
    expect(awaitingApprovalCheck(4)?.title).toBe('4 lançamento(s) auto-classificado(s) aguardando aprovação');
  });
});

describe('DRE × Balanço', () => {
  it('confere: uma linha verde', () => {
    expect(dreConsistencyChecks(consistency(), '2025-03-31')).toEqual([{ id: 'dre-pl', level: 'ok', title: 'Resultado confere com o Balanço em 31/03/2025' }]);
  });

  it('pendências viram atenção, divergência impede', () => {
    const c = consistency({
      isConsistent: false,
      dreNetResult: 1000,
      balanceCurrentResult: 900,
      difference: 100,
      issues: [
        { id: 'suspense', type: 'SUSPENSE_ENTRIES', severity: 'warning', title: 'Lançamentos ainda não conciliados', description: '3 pendentes' },
        { id: 'divergence', type: 'DIVERGENCE', severity: 'warning', title: 'Divergência', description: '' },
      ],
    });
    const checks = dreConsistencyChecks(c, '2025-03-31');
    expect(checks.map((x) => [x.id, x.level])).toEqual([
      ['suspense', 'warn'],
      ['dre-pl', 'block'],
    ]);
    expect(checks[0].href).toBe('/');
    expect(checks[1].title).toMatch(/^Divergência de R\$\s100,00 entre a DRE e o Balanço$/);
  });
});

describe('Balanço', () => {
  it('tudo certo: só o que confere, mais a observação da norma', () => {
    const s = summarizeChecks(balanceSheetChecks(balance({ consistency: consistency(), standardNote: 'Pequena empresa: inclui a DFC.' })));
    expect(s.pending).toBe(0);
    expect(s.oks.map((c) => c.title)).toEqual(['Ativo = Passivo + Patrimônio líquido', 'Resultado no PL confere com a DRE']);
    expect(s.infos.map((c) => c.title)).toEqual(['Pequena empresa: inclui a DFC.']);
  });

  it('pendências do balanço e diferença entre ativo e passivo', () => {
    const s = summarizeChecks(
      balanceSheetChecks(
        balance({
          suspense: -5131.5,
          unlinkedBanks: ['Itaú'],
          missingOpeningBanks: ['Nubank'],
          inverted: [{ code: '1.1.2.01', name: 'Clientes', value: -50, side: 'ASSET' }],
          missingCapitalCode: '2.3.1',
          difference: 10,
        })
      )
    );
    expect(s.blocking).toBe(true);
    expect(s.pending).toBe(5);
    expect(s.issues[0].title).toMatch(/^Diferença de R\$\s10,00 entre ativo e passivo \+ PL$/);
    expect(s.issues.find((c) => c.id === 'inverted')?.items?.[0]).toMatch(/^1\.1\.2\.01 Clientes: R\$\s50,00 credor no ativo$/);
    expect(s.infos.map((c) => c.id)).toEqual(['capital']);
  });

  it('balancete: confere débitos e créditos; saldo invertido e capital ficam de fora', () => {
    const s = summarizeChecks(balanceSheetChecks(balance({ trialBalance: true, trialBalanced: false, inverted: [{ code: '1', name: 'X', value: -1, side: 'ASSET' }], missingCapitalCode: '2.3.1' })));
    expect(s.issues.map((c) => c.title)).toEqual(['Débitos e créditos não conferem']);
    expect(s.infos).toEqual([]);
  });
});
