import { describe, expect, it } from 'vitest';
import type { BankTransaction } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { loadRuleSample } from '@/lib/services/reconciliation-service';

const tx = (clientId: string, id: string, date: string, status: BankTransaction['status'] = 'RECONCILED'): BankTransaction => ({
  id: `${clientId}_${id}`,
  clientId,
  fitid: id,
  date,
  amount: -10,
  type: 'DEBIT',
  memo: id,
  status,
  createdAt: '',
});

describe('amostra de lançamentos da tela de Regras', () => {
  it('traz os últimos 12 meses e os pendentes de qualquer período, sem repetir', async () => {
    const repo = getRepository();
    await repo.insertTransactions([
      tx('amostra', 'antigo', '2023-06-10'),
      tx('amostra', 'antigo-pendente', '2023-06-11', 'PENDING'),
      tx('amostra', 'limite-fora', '2024-03-31'),
      tx('amostra', 'limite-dentro', '2024-04-01'),
      tx('amostra', 'recente-pendente', '2025-02-01', 'PENDING'),
      tx('amostra', 'ultimo', '2025-03-15'),
      tx('outro', 'x', '2025-03-20', 'PENDING'),
    ]);
    expect((await loadRuleSample('amostra')).map((t) => t.fitid)).toEqual(['ultimo', 'recente-pendente', 'limite-dentro', 'antigo-pendente']);
    expect((await loadRuleSample('amostra', 1)).map((t) => t.fitid)).toEqual(['ultimo', 'recente-pendente', 'antigo-pendente']);
  });

  it('cliente sem lançamentos devolve lista vazia', async () => {
    expect(await loadRuleSample('vazio')).toEqual([]);
  });
});
