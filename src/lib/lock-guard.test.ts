import { describe, expect, it } from 'vitest';
import type { BankAccount, ChartAccount, LockState, OpeningBalances } from '@/types/firestore';
import {
  canDeleteRule,
  formatLockedMonthsSummary,
  initialLockState,
  isFrozen,
  isOpeningFrozen,
  nextLockStateOnClose,
  nextLockStateOnReopen,
  nextLockStateOnYearClose,
  prepareProtectedSave,
  preserveLockSeq,
  stampLockSeq,
  touchesProtected,
} from '@/lib/lock-guard';

const state = (count: number, seq: number, clientId = 'c1'): LockState => ({
  id: clientId,
  clientId,
  count,
  seq,
});

const baseOpening = (overrides: Partial<OpeningBalances> = {}): OpeningBalances => ({
  id: 'c1',
  clientId: 'c1',
  date: '2025-01-01',
  mode: 'OPENING_BALANCE',
  memo: 'Balanço de abertura',
  entries: [{ accountId: 'a1', amount: 1000 }],
  updatedAt: '2025-01-01T00:00:00Z',
  ...overrides,
});

const baseBank = (overrides: Partial<BankAccount> = {}): BankAccount => ({
  id: 'c1_k1',
  clientId: 'c1',
  accountKey: 'k1',
  kind: 'BANK',
  nickname: 'Itaú Movimento',
  ledgerAccountId: 'acc_bank',
  ledgerAccountCode: '1.1.1.02',
  ledgerAccountName: 'Bancos',
  openingBalance: 1500,
  openingDate: '2025-01-01',
  createdAt: '2025-01-01',
  updatedAt: '2025-01-01',
  ...overrides,
});

const baseAccount = (overrides: Partial<ChartAccount> = {}): ChartAccount => ({
  id: 'acc1',
  clientId: 'c1',
  code: '3.3.2.07',
  name: 'Aluguéis',
  type: 'EXPENSE',
  nature: 'ANALYTIC',
  parentId: 'p1',
  level: 4,
  dreGroup: 'OPERATING_EXPENSES',
  createdAt: '2025-01-01',
  updatedAt: '2025-01-01',
  ...overrides,
});

