'use client';

import { useMemo } from 'react';
import type { BankTransaction, ChartAccount } from '@/types/firestore';
import { directionOf, suggestAccounts, type AccountSuggestion } from '@/lib/account-suggestions';
import { loadRecentAccounts } from '@/lib/recent-accounts';
import { payeeKey, type PayeeGroup } from '@/lib/payee';

interface AccountSuggestionsParams {
  clientId: string | null;
  accounts: readonly ChartAccount[];
  /** Lançamentos carregados na tela (o histórico das sugestões). */
  transactions: readonly BankTransaction[];
  /** Lançamento aberto no Classificar e a conta da nota fiscal casada com ele. */
  selected: BankTransaction | null;
  invoiceAccountId?: string | null;
  /** Grupo aberto em Por favorecido. */
  group: PayeeGroup | null;
  /** Lançamentos marcados para a classificação em lote (só com o modal aberto). */
  bulk: readonly BankTransaction[] | null;
}

const NONE: readonly AccountSuggestion[] = [];

/**
 * Contas sugeridas para cada seletor da Conciliação (único, por favorecido e em lote). As recentes
 * são relidas do navegador cada vez que um seletor abre.
 */
export function useAccountSuggestions({ clientId, accounts, transactions, selected, invoiceAccountId, group, bulk }: AccountSuggestionsParams) {
  const forSelected = useMemo(
    () =>
      selected
        ? suggestAccounts({
            memo: selected.memo,
            direction: directionOf(selected.amount),
            accounts,
            history: transactions,
            excludeIds: new Set([selected.id]),
            invoiceAccountId,
            recent: loadRecentAccounts(clientId),
          })
        : NONE,
    [selected, accounts, transactions, invoiceAccountId, clientId]
  );

  const forGroup = useMemo(
    () =>
      group
        ? suggestAccounts({
            memo: group.transactions[0]?.memo ?? null,
            direction: group.direction,
            accounts,
            history: transactions,
            excludeIds: new Set(group.transactions.map((t) => t.id)),
            recent: loadRecentAccounts(clientId),
          })
        : NONE,
    [group, accounts, transactions, clientId]
  );

  const forBulk = useMemo(() => {
    if (!bulk?.length) return NONE;
    const directions = new Set(bulk.map((t) => directionOf(t.amount)));
    const payees = new Set(bulk.map((t) => payeeKey(t.memo)));
    return suggestAccounts({
      memo: payees.size === 1 ? bulk[0].memo : null,
      direction: directions.size === 1 ? directionOf(bulk[0].amount) : null,
      accounts,
      history: transactions,
      excludeIds: new Set(bulk.map((t) => t.id)),
      recent: loadRecentAccounts(clientId),
    });
  }, [bulk, accounts, transactions, clientId]);

  return { forSelected, forGroup, forBulk };
}
