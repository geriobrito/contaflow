'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CompanyPorte, FixedAsset, JournalEntry } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import {
  type DisposalInput,
  deleteFixedAsset,
  disposeFixedAsset,
  loadFixedAssetContext,
  postMonthDepreciation,
  saveFixedAsset,
  undoFixedAssetDisposal,
  type FixedAssetContext,
} from '@/lib/services/fixed-asset-service';
import { lastDayOf, naturalAssetBalances, pendingDepreciationMonths, reconcileWithLedger, type ReconciliationRow } from '@/lib/fixed-assets';
import { buildBalanceSheet, buildPostings } from '@/lib/ledger';
import { loadLedgerWindow } from '@/lib/services/ledger-loader';
import { describeError } from '@/lib/utils/errors';
import { reportError } from '@/lib/monitoring';

const currentMonth = () => new Date().toISOString().slice(0, 7);

/**
 * Cadastro do imobilizado de uma empresa, com o plano, os fechamentos e a implantação, e as
 * gravações: bem novo ou alterado, exclusão, baixa, desfazer baixa e lançar a depreciação dos
 * meses abertos que ficaram para trás. Toda gravação recarrega.
 */
export function useFixedAssets(clientId: string | undefined, authorUid: string | undefined, porte?: CompanyPorte) {
  const [ctx, setCtx] = useState<(FixedAssetContext & { id: string; entries: JournalEntry[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    Promise.all([loadFixedAssetContext(clientId), getRepository().listJournalEntries(clientId)])
      .then(([context, entries]) => {
        if (!active) return;
        setCtx({ ...context, id: clientId, entries });
        setError(null);
      })
      .catch((e: unknown) => {
        if (!active) return;
        reportError(e, { area: 'imobilizado', op: 'carregar' });
        setError(`Não foi possível carregar o imobilizado (${describeError(e)}).`);
      });
    return () => {
      active = false;
    };
  }, [clientId, reloadCount]);

  const current = ctx?.id === clientId ? ctx : null;
  const assets = useMemo(() => current?.register?.assets ?? [], [current]);
  const reload = useCallback(() => setReloadCount((c) => c + 1), []);

  /** Competências abertas, até o mês atual, com depreciação a lançar ou atualizar. */
  const pendingMonths = useMemo(
    () =>
      current
        ? pendingDepreciationMonths({
            assets,
            untilMonth: currentMonth(),
            implantationMonth: current.implantationMonth,
            lockedMonths: current.lockedMonths,
            accounts: current.accounts,
            entries: current.entries,
          })
        : [],
    [current, assets]
  );

  /** Executa uma gravação; o erro fica na tela e volta como false. */
  const run = async (op: string, action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      reload();
      return true;
    } catch (e) {
      reportError(e, { area: 'imobilizado', op });
      setError(describeError(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const requireCtx = () => {
    if (!clientId || !current) throw new Error('Os dados ainda estão carregando.');
    return current;
  };

  const save = (asset: FixedAsset) => run('salvar bem', async () => saveFixedAsset(clientId!, asset, requireCtx(), porte));
  const remove = (asset: FixedAsset) => run('excluir bem', async () => deleteFixedAsset(clientId!, asset, requireCtx()));
  const dispose = (asset: FixedAsset, disposal: DisposalInput) =>
    run('baixar bem', async () => disposeFixedAsset(clientId!, asset, disposal, requireCtx(), authorUid ?? 'local'));
  const undoDisposal = (asset: FixedAsset) => run('desfazer baixa', async () => undoFixedAssetDisposal(clientId!, asset, requireCtx()));

  /** Lança (ou atualiza) a depreciação das competências pendentes, uma a uma, em ordem. */
  const postPending = (months: readonly string[]) =>
    run('lançar depreciação', async () => {
      let done = 0;
      try {
        for (const month of months) {
          await postMonthDepreciation(clientId!, month, authorUid ?? 'local');
          done++;
        }
      } catch (e) {
        throw new Error(`${done} de ${months.length} competência(s) lançada(s); a seguinte falhou (${describeError(e)}).`);
      }
    });

  return { ctx: current, assets, pendingMonths, error, busy, reload, save, remove, dispose, undoDisposal, postPending };
}

/**
 * Conferência com o balancete sob demanda: lê os lançamentos (o mínimo, a partir das
 * competências fechadas) só quando pedida, porque custa leituras.
 */
export function useFixedAssetReconciliation(clientId: string | undefined, ctx: FixedAssetContext | null) {
  const [result, setResult] = useState<{ key: string; month: string; rows: ReconciliationRow[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async (month: string) => {
    if (!clientId || !ctx?.register) return;
    setLoading(true);
    setError(null);
    try {
      const repo = getRepository();
      const date = lastDayOf(month);
      const [banks, openings, journalEntries] = await Promise.all([repo.listBankAccounts(clientId), repo.getOpeningBalances(clientId), repo.listJournalEntries(clientId)]);
      const window = await loadLedgerWindow({ clientId, accounts: ctx.accounts, banks, from: `${month.slice(0, 4)}-01-01`, until: date });
      const postings = buildPostings(window.transactions, banks, ctx.accounts, date, openings, journalEntries, window.carry);
      const bs = buildBalanceSheet(postings, ctx.accounts, date);
      const balances = naturalAssetBalances(bs.assets, ctx.accounts);
      const rows = reconcileWithLedger({
        assets: ctx.register.assets,
        month,
        implantationMonth: ctx.implantationMonth,
        accounts: ctx.accounts,
        ledgerBalance: (id) => balances.get(id) ?? 0,
      });
      setResult({ key: clientId, month, rows });
    } catch (e) {
      reportError(e, { area: 'imobilizado', op: 'conferir com o balancete' });
      setError(`Não foi possível conferir (${describeError(e)}).`);
    } finally {
      setLoading(false);
    }
  };

  return { result: result?.key === clientId ? result : null, loading, error, check, clear: () => setResult(null) };
}
