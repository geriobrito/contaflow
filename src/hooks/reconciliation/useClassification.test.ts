import { createElement, type SetStateAction } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BankTransaction, ChartAccount, ClassificationRule, PeriodLock } from '@/types/firestore';
import { setSession } from '@/lib/data/scope';
import { getRepository } from '@/lib/services/data-service';
import { describeError, type ReconciliationStore } from '@/hooks/reconciliation/types';
import { useClassification, type ClassificationActions } from '@/hooks/reconciliation/useClassification';

/**
 * O hook só monta funções (`useCallback`) sobre o estado que recebe: aqui ele é renderizado
 * no servidor, com um estado de teste no lugar do `useReconciliation`, e as ações gravam no
 * repositório local em memória — o mesmo caminho da tela, sem navegador.
 */

const account = (id: string, code: string, extra: Partial<ChartAccount> = {}): ChartAccount => ({
  id,
  clientId: 'global',
  code,
  name: `Conta ${id}`,
  type: 'EXPENSE',
  nature: 'ANALYTIC',
  level: code.split('.').length,
  createdAt: '',
  updatedAt: '',
  ...extra,
});
const ACCOUNTS = [
  account('grupo', '3.3', { nature: 'SYNTHETIC' }),
  account('aluguel', '3.3.01'),
  account('energia', '3.3.02'),
  account('receita', '3.1.01', { type: 'REVENUE' }),
  account('transito', '1.1.04', { type: 'ASSET', name: 'Transferências entre contas' }),
];

let seq = 0;
/** Cada teste usa um cliente próprio: o repositório em memória é compartilhado pelo arquivo. */
function setup(transactions: (clientId: string) => BankTransaction[]) {
  const clientId = `hook_${++seq}`;
  const repo = getRepository();
  const state = { transactions: [] as BankTransaction[], rules: [] as ClassificationRule[], locks: [] as PeriodLock[], error: null as string | null };
  const apply = <T,>(current: T, next: SetStateAction<T>): T => (typeof next === 'function' ? (next as (prev: T) => T)(current) : next);

  const store = (): ReconciliationStore => ({
    clientId,
    accounts: ACCOUNTS,
    accountsById: new Map(ACCOUNTS.map((a) => [a.id, a] as const)),
    range: null,
    transactions: state.transactions,
    rules: state.rules,
    locks: state.locks,
    lockedMonths: new Set(state.locks.map((l) => l.month)),
    setTransactions: (next) => void (state.transactions = apply(state.transactions, next)),
    setRules: (next) => void (state.rules = apply(state.rules, next)),
    setLocks: (next) => void (state.locks = apply(state.locks, next)),
    setError: (next) => void (state.error = apply(state.error, next)),
    mutate: async (failure, op) => {
      state.error = null;
      try {
        return await op();
      } catch (e) {
        state.error = `${failure} (${describeError(e)}).`;
        throw e;
      }
    },
    replaceLoaded: (updated) => {
      const byId = new Map(updated.map((t) => [t.id, t] as const));
      state.transactions = state.transactions.map((t) => byId.get(t.id) ?? t);
    },
  });

  /** Ações com o estado atual (como um novo render da tela). */
  const actions = (): ClassificationActions => {
    let out: ClassificationActions | undefined;
    renderToString(
      createElement(() => {
        out = useClassification(store());
        return null;
      })
    );
    return out!;
  };

  return {
    clientId,
    repo,
    state,
    actions,
    /** Grava os lançamentos e carrega os do período na "tela" (por padrão, todos). */
    async seed(loaded: (t: BankTransaction) => boolean = () => true) {
      await repo.insertTransactions(transactions(clientId));
      state.transactions = (await repo.listTransactions(clientId)).filter(loaded);
    },
    async close(month: string) {
      const lock: PeriodLock = { id: `${clientId}_${month}`, clientId, month, lockedAt: 'T', lockedByUid: 'u1' };
      await repo.closePeriod(lock, { id: '', clientId, action: 'PERIOD_CLOSE', actorUid: 'u1', at: 'T', month });
      state.locks = [...state.locks, lock];
    },
    stored: async (id: string) => (await repo.getTransaction(`${clientId}_${id}`))!,
    audit: async () => (await repo.listAudit(clientId)).map((a) => a.action).sort(),
  };
}

