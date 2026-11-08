import { describe, expect, it } from 'vitest';
import type { BankTransaction, ClassificationRule } from '@/types/firestore';
import { createRulesWorkerClient, type WorkerLike } from '@/hooks/useRulesWorker';
import {
  evaluateRulesBatch,
  processRulesWorkerMessage,
  type RulesWorkerRequest,
  type RulesWorkerResponse,
} from '@/workers/rules.worker';
import { countAffected, detectRuleConflicts, pendingWonByRule } from '@/lib/reconciliation';
import { assessRuleTerm } from '@/lib/payee';

const makeTx = (id: string, memo: string, extra: Partial<BankTransaction> = {}): BankTransaction => ({
  id,
  clientId: 'c1',
  fitid: id,
  date: '2026-03-10',
  amount: -250,
  type: 'DEBIT',
  memo,
  status: 'PENDING',
  createdAt: '2026-03-10',
  ...extra,
});

const makeRule = (id: string, pattern: string, accountId: string, extra: Partial<ClassificationRule> = {}): ClassificationRule => ({
  id,
  clientId: 'c1',
  pattern,
  accountId,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...extra,
});

describe('Web Worker de regras e favorecidos (rules.worker & useRulesWorker)', () => {
  it('evaluateRulesBatch produz resultados idênticos às funções individuais de conciliação', () => {
    const rules: ClassificationRule[] = [
      makeRule('r1', 'uber', 'acc_transporte', { matchType: 'CONTAINS' }),
      makeRule('r2', 'uber eats', 'acc_alimentacao', { matchType: 'CONTAINS' }),
      makeRule('r3', 'energia eletrica', 'acc_luz', { matchType: 'STARTS_WITH' }),
    ];

    const transactions: BankTransaction[] = [
      makeTx('t1', 'UBER EATS PEDIDO 101'),
      makeTx('t2', 'UBER EATS PEDIDO 102'),
      makeTx('t3', 'UBER TRIP VIAGEM AEROPORTO'),
      makeTx('t4', 'ENERGIA ELETRICA CELPE MARCO', { status: 'RECONCILED', matchedRuleId: 'r3' }),
    ];

    const openPending = transactions.filter((t) => t.status === 'PENDING');
    const memos = transactions.map((t) => t.memo);

    const batch = evaluateRulesBatch({ rules, transactions, openPending });
    const expectedConflicts = detectRuleConflicts(memos, rules);

    expect(new Map(batch.conflictEntries)).toEqual(expectedConflicts);

    for (const rule of rules) {
      expect(batch.metricsByRuleId[rule.id]).toEqual({
        assessment: assessRuleTerm(rule, memos),
        affected: countAffected(rule, transactions),
        pending: pendingWonByRule(openPending, rules, rule).length,
      });
    }
  });

  it('processa GROUP_PAYEES e EVALUATE_RULES via worker assíncrono correlacionando IDs', async () => {
    let terminated = false;
    const fakeWorker: WorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage(req: RulesWorkerRequest) {
        // Simula resposta assíncrona fora de ordem
        const delay = req.type === 'GROUP_PAYEES' ? 15 : 5;
        setTimeout(() => {
          const res: RulesWorkerResponse = processRulesWorkerMessage(req);
          fakeWorker.onmessage?.({ data: res } as MessageEvent<RulesWorkerResponse>);
        }, delay);
      },
      terminate() {
        terminated = true;
      },
    };

    const client = createRulesWorkerClient(() => fakeWorker);

    const txs = [
      makeTx('1', 'Pix enviado - WMS SUPERMERCADOS DO BRASIL LTDA'),
      makeTx('2', 'Pix enviado - WMS SUPERMERCADOS DO BRASIL LTDA'),
      makeTx('3', 'Pagamento de boleto efetuado - Claro S.A.'),
    ];
    const rules = [makeRule('r_wms', 'wms supermercados', 'acc_mercado')];

    // Dispara duas requisições em paralelo
    const [groups, evalRes] = await Promise.all([
      client.groupPayees(txs),
      client.evaluateRules({ rules, transactions: txs, openPending: txs }),
    ]);

    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(groups[0].transactions).toHaveLength(2);
    expect(evalRes.metricsByRuleId['r_wms'].affected).toBe(2);
    expect(evalRes.metricsByRuleId['r_wms'].pending).toBe(2);

    client.terminate();
    expect(terminated).toBe(true);
  });

  it('opera em fallback síncrono transparente quando Worker não está disponível (SSR/Node)', async () => {
    const client = createRulesWorkerClient(() => null);
    const txs = [makeTx('1', 'Pix enviado - ACME FORNECEDOR LTDA'), makeTx('2', 'Pix enviado - ACME FORNECEDOR LTDA')];
    const groups = await client.groupPayees(txs);

    expect(groups).toHaveLength(1);
    expect(groups[0].transactions).toHaveLength(2);
  });
});

