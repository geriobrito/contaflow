import { describe, expect, it } from 'vitest';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { summarizeSplits } from '@/lib/splits';
import { creditSplitDrafts, ibsCbsCredit } from '@/lib/nfe/credits';

const chart = buildITG1000Chart('c', '2025-01-01T00:00:00.000Z');
const acc = (code: string) => chart.find((a) => a.code === code)!.id;
const byId = new Map(chart.map((a) => [a.id, a] as const));

const purchase = { direction: 'PURCHASE' as const, issueDate: '2027-02-10', total: 1000, ibs: 1, cbs: 88 };

describe('crédito de IBS/CBS na compra', () => {
  it('regime regular, a partir de 2027: crédito inteiro no pagamento do total', () => {
    expect(ibsCbsCredit(purchase, -1000, 'LUCRO_PRESUMIDO')).toEqual({ status: 'CREDIT', invoiceIbs: 1, invoiceCbs: 88, ibs: 1, cbs: 88 });
    // Pagamento do total com os tributos (vNFTot): não passa do destaque.
    expect(ibsCbsCredit(purchase, -1089, 'LUCRO_REAL')).toMatchObject({ ibs: 1, cbs: 88 });
  });

  it('parcela: crédito proporcional ao pago', () => {
    expect(ibsCbsCredit(purchase, -250, 'LUCRO_REAL')).toMatchObject({ status: 'CREDIT', ibs: 0.25, cbs: 22 });
  });

  it('2026, Simples Nacional, MEI e venda: só informativo', () => {
    expect(ibsCbsCredit({ ...purchase, issueDate: '2026-12-31' }, -1000, 'LUCRO_REAL')).toMatchObject({ status: 'TEST_YEAR', ibs: 0, cbs: 0 });
    expect(ibsCbsCredit(purchase, -1000, 'SIMPLES_NACIONAL')?.status).toBe('SIMPLES');
    expect(ibsCbsCredit(purchase, -1000, 'MEI')?.status).toBe('SIMPLES');
    expect(ibsCbsCredit({ ...purchase, direction: 'SALE' }, 1000, 'LUCRO_REAL')?.status).toBe('SALE');
  });

  it('nota sem destaque: nada', () => {
    expect(ibsCbsCredit({ ...purchase, ibs: undefined, cbs: undefined }, -1000, 'LUCRO_REAL')).toBeNull();
  });
});

describe('rateio com o crédito', () => {
  it('despesa pelo líquido do crédito e as contas a recuperar; fecha com o pagamento', () => {
    const drafts = creditSplitDrafts(-1000, acc('3.3.2.10'), { ibs: 1, cbs: 88 }, chart)!;
    expect(drafts.map((d) => [d.accountId, d.cents])).toEqual([
      [acc('3.3.2.10'), 91100],
      [acc('1.1.2.07'), 100],
      [acc('1.1.2.08'), 8800],
    ]);
    const summary = summarizeSplits(-1000, drafts, byId);
    expect(summary.isBalanced && summary.isComplete).toBe(true);
  });

  it('só a CBS, sem conta de despesa escolhida ou sem as contas no plano', () => {
    expect(creditSplitDrafts(-1000, acc('3.3.2.10'), { ibs: 0, cbs: 88 }, chart)?.map((d) => d.cents)).toEqual([91200, 8800]);
    // Sem conta de despesa: a linha fica para o contador escolher.
    expect(creditSplitDrafts(-1000, '', { ibs: 1, cbs: 88 }, chart)?.[0].accountId).toBe('');
    expect(creditSplitDrafts(-1000, acc('3.3.2.10'), { ibs: 1, cbs: 88 }, chart.filter((a) => a.code !== '1.1.2.08'))).toBeNull();
    // Crédito maior que o pagamento: não monta.
    expect(creditSplitDrafts(-50, acc('3.3.2.10'), { ibs: 1, cbs: 88 }, chart)).toBeNull();
  });
});