const tx = (clientId: string, id: string, date: string, amount: number, memo: string, extra: Partial<BankTransaction> = {}): BankTransaction => ({
  id: `${clientId}_${id}`,
  clientId,
  fitid: id,
  date,
  amount,
  type: amount < 0 ? 'DEBIT' : 'CREDIT',
  memo,
  status: 'PENDING',
  accountKey: 'k1',
  createdAt: '',
  ...extra,
});

beforeAll(async () => {
  setSession('org-hook', { uid: 'u1', email: 'contador@teste.com' });
  await getRepository().insertAccounts(ACCOUNTS);
});

describe('useClassification', () => {
  it('classifica, aprende a regra e aplica aos pendentes de outros períodos abertos', async () => {
    const t = setup((c) => [
      tx(c, 'a', '2025-03-10', -1200, 'ALUGUEL IMOBILIARIA CENTRAL 03'),
      tx(c, 'b', '2025-02-10', -1200, 'ALUGUEL IMOBILIARIA CENTRAL 02'),
      tx(c, 'c', '2025-01-10', -1200, 'ALUGUEL IMOBILIARIA CENTRAL 01'),
      tx(c, 'd', '2025-03-12', -90, 'CONTA DE LUZ'),
    ]);
    // Só março está na tela; janeiro está fechado.
    await t.seed((x) => x.date.startsWith('2025-03'));
    await t.close('2025-01');

    const result = await t.actions().classifyTransaction(`${t.clientId}_a`, 'aluguel', { learnRule: true, customPattern: 'Aluguel Imobiliaria Central' });

    expect(result.rule).toMatchObject({ clientId: t.clientId, pattern: 'aluguel imobiliaria central', accountId: 'aluguel', accountCode: '3.3.01', matchType: 'CONTAINS' });
    expect(result.propagated).toBe(1);
    expect(await t.stored('a')).toMatchObject({ status: 'RECONCILED', accountId: 'aluguel', matchedRuleId: result.rule!.id });
    // Fevereiro (fora da tela, aberto) foi auto-classificado; janeiro (fechado) e a luz, não.
    expect(await t.stored('b')).toMatchObject({ status: 'AUTO_CLASSIFIED', accountId: 'aluguel', matchedRuleId: result.rule!.id });
    expect((await t.stored('c')).status).toBe('PENDING');
    expect((await t.stored('d')).status).toBe('PENDING');
    // A tela reflete o que foi gravado, e a regra entra na lista.
    expect(t.state.transactions.find((x) => x.fitid === 'a')?.status).toBe('RECONCILED');
    expect(t.state.rules.map((r) => r.id)).toEqual([result.rule!.id]);
    expect(await t.repo.listRules(t.clientId)).toHaveLength(1);
    expect(await t.audit()).toEqual(['AUTO_CLASSIFY', 'CLASSIFY', 'PERIOD_CLOSE']);
  });

  it('reclassificar atualiza a regra de origem em vez de criar outra', async () => {
    const t = setup((c) => [tx(c, 'a', '2025-03-10', -300, 'ENERGISA FATURA 03')]);
    await t.seed();
    const first = await t.actions().classifyTransaction(`${t.clientId}_a`, 'aluguel', { learnRule: true, customPattern: 'energisa' });
    const second = await t.actions().classifyTransaction(`${t.clientId}_a`, 'energia', { learnRule: true, customPattern: 'energisa fatura' });

    expect(second.rule?.id).toBe(first.rule?.id);
    expect(await t.repo.listRules(t.clientId)).toMatchObject([{ pattern: 'energisa fatura', accountId: 'energia' }]);
    expect(t.state.rules).toHaveLength(1);
    expect(await t.stored('a')).toMatchObject({ status: 'RECONCILED', accountId: 'energia' });
    expect(await t.audit()).toEqual(['CLASSIFY', 'RECLASSIFY']);
  });

  it('recusa conta sintética, competência fechada e lançamento que não está carregado', async () => {
    const t = setup((c) => [tx(c, 'a', '2025-03-10', -50, 'ABERTO'), tx(c, 'b', '2025-02-10', -50, 'FECHADO')]);
    await t.seed();
    await t.close('2025-02');

    await expect(t.actions().classifyTransaction(`${t.clientId}_a`, 'grupo')).rejects.toThrow(/sintética/);
    expect(t.state.error).toMatch(/^Não foi possível salvar a classificação \(.*sintética/);
    await expect(t.actions().classifyTransaction(`${t.clientId}_b`, 'aluguel')).rejects.toThrow(/competência de fevereiro de 2025 está fechada/);
    await expect(t.actions().unreconcileTransaction(`${t.clientId}_b`)).rejects.toThrow(/fechada/);
    await expect(t.actions().classifyTransaction(`${t.clientId}_zzz`, 'aluguel')).rejects.toThrow(/não encontrado/);
    // Nada foi gravado nem auditado além do fechamento.
    expect((await t.stored('a')).status).toBe('PENDING');
    expect((await t.stored('b')).status).toBe('PENDING');
    expect(await t.audit()).toEqual(['PERIOD_CLOSE']);
  });

  it('rateio: recusa soma diferente do lançamento, grava o que fecha, e desfazer volta para pendente', async () => {
    const t = setup((c) => [tx(c, 'a', '2025-03-10', -100, 'FATURA CARTAO')]);
    await t.seed();
    const id = `${t.clientId}_a`;

    await expect(
      t.actions().splitTransaction(id, [
        { id: 's1', accountId: 'aluguel', cents: 6000, memo: '' },
        { id: 's2', accountId: 'energia', cents: 3000, memo: '' },
      ])
    ).rejects.toThrow(/soma do rateio difere/);
    expect((await t.stored('a')).status).toBe('PENDING');

    await t.actions().splitTransaction(id, [
      { id: 's1', accountId: 'aluguel', cents: 6000, memo: 'parte 1' },
      { id: 's2', accountId: 'energia', cents: 4000, memo: '' },
    ]);
    const split = await t.stored('a');
    expect(split).toMatchObject({ status: 'RECONCILED', isSplit: true });
    expect(split.splits?.map((s) => [s.accountId, s.amount])).toEqual([['aluguel', -60], ['energia', -40]]);

    await t.actions().unreconcileTransaction(id);
    const undone = await t.stored('a');
    expect(undone.status).toBe('PENDING');
    expect(undone.isSplit ?? false).toBe(false);
    expect(undone.splits ?? []).toEqual([]);
    expect(await t.audit()).toEqual(['SPLIT', 'UNRECONCILE']);
  });

  it('transferência entre contas próprias: concilia as duas pernas, e mexer em uma desfaz a outra', async () => {
    const t = setup((c) => [
      tx(c, 'saida', '2025-03-10', -500, 'TED ENVIADA', { accountKey: 'k1' }),
      tx(c, 'entrada', '2025-03-10', 500, 'TED RECEBIDA', { accountKey: 'k2' }),
    ]);
    await t.seed();
    const [out, inn] = ['saida', 'entrada'].map((f) => t.state.transactions.find((x) => x.fitid === f)!);
    const transit = ACCOUNTS.find((a) => a.id === 'transito')!;

    expect(await t.actions().reconcileTransfers([{ out, in: inn }] as never, transit)).toBe(1);
    expect(await t.stored('saida')).toMatchObject({ status: 'RECONCILED', accountId: 'transito', transferPairId: inn.id });
    expect(await t.stored('entrada')).toMatchObject({ status: 'RECONCILED', accountId: 'transito', transferPairId: out.id });

    // Reclassificar a saída como despesa desfaz o par: a entrada volta para pendente.
    await t.actions().classifyTransaction(out.id, 'aluguel');
    expect(await t.stored('saida')).toMatchObject({ status: 'RECONCILED', accountId: 'aluguel' });
    expect((await t.stored('saida')).transferPairId).toBeUndefined();
    const partner = await t.stored('entrada');
    expect(partner.status).toBe('PENDING');
    expect(partner.transferPairId).toBeUndefined();
    expect(t.state.transactions.find((x) => x.fitid === 'entrada')?.status).toBe('PENDING');
  });

  it('classificação em lote: uma regra só, pulando competência fechada e pernas de transferência', async () => {
    const t = setup((c) => [
      tx(c, 'a', '2025-03-05', -10, 'PADARIA DO ZE 1'),
      tx(c, 'b', '2025-03-06', -12, 'PADARIA DO ZE 2'),
      tx(c, 'c', '2025-02-06', -12, 'PADARIA DO ZE 0'),
      tx(c, 'd', '2025-03-07', -99, 'PADARIA DO ZE TED', { status: 'RECONCILED', accountId: 'transito', transferPairId: 'x' }),
      tx(c, 'e', '2025-04-01', -15, 'PADARIA DO ZE 3'),
    ]);
    await t.seed((x) => !x.date.startsWith('2025-04'));
    await t.close('2025-02');
    const ids = ['a', 'b', 'c', 'd'].map((f) => `${t.clientId}_${f}`);

    const result = await t.actions().classifyMany(ids, 'energia', { learnRule: true, customPattern: 'padaria do ze' });

    expect(result).toMatchObject({ classified: 2, skipped: 2, propagated: 1 });
    expect(await t.repo.listRules(t.clientId)).toHaveLength(1);
    expect((await t.stored('a')).status).toBe('RECONCILED');
    expect((await t.stored('b')).status).toBe('RECONCILED');
    expect((await t.stored('c')).status).toBe('PENDING');
    expect((await t.stored('d')).accountId).toBe('transito');
    // Abril não estava na tela: a regra recém-criada o classificou.
    expect(await t.stored('e')).toMatchObject({ status: 'AUTO_CLASSIFIED', accountId: 'energia' });
  });

  it('aprova só os auto-classificados de competência aberta', async () => {
    const t = setup((c) => [
      tx(c, 'a', '2025-03-05', -10, 'A', { status: 'AUTO_CLASSIFIED', accountId: 'aluguel' }),
      tx(c, 'b', '2025-02-05', -10, 'B', { status: 'AUTO_CLASSIFIED', accountId: 'aluguel' }),
      tx(c, 'c', '2025-03-06', -10, 'C'),
      tx(c, 'd', '2025-03-07', -10, 'D', { status: 'AUTO_CLASSIFIED' }),
    ]);
    await t.seed();
    await t.close('2025-02');

    expect((await t.actions().approveAutoClassified()).approved).toBe(1);
    expect((await t.stored('a')).status).toBe('RECONCILED');
    expect((await t.stored('b')).status).toBe('AUTO_CLASSIFIED');
    expect((await t.stored('c')).status).toBe('PENDING');
    expect((await t.stored('d')).status).toBe('AUTO_CLASSIFIED');
    expect(await t.actions().approveAutoClassified()).toEqual({ approved: 0, undo: null });
    expect(await t.audit()).toEqual(['APPROVE', 'PERIOD_CLOSE']);
  });

  it('pergunta ao cliente: abre, conclui e remove a pendência, com trilha de auditoria', async () => {
    const t = setup((c) => [tx(c, 'a', '2025-03-05', -77, 'PIX JOAO'), tx(c, 'b', '2025-03-06', -88, 'PIX MARIA')]);
    await t.seed();
    const [a, b] = ['a', 'b'].map((f) => `${t.clientId}_${f}`);

    await t.actions().askClient(a, '  O que é este Pix?  ');
    await t.actions().askClient(b, 'E este?');
    expect((await t.stored('a')).clientQuery).toMatchObject({ question: 'O que é este Pix?', status: 'OPEN', askedByUid: 'u1', askedByEmail: 'contador@teste.com' });
    expect((await t.repo.listOpenQueries(t.clientId)).map((q) => q.fitid).sort()).toEqual(['a', 'b']);

    await t.actions().resolveClientQuery(a);
    expect((await t.stored('a')).clientQuery?.status).toBe('RESOLVED');
    // Pergunta vazia remove a pendência.
    await t.actions().askClient(b, '   ');
    expect((await t.stored('b')).clientQuery).toBeUndefined();
    expect(await t.repo.listOpenQueries(t.clientId)).toEqual([]);
    expect(await t.audit()).toEqual(['QUERY_ASK', 'QUERY_ASK', 'QUERY_ASK', 'QUERY_RESOLVE']);
  });
  describe('Desfazer', () => {
    it('classificação com regra nova: volta o lançamento e os semelhantes a pendente e apaga a regra', async () => {
      const t = setup((c) => [tx(c, 'a', '2025-03-10', -1200, 'ALUGUEL CENTRAL 03'), tx(c, 'b', '2025-02-10', -1200, 'ALUGUEL CENTRAL 02')]);
      await t.seed((x) => x.date.startsWith('2025-03'));
      const before = await t.stored('a');
      const { undo, rule } = await t.actions().classifyTransaction(`${t.clientId}_a`, 'aluguel', { learnRule: true, customPattern: 'aluguel central' });
      expect(undo.changes).toHaveLength(2);
      expect(undo.rule).toEqual({ kind: 'created', rule });

      expect(await t.actions().undoChange(undo)).toBe(2);
      const a = await t.stored('a');
      expect(a.status).toBe('PENDING');
      expect([a.accountId, a.matchedRuleId, a.reconciledAt]).toEqual([undefined, undefined, undefined]);
      expect(a.memo).toBe(before.memo);
      expect((await t.stored('b')).status).toBe('PENDING');
      expect(await t.repo.listRules(t.clientId)).toEqual([]);
      expect(t.state.rules).toEqual([]);
      expect(t.state.transactions.find((x) => x.fitid === 'a')?.status).toBe('PENDING');
      expect(await t.audit()).toEqual(['AUTO_CLASSIFY', 'CLASSIFY', 'UNRECONCILE', 'UNRECONCILE']);
      expect((await t.repo.listAudit(t.clientId)).find((e) => e.action === 'UNRECONCILE')?.note).toMatch(/Desfazer/);
    });

    it('reclassificação: volta à conta anterior e à versão anterior da regra', async () => {
      const t = setup((c) => [tx(c, 'a', '2025-03-10', -300, 'ENERGISA FATURA 03')]);
      await t.seed();
      await t.actions().classifyTransaction(`${t.clientId}_a`, 'aluguel', { learnRule: true, customPattern: 'energisa' });
      const reconciled = await t.stored('a');
      const second = await t.actions().classifyTransaction(`${t.clientId}_a`, 'energia', { learnRule: true, customPattern: 'energisa fatura' });
      expect(second.undo.rule).toMatchObject({ kind: 'updated', previous: { pattern: 'energisa', accountId: 'aluguel' } });

      await t.actions().undoChange(second.undo);
      expect(await t.stored('a')).toMatchObject({ status: 'RECONCILED', accountId: 'aluguel', matchedRuleId: reconciled.matchedRuleId, reconciledAt: reconciled.reconciledAt });
      expect(await t.repo.listRules(t.clientId)).toMatchObject([{ pattern: 'energisa', accountId: 'aluguel' }]);
      expect(t.state.rules).toMatchObject([{ pattern: 'energisa', accountId: 'aluguel' }]);
      expect((await t.audit()).filter((a) => a === 'RECLASSIFY')).toHaveLength(2);
    });

    it('rateio e aprovação em lote também se desfazem', async () => {
      const t = setup((c) => [
        tx(c, 'a', '2025-03-10', -100, 'FATURA'),
        tx(c, 'b', '2025-03-11', -10, 'B', { status: 'AUTO_CLASSIFIED', accountId: 'aluguel', accountCode: '3.3.01' }),
      ]);
      await t.seed();
      const split = await t.actions().splitTransaction(`${t.clientId}_a`, [
        { id: 's1', accountId: 'aluguel', cents: 6000, memo: '' },
        { id: 's2', accountId: 'energia', cents: 4000, memo: '' },
      ]);
      await t.actions().undoChange(split);
      const a = await t.stored('a');
      expect(a.status).toBe('PENDING');
      expect(Boolean(a.isSplit)).toBe(false);
      expect(a.splits).toBeUndefined();

      const approved = await t.actions().approveAutoClassified();
      expect(approved.approved).toBe(1);
      await t.actions().undoChange(approved.undo!);
      const b = await t.stored('b');
      expect(b).toMatchObject({ status: 'AUTO_CLASSIFIED', accountId: 'aluguel' });
      expect(b.reconciledAt).toBeUndefined();
    });

    it('recusa desfazer se o lançamento mudou depois, sem gravar nada', async () => {
      const t = setup((c) => [tx(c, 'a', '2025-03-10', -50, 'PIX')]);
      await t.seed();
      const first = await t.actions().classifyTransaction(`${t.clientId}_a`, 'aluguel');
      await t.actions().classifyTransaction(`${t.clientId}_a`, 'energia');
      await expect(t.actions().undoChange(first.undo)).rejects.toThrow(/alterado depois/);
      expect(await t.stored('a')).toMatchObject({ status: 'RECONCILED', accountId: 'energia' });
      expect(t.state.error).toMatch(/Não foi possível desfazer/);
    });
  });
});
