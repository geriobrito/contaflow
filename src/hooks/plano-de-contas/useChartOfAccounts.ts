'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChartAccount, ClientCompany, LockState, PeriodLock } from '@/types/firestore';
import {
  applyDefaultChartTemplate,
  deleteChartAccount,
  getAccounts,
  getLockState,
  getPeriodLocks,
  saveClient,
} from '@/lib/services/data-service';
import { missingTemplateAccounts } from '@/lib/chart/itg1000';
import { describeError } from '@/lib/utils/errors';
import { reportError } from '@/lib/monitoring';

/** Resultado de uma gravação: se deu certo e o aviso a mostrar. */
export interface ChartActionResult {
  ok: boolean;
  message: string;
}

interface Loaded {
  id: string;
  accounts: ChartAccount[];
  lockState: LockState | null;
  locks: PeriodLock[];
}

async function fetchChart(id: string): Promise<Loaded> {
  const [accounts, lockState, locks] = await Promise.all([getAccounts(id), getLockState(id), getPeriodLocks(id)]);
  return { id, accounts, lockState, locks };
}

const EMPTY_ACCOUNTS: ChartAccount[] = [];

/**
 * Dados e gravações da tela "Plano de contas" de uma empresa: contas, fechamentos (para travar
 * a edição estrutural), contas do modelo do CFC que faltam e as que o contador mandou ignorar.
 */
export function useChartOfAccounts(client: ClientCompany | null, refreshClients: () => Promise<unknown>) {
  const clientId = client?.id;
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<{ id: string; message: string } | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    fetchChart(clientId)
      .then((loaded) => {
        if (!active) return;
        setData(loaded);
        setLoadError(null);
      })
      .catch((e: unknown) => {
        reportError(e, { area: 'plano-de-contas', op: 'carregar' });
        if (active) setLoadError({ id: clientId, message: e instanceof Error && e.message ? e.message : 'erro desconhecido' });
      });
    return () => {
      active = false;
    };
  }, [clientId]);

  /** Relê o plano depois de uma gravação; um erro aqui sobe para quem gravou. */
  const reload = useCallback(async () => {
    if (clientId) setData(await fetchChart(clientId));
  }, [clientId]);

  const current = data && data.id === clientId ? data : null;
  const accounts = current?.accounts ?? EMPTY_ACCOUNTS;
  const loadFailure = loadError && loadError.id === clientId ? loadError.message : null;
  const isLoading = Boolean(clientId) && !current && !loadFailure;
  // Carga que falhou não é plano vazio: não oferece o modelo por cima de dados que não foram lidos.
  const isEmpty = !isLoading && !loadFailure && accounts.length === 0;
  const lockedMonths = useMemo(() => (current?.locks ?? []).map((l) => l.month).sort(), [current]);

  // Plano em uso: contas do modelo que ainda faltam (ex.: IBS e CBS, incluídas depois), menos as
  // que o contador excluiu de propósito e mandou não oferecer mais.
  const ignored = useMemo(() => new Set(client?.ignoredTemplateCodes ?? []), [client]);
  const missing = useMemo(
    () =>
      clientId && current && !loadFailure && current.accounts.length > 0
        ? missingTemplateAccounts(clientId, current.accounts).filter((a) => !ignored.has(a.code))
        : [],
    [clientId, current, loadFailure, ignored]
  );

  /** Aplica o modelo do CFC: inteiro (plano vazio) ou só os códigos escolhidos. */
  const applyTemplate = async (codes?: string[]): Promise<ChartActionResult> => {
    if (!clientId) return { ok: false, message: 'Nenhuma empresa selecionada.' };
    setApplying(true);
    try {
      const created = await applyDefaultChartTemplate(clientId, codes);
      await reload();
      const message = codes
        ? `${created} conta(s) do modelo de plano de contas (CFC) adicionada(s).`
        : created > 0
          ? `${created} contas do modelo de plano de contas (CFC) adicionadas.`
          : 'O plano já contém todas as contas do modelo.';
      return { ok: true, message };
    } catch (e: unknown) {
      const what = codes ? 'completar o plano' : 'aplicar o modelo de plano de contas';
      return { ok: false, message: `Não foi possível ${what} (${describeError(e)}).` };
    } finally {
      setApplying(false);
    }
  };

  /** Grava a lista de contas do modelo que não devem mais ser oferecidas para esta empresa. */
  const setIgnoredCodes = async (codes: string[]): Promise<ChartActionResult> => {
    if (!client) return { ok: false, message: 'Nenhuma empresa selecionada.' };
    setApplying(true);
    try {
      await saveClient({ ...client, ignoredTemplateCodes: codes, updatedAt: new Date().toISOString() });
      await refreshClients();
      return {
        ok: true,
        message: codes.length
          ? `${codes.length} conta(s) do modelo não serão mais oferecidas para este cliente.`
          : 'As contas ignoradas voltam a ser oferecidas.',
      };
    } catch (e: unknown) {
      return { ok: false, message: `Não foi possível gravar a escolha (${describeError(e)}).` };
    } finally {
      setApplying(false);
    }
  };

  const deleteAccount = async (account: ChartAccount): Promise<ChartActionResult> => {
    try {
      await deleteChartAccount(account);
      await reload();
      return { ok: true, message: `Conta ${account.code} (${account.name}) excluída com sucesso.` };
    } catch (e: unknown) {
      return { ok: false, message: `Não foi possível excluir a conta ${account.code}: ${describeError(e)}` };
    }
  };

  return {
    accounts,
    lockState: current?.lockState ?? null,
    lockedMonths,
    loadFailure,
    isLoading,
    isEmpty,
    missing,
    ignored,
    applying,
    reload,
    applyTemplate,
    setIgnoredCodes,
    deleteAccount,
  };
}
