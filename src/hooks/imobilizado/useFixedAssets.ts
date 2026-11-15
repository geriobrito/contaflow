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
import {
  lastDayOf,
  naturalAssetBalances,
  pendingDepreciationMonths,
  reconcileWithLedger,
  unlinkedAssetSaleInvoices,
  unregisteredAssetInvoices,
  type ReconciliationRow,
  type UnregisteredAssetInvoice,
} from '@/lib/fixed-assets';
import { buildBalanceSheet, buildPostings } from '@/lib/ledger';
import { loadLedgerWindow } from '@/lib/services/ledger-loader';
import { describeError, isRegisterConflictError } from '@/lib/utils/errors';
import { reportError } from '@/lib/monitoring';
import { todayISO } from '@/lib/business-days';

const currentMonth = () => todayISO().slice(0, 7);

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
    loadFixedAssetContext(clientId)
      .then(async (context) => {
        const list = context.register?.assets ?? [];
        const start = context.implantationMonth ? `${context.implantationMonth}-01` : '0000-01-01';
        const entries = list.length
          ? await getRepository().listJournalEntries(clientId, { start, end: lastDayOf(currentMonth()) })
          : [];
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
      if (isRegisterConflictError(e)) reload();
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
  const [result, setResult] = useState<{
    key: string;
    month: string;
    rows: ReconciliationRow[];
    unregisteredInvoices: UnregisteredAssetInvoice[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async (month: string) => {
    if (!clientId || !ctx?.register) return;
    setLoading(true);
    setError(null);
    try {
      const repo = getRepository();
      const date = lastDayOf(month);
      const yearStart = `${month.slice(0, 4)}-01-01`;
      const [banks, openings, journalEntries, invoices] = await Promise.all([
        repo.listBankAccounts(clientId),
        repo.getOpeningBalances(clientId),
        repo.listJournalEntries(clientId, { start: '0000-01-01', end: date }),
        repo.listInvoices(clientId, { start: yearStart, end: date }),
      ]);
      const window = await loadLedgerWindow({ clientId, accounts: ctx.accounts, banks, from: yearStart, until: date });
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
      const unregisteredInvoices = unregisteredAssetInvoices(invoices, ctx.register.assets);
      setResult({ key: clientId, month, rows, unregisteredInvoices });
    } catch (e) {
      reportError(e, { area: 'imobilizado', op: 'conferir com o balancete' });
      setError(`Não foi possível conferir (${describeError(e)}).`);
    } finally {
      setLoading(false);
    }
  };

  return { result: result?.key === clientId ? result : null, loading, error, check, clear: () => setResult(null) };
}

/**
 * Busca sob demanda notas fiscais de compra/venda de imobilizado no ano da competência.
 */
export function useAssetInvoicesRadar(clientId: string | undefined, assets: readonly FixedAsset[]) {
  const [state, setState] = useState<{ key: string; year: string; invoices: Awaited<ReturnType<ReturnType<typeof getRepository>['listInvoices']>> } | null>(null);
  const [loading, setLoading] = useState(false);

  const scanYear = useCallback(
    async (year: string) => {
      if (!clientId) return;
      setLoading(true);
      try {
        const invoices = await getRepository().listInvoices(clientId, { start: `${year}-01-01`, end: `${year}-12-31` });
        setState({ key: `${clientId}|${year}`, year, invoices });
      } catch (e) {
        reportError(e, { area: 'imobilizado', op: 'buscar notas de imobilizado' });
      } finally {
        setLoading(false);
      }
    },
    [clientId]
  );

  const currentInvoices = useMemo(() => (state && clientId && state.key.startsWith(`${clientId}|`) ? state.invoices : null), [state, clientId]);
  const unregistered = useMemo(() => (currentInvoices ? unregisteredAssetInvoices(currentInvoices, assets) : null), [currentInvoices, assets]);
  const saleSuggestions = useMemo(() => (currentInvoices ? unlinkedAssetSaleInvoices(currentInvoices, assets) : []), [currentInvoices, assets]);

  return { unregistered, saleSuggestions, scannedYear: state?.year ?? null, loading, scanYear };
}