describe('lock-guard', () => {
  describe('isFrozen e isOpeningFrozen', () => {
    it('libera quando nenhuma competência está fechada (count === 0), mesmo sem lockSeq', () => {
      expect(isFrozen({ lockSeq: undefined }, state(0, 0))).toBe(false);
      expect(isFrozen({ lockSeq: 0 }, state(0, 5))).toBe(false);
      expect(isOpeningFrozen(null, state(0, 3))).toBe(false);
    });

    it('congela quando um fechamento posterior avançou seq', () => {
      const s0 = initialLockState('c1');
      const doc = stampLockSeq(baseBank(), s0);
      expect(doc.lockSeq).toBe(0);
      expect(isFrozen(doc, s0)).toBe(false);

      const s1 = nextLockStateOnClose(s0, 'c1_2025-01');
      expect(s1).toMatchObject({ count: 1, seq: 1 });
      expect(isFrozen(doc, s1)).toBe(true);
    });

    it('mantém editável cadastro criado ou gravado depois do último fechamento (lockSeq === seq)', () => {
      const s1 = state(1, 1);
      const createdAfterLock = stampLockSeq(baseAccount(), s1);
      expect(isFrozen(createdAfterLock, s1)).toBe(false);

      // Encerramento do exercício também avança seq sem mudar count: congela a conta.
      const afterYear = nextLockStateOnYearClose(s1, 'au_year_2025');
      expect(afterYear).toMatchObject({ count: 1, seq: 2 });
      expect(isFrozen(createdAfterLock, afterYear)).toBe(true);
    });

    it('libera novamente ao reabrir todas as competências (count volta a 0)', () => {
      const s0 = initialLockState('c1');
      const doc = stampLockSeq(baseOpening(), s0);
      const s1 = nextLockStateOnClose(s0, 'c1_2025-01');
      const s2 = nextLockStateOnClose(s1, 'c1_2025-02');
      expect(isFrozen(doc, s2)).toBe(true);

      const r1 = nextLockStateOnReopen(s2, 'c1_2025-02');
      expect(r1).toMatchObject({ count: 1, seq: 2 });
      expect(isFrozen(doc, r1)).toBe(true); // ainda resta uma fechada

      const r0 = nextLockStateOnReopen(r1, 'c1_2025-01');
      expect(r0).toMatchObject({ count: 0, seq: 2 });
      expect(isFrozen(doc, r0)).toBe(false);
    });

    it('congela documento antigo sem lockSeq quando há competência fechada', () => {
      expect(isFrozen(baseBank(), state(1, 1))).toBe(true);
      expect(isOpeningFrozen(baseOpening(), state(1, 1))).toBe(true);
    });

    it('falha fechado quando lockState está ausente (empresa antes do backfill)', () => {
      expect(isFrozen(baseBank({ lockSeq: 0 }), null)).toBe(true);
      expect(isOpeningFrozen(null, null)).toBe(true);
    });

    it('D1: bloqueia primeiro cadastro de saldos de abertura se já há competência fechada', () => {
      expect(isOpeningFrozen(null, state(1, 1))).toBe(true);
      expect(() => prepareProtectedSave('opening_balances', null, baseOpening(), state(1, 1), ['2025-03'])).toThrow(
        /março de 2025/
      );
    });

    it('D3: mantém estrutura de conta global sempre congelada, mesmo com count === 0', () => {
      const globalAcc = baseAccount({ clientId: 'global' });
      expect(isFrozen(globalAcc, state(0, 0))).toBe(true);
      expect(() =>
        prepareProtectedSave('chart_of_accounts', globalAcc, { ...globalAcc, dreGroup: 'COSTS' }, state(0, 0))
      ).toThrow(/compartilhada/);
      // Nome e descrição continuam livres.
      const renamed = prepareProtectedSave('chart_of_accounts', globalAcc, { ...globalAcc, name: 'Novo Nome' }, state(0, 0));
      expect(renamed.name).toBe('Novo Nome');
      expect(renamed.lockSeq).toBeUndefined();
    });
  });

  describe('touchesProtected e prepareProtectedSave', () => {
    it('permite alterar campos livres mesmo com competência fechada, preservando lockSeq', () => {
      const s1 = state(1, 2);
      const bankBefore = baseBank({ lockSeq: 0 });
      // Formulário reconstruiu o objeto sem passar lockSeq, alterando apenas nickname e csvPreset.
      const bankDraft: BankAccount = {
        ...baseBank(),
        nickname: 'Itaú Conta Principal',
        csvPreset: { delimiter: ';', mapping: { dateCol: 0, memoCol: 1, valueMode: 'single', amountCol: 2, hasHeader: true } },
        updatedAt: '2025-04-01',
      };
      expect(touchesProtected('bank_accounts', bankBefore, bankDraft)).toBe(false);
      const savedBank = prepareProtectedSave('bank_accounts', bankBefore, bankDraft, s1);
      expect(savedBank.nickname).toBe('Itaú Conta Principal');
      expect(savedBank.lockSeq).toBe(0);

      const accBefore = baseAccount(); // legado sem lockSeq
      const accDraft = { ...accBefore, name: 'Aluguéis e Condomínios', description: 'Sede' };
      expect(touchesProtected('chart_of_accounts', accBefore, accDraft)).toBe(false);
      const savedAcc = prepareProtectedSave('chart_of_accounts', accBefore, accDraft, s1);
      expect(savedAcc.name).toBe('Aluguéis e Condomínios');
      expect('lockSeq' in savedAcc).toBe(false);
    });

    it('recusa tentativa de alterar só o lockSeq para destravar o documento', () => {
      const s1 = state(1, 1);
      const before = baseBank({ lockSeq: 0 });
      const forged = { ...before, lockSeq: 1 };
      expect(touchesProtected('bank_accounts', before, forged)).toBe(true);
      expect(() => prepareProtectedSave('bank_accounts', before, forged, s1, ['2025-01'])).toThrow(/janeiro de 2025/);
    });

    it('detecta alterações em todos os grupos de campos protegidos e carimba novo lockSeq quando permitido', () => {
      const s = state(0, 4);
      expect(touchesProtected('bank_accounts', baseBank(), baseBank({ openingBalance: 2000 }))).toBe(true);
      expect(touchesProtected('bank_accounts', baseBank(), baseBank({ openingDate: '2025-02-01' }))).toBe(true);
      expect(touchesProtected('bank_accounts', baseBank(), baseBank({ ledgerAccountId: 'outra' }))).toBe(true);
      expect(touchesProtected('bank_accounts', baseBank(), baseBank({ kind: 'CARD' }))).toBe(true);

      expect(touchesProtected('chart_of_accounts', baseAccount(), baseAccount({ code: '3.3.2.08' }))).toBe(true);
      expect(touchesProtected('chart_of_accounts', baseAccount(), baseAccount({ dreGroup: 'COSTS' }))).toBe(true);
      expect(touchesProtected('chart_of_accounts', baseAccount(), baseAccount({ isContra: true }))).toBe(true);
      expect(touchesProtected('chart_of_accounts', baseAccount(), baseAccount({ nature: 'SYNTHETIC' }))).toBe(true);

      expect(touchesProtected('opening_balances', baseOpening(), baseOpening({ entries: [] }))).toBe(true);
      expect(touchesProtected('opening_balances', baseOpening(), baseOpening({ date: '2025-02-01' }))).toBe(true);

      const updated = prepareProtectedSave('bank_accounts', baseBank({ lockSeq: 1 }), baseBank({ openingBalance: 999 }), s);
      expect(updated.lockSeq).toBe(4);
    });

    it('preserveLockSeq mantém ou omite lockSeq conforme o documento anterior', () => {
      expect(preserveLockSeq({ lockSeq: 3 }, { a: 1, lockSeq: 9 })).toEqual({ a: 1, lockSeq: 3 });
      expect(preserveLockSeq({}, { a: 1, lockSeq: 9 })).toEqual({ a: 1 });
    });
  });

  describe('mensagens e permissões de regra (D2)', () => {
    it('resume lista de competências fechadas', () => {
      expect(formatLockedMonthsSummary(['2025-03', '2025-01'])).toBe('janeiro de 2025, março de 2025');
      expect(formatLockedMonthsSummary(['2025-01', '2025-02', '2025-03', '2025-04'])).toBe(
        'janeiro de 2025, fevereiro de 2025, março de 2025 e mais 1'
      );
    });

    it('canDeleteRule libera administrador em tudo e operador apenas nas regras próprias', () => {
      expect(canDeleteRule({}, 'carol', true)).toBe(true);
      expect(canDeleteRule({ createdByUid: 'alice' }, 'carol', true)).toBe(true);
      expect(canDeleteRule({ createdByUid: 'carol' }, 'carol', false)).toBe(true);
      expect(canDeleteRule({ createdByUid: 'alice' }, 'carol', false)).toBe(false);
      expect(canDeleteRule({}, 'carol', false)).toBe(false);
    });
  });
});

