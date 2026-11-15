import { beforeEach, describe, expect, it } from 'vitest';
import type { BankAccount, BankTransaction, PeriodLock } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { createLocalRepository, type KeyValueStore } from '@/lib/data/local-repository';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { buildPayrollJournalDraft, buildPayrollSummary, DEFAULT_PAYROLL_MAPPING, matchBankTransactionsWithPayroll } from '@/lib/payroll';
import { loadPayrollContext } from '@/lib/services/payroll-service';

function memoryStore(): KeyValueStore {
  const dump = new Map<string, string>();
  return { getItem: (k) => dump.get(k) ?? null, setItem: (k, v) => void dump.set(k, v) };
}

const accounts = buildITG1000Chart('c1', '2026-01-01T00:00:00Z');
const idOf = (code: string) => accounts.find((a) => a.code === code)!.id;
const inssId = idOf(DEFAULT_PAYROLL_MAPPING.inssPayableCode);
const bankLedgerId = accounts.find((a) => a.nature === 'ANALYTIC' && a.type === 'ASSET')!.id;
const banks: BankAccount[] = [{ id: 'b1', clientId: 'c1', accountKey: 'k1', nickname: 'Itaú', ledgerAccountId: bankLedgerId, createdAt: '', updatedAt: '' }];

/** Guia de INSS paga no banco, já classificada em 2.1.1.03. */
const guide = (id: string, date: string, amount: number): BankTransaction => ({
  id,
  clientId: 'c1',
  fitid: id,
  date,
  amount: -amount,
  type: 'DEBIT',
  memo: 'DARF PREVIDENCIARIO',
  status: 'RECONCILED',
  accountId: inssId,
  accountCode: DEFAULT_PAYROLL_MAPPING.inssPayableCode,
  accountName: 'INSS a Recolher',
  accountKey: 'k1',
  createdAt: '',
});

/** Pró-labore fixo: 3.000,00 brutos e 330,00 de INSS todo mês. */
const payroll = (month: string) => ({ month, grossProLabore: 3000, inssProLabore: 330 });

describe('folha — saldo anterior das contas a pagar (carregamento da competência)', () => {
  let repo: DataRepository;

  /** Provisão da folha da competência no Diário (último dia do mês). */
  const provision = async (month: string) => {
    const draft = buildPayrollJournalDraft(payroll(month), accounts);
    await repo.createJournalEntry(
      { ...draft, id: `je_${month}`, clientId: 'c1', createdAt: '', updatedAt: '', createdByUid: 'u' },
      { id: `audit_${month}`, clientId: 'c1', action: 'JOURNAL_CREATE', actorUid: 'u', at: '' }
    );
  };
  const close = (month: string) => {
    const lock: PeriodLock = { id: `c1_${month}`, clientId: 'c1', month, lockedAt: 'T', lockedByUid: 'u' };
    return repo.closePeriod(lock, { id: '', clientId: 'c1', action: 'PERIOD_CLOSE', actorUid: 'u', at: 'T', month });
  };
  const inssOfFebruary = async () => {
    const ctx = await loadPayrollContext('c1', '2026-02', repo);
    const summary = buildPayrollSummary('c1', payroll('2026-02'), ['je_2026-02'], '');
    const inss = matchBankTransactionsWithPayroll(summary, ctx.windowTransactions, ctx.accounts, DEFAULT_PAYROLL_MAPPING, {
      priorBalances: ctx.priorBalances,
      today: '2026-02-25',
    }).find((m) => m.key === 'inss')!;
    return { ctx, inss };
  };

  beforeEach(async () => {
    repo = createLocalRepository(memoryStore());
    await repo.insertAccounts(accounts);
    await repo.saveBankAccount(banks[0]);
    await provision('2026-01');
    await provision('2026-02');
  });

  it('a guia de janeiro, paga em fevereiro, baixa janeiro e não a folha de fevereiro', async () => {
    await repo.insertTransactions([guide('jan', '2026-02-20', 330)]);

    const { ctx, inss } = await inssOfFebruary();
    // No início de fevereiro a conta devia a provisão de janeiro.
    expect(ctx.priorBalances.get(inssId)).toBe(330);
    expect(ctx.windowTransactions.map((t) => t.id)).toEqual(['jan']);
    expect(ctx.monthEntries.map((e) => e.payrollMonth)).toEqual(['2026-02']);
    expect(inss.status).toBe('PENDING');
    expect(inss.priorTransactions.map((t) => t.id)).toEqual(['jan']);

    // Paga a guia de fevereiro em março: aí sim a competência fica quitada.
    await repo.insertTransactions([guide('fev', '2026-03-20', 330)]);
    const after = await inssOfFebruary();
    expect(after.inss.status).toBe('SETTLED');
    expect(after.inss.reconciledTransactions.map((t) => t.id)).toEqual(['fev']);
  });

  it('pagamento feito antes da competência reduz o saldo anterior, com janeiro aberto ou fechado (consolidado)', async () => {
    // Parte da guia de janeiro paga ainda em janeiro: sobra 230,00 para fevereiro quitar.
    await repo.insertTransactions([guide('adiantado', '2026-01-31', 100), guide('resto', '2026-02-20', 330)]);

    const open = await inssOfFebruary();
    expect(open.ctx.priorBalances.get(inssId)).toBe(230);
    // Dos 330,00 pagos em fevereiro, 230,00 fecham janeiro e 100,00 já contam para fevereiro.
    expect(open.inss.paid).toBe(100);
    expect(open.inss.status).toBe('PARTIAL');

    // Com janeiro fechado, os lançamentos dele chegam pelo consolidado: o saldo é o mesmo.
    await close('2026-01');
    const closed = await inssOfFebruary();
    expect(closed.ctx.priorBalances.get(inssId)).toBe(230);
    expect(closed.ctx.windowTransactions.map((t) => t.id)).toEqual(['resto']);
    expect(closed.inss.paid).toBe(100);
  });
});
