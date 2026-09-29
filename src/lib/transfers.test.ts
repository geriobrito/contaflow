import { describe, expect, it } from 'vitest';
import type { BankTransaction } from '@/types/firestore';
import { findTransferPairs, findTransitAccount } from '@/lib/transfers';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { transferTransition, resetTransition } from '@/lib/transitions';

const tx = (id: string, date: string, amount: number, accountKey: string | undefined, memo = 'X', extra: Partial<BankTransaction> = {}): BankTransaction => ({
  id,
  clientId: 'c',
  fitid: id,
  date,
  amount,
  type: amount < 0 ? 'DEBIT' : 'CREDIT',
  memo,
  status: 'PENDING',
  accountKey,
  createdAt: '',
  ...extra,
});

describe('findTransferPairs', () => {
  it('pareia saída e entrada de mesmo valor entre contas diferentes, em datas próximas', () => {
    const pairs = findTransferPairs([
      tx('a', '2025-03-10', -1500, 'itau', 'TED ENVIADA'),
      tx('b', '2025-03-11', 1500, 'bb', 'TED RECEBIDA'),
      tx('c', '2025-03-10', 1500, 'itau'), // mesma conta: não é transferência
      tx('d', '2025-03-20', 1500, 'nubank'), // longe demais
    ]);
    expect(pairs.map((p) => [p.out.id, p.in.id, p.days, p.hinted])).toEqual([['a', 'b', 1, true]]);
  });

  it('cada lançamento entra em um único par; o mais próximo vence', () => {
    const pairs = findTransferPairs([
      tx('o1', '2025-03-10', -100, 'itau'),
      tx('i1', '2025-03-12', 100, 'bb'),
      tx('i2', '2025-03-10', 100, 'nubank'),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].in.id).toBe('i2');
  });

  it('ignora conciliados, já pareados, rateados, sem conta e meses fechados', () => {
    const pairs = findTransferPairs(
      [
        tx('o1', '2025-03-10', -100, 'itau', 'X', { status: 'RECONCILED' }),
        tx('i1', '2025-03-10', 100, 'bb'),
        tx('o2', '2025-03-10', -200, undefined),
        tx('i2', '2025-03-10', 200, 'bb'),
        tx('o3', '2025-01-10', -300, 'itau'),
        tx('i3', '2025-01-10', 300, 'bb'),
      ],
      { lockedMonths: new Set(['2025-01']) }
    );
    expect(pairs).toEqual([]);
  });

  it('transição: vai para a transitória com o par; desfazer limpa o par', () => {
    const t = tx('a', '2025-03-10', -100, 'itau');
    const { after } = transferTransition(t, { accountId: 'tr', accountCode: '1.1.1.04', accountName: 'Trânsito' }, 'b', 'now');
    expect(after).toMatchObject({ status: 'RECONCILED', accountId: 'tr', transferPairId: 'b' });
    expect(resetTransition(after).after.transferPairId).toBeUndefined();
  });

  it('encontra a conta transitória do modelo ITG 1000', () => {
    expect(findTransitAccount(buildITG1000Chart('c'))?.code).toBe('1.1.1.04');
    expect(findTransitAccount([])).toBeUndefined();
  });
});
