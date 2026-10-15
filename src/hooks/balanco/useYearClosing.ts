'use client';

import { useMemo, useState } from 'react';
import type { AuditEntry, ChartAccount, JournalEntry, PeriodLock } from '@/types/firestore';
import type { Posting } from '@/lib/ledger';
import { getRepository } from '@/lib/services/data-service';
import { getActor } from '@/lib/data/scope';
import { describeError } from '@/lib/utils/errors';
import { formatCurrency } from '@/lib/utils/formatters';
import { buildClosingDrafts, describeResult, missingClosingAccounts, openingAccountBalance, resultBalances, yearClosingState } from '@/lib/year-closing';

const newJournalId = () => `je_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

/**
 * Encerramento e reabertura do exercício de `year`. Todos os lançamentos do encerramento e o
 * registro de auditoria entram (ou saem) numa única gravação: uma queda de rede não deixa o
 * exercício pela metade. Depois de gravar, `onChanged` recarrega os dados da tela.
 */
export function useYearClosing(args: {
  clientId: string | undefined;
  year: string;
  /** Partidas do exercício sem o encerramento dele (ver `withoutClosingOf`). */
  postings: readonly Posting[] | null;
  accounts: readonly ChartAccount[];
  journalEntries: readonly JournalEntry[];
  locks: readonly PeriodLock[];
  monthsWithData: Iterable<string>;
  implantation: string | null;
  onChanged: () => void;
}) {
  const { clientId, year, postings, accounts, journalEntries, locks, monthsWithData, implantation, onChanged } = args;
  const [busy, setBusy] = useState<'close' | 'reopen' | null>(null);

  const state = useMemo(
    () => (postings ? yearClosingState({ year, postings, accounts, journalEntries, locks, monthsWithData, implantation }) : null),
    [year, postings, accounts, journalEntries, locks, monthsWithData, implantation]
  );

  const audit = (id: string, action: 'YEAR_CLOSE' | 'YEAR_REOPEN', note: string): AuditEntry => {
    const actor = getActor();
    return {
      id,
      clientId: clientId!,
      action,
      actorUid: actor.uid,
      ...(actor.email ? { actorEmail: actor.email } : {}),
      at: new Date().toISOString(),
      month: `${year}-12`,
      note,
    };
  };

  /** Lança o encerramento inteiro numa única gravação: entra tudo ou nada. */
  const close = async () => {
    if (!clientId || !state?.canClose || !postings) return;
    setBusy('close');
    const repo = getRepository();
    try {
      // ARE e Lucros/Prejuízos Acumulados entram no plano se faltarem.
      const missing = missingClosingAccounts(clientId, accounts);
      if (missing.length > 0) await repo.insertAccounts(missing);
      const chart = [...accounts, ...missing];
      const drafts = buildClosingDrafts(year, resultBalances(postings, chart, year), chart, openingAccountBalance(postings, chart, year));
      const actor = getActor();
      const now = new Date().toISOString();
      await repo.closeYear(
        drafts.map((draft) => ({ ...draft, id: newJournalId(), clientId, createdAt: now, updatedAt: now, createdByUid: actor.uid })),
        audit(`${clientId}_${year}_close_${Date.now().toString(36)}`, 'YEAR_CLOSE', `Exercício ${year} (${describeResult(state.netResult)}${state.openingTransfer ? `; balanço de abertura de ${formatCurrency(state.openingTransfer)}` : ''}) em ${drafts.length} lançamento(s)`)
      );
    } catch (e) {
      console.error('Erro ao encerrar o exercício:', e);
      throw new Error(`Não foi possível encerrar o exercício; nada foi gravado (${describeError(e)}).`);
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  /** Apaga todos os lançamentos do encerramento numa única gravação. */
  const reopen = async () => {
    if (!clientId || !state?.closed) return;
    const closings = new Set(state.entries.map((e) => e.closingAuditId));
    const [closingAuditId] = [...closings];
    if (closings.size !== 1 || !closingAuditId) throw new Error('Os lançamentos de encerramento deste exercício não pertencem a um único encerramento. Exclua-os pela auditoria do Diário.');
    setBusy('reopen');
    try {
      await getRepository().reopenYear(
        state.entries,
        audit(`${closingAuditId}_reopen`, 'YEAR_REOPEN', `Exercício ${year} · excluídos os lançamentos ${state.entries.map((e) => `#${e.entryNumber}`).join(', ')}`)
      );
    } catch (e) {
      console.error('Erro ao reabrir o exercício:', e);
      throw new Error(`Não foi possível reabrir o exercício; nada foi excluído (${describeError(e)}).`);
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  return { state, busy, close, reopen };
}
